// The training yard: the hall's dummies and targets take a hero's blows so a
// player can see what their weapon does. Each hit shows the usual numbers and
// impact (dungeonEnemies presents it like a hit on an enemy), rocks the dummy,
// and feeds a running tally the HUD shows while the player keeps swinging.

import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CombatPose } from './combatActions'
import { onDungeonLoaded } from './dungeon'
import { TRAINING_TARGETS } from './dungeon/hub'
import { setTrainingTargets, TrainingTarget } from './dungeonEnemies'

type Dummy = {
  entity: Entity
  target: TrainingTarget
  /** The piece's authored rotation, which the rock returns to. */
  rest: Quaternion
  /** Seconds since the last blow (Infinity when still), the blow's yaw and how hard it was. */
  rocking: number
  rockYaw: number
  rockAmplitude: number
}

/** The running tally of a string of blows on the yard's targets. */
export type TrainingTally = {
  /** Damage of the last blow. */
  last: number
  /** Blows and damage in the current string (a pause longer than STRING_GAP starts a new one). */
  hits: number
  total: number
  /** Damage per second across the string, once it has two blows; 0 before that. */
  perSecond: number
  /** Heaviest single blow since the hall was entered. */
  best: number
  /** Seconds since the last blow. */
  since: number
}

/** A pause this long ends a string. */
const STRING_GAP = 3
/** How long the rock lasts and how fast it swings. */
const ROCK_SECONDS = 0.9
const ROCK_DECAY = 4.5
const ROCK_HZ = 2.6

let dummies: Dummy[] = []
const tally: TrainingTally = { last: 0, hits: 0, total: 0, perSecond: 0, best: 0, since: Infinity }
let stringStart = 0
let lastHitAt = 0
let clock = 0

export function trainingTally(): Readonly<TrainingTally> {
  return tally
}

/** The yard is in use: a blow landed recently enough that the tally is worth showing. */
export function trainingActive(): boolean {
  return tally.since < 6
}

/** Standing within `reach` metres of one of the yard's targets (the hints use it to offer the keys). */
export function nearTrainingDummy(x: number, z: number, reach: number): boolean {
  for (const d of dummies) {
    const dx = d.target.position.x - x
    const dz = d.target.position.z - z
    if (dx * dx + dz * dz <= reach * reach) return true
  }
  return false
}

function onHit(damage: number, attacker: CombatPose, heavy: boolean, d: Dummy) {
  if (clock - lastHitAt > STRING_GAP) {
    tally.hits = 0
    tally.total = 0
    stringStart = clock
  }
  lastHitAt = clock
  tally.last = damage
  tally.hits++
  tally.total += damage
  tally.best = Math.max(tally.best, damage)
  const span = clock - stringStart
  tally.perSecond = tally.hits >= 2 && span > 0.2 ? tally.total / span : 0
  tally.since = 0
  // Rock away from the blow; a hit on an already swinging dummy adds to it.
  d.rockAmplitude = Math.min(22, (heavy ? 14 : 8) + (d.rocking < ROCK_SECONDS ? 4 : 0))
  d.rocking = 0
  d.rockYaw = attacker.facing
}

function collect(): Dummy[] {
  const out: Dummy[] = []
  const tagged = getTagged()
  for (const tag of Object.keys(TRAINING_TARGETS)) {
    const entity = tagged[tag]
    if (entity === undefined) continue
    const t = Transform.getOrNull(entity)
    if (!t) continue
    const d: Dummy = {
      entity,
      rest: Quaternion.create(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w),
      rocking: Infinity, rockYaw: 0, rockAmplitude: 0,
      target: {
        position: Vector3.create(t.position.x, t.position.y, t.position.z),
        scale: TRAINING_TARGETS[tag].scale,
        material: TRAINING_TARGETS[tag].material,
        onHit: (damage, attacker, _motion, heavy) => onHit(damage, attacker, heavy, d)
      }
    }
    out.push(d)
  }
  return out
}

let getTagged: () => Record<string, Entity> = () => ({})

export function initializeTrainingDummies() {
  onDungeonLoaded((state) => {
    getTagged = () => state.instance?.tagged ?? {}
    dummies = state.style.id === 'hall' ? collect() : []
    tally.since = Infinity
    tally.hits = 0
    tally.total = 0
    tally.perSecond = 0
  })
  setTrainingTargets(() => dummies.map((d) => d.target))
  engine.addSystem((dt) => {
    clock += dt
    tally.since += dt
    for (const d of dummies) {
      if (d.rocking === Infinity) continue
      d.rocking += dt
      const t = Transform.getMutableOrNull(d.entity)
      if (!t) {
        d.rocking = Infinity
        continue
      }
      if (d.rocking >= ROCK_SECONDS) {
        d.rocking = Infinity
        t.rotation = d.rest
        continue
      }
      // A damped swing about the horizontal axis across the blow, so the
      // dummy leans away first and settles back through a couple of wobbles.
      const angle = d.rockAmplitude * Math.exp(-ROCK_DECAY * d.rocking) * Math.sin(2 * Math.PI * ROCK_HZ * d.rocking)
      const axis = Vector3.create(Math.cos(d.rockYaw), 0, -Math.sin(d.rockYaw))
      t.rotation = Quaternion.multiply(d.rest, Quaternion.fromAngleAxis(angle, axis))
    }
  })
}
