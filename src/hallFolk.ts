// The hall's folk: a handful of characters who live in the Hall of Antrom so it
// is not empty between runs. They wear the same outfits heroes earn (each a set
// the player may not own yet, so the hall also shows what is out there), stand
// where they belong (the smith at the anvil, guards at the door, a squire at
// the dummies), gesture now and then, turn to face a hero who walks up, and a
// couple of them walk rounds. Nothing floats over their heads: a hero who
// walks up gets the hold-to-talk prompt beside them (src/hallPrompt.ts).
// Purely local presentation: nothing here is networked, nothing takes or
// deals a hit, and the server never builds them.
//
// Each is one baked GLB (src/folkBodies.json, built by scripts/build-hall-folk.py
// from scripts/folk/folk.json) carrying only the clips they play: in hero
// wardrobe the eight of them were ~70 files and ~2,200 clips on entering the
// hall, and remote heroes dropped out under that load.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COMBAT_CLIPS, EquipmentMotion } from './combatAnimations'
import { COURTYARD } from './courtyard'
import { onDungeonLoaded } from './dungeon'
import { DEFAULT_LOADOUTS } from './equipmentCatalog'
import {
  destroyEquipmentAvatar, getEquipmentLoading, isSolidBody, setEquipmentAvatar, setEquipmentMotion, setEquipmentStride, setEquipmentVisible
} from './equipmentAvatar'
import folkBodies from './folkBodies.json'
import { isHeadless } from './multiplayer'

type Gesture = { motion: EquipmentMotion; weight: number }

type Role = {
  /** Their baked body in src/folkBodies.json (which also carries their title). */
  body: keyof typeof folkBodies
  /** Which hero they are built as; the body's loadout comes from that hero's defaults. */
  cid: 'vanguard' | 'scout' | 'striker' | 'brute'
  /** Where they stand (world metres) and which way they face (radians, 0 = +Z, PI/2 = +X). */
  at: [number, number]
  yaw: number
  /** The clip they rest in. */
  rest: EquipmentMotion
  /** What they do now and then, weighted, and how long they wait between (seconds, min..max). */
  gestures: Gesture[]
  every: [number, number]
  /** Turn to face a hero who comes within this many metres (0: never). */
  greets: number
  /** A round to walk instead of standing still: waypoints, and how long to pause at each. */
  patrol?: { path: Array<[number, number]>; speed: number; pause: [number, number] }
}

const FLOOR_Y = COURTYARD.characterFloorY
/** The walk cycle is authored for about this ground speed. */
const WALK_CLIP_SPEED = 1.5
/** How fast a stander turns toward (and back from) a hero (1/s). */
const TURN_RATE = 5
/** One character starts loading this long after the last, so the hall's own kit lands first. */
const STAGGER_SECONDS = 0.45

const deg = (d: number) => (d * Math.PI) / 180

// Positions are read against src/dungeon/hub.ts: great hall x 33..58, z 38..63
// (war table at 45.5, 50.5 with braziers at x 42.5 / 48.5; long tables at
// x 37 and x 54); smithy x 23..33 (anvil at 27.5, 50.5); training yard
// x 58..68 (dummies along z 47); vestibule x 38..53, z 63..73 (spawn 45.5, 68).
const ROLES: Role[] = [
  {
    body: 'folk-quartermaster', cid: 'brute',
    at: [29.4, 50.5], yaw: deg(-90), rest: 'combat_idle',
    gestures: [{ motion: 'attack_heavy', weight: 3 }, { motion: 'flourish', weight: 1 }], every: [4, 9], greets: 0
  },
  {
    body: 'folk-guard-a', cid: 'vanguard',
    at: [43.3, 61.4], yaw: deg(0), rest: 'combat_idle',
    gestures: [], every: [0, 0], greets: 3.2
  },
  {
    body: 'folk-guard-b', cid: 'vanguard',
    at: [47.7, 61.4], yaw: deg(0), rest: 'combat_idle',
    gestures: [], every: [0, 0], greets: 3.2
  },
  {
    body: 'folk-sellsword', cid: 'vanguard',
    at: [40.6, 43.9], yaw: deg(90), rest: 'idle',
    gestures: [{ motion: 'flourish', weight: 2 }, { motion: 'combat_idle', weight: 1 }], every: [7, 16], greets: 3
  },
  {
    body: 'folk-witch', cid: 'striker',
    at: [42.4, 43.9], yaw: deg(-90), rest: 'idle',
    gestures: [{ motion: 'cast_bolt', weight: 1 }], every: [9, 20], greets: 3
  },
  {
    body: 'folk-squire', cid: 'brute',
    at: [63, 49.7], yaw: deg(180), rest: 'combat_idle',
    gestures: [{ motion: 'attack_light', weight: 3 }, { motion: 'attack_light2', weight: 3 }, { motion: 'attack_heavy', weight: 2 }, { motion: 'leap', weight: 1 }],
    every: [1.2, 3.5], greets: 0
  },
  {
    body: 'folk-ranger', cid: 'scout',
    at: [40.5, 57], yaw: deg(0), rest: 'idle',
    gestures: [], every: [0, 0], greets: 0,
    // A round of the great hall inside the long tables and outside the braziers.
    patrol: { path: [[40.5, 57], [40.5, 44.5], [50.5, 44.5], [50.5, 57]], speed: 1.15, pause: [2.5, 6] }
  },
  {
    body: 'folk-herald', cid: 'striker',
    at: [45.5, 66.2], yaw: deg(180), rest: 'idle',
    gestures: [], every: [0, 0], greets: 0,
    // Vestibule to the foot of the war table and back, through the arch.
    patrol: { path: [[45.5, 66.2], [45.5, 55.2]], speed: 1.0, pause: [4, 9] }
  }
]

type Folk = {
  role: Role
  root: Entity
  loaded: boolean
  x: number
  z: number
  /** The yaw shown and the yaw wanted; a stander eases between them. */
  yaw: number
  wantYaw: number
  /** Seconds to the next gesture, and seconds left in the one playing (0 when resting). */
  nextGesture: number
  gesturing: number
  /** Patrol: the waypoint being walked to, seconds left standing at one, and whether walking. */
  leg: number
  pausing: number
  walking: boolean
}

let folk: Folk[] = []
/** Roles waiting their turn to be built, and the time to the next. */
let queue: Role[] = []
let queueIn = 0
let systemAdded = false
/** The one a hero is talking to (src/hallTalk.ts): they face the hero and a walker stops. */
let attended: Folk | undefined

/** One of the folk as the talk system sees them. */
export type FolkView = { key: number; title: string; x: number; z: number }

/** The nearest loaded character within `reach` metres of (x, z), if any. */
export function hallFolkNear(x: number, z: number, reach: number): FolkView | undefined {
  let best: Folk | undefined
  let bestD = reach * reach
  for (const f of folk) {
    if (!f.loaded) continue
    const dx = f.x - x
    const dz = f.z - z
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      best = f
    }
  }
  return best ? { key: folk.indexOf(best), title: titleOf(best.role), x: best.x, z: best.z } : undefined
}

/** Hold (or release, with undefined) a character's attention while a hero talks to them. */
export function attendHallFolk(key: number | undefined) {
  attended = key === undefined ? undefined : folk[key]
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

/**
 * The body is one GLB, so the loadout only says whether they stand armed: a
 * folk at rest in the plain idle holds their weapon low rather than at the ready.
 */
function loadoutFor(role: Role) {
  const base = DEFAULT_LOADOUTS[role.cid] ?? DEFAULT_LOADOUTS.vanguard
  return { ...base, weapon: role.rest === 'idle' ? 'none-weapon' : base.weapon }
}

function build(role: Role): Folk {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(role.at[0], FLOOR_Y, role.at[1]),
    rotation: Quaternion.fromEulerDegrees(0, (role.yaw * 180) / Math.PI, 0)
  })
  setEquipmentAvatar(root, role.body, loadoutFor(role), false)
  setEquipmentVisible(root, false)
  setEquipmentMotion(root, role.rest, true)
  if (role.patrol) setEquipmentStride(root, Math.min(1.35, Math.max(0.7, role.patrol.speed / WALK_CLIP_SPEED)))
  return {
    role, root, loaded: false, x: role.at[0], z: role.at[1], yaw: role.yaw, wantYaw: role.yaw,
    nextGesture: role.gestures.length ? rand(role.every[0], role.every[1]) : Infinity, gesturing: 0,
    leg: 1, pausing: role.patrol ? rand(role.patrol.pause[0], role.patrol.pause[1]) : 0, walking: false
  }
}

function clear() {
  for (const f of folk) {
    destroyEquipmentAvatar(f.root)
    engine.removeEntity(f.root)
  }
  folk = []
  queue = []
  attended = undefined
}

function pickGesture(role: Role): EquipmentMotion {
  let total = 0
  for (const g of role.gestures) total += g.weight
  let r = Math.random() * total
  for (const g of role.gestures) {
    r -= g.weight
    if (r <= 0) return g.motion
  }
  return role.gestures[role.gestures.length - 1].motion
}

/** A one-shot's real length; a looping clip used as a gesture (a stance) holds for a few seconds. */
function gestureSeconds(motion: EquipmentMotion): number {
  const clip = COMBAT_CLIPS[motion]
  if (clip.loop) return rand(2.5, 5)
  return clip.duration / (clip.rate ?? 1)
}

function turnToward(f: Folk, dt: number) {
  let d = f.wantYaw - f.yaw
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  if (Math.abs(d) < 0.002) {
    f.yaw = f.wantYaw
    return
  }
  f.yaw += d * (1 - Math.exp(-TURN_RATE * dt))
}

function stand(f: Folk, dt: number, hero: Vector3 | undefined) {
  const role = f.role
  // Face a hero who comes close, or who is talking to them; back to the post when they go.
  if ((role.greets > 0 || f === attended) && hero) {
    const dx = hero.x - f.x
    const dz = hero.z - f.z
    f.wantYaw = f === attended || dx * dx + dz * dz <= role.greets * role.greets ? Math.atan2(dx, dz) : role.yaw
  }
  if (f.gesturing > 0) {
    f.gesturing -= dt
    if (f.gesturing <= 0) {
      f.gesturing = 0
      setEquipmentMotion(f.root, role.rest, true)
      f.nextGesture = rand(role.every[0], role.every[1])
    }
  } else if (f.nextGesture !== Infinity) {
    f.nextGesture -= dt
    if (f.nextGesture <= 0) {
      const motion = pickGesture(role)
      f.gesturing = gestureSeconds(motion)
      setEquipmentMotion(f.root, motion, true)
    }
  }
}

function patrol(f: Folk, dt: number, hero: Vector3 | undefined) {
  const p = f.role.patrol!
  // Stopped for a word: stand and face the hero; the round resumes when they are done.
  if (f === attended) {
    if (f.walking) {
      f.walking = false
      f.pausing = 0.5
      setEquipmentMotion(f.root, f.role.rest, true)
    }
    if (hero) f.wantYaw = Math.atan2(hero.x - f.x, hero.z - f.z)
    return
  }
  if (!f.walking) {
    f.pausing -= dt
    if (f.pausing > 0) return
    f.walking = true
    setEquipmentMotion(f.root, 'walk', true)
  }
  const [tx, tz] = p.path[f.leg]
  const dx = tx - f.x
  const dz = tz - f.z
  const dist = Math.hypot(dx, dz)
  const step = p.speed * dt
  f.wantYaw = Math.atan2(dx, dz)
  if (dist <= step) {
    f.x = tx
    f.z = tz
    f.leg = (f.leg + 1) % p.path.length
    f.walking = false
    f.pausing = rand(p.pause[0], p.pause[1])
    setEquipmentMotion(f.root, f.role.rest, true)
    // Look on toward the next leg while waiting, as a walker who knows the way does.
    const [nx, nz] = p.path[f.leg]
    f.wantYaw = Math.atan2(nx - f.x, nz - f.z)
    return
  }
  f.x += (dx / dist) * step
  f.z += (dz / dist) * step
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  if (queue.length) {
    queueIn -= span
    if (queueIn <= 0) {
      folk.push(build(queue.shift()!))
      queueIn = STAGGER_SECONDS
    }
  }
  if (!folk.length) return
  const hero = Transform.getOrNull(engine.PlayerEntity)?.position
  for (const f of folk) {
    if (!f.loaded) {
      const loading = getEquipmentLoading(f.root)
      if (loading !== 'ready') continue
      f.loaded = true
      setEquipmentVisible(f.root, true)
    }
    if (f.role.patrol) patrol(f, span, hero)
    else stand(f, span, hero)
    turnToward(f, span)
    const t = Transform.getMutableOrNull(f.root)
    if (!t) continue
    if (f.role.patrol) t.position = Vector3.create(f.x, FLOOR_Y, f.z)
    t.rotation = Quaternion.fromEulerDegrees(0, (f.yaw * 180) / Math.PI, 0)
  }
}

export function initializeHallFolk() {
  if (isHeadless()) return
  onDungeonLoaded((state) => {
    clear()
    if (state.style.id !== 'hall') return
    queue = [...ROLES]
    queueIn = STAGGER_SECONDS * 2
  })
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(update)
  }
}

function titleOf(role: Role): string {
  return folkBodies[role.body].title
}

// Every role's body must be baked (scripts/build-hall-folk.py), or the hall shows a gap where they stand.
for (const role of ROLES) {
  if (!isSolidBody(role.body)) console.log(`[DG] hall folk: no baked body '${role.body}'`)
}
