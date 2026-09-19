import { CreatedBy, engine, Entity, EntityState, PlayerIdentityData, RealmInfo, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isStateSyncronized, syncEntity } from '@dcl/sdk/network'
import { CombatPose, MAX_COMBAT_HEALTH } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { CharacterAppearance } from './appearance'
import { EquipmentLoadout, EQUIPMENT_SLOTS, sanitizeLoadout } from './equipmentCatalog'
import { dropHero, heroHealth, initializeHeroVitals, rememberHeartDrop, resetHero } from './heroVitals'
import { HeroBody, HeroBodyValue } from './shared/heroBody'
import { room } from './shared/messages'
import { enterSolo, isSolo, onNet, sendNet } from './net'
import { GAME_VERSION } from './version'

export type NetFighter = CombatPose & {
  address: string
  health: number
  invulnerable: boolean
  blocking: boolean
  local: boolean
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

/** What the owner writes into its HeroBody each time something changed. */
export type HeroPublish = Omit<HeroBodyValue, 'id' | 'beat'>

let initialized = false
/** Running as the headless server. */
let hostMode = false
/** Seconds this client has waited for the server's state without an answer. */
let unsyncedFor = 0
/**
 * A client that has waited this long for the server gives up on it and hosts
 * its own fight: enemies, loot and hero health run here, messages loop back
 * locally. Other players in the room are not shared with in that mode.
 */
const SOLO_AFTER_SECONDS = 12

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

const hostStartHooks: Array<() => void> = []

/**
 * Run `fn` once this runtime hosts the fight: at once on the headless server,
 * or the moment a client gives up on the server and goes solo. Modules that own
 * server-side state (parties, saved heroes) register their bindings this way.
 */
export function onHostStart(fn: () => void) {
  hostStartHooks.push(fn)
  if (isHost()) fn()
}

/** Whoever runs the fight: the headless server, or a client that went solo. */
export function isHost(): boolean {
  return hostMode || isSolo()
}

/** The headless server runtime: no renderer, no bodies to load, no UI. */
export function isHeadless(): boolean {
  return hostMode
}

/** The client fell back to hosting its own fight because the server never answered. */
export function isSoloMode(): boolean {
  return isSolo()
}

/** Client: count the wait for the server and, past the limit, go solo. */
function watchForServer(dt: number) {
  if (isSolo() || isStateSyncronized()) return
  unsyncedFor += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (unsyncedFor < SOLO_AFTER_SECONDS) return
  const id = localAddress()
  if (!id) return
  console.log(`[DG] no answer from the server after ${unsyncedFor.toFixed(0)}s; hosting the fight locally`)
  enterSolo(id)
  engine.removeSystem(watchForServer)
  bindServer()
  initializeHeroVitals()
  for (const fn of hostStartHooks) fn()
}

export function localAddress(): string {
  const id = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address
  return id ? id.toLowerCase() : ''
}

export function playerEntityByAddress(address: string): Entity | undefined {
  const want = address.toLowerCase()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address && identity.address.toLowerCase() === want) return entity
  }
  return undefined
}

/**
 * The address exactly as the renderer spells it. AvatarAttach matches it
 * case-sensitively against the avatar's profile id, so the normalised
 * lower-case id must not be used there.
 */
export function playerAddressAsReported(address: string): string | undefined {
  const want = address.toLowerCase()
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address && identity.address.toLowerCase() === want) return identity.address
  }
  return undefined
}

// --- heroes: the synced HeroBody entities --------------------------------------

/**
 * On the server the owner of a hero is whoever's connection created the entity,
 * not the id they wrote into it.
 */
export function heroOwner(entity: Entity, hero: HeroBodyValue): string {
  const created = hostMode ? CreatedBy.getOrNull(entity)?.address : undefined
  return (created || hero.id).toLowerCase()
}

/** Every hero body in the room but our own. */
export function* remoteHeroes(): Iterable<[Entity, HeroBodyValue]> {
  const me = localAddress()
  for (const [entity, hero] of engine.getEntitiesWith(HeroBody)) {
    if (!hero.id || heroOwner(entity, hero) === me) continue
    yield [entity, hero]
  }
}

export function remoteCount(): number {
  let n = 0
  for (const _ of remoteHeroes()) n++
  return n
}

/**
 * Where a hero stands: the runtime's avatar transform when it has one, else
 * the position the hero last wrote (the headless host is not always handed
 * player transforms).
 */
export function heroPosition(id: string): Vector3 | undefined {
  const entity = playerEntityByAddress(id)
  const tracked = entity !== undefined ? Transform.getOrNull(entity)?.position : undefined
  if (tracked) return tracked
  for (const [e, hero] of engine.getEntitiesWith(HeroBody)) {
    if (heroOwner(e, hero) === id) return Vector3.create(hero.x, hero.y, hero.z)
  }
  return undefined
}

export function allFighters(local?: (CombatPose & { health: number; invulnerable: boolean; blocking: boolean })): NetFighter[] {
  const list: NetFighter[] = []
  const me = localAddress()
  if (local && me) {
    list.push({ ...local, address: me, local: true })
  }
  for (const [entity, hero] of remoteHeroes()) {
    const id = heroOwner(entity, hero)
    list.push({
      address: id,
      position: heroPosition(id) ?? Vector3.create(hero.x, hero.y, hero.z),
      facing: hero.f,
      // Only the host keeps the ledger; clients use fighters for presence, not health.
      health: isHost() ? heroHealth(id) : MAX_COMBAT_HEALTH,
      invulnerable: hero.dodge,
      blocking: hero.block,
      local: false
    })
  }
  return list
}

/**
 * The weapon a hero's body says it carries. The host resolves hits with this,
 * so a client cannot claim a better blade than the one everybody can see.
 */
export function heroWeapon(id: string): string {
  for (const [entity, hero] of engine.getEntitiesWith(HeroBody)) {
    if (heroOwner(entity, hero) === id) return hero.loadout.weapon || 'none-weapon'
  }
  return 'none-weapon'
}

export function appearanceOf(hero: HeroBodyValue): CharacterAppearance {
  return { bodyType: hero.body === 'female' ? 'female' : 'male', hairStyle: hero.hair, hairColor: hero.hc, skinTone: hero.skin }
}

export function fullLoadout(hero: HeroBodyValue): EquipmentLoadout {
  const loadout = { ...hero.loadout } as EquipmentLoadout
  for (const slot of EQUIPMENT_SLOTS) {
    if (!loadout[slot.id]) loadout[slot.id] = slot.id === 'weapon' ? 'none-weapon' : `none-${slot.id}`
  }
  // A newer client may carry a weapon this build has never heard of.
  return sanitizeLoadout(loadout, hero.cid)
}

// --- client: owning our hero -------------------------------------------------------

let heroEntity: Entity | undefined
let beat = 0
let beatAge = 0
let sinceSent = 0
const BEAT_SECONDS = 1
/** Position and facing alone are sent at most this often; clips and looks go out at once. */
const POSE_INTERVAL = 0.12

function clientReady() {
  return !hostMode && (isSolo() || isStateSyncronized())
}

// --- diagnostics: what the client sees of the room ------------------------------

let syncError = ''
let snapshots = 0
let sinceSnapshot = 0

function tickNetDiag(dt: number) {
  if (snapshots > 0 && Number.isFinite(dt) && dt > 0) sinceSnapshot += dt
}

/** One line for the HUD and the server log: where this client stands with the server. */
export function netStatus(): string {
  if (hostMode) return 'server'
  const realm = RealmInfo.getOrNull(engine.RootEntity)
  const parts = [
    `v${GAME_VERSION}`,
    isSolo() ? 'solo (server did not answer)' : `waited ${unsyncedFor.toFixed(0)}s`,
    `room ${realm ? (realm.isConnectedSceneRoom ? 'joined' : 'not joined') : 'unknown'}`,
    `state ${isStateSyncronized() ? 'synced' : 'waiting'}`,
    `send ${room.isReady() ? 'live' : 'queued'}`,
    `hero ${heroEntity !== undefined && HeroBody.has(heroEntity) ? 'published' : 'none'}`,
    `others ${remoteCount()}`,
    `enemy feed ${snapshots === 0 ? 'none yet' : `${sinceSnapshot.toFixed(1)}s ago`}`
  ]
  if (syncError) parts.push(`sync error: ${syncError}`)
  return parts.join(' | ')
}

/**
 * Write our hero. The entity is created on first use (once the room state is
 * in, so the profile the sync needs is there) and again if the server dropped
 * it while we were away. Returns false when nothing could be sent yet.
 */
export function publishHero(hero: HeroPublish, dt: number): boolean {
  if (!clientReady()) return false
  const id = localAddress()
  if (!id) return false
  if (heroEntity === undefined || engine.getEntityState(heroEntity) !== EntityState.UsedEntity || !HeroBody.has(heroEntity)) {
    // A body of ours from an earlier session (scene reload) may have arrived in
    // the state dump; as its owner we can take it down for everyone.
    const stale: Entity[] = []
    for (const [entity, body] of engine.getEntitiesWith(HeroBody)) if (body.id === id) stale.push(entity)
    for (const entity of stale) engine.removeEntity(entity)
    const entity = engine.addEntity()
    // Solo: the body stays local; the ledger here reads it like any other.
    if (!isSolo()) {
      try {
        syncEntity(entity, [HeroBody.componentId])
      } catch (error) {
        // The sync profile is filled asynchronously; try again next tick.
        engine.removeEntity(entity)
        syncError = error instanceof Error ? error.message : String(error)
        console.log('hero sync not ready', error)
        return false
      }
    }
    syncError = ''
    HeroBody.create(entity, { ...hero, id, beat })
    heroEntity = entity
    sinceSent = 0
    return true
  }
  beatAge += dt
  sinceSent += dt
  if (beatAge >= BEAT_SECONDS) {
    beatAge = 0
    beat++
  }
  const current = HeroBody.get(heroEntity)
  const stateChanged = current.beat !== beat || !sameState(current, hero)
  const poseChanged = !samePose(current, hero)
  if (!stateChanged && (!poseChanged || sinceSent < POSE_INTERVAL)) return true
  HeroBody.createOrReplace(heroEntity, { ...hero, id, beat })
  sinceSent = 0
  return true
}

function sameState(a: HeroBodyValue, b: HeroPublish): boolean {
  return a.motion === b.motion && a.seq === b.seq && a.cid === b.cid && a.body === b.body && a.hair === b.hair &&
    a.hc === b.hc && a.skin === b.skin && a.block === b.block && a.dodge === b.dodge && a.lock === b.lock &&
    EQUIPMENT_SLOTS.every((slot) => a.loadout[slot.id] === b.loadout[slot.id])
}

function samePose(a: HeroBodyValue, b: HeroPublish): boolean {
  return Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1 && Math.abs(a.z - b.z) < 0.1 && Math.abs(a.f - b.f) < 0.03
}

/** Take our hero out of the room (title screen, character dropped). */
export function withdrawHero() {
  if (heroEntity === undefined) return
  if (engine.getEntityState(heroEntity) === EntityState.UsedEntity) engine.removeEntity(heroEntity)
  heroEntity = undefined
}

export function publishHitEnemy(i: number, motion: string, finisher: boolean) {
  const id = localAddress()
  if (!clientReady() || !id) return
  sendNet('hitEnemy', { id, i, motion, finisher })
}

export function publishImpact(p: ImpactNet) {
  const id = localAddress()
  if (!clientReady() || !id) return
  sendNet('impact', { ...p, id })
}

/** Client -> server: the hero stepped onto a heart it saw at (x, z). Healing comes back as `heal`. */
export function publishPickup(x: number, z: number) {
  if (!clientReady()) return
  sendNet('pickup', { x, z })
}

/** Client -> server: the local recover countdown ended and no `revive` has arrived. */
export function publishRespawn() {
  const id = localAddress()
  if (!clientReady() || !id) return
  sendNet('respawn', { id })
}

/**
 * Client -> server: one line of client state for the server log. Sent even
 * before the state sync so a client that never syncs still shows up (the room
 * queues it until the connection is up).
 */
export function publishDiag(note: string) {
  if (hostMode || isSolo()) return
  sendNet('diag', { note })
}

/** Whether this client has received the server's state (its messages are sent, not queued). */
export function isClientSynced(): boolean {
  return clientReady()
}

// --- server -> clients ---------------------------------------------------------------

export function publishEnemies(party: string, list: EnemySnap[]) {
  // Solo: the enemies already are the ones the snapshot describes.
  if (!hostMode) return
  sendNet('enemies', { party, list })
}

/** `item` is a weapon id from the catalog, or '' when the kill dropped no weapon. */
export function publishLoot(party: string, x: number, z: number, coin: number, heart: number, item: string) {
  if (!isHost()) return
  rememberHeartDrop(x, z, heart)
  sendNet('loot', { party, x, z, coin, heart, item })
}

export type HeroHit = {
  id: string; damage: number; stagger: number; yaw: number; health: number; blocked: boolean; dodged: boolean
}

let onHitEnemy: ((id: string, i: number, motion: string, finisher: boolean) => void) | undefined
let onHitPlayer: ((hit: HeroHit) => void) | undefined
let onHeal: ((id: string, amount: number, health: number) => void) | undefined
let onRevive: ((id: string, health: number) => void) | undefined
let onVitals: ((id: string, health: number) => void) | undefined
let onImpact: ((p: ImpactNet) => void) | undefined
let onEnemies: ((party: string, list: EnemySnap[]) => void) | undefined
let onLoot: ((party: string, x: number, z: number, coin: number, heart: number, item: string) => void) | undefined
let onJoin: ((id: string) => void) | undefined
let onLeave: ((id: string) => void) | undefined

export function setMultiplayerHandlers(handlers: {
  hitEnemy?: typeof onHitEnemy
  hitPlayer?: typeof onHitPlayer
  heal?: typeof onHeal
  revive?: typeof onRevive
  /** The server's periodic statement of a hero's health. */
  vitals?: typeof onVitals
  impact?: typeof onImpact
  enemies?: typeof onEnemies
  loot?: typeof onLoot
  /** Server only: a hero body has appeared in the room. */
  join?: typeof onJoin
  /** Server only: a hero left the room or withdrew their body. */
  leave?: typeof onLeave
}) {
  if (handlers.leave) onLeave = handlers.leave
  if (handlers.hitEnemy) onHitEnemy = handlers.hitEnemy
  if (handlers.hitPlayer) onHitPlayer = handlers.hitPlayer
  if (handlers.heal) onHeal = handlers.heal
  if (handlers.revive) onRevive = handlers.revive
  if (handlers.vitals) onVitals = handlers.vitals
  if (handlers.impact) onImpact = handlers.impact
  if (handlers.enemies) onEnemies = handlers.enemies
  if (handlers.loot) onLoot = handlers.loot
  if (handlers.join) onJoin = handlers.join
}

function bindClient() {
  onNet('hitPlayer', (msg) => onHitPlayer?.(msg))
  onNet('heal', (msg) => onHeal?.(msg.id, msg.amount, msg.health))
  onNet('revive', (msg) => onRevive?.(msg.id, msg.health))
  onNet('vitals', (msg) => onVitals?.(msg.id, msg.health))
  onNet('impact', (msg) => {
    if (msg.id === localAddress()) return
    onImpact?.(msg)
  })
  onNet('enemies', (msg) => {
    snapshots++
    sinceSnapshot = 0
    onEnemies?.(msg.party, msg.list.map((e) => ({ ...e, m: e.m as EquipmentMotion })))
  })
  onNet('loot', (msg) => onLoot?.(msg.party, msg.x, msg.z, msg.coin, msg.heart, msg.item))
  engine.addSystem(tickNetDiag)
  engine.addSystem(watchForServer)
}

// --- server: who is in the room ---------------------------------------------------------

/** One synced HeroBody entity as the server sees it. */
type Body = { owner: string; beat: number; silence: number }
/** The ledger's hero: which body speaks for the owner right now. */
type Tracked = { entity: Entity; cid: string; missing: number }
const bodies = new Map<Entity, Body>()
const tracked = new Map<string, Tracked>()
const seenPlayers = new Set<string>()
/** How long a player entity may be missing before the hero is dropped. */
const LEAVE_GRACE = 1.5
/** A hero whose beat has stopped this long, with no player entity to show for it, is gone. */
const SILENCE_LIMIT = 20
/** A second body for the same owner whose beat has stopped this long is a leftover (scene reload). */
const STALE_BODY_SILENCE = 3
const HEARTBEAT_SECONDS = 15
const VITALS_SECONDS = 2
let heartbeatAge = 0
let vitalsAge = 0

function bindServer() {
  onNet('hitEnemy', (msg, context) => {
    if (!context) return
    onHitEnemy?.(context.from.toLowerCase(), msg.i, msg.motion, msg.finisher)
  })
  onNet('impact', (msg, context) => {
    // Relay to the other clients; solo has none (and relaying would loop back here).
    if (!context || isSolo()) return
    sendNet('impact', { ...msg, id: context.from.toLowerCase() })
  })
  onNet('diag', (msg, context) => {
    if (!context) return
    console.log(`[Client ${context.from}] ${msg.note}`)
  })
  engine.addSystem(trackHeroes)
  console.log('[Server] multiplayer room ready')
}

/** Delete a body; the deletion travels through the sync to every client. */
function removeBody(entity: Entity) {
  bodies.delete(entity)
  if (engine.getEntityState(entity) === EntityState.UsedEntity) engine.removeEntity(entity)
}

/**
 * The hero entities arrive through the sync; this is the ledger's view of them:
 * a new body resets its health, and a body whose owner has gone is deleted
 * (the deletion reaches every client through the same sync).
 */
function trackHeroes(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  const present = new Set<string>()
  let withTransform = 0
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!identity.address) continue
    present.add(identity.address.toLowerCase())
    if (Transform.has(entity)) withTransform++
  }
  for (const id of present) seenPlayers.add(id)

  // Every body in the room, grouped by owner; the freshest beat speaks for them.
  const byOwner = new Map<string, { entity: Entity; hero: HeroBodyValue; body: Body }[]>()
  const liveEntities = new Set<Entity>()
  for (const [entity, hero] of engine.getEntitiesWith(HeroBody)) {
    if (!hero.id) continue
    liveEntities.add(entity)
    const owner = heroOwner(entity, hero)
    let body = bodies.get(entity)
    if (!body) {
      body = { owner, beat: hero.beat, silence: 0 }
      bodies.set(entity, body)
    } else if (hero.beat !== body.beat) {
      body.beat = hero.beat
      body.silence = 0
    } else {
      body.silence += span
    }
    const list = byOwner.get(owner) ?? []
    list.push({ entity, hero, body })
    byOwner.set(owner, list)
  }
  for (const entity of [...bodies.keys()]) if (!liveEntities.has(entity)) bodies.delete(entity)

  for (const [id, list] of byOwner) {
    list.sort((a, b) => a.body.silence - b.body.silence)
    const primary = list[0]
    // A reload leaves the previous session's body behind until the owner takes
    // it down; if they did not, it stops beating and goes here.
    for (const extra of list.slice(1)) {
      if (extra.body.silence >= STALE_BODY_SILENCE) removeBody(extra.entity)
    }
    let t = tracked.get(id)
    if (!t) {
      t = { entity: primary.entity, cid: primary.hero.cid, missing: 0 }
      tracked.set(id, t)
      resetHero(id)
      sendNet('vitals', { id, health: heroHealth(id) })
      console.log(`[Server] hero ${id} joined as ${primary.hero.cid}; player transform: ${present.has(id) ? 'yes' : 'no'}; heroes: ${tracked.size}`)
      onJoin?.(id)
      continue
    }
    t.entity = primary.entity
    if (primary.hero.cid !== t.cid) {
      // A different character is a fresh hero.
      t.cid = primary.hero.cid
      resetHero(id)
      sendNet('vitals', { id, health: heroHealth(id) })
    }
    if (present.has(id)) {
      t.missing = 0
      continue
    }
    // Known player whose entity vanished: a short grace for comms hiccups. One
    // that never surfaced as a player entity here is judged by its beat alone.
    t.missing += span
    const gone = seenPlayers.has(id) ? t.missing >= LEAVE_GRACE : primary.body.silence >= SILENCE_LIMIT
    if (!gone) continue
    for (const { entity } of list) removeBody(entity)
    tracked.delete(id)
    seenPlayers.delete(id)
    dropHero(id)
    onLeave?.(id)
    console.log(`[Server] hero ${id} left; heroes: ${tracked.size}`)
  }
  for (const id of [...tracked.keys()]) {
    if (byOwner.has(id)) continue
    // The body went away on its own (owner withdrew it: title screen, character dropped).
    tracked.delete(id)
    dropHero(id)
    onLeave?.(id)
    console.log(`[Server] hero ${id} withdrew; heroes: ${tracked.size}`)
  }

  vitalsAge += span
  if (vitalsAge >= VITALS_SECONDS) {
    vitalsAge = 0
    for (const id of tracked.keys()) sendNet('vitals', { id, health: heroHealth(id) })
  }
  heartbeatAge += span
  if (heartbeatAge >= HEARTBEAT_SECONDS) {
    heartbeatAge = 0
    console.log(`[Server] heartbeat: ${present.size} player entit(ies), ${withTransform} with transform, ${tracked.size} hero(es)`)
  }
}
