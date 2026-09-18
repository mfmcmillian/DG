import { AvatarModifierArea, AvatarModifierType, engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { MessageBus } from '@dcl/sdk/message-bus'
import { onLeaveScene } from '@dcl/sdk/players'
import { CombatPose } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { CharacterAppearance } from './appearance'
import { EquipmentLoadout, EQUIPMENT_SLOTS } from './equipmentCatalog'

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

type Envelope =
  | { t: 'player'; p: PlayerNet }
  | { t: 'swing'; id: string; motion: string; facing: number }
  | { t: 'hitEnemy'; id: string; i: number; motion: string; finisher: boolean }
  | { t: 'hitPlayer'; id: string; damage: number; stagger: number; yaw: number }
  | { t: 'impact'; id: string; p: ImpactNet }
  | { t: 'enemies'; list: EnemySnap[] }
  | { t: 'loot'; x: number; z: number; coin: number; heart: number; dusk: boolean }
  | { t: 'leave'; id: string }

const bus = new MessageBus()
const remotes = new Map<string, PlayerNet>()
let hideArea: ReturnType<typeof engine.addEntity> | undefined
let initialized = false
let hostId = ''

export function initializeMultiplayer() {
  if (initialized) return
  initialized = true
  hideEveryone()
  bus.on('koa', (msg: Envelope) => onMessage(msg))
  onLeaveScene((userId) => {
    remotes.delete(userId.toLowerCase())
    bus.emit('koa', { t: 'leave', id: userId.toLowerCase() })
  })
  engine.addSystem(electHost)
}

export function localAddress(): string {
  const id = PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address
  return id ? id.toLowerCase() : ''
}

export function isHost(): boolean {
  const me = localAddress()
  return !!me && me === hostId
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

export function publishPlayer(p: PlayerNet) {
  if (!p.id) return
  bus.emit('koa', { t: 'player', p })
}

export function publishSwing(motion: string, facing: number) {
  const id = localAddress()
  if (!id) return
  bus.emit('koa', { t: 'swing', id, motion, facing })
}

export function publishHitEnemy(i: number, motion: string, finisher: boolean) {
  const id = localAddress()
  if (!id) return
  bus.emit('koa', { t: 'hitEnemy', id, i, motion, finisher })
}

export function publishImpact(p: ImpactNet) {
  const id = localAddress()
  if (!id) return
  bus.emit('koa', { t: 'impact', id, p })
}

export function publishHitPlayer(id: string, damage: number, stagger: number, yaw: number) {
  bus.emit('koa', { t: 'hitPlayer', id: id.toLowerCase(), damage, stagger, yaw })
}

export function publishEnemies(list: EnemySnap[]) {
  bus.emit('koa', { t: 'enemies', list })
}

export function publishLoot(x: number, z: number, coin: number, heart: number, dusk: boolean) {
  bus.emit('koa', { t: 'loot', x, z, coin, heart, dusk })
}

let onSwing: ((id: string, motion: string, facing: number) => void) | undefined
let onHitEnemy: ((id: string, i: number, motion: string, finisher: boolean) => void) | undefined
let onHitPlayer: ((id: string, damage: number, stagger: number, yaw: number) => void) | undefined
let onImpact: ((p: ImpactNet) => void) | undefined
let onEnemies: ((list: EnemySnap[]) => void) | undefined
let onLoot: ((x: number, z: number, coin: number, heart: number, dusk: boolean) => void) | undefined
let onRemote: ((p: PlayerNet) => void) | undefined
let onGone: ((id: string) => void) | undefined

export function setMultiplayerHandlers(handlers: {
  swing?: typeof onSwing
  hitEnemy?: typeof onHitEnemy
  hitPlayer?: typeof onHitPlayer
  impact?: typeof onImpact
  enemies?: typeof onEnemies
  loot?: typeof onLoot
  remote?: typeof onRemote
  gone?: typeof onGone
}) {
  if (handlers.swing) onSwing = handlers.swing
  if (handlers.hitEnemy) onHitEnemy = handlers.hitEnemy
  if (handlers.hitPlayer) onHitPlayer = handlers.hitPlayer
  if (handlers.impact) onImpact = handlers.impact
  if (handlers.enemies) onEnemies = handlers.enemies
  if (handlers.loot) onLoot = handlers.loot
  if (handlers.remote) onRemote = handlers.remote
  if (handlers.gone) onGone = handlers.gone
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

function onMessage(msg: Envelope) {
  const me = localAddress()
  if (msg.t === 'player') {
    if (!msg.p.id || msg.p.id === me) return
    remotes.set(msg.p.id, msg.p)
    onRemote?.(msg.p)
    return
  }
  if (msg.t === 'leave') {
    remotes.delete(msg.id)
    onGone?.(msg.id)
    return
  }
  if (msg.t === 'swing') {
    if (msg.id === me) return
    onSwing?.(msg.id, msg.motion, msg.facing)
    return
  }
  if (msg.t === 'hitEnemy') {
    if (!isHost() || msg.id === me) return
    onHitEnemy?.(msg.id, msg.i, msg.motion, msg.finisher)
    return
  }
  if (msg.t === 'hitPlayer') {
    onHitPlayer?.(msg.id, msg.damage, msg.stagger, msg.yaw)
    return
  }
  if (msg.t === 'impact') {
    if (msg.id === me) return
    onImpact?.(msg.p)
    return
  }
  if (msg.t === 'enemies') {
    if (isHost()) return
    onEnemies?.(msg.list)
    return
  }
  if (msg.t === 'loot') {
    if (isHost()) return
    onLoot?.(msg.x, msg.z, msg.coin, msg.heart, msg.dusk)
  }
}

function electHost() {
  const ids = new Set<string>()
  const me = localAddress()
  if (me) ids.add(me)
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address) ids.add(identity.address.toLowerCase())
  }
  const ranked = Array.from(ids).sort()
  hostId = ranked[0] || me
}

function hideEveryone() {
  if (hideArea !== undefined) return
  hideArea = engine.addEntity()
  Transform.create(hideArea, { position: Vector3.create(48, 10, 48) })
  AvatarModifierArea.create(hideArea, {
    area: Vector3.create(96, 24, 96),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
    excludeIds: []
  })
}
