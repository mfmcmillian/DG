// The hall's folk: a handful of characters who live in the Hall of Antrom so it
// is not empty between runs. They wear the same outfits heroes earn (each a set
// the player may not own yet, so the hall also shows what is out there), stand
// where they belong (the smith at the anvil, guards at the door, a squire at
// the dummies), gesture now and then, turn to face a hero who walks up, and a
// couple of them walk rounds. Purely local presentation: nothing here is
// networked, nothing takes or deals a hit, and the server never builds them.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CharacterAppearance } from './appearance'
import { COMBAT_CLIPS, EquipmentMotion } from './combatAnimations'
import { COURTYARD } from './courtyard'
import { onDungeonLoaded } from './dungeon'
import { DEFAULT_LOADOUTS, EQUIPMENT_ITEMS, EquipmentLoadout, getEquipmentItemOrNull } from './equipmentCatalog'
import {
  destroyEquipmentAvatar, getEquipmentLoading, setEquipmentAvatar, setEquipmentMotion, setEquipmentStride, setEquipmentVisible
} from './equipmentAvatar'
import { classAllowsWeapon } from './heroClasses'
import { createHeroNameTag, destroyHeroNameTag, setNameTagText } from './heroNameTag'
import { isHeadless } from './multiplayer'

type Gesture = { motion: EquipmentMotion; weight: number }

type Role = {
  /** The title over their head. */
  title: string
  /** Which hero's wardrobe they dress from. */
  cid: 'vanguard' | 'scout' | 'striker' | 'brute'
  /** Which of that hero's armor sets they wear (see equipmentCatalog: the set is the id prefix). */
  set: string
  weapon: string
  appearance: CharacterAppearance
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
    title: 'Quartermaster', cid: 'brute', set: 'karl', weapon: 'vk-axe-01',
    appearance: { bodyType: 'male', hairStyle: 'none', hairColor: 'black', skinTone: 'tan' },
    at: [29.4, 50.5], yaw: deg(-90), rest: 'combat_idle',
    gestures: [{ motion: 'attack_heavy', weight: 3 }, { motion: 'flourish', weight: 1 }], every: [4, 9], greets: 0
  },
  {
    title: 'Hall Guard', cid: 'vanguard', set: 'ironclad', weapon: 'pride-sword',
    appearance: { bodyType: 'male', hairStyle: 'short', hairColor: 'brown', skinTone: 'warm' },
    at: [43.3, 61.4], yaw: deg(0), rest: 'combat_idle',
    gestures: [], every: [0, 0], greets: 3.2
  },
  {
    title: 'Hall Guard', cid: 'vanguard', set: 'ironclad', weapon: 'pride-sword',
    appearance: { bodyType: 'female', hairStyle: 'tied', hairColor: 'black', skinTone: 'deep' },
    at: [47.7, 61.4], yaw: deg(0), rest: 'combat_idle',
    gestures: [], every: [0, 0], greets: 3.2
  },
  {
    title: 'Sellsword', cid: 'vanguard', set: 'blackguard', weapon: 'pride-sword',
    appearance: { bodyType: 'male', hairStyle: 'long', hairColor: 'auburn', skinTone: 'light' },
    at: [40.6, 43.9], yaw: deg(90), rest: 'idle',
    gestures: [{ motion: 'flourish', weight: 2 }, { motion: 'combat_idle', weight: 1 }], every: [7, 16], greets: 3
  },
  {
    title: 'Hedge Witch', cid: 'striker', set: 'witch', weapon: 'dr-staff-01',
    appearance: { bodyType: 'female', hairStyle: 'long', hairColor: 'violet', skinTone: 'light' },
    at: [42.4, 43.9], yaw: deg(-90), rest: 'idle',
    gestures: [{ motion: 'cast_bolt', weight: 1 }], every: [9, 20], greets: 3
  },
  {
    title: 'Squire', cid: 'brute', set: 'raider', weapon: 'vk-axe-01',
    appearance: { bodyType: 'male', hairStyle: 'short', hairColor: 'blonde', skinTone: 'light' },
    at: [63, 49.7], yaw: deg(180), rest: 'combat_idle',
    gestures: [{ motion: 'attack_light', weight: 3 }, { motion: 'attack_light2', weight: 3 }, { motion: 'attack_heavy', weight: 2 }, { motion: 'leap', weight: 1 }],
    every: [1.2, 3.5], greets: 0
  },
  {
    title: 'Ranger', cid: 'scout', set: 'dusk', weapon: 'bw-longbow-01',
    appearance: { bodyType: 'female', hairStyle: 'tied', hairColor: 'silver', skinTone: 'warm' },
    at: [40.5, 57], yaw: deg(0), rest: 'idle',
    gestures: [], every: [0, 0], greets: 0,
    // A round of the great hall inside the long tables and outside the braziers.
    patrol: { path: [[40.5, 57], [40.5, 44.5], [50.5, 44.5], [50.5, 57]], speed: 1.15, pause: [2.5, 6] }
  },
  {
    title: 'Herald', cid: 'striker', set: 'sage', weapon: 'dr-staff-01',
    appearance: { bodyType: 'male', hairStyle: 'short', hairColor: 'silver', skinTone: 'deep' },
    at: [45.5, 66.2], yaw: deg(180), rest: 'idle',
    gestures: [], every: [0, 0], greets: 0,
    // Vestibule to the foot of the war table and back, through the arch.
    patrol: { path: [[45.5, 66.2], [45.5, 55.2]], speed: 1.0, pause: [4, 9] }
  }
]

type Folk = {
  role: Role
  root: Entity
  tag: Entity
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

const TITLE_COLOR = Color4.create(0.78, 0.8, 0.86, 1)

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo)
}

/** Their outfit: the role's set piece by piece, the hero's default where a piece does not exist. */
function loadoutFor(role: Role): EquipmentLoadout {
  const base = DEFAULT_LOADOUTS[role.cid] ?? DEFAULT_LOADOUTS.vanguard
  const out: EquipmentLoadout = { ...base }
  for (const slot of ['head', 'chest', 'shoulders', 'hands', 'legs', 'boots'] as const) {
    const id = `${role.set}-${slot}`
    if (getEquipmentItemOrNull(id)) out[slot] = id
  }
  const weapon = getEquipmentItemOrNull(role.weapon)
  if (weapon?.weapon && classAllowsWeapon(role.cid, weapon.weapon.class)) out.weapon = role.weapon
  return out
}

function build(role: Role): Folk {
  const root = engine.addEntity()
  Transform.create(root, {
    position: Vector3.create(role.at[0], FLOOR_Y, role.at[1]),
    rotation: Quaternion.fromEulerDegrees(0, (role.yaw * 180) / Math.PI, 0)
  })
  setEquipmentAvatar(root, role.cid, loadoutFor(role), false, { appearance: role.appearance })
  setEquipmentVisible(root, false)
  setEquipmentMotion(root, role.rest, true)
  if (role.patrol) setEquipmentStride(root, Math.min(1.35, Math.max(0.7, role.patrol.speed / WALK_CLIP_SPEED)))
  const tag = createHeroNameTag(root)
  return {
    role, root, tag, loaded: false, x: role.at[0], z: role.at[1], yaw: role.yaw, wantYaw: role.yaw,
    nextGesture: role.gestures.length ? rand(role.every[0], role.every[1]) : Infinity, gesturing: 0,
    leg: 1, pausing: role.patrol ? rand(role.patrol.pause[0], role.patrol.pause[1]) : 0, walking: false
  }
}

function clear() {
  for (const f of folk) {
    destroyHeroNameTag(f.tag)
    destroyEquipmentAvatar(f.root)
    engine.removeEntity(f.root)
  }
  folk = []
  queue = []
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
  // Face a hero who comes close; back to the post when they go.
  if (role.greets > 0 && hero) {
    const dx = hero.x - f.x
    const dz = hero.z - f.z
    f.wantYaw = dx * dx + dz * dz <= role.greets * role.greets ? Math.atan2(dx, dz) : role.yaw
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

function patrol(f: Folk, dt: number) {
  const p = f.role.patrol!
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
      setNameTagText(f.tag, f.role.title, true, TITLE_COLOR)
    }
    if (f.role.patrol) patrol(f, span)
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

// A role naming a set with no pieces would fall back to the hero's defaults silently,
// which would only show up as two guards in starter kit: say so in the log instead.
for (const role of ROLES) {
  if (!EQUIPMENT_ITEMS.some((item) => item.id.startsWith(`${role.set}-`))) {
    console.log(`[DG] hall folk: no armor set '${role.set}' for the ${role.title}`)
  }
}
