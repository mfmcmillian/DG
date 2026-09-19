import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isStateSyncronized } from '@dcl/sdk/network'
import { CombatPose } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { CharacterAppearance } from './appearance'
import { EquipmentLoadout, EQUIPMENT_SLOTS } from './equipmentCatalog'
import { dropHero, heroHealth, rememberHeartDrop, resetHero } from './heroVitals'
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
/** A hero silent this long and back again (title screen, reconnect) restarts at full health. */
const FRESH_HERO_SILENCE = 3
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

/**
 * The address exactly as the renderer spells it. AvatarAttach and the hide
 * area's exclusions are matched case-sensitively against that spelling, so
 * the normalised lower-case id must not be used for them.
 */
export function playerAddressAsReported(address: string): string | undefined {
  const want = address.toLowerCase()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address && identity.address.toLowerCase() === want) return identity.address
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

/** Client -> server: the hero stepped onto a heart it saw at (x, z). Healing comes back as `heal`. */
export function publishPickup(x: number, z: number) {
  if (!clientReady()) return
  void room.send('pickup', { x, z })
}

/** Client -> server: the local recover countdown ended and no `revive` has arrived. */
export function publishRespawn() {
  const id = localAddress()
  if (!clientReady() || !id) return
  void room.send('respawn', { id })
}

/**
 * Client -> server: one line of client state for the server log. Sent even
 * before the state sync so a client that never syncs still shows up (the room
 * queues it until the connection is up).
 */
export function publishDiag(note: string) {
  if (hostMode) return
  void room.send('diag', { note })
}

/** Whether this client has received the server's state (its messages are sent, not queued). */
export function isClientSynced(): boolean {
  return clientReady()
}

export function publishEnemies(list: EnemySnap[]) {
  if (!hostMode) return
  void room.send('enemies', { list })
}

export function publishLoot(x: number, z: number, coin: number, heart: number, dusk: boolean) {
  if (!hostMode) return
  rememberHeartDrop(x, z, heart)
  void room.send('loot', { x, z, coin, heart, dusk })
}

export type HeroHit = {
  id: string; damage: number; stagger: number; yaw: number; health: number; blocked: boolean; dodged: boolean
}

let onSwing: ((id: string, motion: string, facing: number) => void) | undefined
let onHitEnemy: ((id: string, i: number, motion: string, finisher: boolean) => void) | undefined
let onHitPlayer: ((hit: HeroHit) => void) | undefined
let onHeal: ((id: string, amount: number, health: number) => void) | undefined
let onRevive: ((id: string, health: number) => void) | undefined
let onSelf: ((health: number) => void) | undefined
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
  heal?: typeof onHeal
  revive?: typeof onRevive
  /** The server's echo of our own `player` packet, carrying its idea of our health. */
  self?: typeof onSelf
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
  if (handlers.heal) onHeal = handlers.heal
  if (handlers.revive) onRevive = handlers.revive
  if (handlers.self) onSelf = handlers.self
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
    // Prefer the position the runtime reports for the avatar; fall back to the
    // hero's own packet when the runtime has none for them (the host does not
    // always surface player transforms), so the dungeon never stalls.
    const position = transform?.position ?? Vector3.create(p.x, p.y, p.z)
    list.push({
      address: p.id,
      position,
      facing: p.f,
      // The host reads its own ledger; clients get that ledger relayed inside `player`.
      health: hostMode ? heroHealth(p.id) : p.health,
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
    const previous = remotes.get(id)
    const isNew = previous === undefined
    // Health is never taken from the client: a new hero, a different character
    // or a return after silence starts full; otherwise the ledger stands.
    if (isNew || previous.cid !== p.cid || (silentFor.get(id) ?? 0) > FRESH_HERO_SILENCE) resetHero(id)
    const net = asPlayer({ ...p, id, motion: p.motion as EquipmentMotion, health: heroHealth(id) })
    remember(net)
    missingSince.delete(id)
    void room.send('player', net)
    if (!isNew) return
    const entity = playerEntityByAddress(id)
    const tracked = entity !== undefined && Transform.has(entity)
    console.log(`[Server] hero ${id} joined as ${p.cid}; runtime transform: ${tracked ? 'yes' : 'no'}; heroes: ${remotes.size}`)
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
  room.onMessage('diag', (msg, context) => {
    if (!context) return
    console.log(`[Client ${context.from}] ${msg.note}`)
  })
  engine.addSystem(pruneGonePlayers)
  console.log('[Server] multiplayer room ready')
}

function bindClient() {
  room.onMessage('player', (p) => {
    if (!p.id) return
    if (p.id === localAddress()) {
      onSelf?.(p.health)
      return
    }
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
    onHitPlayer?.(msg)
  })
  room.onMessage('heal', (msg) => {
    onHeal?.(msg.id, msg.amount, msg.health)
  })
  room.onMessage('revive', (msg) => {
    onRevive?.(msg.id, msg.health)
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

let heartbeatAge = 0
const HEARTBEAT_SECONDS = 15

function pruneGonePlayers(dt: number) {
  const present = new Set<string>()
  let tracked = 0
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!identity.address) continue
    const id = identity.address.toLowerCase()
    present.add(id)
    seenPlayers.add(id)
    missingSince.delete(id)
    if (Transform.has(entity)) tracked++
  }
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  heartbeatAge += span
  if (heartbeatAge >= HEARTBEAT_SECONDS) {
    heartbeatAge = 0
    console.log(`[Server] heartbeat: ${present.size} player entit(ies), ${tracked} with transform, ${remotes.size} hero(es) publishing`)
  }
  for (const id of [...remotes.keys()]) {
    // Packet silence runs for everyone (it also tells a returning hero apart).
    const silence = (silentFor.get(id) ?? 0) + span
    silentFor.set(id, silence)
    if (present.has(id)) continue
    let gone: boolean
    if (seenPlayers.has(id)) {
      // Known player whose entity vanished: short grace for comms hiccups.
      const missing = (missingSince.get(id) ?? 0) + span
      missingSince.set(id, missing)
      gone = missing >= LEAVE_GRACE
    } else {
      // Never surfaced as a player entity here; fall back to packet silence.
      gone = silence >= SILENCE_LIMIT
    }
    if (!gone) continue
    remotes.delete(id)
    seenPlayers.delete(id)
    missingSince.delete(id)
    silentFor.delete(id)
    dropHero(id)
    console.log(`[Server] hero ${id} left; heroes: ${remotes.size}`)
    void room.send('leave', { id })
  }
}
