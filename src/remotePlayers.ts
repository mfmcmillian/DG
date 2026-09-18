import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
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
  root: Entity
  parent?: Entity
  look: string
  motion: string
  facing: number
}

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

function upsertReplica(p: PlayerNet) {
  let replica = replicas.get(p.id)
  if (!replica) {
    const root = engine.addEntity()
    Transform.create(root)
    replica = { root, look: '', motion: 'idle', facing: p.f }
    replicas.set(p.id, replica)
  }
  const look = lookKey(p)
  if (look !== replica.look) {
    replica.look = look
    setEquipmentAvatar(replica.root, p.cid, emptyLoadout(p), false, { appearance: appearanceOf(p) })
    setEquipmentVisible(replica.root, true)
  }
  replica.facing = p.f
  applyMotion(replica, p.motion, p.motion !== replica.motion && RESET_MOTIONS.has(p.motion))
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
  replicas.delete(id)
}

function playerYaw(entity: Entity) {
  const rotation = Transform.getOrNull(entity)?.rotation
  if (!rotation) return 0
  return Quaternion.toEulerAngles(rotation).y * Math.PI / 180
}

function updateRemotePlayers() {
  for (const [id, replica] of replicas) {
    const parent = playerEntityByAddress(id)
    if (parent === undefined) {
      setEquipmentVisible(replica.root, false)
      continue
    }
    if (replica.parent !== parent) {
      replica.parent = parent
      Transform.createOrReplace(replica.root, { parent })
    }
    const ready = getEquipmentLoading(replica.root) === 'ready'
    setEquipmentVisible(replica.root, ready)
    const delta = replica.facing - playerYaw(parent)
    Transform.getMutable(replica.root).rotation = Quaternion.fromEulerDegrees(0, (delta * 180) / Math.PI, 0)
  }
}
