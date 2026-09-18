import { AvatarAnchorPointType, AvatarAttach, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { setNativeAvatarHidden } from './avatarHiding'
import { AttackMotion } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { fxSlash, fxSound } from './combatFx'
import {
  destroyEquipmentAvatar, getEquipmentLoading, setEquipmentAvatar, setEquipmentMotion, setEquipmentVisible
} from './equipmentAvatar'
import {
  appearanceOf, emptyLoadout, PlayerNet, playerEntityByAddress, setMultiplayerHandlers
} from './multiplayer'

type Replica = {
  /** Follows the remote avatar through the renderer (AvatarAttach). */
  anchor: Entity
  /** The custom body, a child of the anchor; carries the facing correction. */
  root: Entity
  parent?: Entity
  look: string
  motion: string
  facing: number
  last: PlayerNet
  /** Seconds until a failed outfit load is requested again. */
  retryIn: number
}

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

function attachAnchor(replica: Replica, id: string) {
  AvatarAttach.createOrReplace(replica.anchor, { avatarId: id, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
}

function upsertReplica(p: PlayerNet) {
  let replica = replicas.get(p.id)
  if (!replica) {
    const anchor = engine.addEntity()
    Transform.create(anchor)
    const root = engine.addEntity()
    Transform.create(root, { parent: anchor, position: Vector3.create(0, ATTACH_PIVOT_CORRECTION, 0) })
    replica = { anchor, root, look: '', motion: 'idle', facing: p.f, last: p, retryIn: 0 }
    replicas.set(p.id, replica)
    attachAnchor(replica, p.id)
  }
  replica.last = p
  const look = lookKey(p)
  if (look !== replica.look) {
    replica.look = look
    loadOutfit(replica, p)
  }
  replica.facing = p.f
  applyMotion(replica, p.motion, p.motion !== replica.motion && RESET_MOTIONS.has(p.motion))
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
  for (const [id, replica] of replicas) {
    const parent = playerEntityByAddress(id)
    if (parent === undefined) {
      // Out of the scene: the renderer has no avatar to follow.
      setEquipmentVisible(replica.root, false)
      setNativeAvatarHidden(id, false)
      replica.parent = undefined
      continue
    }
    if (replica.parent !== parent) {
      // A returning player may have been handed a different avatar instance;
      // a fresh attach makes the renderer resolve it again.
      replica.parent = parent
      attachAnchor(replica, id)
    }
    const loading = getEquipmentLoading(replica.root)
    if (loading === 'error') {
      replica.retryIn -= dt
      if (replica.retryIn <= 0) loadOutfit(replica, replica.last)
    }
    const ready = loading === 'ready'
    setEquipmentVisible(replica.root, ready)
    setNativeAvatarHidden(id, ready)
    // The anchor turns with the native avatar; the body adds the published facing on top.
    const delta = replica.facing - playerYaw(parent)
    Transform.getMutable(replica.root).rotation = Quaternion.fromEulerDegrees(0, (delta * 180) / Math.PI, 0)
  }
}
