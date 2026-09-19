import { AvatarAnchorPointType, AvatarAttach, engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { setNativeAvatarHidden } from './avatarHiding'
import { AttackMotion } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { fxImpact, fxNumber, fxSlash, fxSound } from './combatFx'
import {
  destroyEquipmentAvatar, getEquipmentLoading, setEquipmentAvatar, setEquipmentMotion, setEquipmentVisible
} from './equipmentAvatar'
import {
  appearanceOf, emptyLoadout, isClientSynced, PlayerNet, playerAddressAsReported, playerEntityByAddress,
  publishDiag, remoteCount, setMultiplayerHandlers
} from './multiplayer'

type Replica = {
  /** Follows the remote avatar through the renderer (AvatarAttach). */
  anchor: Entity
  /** The custom body, a child of the anchor; carries the facing correction. */
  root: Entity
  parent?: Entity
  /** The address spelling the anchor is attached with ('' while riding the published position). */
  attachedAs: string
  look: string
  motion: string
  facing: number
  last: PlayerNet
  /** Seconds until a failed outfit load is requested again. */
  retryIn: number
}

/** How fast a body riding the published position catches up (1/s). */
const NET_FOLLOW = 10
const DIAG_SECONDS = 10
let diagAge = 0

/**
 * Other players' entities cannot be used as Transform parents (the renderer
 * does not expose them to the scene's hierarchy, so children fall back to the
 * scene origin). AvatarAttach with the player's address is the supported way to
 * ride along with them. Its POSITION anchor keeps the old client's pivot, 0.75 m
 * below the feet; the body is raised back onto the ground.
 */
const ATTACH_PIVOT_CORRECTION = 0.75
const RETRY_SECONDS = 3

const replicas = new Map<string, Replica>()
let systemAdded = false

const RESET_MOTIONS = new Set<EquipmentMotion>([
  'attack_light', 'attack_light2', 'attack_heavy', 'hit', 'death', 'block', 'dodge_roll'
])

export function initializeRemotePlayers() {
  if (systemAdded) return
  systemAdded = true
  setMultiplayerHandlers({
    remote: upsertReplica,
    gone: removeReplica,
    swing: (id, motion, facing) => {
      const replica = replicas.get(id)
      if (!replica) return
      applyMotion(replica, motion as EquipmentMotion, true)
      replica.facing = facing
      if (motion === 'attack_light' || motion === 'attack_light2' || motion === 'attack_heavy') {
        fxSlash(replica.root, motion as AttackMotion)
        fxSound(motion === 'attack_heavy' ? 'swing_heavy' : 'swing_light', 0.55)
      }
    }
  })
  engine.addSystem(updateRemotePlayers)
}

function lookKey(p: PlayerNet) {
  return [p.cid, p.body, p.hair, p.hc, p.skin, p.loadout.head, p.loadout.chest, p.loadout.shoulders,
    p.loadout.hands, p.loadout.legs, p.loadout.boots, p.loadout.weapon].join('|')
}

/** Ride the renderer's avatar, addressed exactly as the renderer spells it. */
function attachAnchor(replica: Replica, address: string) {
  replica.attachedAs = address
  AvatarAttach.createOrReplace(replica.anchor, { avatarId: address, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
}

/** No avatar to ride: stand where the player's own packets say they are. */
function detachAnchor(replica: Replica) {
  replica.attachedAs = ''
  if (AvatarAttach.has(replica.anchor)) AvatarAttach.deleteFrom(replica.anchor)
  const t = Transform.getMutable(replica.anchor)
  t.position = Vector3.create(replica.last.x, replica.last.y - ATTACH_PIVOT_CORRECTION, replica.last.z)
  t.rotation = Quaternion.Identity()
}

function followPublished(replica: Replica, dt: number) {
  const target = Vector3.create(replica.last.x, replica.last.y - ATTACH_PIVOT_CORRECTION, replica.last.z)
  const t = Transform.getMutable(replica.anchor)
  const k = Math.min(1, NET_FOLLOW * dt)
  t.position = Vector3.distance(t.position, target) > 6 ? target : Vector3.lerp(t.position, target, k)
}

function upsertReplica(p: PlayerNet) {
  let replica = replicas.get(p.id)
  if (!replica) {
    const anchor = engine.addEntity()
    Transform.create(anchor, { position: Vector3.create(p.x, p.y - ATTACH_PIVOT_CORRECTION, p.z) })
    const root = engine.addEntity()
    Transform.create(root, { parent: anchor, position: Vector3.create(0, ATTACH_PIVOT_CORRECTION, 0) })
    replica = { anchor, root, attachedAs: '', look: '', motion: 'idle', facing: p.f, last: p, retryIn: 0 }
    replicas.set(p.id, replica)
  }
  replica.last = p
  const look = lookKey(p)
  if (look !== replica.look) {
    replica.look = look
    loadOutfit(replica, p)
  }
  replica.facing = p.f
  // The host's health wins over the published pose: a downed hero lies down
  // for everyone, even a late joiner who missed the blow.
  const motion: EquipmentMotion = p.health <= 0 ? 'death' : p.motion
  applyMotion(replica, motion, motion !== replica.motion && RESET_MOTIONS.has(motion))
}

/** Chest height above the remote avatar the renderer is driving. */
function remoteChest(id: string): Vector3 | undefined {
  const entity = playerEntityByAddress(id)
  const position = entity !== undefined ? Transform.getOrNull(entity)?.position : undefined
  if (position) return Vector3.add(position, Vector3.create(0, 1.9, 0))
  const replica = replicas.get(id)
  if (!replica) return undefined
  const anchor = Transform.getOrNull(replica.anchor)?.position
  return anchor ? Vector3.add(anchor, Vector3.create(0, 1.9 + ATTACH_PIVOT_CORRECTION, 0)) : undefined
}

/** An enemy blow the host resolved against another hero. */
export function presentRemoteHit(id: string, damage: number, health: number, blocked: boolean, dodged: boolean) {
  const replica = replicas.get(id)
  const at = remoteChest(id)
  if (blocked) {
    if (at) {
      fxNumber(at, 'Blocked', 'blocked')
      fxImpact(Vector3.add(at, Vector3.create(0, -0.7, 0)), false, true)
    }
    fxSound('block', 0.5)
    return
  }
  if (dodged) {
    if (at) fxNumber(at, 'Dodged', 'note')
    return
  }
  if (at) {
    fxNumber(at, `-${damage}`, 'player')
    fxImpact(Vector3.add(at, Vector3.create(0, -0.7, 0)), health <= 0, false)
  }
  if (replica) applyMotion(replica, health <= 0 ? 'death' : 'hit', true)
  fxSound(health <= 0 ? 'death' : 'hurt', 0.6)
}

export function presentRemoteHeal(id: string, amount: number) {
  const at = remoteChest(id)
  if (at && amount > 0) fxNumber(at, `+${Math.round(amount)}`, 'heal')
}

export function presentRemoteRevive(id: string) {
  const replica = replicas.get(id)
  if (replica && replica.motion === 'death') applyMotion(replica, 'idle', true)
}

function loadOutfit(replica: Replica, p: PlayerNet) {
  setEquipmentAvatar(replica.root, p.cid, emptyLoadout(p), false, { appearance: appearanceOf(p) })
  setEquipmentVisible(replica.root, true)
  replica.retryIn = RETRY_SECONDS
}

function applyMotion(replica: Replica, motion: EquipmentMotion, reset: boolean) {
  replica.motion = motion
  setEquipmentMotion(replica.root, motion, reset)
}

function removeReplica(id: string) {
  const replica = replicas.get(id)
  if (!replica) return
  destroyEquipmentAvatar(replica.root)
  engine.removeEntity(replica.root)
  engine.removeEntity(replica.anchor)
  replicas.delete(id)
  setNativeAvatarHidden(id, false)
}

function playerYaw(entity: Entity) {
  const rotation = Transform.getOrNull(entity)?.rotation
  if (!rotation) return 0
  return Quaternion.toEulerAngles(rotation).y * Math.PI / 180
}

function updateRemotePlayers(dt: number) {
  let attached = 0
  let riding = 0
  let ready = 0
  for (const [id, replica] of replicas) {
    const parent = playerEntityByAddress(id)
    const reported = parent !== undefined ? playerAddressAsReported(id) : undefined
    if (parent !== undefined && reported) {
      if (replica.parent !== parent || replica.attachedAs !== reported) {
        // A returning player may have been handed a different avatar instance;
        // a fresh attach makes the renderer resolve it again.
        replica.parent = parent
        attachAnchor(replica, reported)
      }
      attached++
    } else {
      // The renderer shows no avatar for this player (not yet, or never on this
      // engine); the body still stands where their packets put them.
      if (replica.parent !== undefined || replica.attachedAs !== '' || AvatarAttach.has(replica.anchor)) {
        replica.parent = undefined
        detachAnchor(replica)
      }
      followPublished(replica, dt)
      riding++
    }
    const loading = getEquipmentLoading(replica.root)
    if (loading === 'error') {
      replica.retryIn -= dt
      if (replica.retryIn <= 0) loadOutfit(replica, replica.last)
    }
    const loaded = loading === 'ready'
    if (loaded) ready++
    setEquipmentVisible(replica.root, loaded)
    setNativeAvatarHidden(id, loaded)
    // An attached anchor turns with the native avatar; the body adds the published facing on top.
    const baseYaw = parent !== undefined && replica.attachedAs ? playerYaw(parent) : 0
    const delta = replica.facing - baseYaw
    Transform.getMutable(replica.root).rotation = Quaternion.fromEulerDegrees(0, (delta * 180) / Math.PI, 0)
  }
  diagAge += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (diagAge >= DIAG_SECONDS) {
    diagAge = 0
    let identities = 0
    for (const _ of engine.getEntitiesWith(PlayerIdentityData)) identities++
    publishDiag(
      `synced: ${isClientSynced() ? 'yes' : 'no'}; players seen by renderer: ${identities}; ` +
      `heroes known: ${remoteCount()}; bodies: ${replicas.size} (${ready} loaded, ${attached} attached, ${riding} on packets)`
    )
  }
}
