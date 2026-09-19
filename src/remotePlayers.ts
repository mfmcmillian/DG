import { AvatarAnchorPointType, AvatarAttach, engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { rearmAvatarHiding } from './avatarHiding'
import { AttackMotion } from './combatActions'
import { EquipmentMotion } from './combatAnimations'
import { fxImpact, fxNumber, fxSlash, fxSound } from './combatFx'
import {
  destroyEquipmentAvatar, getEquipmentLoading, setEquipmentAvatar, setEquipmentMotion, setEquipmentVisible
} from './equipmentAvatar'
import {
  appearanceOf, fullLoadout, heroOwner, localAddress, netStatus, playerAddressAsReported, playerEntityByAddress, publishDiag,
  remoteHeroes
} from './multiplayer'
import { createHeroNameTag, destroyHeroNameTag, updateHeroNameTag } from './heroNameTag'
import { partyOf } from './partyLookup'
import { HeroBodyValue } from './shared/heroBody'

/**
 * Another hero's body. The synced HeroBody entity says who and what to show;
 * the body itself is built here, because the renderer's avatar is the only
 * thing that can carry it smoothly and only a local AvatarAttach can ride it.
 */
type Replica = {
  id: string
  /** Rides the remote avatar through the renderer (AvatarAttach). */
  anchor: Entity
  /** The custom body, a child of the anchor; carries the facing correction. */
  root: Entity
  /** The address spelling the anchor is attached with ('' until the renderer reports the avatar). */
  attachedAs: string
  look: string
  /** The clip playing on the body. */
  motion: EquipmentMotion
  /** The clip the owner last wrote, and its restart counter. */
  netMotion: EquipmentMotion
  seq: number
  /**
   * Seconds left in which the owner's own report of a clip we already started
   * from a server verdict (hit, death, revive) is not replayed on top of it.
   */
  echoGrace: number
  /** Seconds until a failed outfit load is requested again. */
  retryIn: number
  /** Owner's heartbeat and how long since it last ticked (a reload can leave two bodies for one owner). */
  beat: number
  silence: number
  /** The body's yaw offset from the native avatar it rides (radians), eased toward its target. */
  turn: number
  /** Billboard over the head: the owner's Decentraland display name. */
  nameTag: Entity
}

/** How fast the lock-on offset eases in and out (1/s); fast enough to read as a turn, not a snap. */
const TURN_RATE = 14

/**
 * Other players' entities cannot be used as Transform parents (the renderer
 * does not expose them to the scene's hierarchy). AvatarAttach with the
 * player's address is the supported way to ride along with them. Its POSITION
 * anchor keeps the old client's pivot, 0.75 m below the feet; the body is
 * raised back onto the ground.
 */
const ATTACH_PIVOT_CORRECTION = 0.75
const RETRY_SECONDS = 3
const DIAG_SECONDS = 10

const RESET_MOTIONS = new Set<EquipmentMotion>([
  'attack_light', 'attack_light2', 'attack_heavy', 'hit', 'death', 'block', 'dodge_roll'
])

/** Keyed by the synced hero entity. */
const replicas = new Map<Entity, Replica>()
let systemAdded = false
let diagAge = 0

export function initializeRemotePlayers() {
  if (systemAdded) return
  systemAdded = true
  engine.addSystem(updateRemotePlayers)
}

function lookKey(hero: HeroBodyValue) {
  const l = hero.loadout
  return [hero.cid, hero.body, hero.hair, hero.hc, hero.skin, l.head, l.chest, l.shoulders, l.hands, l.legs, l.boots, l.weapon].join('|')
}

function createReplica(id: string, hero: HeroBodyValue): Replica {
  const anchor = engine.addEntity()
  Transform.create(anchor)
  const root = engine.addEntity()
  Transform.create(root, { parent: anchor, position: Vector3.create(0, ATTACH_PIVOT_CORRECTION, 0) })
  // A hero arriving means a native avatar arrived too; make sure the hide catches it.
  rearmAvatarHiding()
  return {
    id, anchor, root, attachedAs: '', look: '', motion: 'idle', netMotion: 'idle', seq: hero.seq, echoGrace: 0, retryIn: 0,
    beat: hero.beat, silence: 0, turn: 0, nameTag: createHeroNameTag(root)
  }
}

function loadOutfit(replica: Replica, hero: HeroBodyValue) {
  setEquipmentAvatar(replica.root, hero.cid, fullLoadout(hero), false, { appearance: appearanceOf(hero) })
  replica.retryIn = RETRY_SECONDS
}

function applyMotion(replica: Replica, motion: EquipmentMotion, reset: boolean) {
  replica.motion = motion
  setEquipmentMotion(replica.root, motion, reset)
}

/** A clip started from the server's verdict; the owner will report the same one shortly. */
function presentMotion(replica: Replica, motion: EquipmentMotion) {
  applyMotion(replica, motion, true)
  replica.echoGrace = 0.6
}

function removeReplica(entity: Entity, replica: Replica) {
  destroyHeroNameTag(replica.nameTag)
  destroyEquipmentAvatar(replica.root)
  engine.removeEntity(replica.root)
  engine.removeEntity(replica.anchor)
  replicas.delete(entity)
}

/** The body speaking for this owner: the one whose heartbeat ticked most recently. */
function replicaByAddress(id: string): Replica | undefined {
  let best: Replica | undefined
  for (const replica of replicas.values()) {
    if (replica.id === id && (!best || replica.silence < best.silence)) best = replica
  }
  return best
}

/** Into (-PI, PI], so easing between yaws takes the short way round. */
function wrapAngle(a: number) {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
}

function playerYaw(entity: Entity) {
  const rotation = Transform.getOrNull(entity)?.rotation
  if (!rotation) return 0
  return Quaternion.toEulerAngles(rotation).y * Math.PI / 180
}

/** Chest height above the remote avatar the renderer is driving. */
function remoteChest(id: string): Vector3 | undefined {
  const entity = playerEntityByAddress(id)
  const position = entity !== undefined ? Transform.getOrNull(entity)?.position : undefined
  return position ? Vector3.add(position, Vector3.create(0, 1.9, 0)) : undefined
}

/** An enemy blow the host resolved against another hero. */
export function presentRemoteHit(id: string, damage: number, health: number, blocked: boolean, dodged: boolean) {
  const replica = replicaByAddress(id)
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
  if (replica) presentMotion(replica, health <= 0 ? 'death' : 'hit')
  fxSound(health <= 0 ? 'death' : 'hurt', 0.6)
}

export function presentRemoteHeal(id: string, amount: number) {
  const at = remoteChest(id)
  if (at && amount > 0) fxNumber(at, `+${Math.round(amount)}`, 'heal')
}

export function presentRemoteRevive(id: string) {
  const replica = replicaByAddress(id)
  if (replica && replica.motion === 'death') presentMotion(replica, 'idle')
}

function updateRemotePlayers(dt: number) {
  const live = new Set<Entity>()
  let attached = 0
  let ready = 0
  const myPhase = partyOf(localAddress())
  for (const [entity, hero] of remoteHeroes()) {
    live.add(entity)
    const id = heroOwner(entity, hero)
    let replica = replicas.get(entity)
    if (!replica) {
      replica = createReplica(id, hero)
      replicas.set(entity, replica)
    }
    if (hero.beat !== replica.beat) {
      replica.beat = hero.beat
      replica.silence = 0
    } else {
      replica.silence += dt
    }
    const look = lookKey(hero)
    if (look !== replica.look) {
      replica.look = look
      loadOutfit(replica, hero)
    }

    // Ride the renderer's avatar, addressed exactly as the renderer spells it.
    // Until the renderer shows one there is nothing to stand next to, so the body waits unseen.
    const avatar = playerEntityByAddress(id)
    const reported = avatar !== undefined ? playerAddressAsReported(id) : undefined
    if (reported && replica.attachedAs !== reported) {
      replica.attachedAs = reported
      AvatarAttach.createOrReplace(replica.anchor, { avatarId: reported, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
    }
    if (reported) attached++

    // Follow the owner's clip. A new `seq` restarts it even when the name did not
    // change (two hits in a row). A clip we already started from the server's
    // verdict is left alone when the owner's own report of it arrives.
    replica.echoGrace = Math.max(0, replica.echoGrace - dt)
    const motion = hero.motion as EquipmentMotion
    const restart = hero.seq !== replica.seq
    if (motion !== replica.netMotion || restart) {
      replica.netMotion = motion
      replica.seq = hero.seq
      if (!(replica.echoGrace > 0 && motion === replica.motion)) {
        applyMotion(replica, motion, restart && RESET_MOTIONS.has(motion))
        if (restart && (motion === 'attack_light' || motion === 'attack_light2' || motion === 'attack_heavy')) {
          fxSlash(replica.root, motion as AttackMotion)
          fxSound(motion === 'attack_heavy' ? 'swing_heavy' : 'swing_light', 0.55)
        }
      }
    }

    const loading = getEquipmentLoading(replica.root)
    if (loading === 'error') {
      replica.retryIn -= dt
      if (replica.retryIn <= 0) loadOutfit(replica, hero)
    }
    const loaded = loading === 'ready'
    if (loaded) ready++
    // Only the owner's freshest body is shown; a leftover from their previous
    // session is hidden until the server takes it down. Heroes in another
    // party's run share these 96 m with us but are in their own phase: unseen.
    const shown = loaded && !!reported && replicaByAddress(id) === replica && partyOf(id) === myPhase
    setEquipmentVisible(replica.root, shown)
    updateHeroNameTag(replica.nameTag, id, shown)
    // The anchor turns with the native avatar, which the renderer interpolates
    // smoothly; the body normally adds nothing, so a turn shows the instant the
    // avatar makes it. Only while the owner is locked on does the body take the
    // published facing instead, eased in and out: that yaw is relayed and lags a
    // turn by a round trip, which read as a jitter when it was applied always.
    const baseYaw = avatar !== undefined && reported ? playerYaw(avatar) : 0
    const target = hero.lock ? wrapAngle(hero.f - baseYaw) : 0
    const ease = 1 - Math.exp(-(Number.isFinite(dt) && dt > 0 ? dt : 0) * TURN_RATE)
    replica.turn = wrapAngle(replica.turn + wrapAngle(target - replica.turn) * ease)
    Transform.getMutable(replica.root).rotation = Quaternion.fromEulerDegrees(0, (replica.turn * 180) / Math.PI, 0)
  }
  for (const [entity, replica] of [...replicas]) {
    if (!live.has(entity)) removeReplica(entity, replica)
  }

  diagAge += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (diagAge >= DIAG_SECONDS) {
    diagAge = 0
    let identities = 0
    for (const _ of engine.getEntitiesWith(PlayerIdentityData)) identities++
    const note = `${netStatus()}; players seen by renderer: ${identities}; bodies: ${replicas.size} (${ready} loaded, ${attached} attached)`
    console.log(`[DG] ${note}`)
    publishDiag(note)
  }
}
