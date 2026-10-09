// The Barrow Run, Gravewatch's runner: the hero runs a three-lane graveyard
// road, swaps lanes with A and D, and keeps going while the stamina meter
// lasts. Tombstones, tombs and ghouls bite the meter and stumble the hero;
// embers refill it, a lantern bursts the speed, a ward shrugs off a hit.
// Everything here is pure and deterministic from the run's seed, so the host
// and the client run the same race: the host from the player's lane changes,
// which is what makes the distance (and the embers it pays) its own.

/** Free runs a day, and the ember price of one more. */
export const RUN_TOKENS = 3
export const RUN_EXTRA_COST = 60
/** Distance tiers and what each pays; every tier reached in a run pays. */
export const RUN_TIERS: readonly { m: number; embers: number }[] = [
  { m: 300, embers: 10 },
  { m: 600, embers: 20 },
  { m: 1000, embers: 35 },
  { m: 1500, embers: 60 }
]
/** A mileage point per this many metres; the points train the three stats below. */
export const RUN_MILE = 50
/** Training: Endurance (more stamina), Speed (faster from the start), Luck (more and better pickups). */
export const RUN_STATS = ['end', 'spd', 'lck'] as const
export type RunStat = (typeof RUN_STATS)[number]
export const RUN_TRAIN_MAX = 10
/** Each stat level adds this: a tenth more stamina, four hundredths more speed, a point of luck. */
export const RUN_END_STEP = 0.1
export const RUN_SPD_STEP = 0.04
/** Mileage points for the next level: 10, 20, 30… */
export function runTrainCost(level: number): number {
  return 10 * (level + 1)
}
/** The leaderboards keep this many names. */
export const RUN_BOARD_SIZE = 10
/** Monday-start weeks, counted in Eastern days since the epoch, for the weekly board's key. */
export function runWeekKey(dayKey: string): string {
  const days = Math.floor(Date.UTC(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)) - 1, Number(dayKey.slice(8, 10))) / 86400000)
  return String(Math.floor((days + 3) / 7))
}

export const RUN_LANES = 3
export const RUN_LANE_WIDTH = 2.2
/** Host and client use the same sideways motion, so collision follows the visible runner. */
export const RUN_LATERAL_SPEED = 11
/** Metres a second at the start, the ramp per hundred metres, and the ceiling. */
export const RUN_BASE_SPEED = 7
export const RUN_SPEED_PER_100 = 0.35
export const RUN_MAX_SPEED = 13
/** Final ceiling after training and a lantern; prevents speed from outrunning reliable play. */
export const RUN_MAX_TOTAL_SPEED = 18
/** The meter: where it starts, what it loses a second (plus distance over RUN_DRAIN_RAMP a second more). */
export const RUN_STAMINA = 100
export const RUN_DRAIN = 3.2
export const RUN_DRAIN_RAMP = 500
/** An obstacle: this much off the meter and this long at a stumble's pace. */
export const RUN_HIT_STAMINA = 22
export const RUN_STUMBLE_SECONDS = 0.8
export const RUN_STUMBLE_SPEED = 0.35
/** Brief protection after damage prevents a two-obstacle row from chaining hits during the stumble. */
export const RUN_HIT_GRACE_SECONDS = 1
/** Pickups: an ember's stamina (and one ember to the tally), the lantern's burst, the ward's cover. */
export const RUN_EMBER_STAMINA = 9
export const RUN_LANTERN_SECONDS = 4
export const RUN_LANTERN_MULT = 1.6
export const RUN_WARD_SECONDS = 4
/** The road is laid in chunks this long; the largest overlap reach is used to scan it. */
export const RUN_CHUNK = 40
export const RUN_HIT_RADIUS = 1.6
/** The host runs this far behind the clock so lane changes arrive in time, and tells the client where it stands this often. */
export const RUN_HOST_DELAY = 0.4
export const RUN_SYNC_SECONDS = 0.5
/** Host and client both advance the deterministic race in exactly this-sized slice. */
export const RUN_STEP_SECONDS = 0.025
/** A run cannot outlast this, whatever the meter says. */
export const RUN_MAX_SECONDS = 240

export type RunItemKind = 'stone' | 'tomb' | 'ghoul' | 'ember' | 'lantern' | 'ward'
export type RunItem = { kind: RunItemKind; lane: number; at: number; key: string }

export function isObstacle(kind: RunItemKind): boolean {
  return kind === 'stone' || kind === 'tomb' || kind === 'ghoul'
}

export type RunItemBounds = Readonly<{ width: number; height: number; depth: number }>

/** Model-sized boxes in metres. Pickups stay slightly generous so they remain pleasant to collect. */
export function runItemBounds(kind: RunItemKind): RunItemBounds {
  switch (kind) {
    case 'stone': return { width: 0.651, height: 1.776, depth: 0.649 }
    // Slightly inset from the stone model so its long ends and corners do not feel unfair from the overhead camera.
    case 'tomb': return { width: 1.22, height: 1.77, depth: 2.35 }
    case 'ghoul': return { width: 0.9, height: 2, depth: 0.65 }
    case 'lantern': return { width: 0.6, height: 0.8, depth: 0.6 }
    default: return { width: 0.8, height: 0.8, depth: 0.8 }
  }
}

export function runItemHitRadius(kind: RunItemKind): number {
  return runItemBounds(kind).depth / 2
}

/** A small fast PRNG (mulberry32) so both sides lay the same road. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const chunkCache = new Map<string, RunItem[]>()

/**
 * The items on chunk `index` of the road laid from `seed`: obstacles at steps
 * along it, never all three lanes at once, denser and closer as the chunks go
 * by; embers in the open lanes, now and then a lantern or a ward. The first
 * chunk is clear so the hero finds their feet.
 */
export function chunkItems(seed: number, index: number, luck = 0): RunItem[] {
  const cacheKey = `${seed}:${index}:${luck}`
  const cached = chunkCache.get(cacheKey)
  if (cached) return cached
  const items: RunItem[] = []
  if (index > 0) {
    const r = rng((seed ^ Math.imul(index, 0x9e3779b9)) >>> 0)
    const start = index * RUN_CHUNK
    const gapMin = Math.max(4.5, 9 - index * 0.35)
    const gapMax = Math.max(7, 14 - index * 0.5)
    let at = start + 3 + r() * 4
    let n = 0
    while (at < start + RUN_CHUNK - 3) {
      // One obstacle, or two from the fourth chunk on, leaving a lane open.
      const two = index >= 4 && r() < Math.min(0.55, 0.15 + index * 0.04)
      const first = Math.floor(r() * RUN_LANES)
      const lanes = [first]
      if (two) {
        let second = Math.floor(r() * (RUN_LANES - 1))
        if (second >= first) second++
        lanes.push(second)
      }
      for (const lane of lanes) {
        const pick = r()
        const kind: RunItemKind = pick < 0.35 ? 'stone' : pick < 0.6 ? 'tomb' : 'ghoul'
        items.push({ kind, lane, at, key: `${index}:${n++}` })
      }
      // Something to run through in an open lane just past it.
      const open: number[] = []
      for (let l = 0; l < RUN_LANES; l++) if (!lanes.includes(l)) open.push(l)
      // Luck helps without making every obstacle produce a pickup. Wards stay
      // uncommon so a Luck build cannot chain near-permanent immunity.
      const pickChance = Math.min(0.85, 0.55 + luck * 0.03)
      if (r() < pickChance) {
        const lane = open[Math.floor(r() * open.length)]
        const special = r()
        const wardChance = 0.04 + luck * 0.006
        const lanternChance = 0.14 + luck * 0.012
        const kind: RunItemKind = special < wardChance ? 'ward' : special < wardChance + lanternChance ? 'lantern' : 'ember'
        items.push({ kind, lane, at: at + 2.2, key: `${index}:${n++}` })
      }
      at += gapMin + r() * (gapMax - gapMin)
    }
  }
  chunkCache.set(cacheKey, items)
  return items
}

export type RunState = {
  /** Run seconds, metres along the road, target lane (0 left, 2 right), and current lateral offset. */
  t: number
  s: number
  lane: number
  x: number
  stamina: number
  staminaMax: number
  /** Training and cheer, as a factor on speed. */
  speedMult: number
  luck: number
  /** Seconds left of each. */
  stumble: number
  hitGrace: number
  lantern: number
  ward: number
  hits: number
  embers: number
  picks: number
  over: boolean
  taken: Set<string>
}

export function newRunState(staminaMax = RUN_STAMINA, speedMult = 1, luck = 0): RunState {
  return {
    t: 0, s: 0, lane: 1, x: laneOffset(1), stamina: staminaMax, staminaMax, speedMult, luck,
    stumble: 0, hitGrace: 0, lantern: 0, ward: 0, hits: 0, embers: 0, picks: 0, over: false, taken: new Set()
  }
}

/** The hero's speed right now, in metres a second. */
export function runSpeed(st: RunState): number {
  let v = Math.min(RUN_MAX_SPEED, RUN_BASE_SPEED + RUN_SPEED_PER_100 * (st.s / 100)) * st.speedMult
  if (st.lantern > 0) v *= RUN_LANTERN_MULT
  if (st.stumble > 0) v *= RUN_STUMBLE_SPEED
  return Math.min(RUN_MAX_TOTAL_SPEED, v)
}

export type RunEvent = 'hit' | 'ember' | 'lantern' | 'ward' | 'smash' | 'over'

/** One step of the race: the road passes, the meter drains, whatever is in the lane is met. Returns what happened. */
export function stepRun(st: RunState, dt: number, seed: number): RunEvent[] {
  const events: RunEvent[] = []
  if (st.over || dt <= 0) return events
  const s0 = st.s
  const targetX = laneOffset(st.lane)
  const lateralStep = RUN_LATERAL_SPEED * dt
  st.x = Math.abs(targetX - st.x) <= lateralStep ? targetX : st.x + Math.sign(targetX - st.x) * lateralStep
  st.s += runSpeed(st) * dt
  st.t += dt
  st.stumble = Math.max(0, st.stumble - dt)
  st.hitGrace = Math.max(0, st.hitGrace - dt)
  st.lantern = Math.max(0, st.lantern - dt)
  st.ward = Math.max(0, st.ward - dt)
  st.stamina -= (RUN_DRAIN + st.s / RUN_DRAIN_RAMP) * dt
  const lo = s0 - RUN_HIT_RADIUS
  const hi = st.s + RUN_HIT_RADIUS
  const firstChunk = Math.max(0, Math.floor(lo / RUN_CHUNK))
  const lastChunk = Math.floor(hi / RUN_CHUNK)
  for (let c = firstChunk; c <= lastChunk; c++) {
    for (const item of chunkItems(seed, c, st.luck)) {
      const bounds = runItemBounds(item.kind)
      const radius = runItemHitRadius(item.kind)
      const lateralReach = bounds.width / 2
      if (Math.abs(laneOffset(item.lane) - st.x) > lateralReach ||
        item.at < s0 - radius || item.at > st.s + radius || st.taken.has(item.key)) continue
      st.taken.add(item.key)
      if (isObstacle(item.kind)) {
        if (st.ward > 0) {
          events.push('smash')
        } else if (st.hitGrace > 0) {
          // It is already in `taken`, so an obstacle crossed during grace
          // cannot deal delayed damage when protection ends.
        } else {
          st.stamina -= RUN_HIT_STAMINA
          st.stumble = RUN_STUMBLE_SECONDS
          st.hitGrace = RUN_HIT_GRACE_SECONDS
          st.hits++
          events.push('hit')
        }
      } else if (item.kind === 'ember') {
        st.stamina = Math.min(st.staminaMax, st.stamina + RUN_EMBER_STAMINA)
        st.embers++
        st.picks++
        events.push('ember')
      } else if (item.kind === 'lantern') {
        st.lantern = RUN_LANTERN_SECONDS
        st.picks++
        events.push('lantern')
      } else {
        st.ward = RUN_WARD_SECONDS
        st.picks++
        events.push('ward')
      }
    }
  }
  if (st.stamina <= 0 || st.t >= RUN_MAX_SECONDS) {
    st.stamina = Math.max(0, st.stamina)
    st.over = true
    events.push('over')
  }
  return events
}

/** The embers the tiers pay for a distance. */
export function runTierEmbers(metres: number): number {
  let total = 0
  for (const tier of RUN_TIERS) if (metres >= tier.m) total += tier.embers
  return total
}

/** Lane centre as an offset across the road, left negative. */
export function laneOffset(lane: number): number {
  return (lane - (RUN_LANES - 1) / 2) * RUN_LANE_WIDTH
}
