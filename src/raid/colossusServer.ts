// The Chained Colossus: the headless host's side. One boss for the whole
// realm, sleeping in the Pit of Chains until someone walks up to it. The
// brain here picks its blows, lands them on the heroes' authoritative
// health, keeps the stagger meter and the phases, and broadcasts a compact
// snapshot several times a second that every client poses the stone from.
//
// Hits on it come back as `hitRaid` (which part, which motion); the host
// checks the part is really within the hero's reach from its own pose and
// reads the weapon off the hero's synced body, exactly as it does for
// dungeon enemies. Rewards are XP and a Legendary drop for each hero still
// standing (or down but not gone) when it falls.

import { engine } from '@dcl/sdk/ecs'
import { attackRange, isHeavyMotion, isRangedAttack, resolveCombatHit, WeaponMotion } from '../combatActions'
import { PIT_CENTER, inPitArena } from '../dungeon/pit'
import { heroClassOf, weaponPoolFor } from '../heroClasses'
import { heroDownFor, reviveHero, strikeHero } from '../heroVitals'
import { heroBonusesFor } from '../heroXp'
import { allFighters, heroCharacters, heroWeapon, NetFighter } from '../multiplayer'
import { onNet, sendNet } from '../net'
import { RAID_PARTY } from '../shared/levels'
import { rollArmorDrop, rollRaidDrop, weaponStats } from '../weapons'
import {
  Act, ACTS, armFor, BossState, curve, DEBRIS_RADIUS, FISSURE_RADIUS, poseFor, slamPoint, SLAM_RADIUS, solvePose, STOMP_BAND,
  SWEEP_INNER, SWEEP_OUTER, v3, Vec3
} from './colossusPose'

export const COLOSSUS_MAX_HP = 9000
/** A hero this close to the circle wakes it. */
const WAKE_RADIUS = 17
/** With nobody in the Pit this long the fight resets and the stone settles. */
const ABANDON_SECONDS = 25
/** It lies broken this long before the chains draw it up again. */
const RESPAWN_SECONDS = 240
const WAKING_SECONDS = 4
const STAGGER_SECONDS = 6
const DYING_SECONDS = 5
/** Blows on grounded fists (and the head) fill this to topple it. */
const POISE_MAX = 900
/** Seconds of touching a downed ally to raise them. */
const REVIVE_SECONDS = 3
const REVIVE_RADIUS = 2.4
const SNAPSHOT_HZ = 8
const TURN_RATE = 1.5

const DAMAGE = { slam: 46, sweep: 34, stomp: 28, fissure: 30, burn: 5, debris: 42 } as const
/** Multipliers on what a hero's blow does, by the part it lands on. */
const PART_MULT: Record<string, number> = { leg_l: 1, leg_r: 1, hand_l: 1.6, hand_r: 1.6, head: 2.2 }
const XP_KILL = 320
const XP_PARTICIPATION_MIN = 0.15

type Fire = { x: number; z: number; left: number; tick: number }

type Brain = {
  state: BossState
  stateT: number
  hp: number
  phase: number
  yaw: number
  act: Act
  t: number
  pts: Vec3[]
  cooldown: number
  poise: number
  fires: Fire[]
  wait: number
  emptyFor: number
  /** Per act bookkeeping: which impact marks have fired, who the sweep/ring already caught. */
  fired: Set<number>
  caught: Set<string>
  sweepPrev: number
  ringPrev: number
  aggro: Map<string, number>
  /** Damage each hero has done this life, for the participation share of the reward. */
  dealt: Map<string, number>
  revive: Map<string, number>
  snapshotAge: number
  lastAct: Act
}

type Callbacks = {
  members: () => string[]
  awardXp: (id: string, amount: number) => void
  saveXp: () => void
}

let cb: Callbacks | undefined
const center: Vec3 = v3(PIT_CENTER.x, 0, PIT_CENTER.z)
const brain: Brain = freshBrain()

function freshBrain(): Brain {
  return {
    state: 'dormant', stateT: 0, hp: COLOSSUS_MAX_HP, phase: 1, yaw: 0, act: '', t: 0, pts: [], cooldown: 0, poise: 0, fires: [],
    wait: 0, emptyFor: 0, fired: new Set(), caught: new Set(), sweepPrev: 0, ringPrev: 0, aggro: new Map(), dealt: new Map(),
    revive: new Map(), snapshotAge: 0, lastAct: ''
  }
}

export function initializeColossusServer(callbacks: Callbacks) {
  cb = callbacks
  onNet('hitRaid', (msg, context) => {
    if (!context) return
    onHit(context.from.toLowerCase(), msg.part, msg.motion, msg.finisher)
  })
  engine.addSystem(update)
  console.log('[Colossus] chained in the Pit')
}

/** Heroes in the raid party who are standing on the Pit's floor. */
function raiders(): NetFighter[] {
  const members = cb?.members() ?? []
  if (!members.length) return []
  const inside = new Set(members)
  return allFighters().filter((f) => inside.has(f.address) && inPitArena(f.position.x, f.position.z))
}

function setState(next: BossState) {
  brain.state = next
  brain.stateT = 0
  brain.act = ''
  brain.t = 0
  brain.pts = []
  brain.fired.clear()
  brain.caught.clear()
}

function announce(kind: string, text: string, n = 0, to?: string[]) {
  sendNet('raidEvent', { kind, text, n }, to ? { to } : undefined)
}

function phaseFor(hp: number): number {
  const k = hp / COLOSSUS_MAX_HP
  return k > 0.66 ? 1 : k > 0.33 ? 2 : 3
}

function flat(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Angle of a point around the Colossus, degrees, 0 straight ahead, positive to its left (+X side). */
function bearing(p: { x: number; z: number }): number {
  const dx = p.x - center.x
  const dz = p.z - center.z
  const a = Math.atan2(dx, dz) - brain.yaw
  let d = (a * 180) / Math.PI
  while (d > 180) d -= 360
  while (d < -180) d += 360
  return d
}

// --- the fight -----------------------------------------------------------------------------

function update(dt: number) {
  if (!cb) return
  const fighters = raiders()
  const alive = fighters.filter((f) => f.health > 0)
  brain.stateT += dt
  brain.snapshotAge += dt

  for (const f of brain.fires) {
    f.left -= dt
    f.tick -= dt
    if (f.tick <= 0) {
      f.tick = 0.5
      for (const h of alive) {
        if (flat(h.position, f) < FISSURE_RADIUS && !h.invulnerable) strikeHero(h.address, DAMAGE.burn, 0, 0)
      }
    }
  }
  brain.fires = brain.fires.filter((f) => f.left > 0)

  if (fighters.length === 0) brain.emptyFor += dt
  else brain.emptyFor = 0

  switch (brain.state) {
    case 'dormant':
      if (alive.some((f) => flat(f.position, center) < WAKE_RADIUS)) {
        setState('waking')
        brain.hp = COLOSSUS_MAX_HP
        brain.phase = 1
        brain.poise = 0
        brain.dealt.clear()
        brain.aggro.clear()
        announce('wake', 'The chains groan. The Colossus stirs.')
        console.log('[Colossus] wakes')
      }
      break
    case 'waking':
      if (brain.stateT >= WAKING_SECONDS) {
        setState('fighting')
        brain.act = 'roar'
        brain.cooldown = 0
      }
      break
    case 'fighting':
    case 'stagger':
      if (brain.emptyFor > ABANDON_SECONDS) {
        setState('dormant')
        brain.fires = []
        announce('leave', 'Nothing stirs in the Pit. The stone settles.')
        console.log('[Colossus] abandoned, resets')
        break
      }
      fight(dt, fighters, alive)
      break
    case 'dying':
      if (brain.stateT >= DYING_SECONDS) {
        setState('dead')
        brain.wait = RESPAWN_SECONDS
      }
      break
    case 'dead':
      brain.wait -= dt
      if (brain.wait <= 0) {
        setState('dormant')
        brain.hp = COLOSSUS_MAX_HP
        brain.phase = 1
        console.log('[Colossus] the chains draw it up again')
      }
      break
  }

  tendDowned(dt, fighters)

  const busy = brain.state !== 'dormant' || fighters.length > 0
  const every = busy ? 1 / SNAPSHOT_HZ : 2
  if (brain.snapshotAge >= every && (fighters.length > 0 || brain.state !== 'dormant' || brain.snapshotAge < every * 2)) {
    brain.snapshotAge = 0
    broadcast(fighters)
  }
}

function fight(dt: number, fighters: NetFighter[], alive: NetFighter[]) {
  // Aggro decays; nearness counts a little, damage counts a lot.
  for (const [id, score] of brain.aggro) brain.aggro.set(id, score * Math.pow(0.9, dt))
  for (const f of alive) {
    const near = flat(f.position, center) < 7 ? 6 * dt : 0
    brain.aggro.set(f.address, (brain.aggro.get(f.address) ?? 0) + near)
  }
  const target = pickTarget(alive)

  if (brain.state === 'stagger') {
    if (brain.stateT >= STAGGER_SECONDS) {
      setState('fighting')
      brain.cooldown = 1.2
      announce('rise', 'The Colossus finds its feet.')
    }
    return
  }

  // Turn toward the target unless a blow is already committed.
  const swinging = brain.act !== '' && brain.t > telegraphOf(brain.act) * 0.55
  if (target && !swinging) {
    const want = Math.atan2(target.position.x - center.x, target.position.z - center.z)
    let d = want - brain.yaw
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const step = TURN_RATE * dt
    brain.yaw += Math.abs(d) < step ? d : Math.sign(d) * step
  }

  if (brain.act) {
    const prev = brain.t
    brain.t += dt
    resolveAct(prev, brain.t, alive)
    if (brain.t >= ACTS[brain.act].duration) {
      brain.lastAct = brain.act
      brain.act = ''
      brain.t = 0
      brain.pts = []
      brain.fired.clear()
      brain.caught.clear()
      brain.cooldown = brain.phase === 1 ? 2.2 : brain.phase === 2 ? 1.5 : 1.0
    }
    return
  }

  brain.cooldown -= dt
  if (brain.cooldown > 0 || !target) return
  chooseAct(target, alive)
}

function telegraphOf(act: Act): number {
  if (!act) return 0
  const spec = ACTS[act] as { telegraph?: number; duration: number }
  return spec.telegraph ?? spec.duration * 0.4
}

function pickTarget(alive: NetFighter[]): NetFighter | undefined {
  let best: NetFighter | undefined
  let bestScore = -Infinity
  for (const f of alive) {
    const score = (brain.aggro.get(f.address) ?? 0) - flat(f.position, center) * 0.4
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best
}

function chooseAct(target: NetFighter, alive: NetFighter[]) {
  const dist = flat(target.position, center)
  const bands = { near: 0, mid: 0, far: 0 }
  for (const f of alive) {
    const d = flat(f.position, center)
    if (d < SWEEP_INNER + 1) bands.near++
    else if (d <= SWEEP_OUTER) bands.mid++
    else bands.far++
  }
  type Choice = 'slam' | 'sweep' | 'stomp' | 'slam_lr' | 'fissure' | 'debris'
  const options: Array<[Choice, number]> = []
  const reachable = dist <= 11
  if (reachable) options.push(['slam', 45])
  if (bands.mid > 0) options.push(['sweep', 30 + bands.mid * 6])
  options.push(['stomp', 22 + bands.near * 8 + bands.far * 6])
  if (brain.phase >= 2 && alive.length >= 2) options.push(['slam_lr', 30])
  if (brain.phase >= 3) {
    options.push(['fissure', 30])
    if (bands.far + bands.mid > 0) options.push(['debris', 28 + bands.far * 8])
  }
  // Never the same thing twice in a row when there is a choice.
  const last = brain.lastAct
  const lastChoice: Choice | '' = last === 'slam_l' || last === 'slam_r' ? 'slam' : last === 'sweep_l' || last === 'sweep_r' ? 'sweep' : last === 'roar' ? '' : last
  const filtered = options.filter(([a]) => a !== lastChoice)
  const pool = filtered.length ? filtered : options
  let total = 0
  for (const [, w] of pool) total += w
  let pick = Math.random() * total
  let chosen: Choice = pool[0][0]
  for (const [a, w] of pool) {
    pick -= w
    if (pick <= 0) {
      chosen = a
      break
    }
  }
  brain.fired.clear()
  brain.caught.clear()
  brain.t = 0
  if (chosen === 'slam') {
    const at = slamPoint(center, target.position)
    brain.act = armFor(center, brain.yaw, at) === 'l' ? 'slam_l' : 'slam_r'
    brain.pts = [at]
  } else if (chosen === 'slam_lr') {
    // The first fist falls on the target, the second on whoever else is furthest from the first crater.
    const at = slamPoint(center, target.position)
    let second = at
    let bestD = -1
    for (const f of alive) {
      const p = slamPoint(center, f.position)
      const d = flat(p, at)
      if (d > bestD) {
        bestD = d
        second = p
      }
    }
    brain.act = 'slam_lr'
    brain.pts = [at, second]
  } else if (chosen === 'sweep') {
    // Sweep from the side most heroes stand on toward the other.
    let left = 0
    for (const f of alive) if (bearing(f.position) > 0) left++
    brain.act = left >= alive.length / 2 ? 'sweep_l' : 'sweep_r'
    brain.sweepPrev = sweepAngle(brain.act, 0)
    brain.pts = []
  } else if (chosen === 'stomp') {
    brain.act = 'stomp'
    brain.ringPrev = 0
    brain.pts = []
  } else if (chosen === 'fissure') {
    // The ground splits under up to three heroes (the nearest first), a step ahead of where they stand.
    const spots = alive.slice().sort((a, b) => flat(a.position, center) - flat(b.position, center)).slice(0, 3)
    brain.act = 'fissure'
    brain.pts = spots.map((f) => v3(f.position.x, 0, f.position.z))
    if (!brain.pts.length) brain.pts = [slamPoint(center, target.position)]
  } else {
    // Rocks on everyone beyond the fists' reach, up to six.
    const far = alive.filter((f) => flat(f.position, center) > 7).slice(0, 6)
    brain.act = 'debris'
    brain.pts = (far.length ? far : alive.slice(0, 6)).map((f) => v3(f.position.x, 0, f.position.z))
  }
  brain.lastAct = brain.act
}

function sweepAngle(act: Act, t: number): number {
  const s = act === 'sweep_l' ? 1 : -1
  const spec = ACTS.sweep_l
  const t0 = spec.windup
  const t1 = spec.windup + spec.swing
  return curve(t, [[0, s * 55], [t0, s * 118], [t1, -s * 105], [spec.duration, s * 45]])
}

/** A blow on a hero: dodges pass clean, a raised shield takes the worst off it. */
function hitHero(f: NetFighter, damage: number, stagger: number, from: { x: number; z: number }) {
  const yaw = Math.atan2(f.position.x - from.x, f.position.z - from.z)
  const dodged = f.invulnerable
  const dealt = f.blocking && !dodged ? Math.round(damage * 0.4) : damage
  strikeHero(f.address, dealt, stagger, yaw, { dodged })
  brain.aggro.set(f.address, (brain.aggro.get(f.address) ?? 0) + 4)
}

function once(mark: number, t0: number, t1: number, fn: () => void) {
  if (t0 < mark && t1 >= mark && !brain.fired.has(mark)) {
    brain.fired.add(mark)
    fn()
  }
}

function resolveAct(t0: number, t1: number, alive: NetFighter[]) {
  const act = brain.act
  if (!act) return
  switch (act) {
    case 'slam_l':
    case 'slam_r':
    case 'slam_lr': {
      const spec = ACTS[act]
      spec.impact.forEach((mark, i) => once(mark, t0, t1, () => {
        const at = brain.pts[i] ?? brain.pts[0]
        for (const f of alive) if (flat(f.position, at) < SLAM_RADIUS) hitHero(f, DAMAGE.slam, 1.1, at)
      }))
      break
    }
    case 'sweep_l':
    case 'sweep_r': {
      const spec = ACTS[act]
      if (t1 < spec.windup || t0 > spec.windup + spec.swing) break
      const a0 = sweepAngle(act, Math.max(t0, spec.windup))
      const a1 = sweepAngle(act, Math.min(t1, spec.windup + spec.swing))
      const lo = Math.min(a0, a1) - 4
      const hi = Math.max(a0, a1) + 4
      for (const f of alive) {
        if (brain.caught.has(f.address)) continue
        const r = flat(f.position, center)
        if (r < SWEEP_INNER || r > SWEEP_OUTER) continue
        const b = bearing(f.position)
        if (b < lo || b > hi) continue
        brain.caught.add(f.address)
        // Thrown along the arm's travel.
        const tangentFrom = { x: center.x, z: center.z }
        hitHero(f, DAMAGE.sweep, 1.3, tangentFrom)
      }
      break
    }
    case 'stomp': {
      const spec = ACTS.stomp
      if (t1 < spec.impact) break
      const r1 = Math.min(spec.ringMax, (t1 - spec.impact) * spec.ringSpeed)
      const r0 = brain.ringPrev
      brain.ringPrev = r1
      for (const f of alive) {
        if (brain.caught.has(f.address)) continue
        const d = flat(f.position, center)
        if (d <= r0 - STOMP_BAND || d > r1 + STOMP_BAND) continue
        if (d < 1.5) continue
        brain.caught.add(f.address)
        // Jumped over it: the ring passes under.
        if (f.position.y > 0.6) continue
        hitHero(f, DAMAGE.stomp, 0.9, center)
      }
      break
    }
    case 'fissure': {
      const spec = ACTS.fissure
      once(spec.impact, t0, t1, () => {
        for (const p of brain.pts) {
          for (const f of alive) if (flat(f.position, p) < FISSURE_RADIUS) hitHero(f, DAMAGE.fissure, 1.0, p)
          brain.fires.push({ x: p.x, z: p.z, left: spec.burn, tick: 0.6 })
        }
        // The fists themselves crater the floor beside the feet.
        const solved = solvePose(poseFor({ center, yaw: brain.yaw, state: 'fighting', act, t: spec.impact, pts: brain.pts, stateT: brain.stateT }))
        for (const hand of [solved.handL, solved.handR]) {
          for (const f of alive) if (flat(f.position, hand) < 3.4) hitHero(f, DAMAGE.fissure, 1.0, hand)
        }
      })
      break
    }
    case 'debris': {
      const spec = ACTS.debris
      once(spec.impact, t0, t1, () => {
        for (const p of brain.pts) {
          for (const f of alive) if (flat(f.position, p) < DEBRIS_RADIUS) hitHero(f, DAMAGE.debris, 1.2, p)
        }
      })
      break
    }
    case 'roar': {
      once(0.9, t0, t1, () => {
        for (const f of alive) if (flat(f.position, center) < 7.5) hitHero(f, 0, 0.7, center)
      })
      break
    }
  }
}

// --- being hit ------------------------------------------------------------------------------

/** Where each hittable part is right now, from the same pose the clients draw. */
function partHulls(): Record<string, { x: number; y: number; z: number; radius: number; height: number; open: boolean }> {
  const s = solvePose(poseFor({ center, yaw: brain.yaw, state: brain.state, act: brain.act, t: brain.t, pts: brain.pts, stateT: brain.stateT }))
  const hands = handsDown()
  const staggered = brain.state === 'stagger'
  return {
    leg_l: { x: s.footL.x, y: 0, z: s.footL.z, radius: 1.7, height: 6.5, open: true },
    leg_r: { x: s.footR.x, y: 0, z: s.footR.z, radius: 1.7, height: 6.5, open: true },
    hand_l: { x: s.handL.x, y: 0, z: s.handL.z, radius: 2.2, height: 2.6, open: hands.l || staggered },
    hand_r: { x: s.handR.x, y: 0, z: s.handR.z, radius: 2.2, height: 2.6, open: hands.r || staggered },
    head: { x: s.head.x, y: s.head.y - 1.5, z: s.head.z, radius: 1.8, height: 3.2, open: true }
  }
}

/** Which fists rest on the floor: the sword's chance. */
function handsDown(): { l: boolean; r: boolean } {
  const act = brain.act
  if (brain.state === 'stagger') return { l: true, r: true }
  if (act === 'slam_l' || act === 'slam_r' || act === 'slam_lr') {
    const spec = ACTS[act]
    const downFor = (i: number) => {
      const mark = spec.impact[Math.min(i, spec.impact.length - 1)]
      return brain.t >= mark && brain.t <= mark + spec.hold
    }
    if (act === 'slam_lr') return { l: downFor(0), r: downFor(1) }
    return { l: act === 'slam_l' && downFor(0), r: act === 'slam_r' && downFor(0) }
  }
  if (act === 'fissure') {
    const spec = ACTS.fissure
    const down = brain.t >= spec.impact && brain.t <= spec.impact + 0.9
    return { l: down, r: down }
  }
  return { l: false, r: false }
}

function onHit(id: string, part: string, motion: string, finisher: boolean) {
  if (!cb || (brain.state !== 'fighting' && brain.state !== 'stagger')) return
  if (!cb.members().includes(id)) return
  const hull = partHulls()[part]
  if (!hull || !hull.open) return
  const attacker = allFighters().find((f) => f.address === id)
  if (!attacker || attacker.health <= 0) return
  const m = motion as WeaponMotion
  const cid = heroCharacters((owner) => owner === id)[0]
  const cls = heroClassOf(cid)
  const allowed = (cls.light as readonly string[]).includes(m) || cls.heavy === m || cls.pointBlank?.motion === m
  if (!allowed) return
  const ranged = isRangedAttack(m)
  // Reach to the hull's edge, with the same slack a dungeon hit gets for the lunge already played.
  const d = flat(attacker.position, hull) - hull.radius
  if (d > attackRange(m) + 1.5) return
  // A sword needs the part down at its height; a shot climbs.
  if (!ranged && hull.y > attacker.position.y + 1.6) return
  // The head is a shot's mark; a sword cannot reach it even when the stone kneels.
  if (part === 'head' && !ranged) return

  const weapon = weaponStats(heroWeapon(id))
  const hit = resolveCombatHit(m, false, finisher, weapon)
  const might = heroBonusesFor(id, cid ?? '').might
  let damage = Math.max(1, Math.round(hit.damage * might * (PART_MULT[part] ?? 1)))
  if (brain.state === 'stagger') damage = Math.round(damage * 1.5)
  brain.hp = Math.max(0, brain.hp - damage)
  brain.dealt.set(id, (brain.dealt.get(id) ?? 0) + damage)
  brain.aggro.set(id, (brain.aggro.get(id) ?? 0) + damage * 0.25)

  if (brain.state === 'fighting' && (part === 'hand_l' || part === 'hand_r' || part === 'head')) {
    brain.poise += damage * (isHeavyMotion(m) || finisher ? 1.4 : 1)
    if (brain.poise >= POISE_MAX && brain.hp > 0) {
      brain.poise = 0
      setState('stagger')
      announce('stagger', 'The Colossus reels! Its fists are down: strike!')
    }
  }

  if (brain.hp <= 0) {
    fall()
    return
  }
  const phase = phaseFor(brain.hp)
  if (phase > brain.phase) {
    brain.phase = phase
    brain.poise = 0
    setState('fighting')
    brain.act = 'roar'
    brain.t = 0
    announce('phase', phase === 2 ? 'The chains snap. It fights with both fists.' : 'The Pit itself burns. Finish it!', phase)
  }
}

function fall() {
  if (!cb) return
  setState('dying')
  brain.fires = []
  announce('fall', 'THE CHAINED COLOSSUS IS BROKEN')
  console.log('[Colossus] falls')
  let total = 0
  for (const v of brain.dealt.values()) total += v
  const members = cb.members()
  const cids = heroCharacters((owner) => members.includes(owner))
  const pool = weaponPoolFor(cids)
  for (const id of members) {
    const share = total > 0 ? (brain.dealt.get(id) ?? 0) / total : 1 / Math.max(1, members.length)
    const xp = Math.round(XP_KILL * (0.5 + 0.5 * Math.max(XP_PARTICIPATION_MIN, Math.min(1, share * members.length))))
    cb.awardXp(id, xp)
    const mine = heroCharacters((owner) => owner === id)
    const item = rollRaidDrop(mine.length ? weaponPoolFor(mine) : pool)
    const f = allFighters().find((x) => x.address === id)
    const at = f ? f.position : { x: center.x, z: center.z + 6 }
    sendNet('loot', { party: RAID_PARTY, x: at.x, z: at.z, coin: 60, heart: 1, item, boss: true }, { to: [id] })
    // And a piece of the class's raid set: the armour only the Pit gives up.
    const armor = mine.length ? rollArmorDrop('boss', 'raid', mine) : ''
    if (armor) sendNet('loot', { party: RAID_PARTY, x: at.x + 0.6, z: at.z - 0.6, coin: 0, heart: 0, item: armor, boss: true }, { to: [id] })
    announce('kill', item ? 'The Colossus yields a Legendary.' : 'The Colossus is broken.', xp, [id])
  }
  cb.saveXp()
  for (const id of members) if (heroDownFor(id) !== undefined) reviveHero(id, true)
}

// --- downed heroes -----------------------------------------------------------------------------

function tendDowned(dt: number, fighters: NetFighter[]) {
  const members = cb?.members() ?? []
  const down: string[] = []
  for (const id of members) {
    if (heroDownFor(id) === undefined) {
      brain.revive.delete(id)
      continue
    }
    down.push(id)
    const me = fighters.find((f) => f.address === id)
    let helped = false
    if (me) {
      for (const f of fighters) {
        if (f.address === id || f.health <= 0) continue
        if (flat(f.position, me.position) < REVIVE_RADIUS) {
          helped = true
          break
        }
      }
    }
    const k = brain.revive.get(id) ?? 0
    const next = helped ? k + dt / REVIVE_SECONDS : Math.max(0, k - dt / 1.5)
    if (next >= 1) {
      brain.revive.delete(id)
      reviveHero(id, true)
      announce('revive', 'raised', 0, [id])
    } else brain.revive.set(id, next)
  }
  for (const id of [...brain.revive.keys()]) if (!down.includes(id)) brain.revive.delete(id)
}

// --- snapshot ------------------------------------------------------------------------------------

function broadcast(fighters: NetFighter[]) {
  const hands = handsDown()
  let hl = { x: 0, z: 0 }
  let hr = { x: 0, z: 0 }
  if (hands.l || hands.r) {
    const s = solvePose(poseFor({ center, yaw: brain.yaw, state: brain.state, act: brain.act, t: brain.t, pts: brain.pts, stateT: brain.stateT }))
    hl = s.handL
    hr = s.handR
  }
  const pts: number[] = []
  for (const p of brain.pts) pts.push(p.x, p.z)
  const fires: number[] = []
  for (const f of brain.fires) fires.push(f.x, f.z, f.left)
  const down: string[] = []
  const downT: number[] = []
  for (const id of cb?.members() ?? []) {
    if (heroDownFor(id) !== undefined) {
      down.push(id)
      downT.push(brain.revive.get(id) ?? 0)
    }
  }
  sendNet('raid', {
    state: brain.state, hp: brain.hp, max: COLOSSUS_MAX_HP, phase: brain.phase, yaw: brain.yaw, act: brain.act, t: brain.t, pts,
    hands: [hands.l ? 1 : 0, hl.x, hl.z, hands.r ? 1 : 0, hr.x, hr.z], fires, wait: brain.state === 'dead' ? brain.wait : 0,
    down, downT, n: fighters.length
  })
}

/** For the party server's logs and the dev panel. */
export function colossusStatus(): string {
  return `${brain.state} hp ${brain.hp}/${COLOSSUS_MAX_HP} p${brain.phase} act ${brain.act || '-'} ${brain.t.toFixed(1)}s`
}

