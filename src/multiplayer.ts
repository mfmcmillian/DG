import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { CombatPose } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { CharacterAppearance } from './appearance'
import { EquipmentLoadout, EQUIPMENT_SLOTS } from './equipmentCatalog'
import { room } from './shared/messages'

export type NetFighter = CombatPose & {
  address: string
  health: number
  invulnerable: boolean
  blocking: boolean
  local: boolean
}

export type PlayerNet = {
  id: string
  x: number
  y: number
  z: number
  f: number
  motion: EquipmentMotion
  cid: string
  body: string
  hair: string
  hc: string
  skin: string
  loadout: EquipmentLoadout
  block: boolean
  dodge: boolean
  health: number
}

export type EnemySnap = {
  i: number
  x: number
  z: number
  f: number
  h: number
  m: EquipmentMotion
  dead: boolean
  engaged: boolean
}

export type ImpactNet = {
  x: number
  y: number
  z: number
  heavy: boolean
  blocked: boolean
  label: string
  kind: string
  sound: string
  vol: number
}

const remotes = new Map<string, PlayerNet>()
const seenPlayers = new Set<string>()
const missingSince = new Map<string, number>()
/** Seconds since the last `player` packet from each remote. */
const silentFor = new Map<string, number>()
/** How long a player entity may be missing before the server announces a leave. */
const LEAVE_GRACE = 1.5
/**
 * Clients publish at ~8 Hz even when idle, so this much silence means the
 * peer is gone and a leave was lost or never produced.
 */
const SILENCE_LIMIT = 20
let initialized = false
let hostMode = false

function asPlayer(p: PlayerNet): PlayerNet {
  return {
    ...p,
    id: p.id.toLowerCase(),
    motion: p.motion as EquipmentMotion,
    loadout: emptyLoadout(p)
  }
}

function clientReady() {
  return !hostMode && isStateSyncronized()
}

/**
 * `server` is resolved once by main() from the runtime; it is held here so the
 * rest of the game never depends on the SDK's asynchronously-filled atom.
 */
export function initializeMultiplayer(server: boolean) {
  if (initialized) return
  initialized = true
  hostMode = server
  if (server) bindServer()
  else bindClient()
}

/** The headless server is the only host. Clients never simulate enemies or loot. */
export function isHost(): boolean {
  return hostMode
}

export function localAddress(): string {
  const id = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address
  return id ? id.toLowerCase() : ''
}

export function remotePlayers(): Iterable<PlayerNet> {
  return remotes.values()
}

export function remoteCount(): number {
  return remotes.size
}

export function playerEntityByAddress(address: string): ReturnType<typeof engine.addEntity> | undefined {
  const want = address.toLowerCase()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address && identity.address.toLowerCase() === want) return entity
  }
  return undefined
}

export function publishPlayer(p: PlayerNet): boolean {
  if (!clientReady() || !p.id) return false
  void room.send('player', asPlayer(p))
  return true
}

export function publishSwing(motion: string, facing: number) {
  const id = localAddress()
  if (!clientReady() || !id) return
  void room.send('swing', { id, motion, facing })
}

export function publishHitEnemy(i: number, motion: string, finisher: boolean) {
  const id = localAddress()
  if (!clientReady() || !id) return
  void room.send('hitEnemy', { id, i, motion, finisher })
}

export function publishImpact(p: ImpactNet) {
  const id = localAddress()
  if (!clientReady() || !id) return
  void room.send('impact', { ...p, id })
}

export function publishHitPlayer(id: string, damage: number, stagger: number, yaw: number) {
  if (!hostMode) return
  // Broadcast: `to` matching is case-sensitive in some runtimes, and the
  // struck client already ignores packets that are not addressed to it.
  void room.send('hitPlayer', { id: id.toLowerCase(), damage, stagger, yaw })
}

export function publishEnemies(list: EnemySnap[]) {
  if (!hostMode) return
  void room.send('enemies', { list })
}

export function publishLoot(x: number, z: number, coin: number, heart: number, dusk: boolean) {
  if (!hostMode) return
  void room.send('loot', { x, z, coin, heart, dusk })
}

let onSwing: ((id: string, motion: string, facing: number) => void) | undefined
let onHitEnemy: ((id: string, i: number, motion: string, finisher: boolean) => void) | undefined
let onHitPlayer: ((id: string, damage: number, stagger: number, yaw: number) => void) | undefined
let onImpact: ((p: ImpactNet) => void) | undefined
let onEnemies: ((list: EnemySnap[]) => void) | undefined
let onLoot: ((x: number, z: number, coin: number, heart: number, dusk: boolean) => void) | undefined
let onRemote: ((p: PlayerNet) => void) | undefined
let onGone: ((id: string) => void) | undefined
let onJoin: ((id: string) => void) | undefined

export function setMultiplayerHandlers(handlers: {
  swing?: typeof onSwing
  hitEnemy?: typeof onHitEnemy
  hitPlayer?: typeof onHitPlayer
  impact?: typeof onImpact
  enemies?: typeof onEnemies
  loot?: typeof onLoot
  remote?: typeof onRemote
  gone?: typeof onGone
  join?: typeof onJoin
}) {
  if (handlers.swing) onSwing = handlers.swing
  if (handlers.hitEnemy) onHitEnemy = handlers.hitEnemy
  if (handlers.hitPlayer) onHitPlayer = handlers.hitPlayer
  if (handlers.impact) onImpact = handlers.impact
  if (handlers.enemies) onEnemies = handlers.enemies
  if (handlers.loot) onLoot = handlers.loot
  if (handlers.remote) onRemote = handlers.remote
  if (handlers.gone) onGone = handlers.gone
  if (handlers.join) onJoin = handlers.join
}

export function allFighters(local?: (CombatPose & { health: number; invulnerable: boolean; blocking: boolean }) ): NetFighter[] {
  const list: NetFighter[] = []
  const me = localAddress()
  if (local && me) {
    list.push({ ...local, address: me, local: true })
  }
  for (const p of remotes.values()) {
    const entity = playerEntityByAddress(p.id)
    const transform = entity !== undefined ? Transform.getOrNull(entity) : undefined
    // On the server, never fight from a client-reported coordinate.
    if (hostMode && !transform) continue
    const position = transform?.position ?? Vector3.create(p.x, p.y, p.z)
    list.push({
      address: p.id,
      position,
      facing: p.f,
      health: p.health,
      invulnerable: p.dodge,
      blocking: p.block,
      local: false
    })
  }
  return list
}

export function appearanceOf(p: PlayerNet): CharacterAppearance {
  return { bodyType: p.body === 'female' ? 'female' : 'male', hairStyle: p.hair, hairColor: p.hc, skinTone: p.skin }
}

export function emptyLoadout(p: PlayerNet): EquipmentLoadout {
  const loadout = { ...(p.loadout ?? {}) } as EquipmentLoadout
  for (const slot of EQUIPMENT_SLOTS) {
    if (!loadout[slot.id]) loadout[slot.id] = slot.id === 'weapon' ? 'none-weapon' : `none-${slot.id}`
  }
  return loadout
}

function remember(p: PlayerNet) {
  remotes.set(p.id, p)
  silentFor.set(p.id, 0)
}

function forget(id: string) {
  remotes.delete(id)
  silentFor.delete(id)
  onGone?.(id)
}

function bindServer() {
  room.onMessage('player', (p, context) => {
    if (!context) return
    const id = context.from.toLowerCase()
    const isNew = !remotes.has(id)
    const net = asPlayer({ ...p, id, motion: p.motion as EquipmentMotion })
    remember(net)
    missingSince.delete(id)
    void room.send('player', net)
    if (!isNew) return
    // A joiner otherwise waits until every other hero happens to move.
    for (const other of remotes.values()) {
      if (other.id !== id) void room.send('player', other)
    }
    onJoin?.(id)
  })
  room.onMessage('swing', (msg, context) => {
    if (!context) return
    void room.send('swing', { id: context.from.toLowerCase(), motion: msg.motion, facing: msg.facing })
  })
  room.onMessage('hitEnemy', (msg, context) => {
    if (!context) return
    onHitEnemy?.(context.from.toLowerCase(), msg.i, msg.motion, msg.finisher)
  })
  room.onMessage('impact', (msg, context) => {
    if (!context) return
    void room.send('impact', { ...msg, id: context.from.toLowerCase() })
  })
  engine.addSystem(pruneGonePlayers)
  console.log('[Server] multiplayer room ready')
}

function bindClient() {
  room.onMessage('player', (p) => {
    if (!p.id || p.id === localAddress()) return
    const net = asPlayer({ ...p, motion: p.motion as EquipmentMotion })
    remember(net)
    onRemote?.(net)
  })
  room.onMessage('leave', (msg) => {
    forget(msg.id)
  })
  room.onMessage('swing', (msg) => {
    if (msg.id === localAddress()) return
    onSwing?.(msg.id, msg.motion, msg.facing)
  })
  room.onMessage('hitPlayer', (msg) => {
    onHitPlayer?.(msg.id, msg.damage, msg.stagger, msg.yaw)
  })
  room.onMessage('impact', (msg) => {
    if (msg.id === localAddress()) return
    onImpact?.(msg)
  })
  room.onMessage('enemies', (msg) => {
    onEnemies?.(msg.list.map((e) => ({ ...e, m: e.m as EquipmentMotion })))
  })
  room.onMessage('loot', (msg) => {
    onLoot?.(msg.x, msg.z, msg.coin, msg.heart, msg.dusk)
  })
  engine.addSystem(pruneSilentRemotes)
}

/** Client fallback for a lost `leave`: drop a hero whose owner is silent and no longer in the scene. */
function pruneSilentRemotes(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  for (const id of [...remotes.keys()]) {
    const silence = (silentFor.get(id) ?? 0) + span
    silentFor.set(id, silence)
    if (silence < SILENCE_LIMIT) continue
    if (playerEntityByAddress(id) !== undefined) continue
    forget(id)
  }
}

function pruneGonePlayers(dt: number) {
  const present = new Set<string>()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!identity.address) continue
    const id = identity.address.toLowerCase()
    present.add(id)
    seenPlayers.add(id)
    missingSince.delete(id)
  }
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  for (const id of [...remotes.keys()]) {
    if (present.has(id)) {
      silentFor.set(id, 0)
      continue
    }
    let gone: boolean
    if (seenPlayers.has(id)) {
      // Known player whose entity vanished: short grace for comms hiccups.
      const missing = (missingSince.get(id) ?? 0) + span
      missingSince.set(id, missing)
      gone = missing >= LEAVE_GRACE
    } else {
      // Never surfaced as a player entity here; fall back to packet silence.
      const silence = (silentFor.get(id) ?? 0) + span
      silentFor.set(id, silence)
      gone = silence >= SILENCE_LIMIT
    }
    if (!gone) continue
    remotes.delete(id)
    seenPlayers.delete(id)
    missingSince.delete(id)
    silentFor.delete(id)
    void room.send('leave', { id })
  }
}
