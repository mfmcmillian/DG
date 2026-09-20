// The Chained Colossus as the player sees it. Ten stone segments posed every
// frame from the host's latest snapshot (act and seconds into it, the yaw,
// the ground points), run through the same curves the host used to place its
// blows; telegraph decals on the floor ahead of every strike; dust, sparks and
// a camera kick when a fist lands; and the parts a hero can hit, offered to
// the combat code as training-style targets whose blows go back to the host
// as `hitRaid`.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Color3, Vector3 } from '@dcl/sdk/math'
import { createDecal, Decal, fxImpact, fxMagicBurst, fxSlam, fxSound, updateDecal } from '../combatFx'
import { onDungeonLoaded } from '../dungeon'
import { kickCrawlerCamera } from '../dungeon/crawlerCamera'
import { PIT_CENTER } from '../dungeon/pit'
import { setTrainingTargets, TrainingTarget } from '../dungeonEnemies'
import { localAddress } from '../multiplayer'
import { onNet, sendNet } from '../net'
import {
  Act, ACTS, BossState, curve, DEBRIS_RADIUS, FISSURE_RADIUS, PART_NAMES, PartName, partSrc, poseFor, SLAM_RADIUS, solvePose,
  Solved, SWEEP_INNER, SWEEP_OUTER, v3, Vec3
} from './colossusPose'

export type RaidEvent = { kind: string; text: string; n: number; age: number }

export type RaidView = {
  /** The Pit is loaded around us. */
  active: boolean
  state: BossState
  hp: number
  max: number
  phase: number
  act: Act
  /** Heroes in the Pit. */
  n: number
  /** Dead: seconds until it stirs. */
  wait: number
  /** Downed heroes (addresses) and how far each has been raised, 0..1. */
  down: Array<{ id: string; k: number }>
  events: RaidEvent[]
}

type Snapshot = {
  state: BossState
  hp: number
  max: number
  phase: number
  yaw: number
  act: Act
  t: number
  pts: Vec3[]
  hands: { l: boolean; r: boolean }
  fires: Array<{ x: number; z: number; left: number }>
  wait: number
  down: Array<{ id: string; k: number }>
  n: number
  age: number
}

const center: Vec3 = v3(PIT_CENTER.x, 0, PIT_CENTER.z)
let active = false
let snap: Snapshot | undefined
let seen = false
/** The pose clock: follows the host's `t`, advancing between snapshots. */
let rT = 0
let rYaw = 0
let rState: BossState = 'dormant'
let rStateT = 0
let rAct: Act = ''
let fired = new Set<number>()
let lastSolved: Solved | undefined
let embersAge = 0
const events: RaidEvent[] = []

let bodies: Partial<Record<PartName, Entity>> = {}
const discs: Decal[] = []
const cracks: Decal[] = []
let ring: Decal | undefined
let handDisc: Decal | undefined

const RED = Color3.create(1, 0.14, 0.08)
const ORANGE = Color3.create(1, 0.42, 0.1)
const EMBER = Color3.create(1, 0.3, 0.05)
const PALE = Color3.create(1, 0.85, 0.5)
const ASH = Color3.create(0.75, 0.55, 0.9)

export function raidView(): RaidView {
  return {
    active,
    state: snap?.state ?? 'dormant',
    hp: snap?.hp ?? 0,
    max: snap?.max ?? 1,
    phase: snap?.phase ?? 1,
    act: rAct,
    n: snap?.n ?? 0,
    wait: snap?.wait ?? 0,
    down: snap?.down ?? [],
    events
  }
}

/** Where the Colossus's head is, for a HUD marker or a camera. */
export function colossusHead(): Vector3 | undefined {
  return lastSolved ? Vector3.create(lastSolved.head.x, lastSolved.head.y, lastSolved.head.z) : undefined
}

export function initializeColossusClient() {
  onNet('raid', (msg) => {
    const pts: Vec3[] = []
    for (let i = 0; i + 1 < msg.pts.length; i += 2) pts.push(v3(msg.pts[i], 0, msg.pts[i + 1]))
    const fires: Snapshot['fires'] = []
    for (let i = 0; i + 2 < msg.fires.length; i += 3) fires.push({ x: msg.fires[i], z: msg.fires[i + 1], left: msg.fires[i + 2] })
    const down: Snapshot['down'] = msg.down.map((id, i) => ({ id, k: msg.downT[i] ?? 0 }))
    snap = {
      state: msg.state as BossState, hp: msg.hp, max: msg.max, phase: msg.phase, yaw: msg.yaw, act: msg.act as Act, t: msg.t, pts,
      hands: { l: msg.hands[0] > 0.5, r: msg.hands[3] > 0.5 }, fires, wait: msg.wait, down, n: msg.n, age: 0
    }
    if (!seen) {
      seen = true
      rYaw = msg.yaw
      rT = msg.t
      rAct = snap.act
      rState = snap.state
    }
  })
  onNet('raidEvent', (msg) => {
    if (!active) return
    events.push({ kind: msg.kind, text: msg.text, n: msg.n, age: 0 })
    if (events.length > 4) events.shift()
    if (msg.kind === 'wake' || msg.kind === 'phase') fxSound('roar', 1)
    if (msg.kind === 'fall') fxSound('slam', 1)
  })
  onDungeonLoaded((state) => {
    const pit = state.style.id === 'pit'
    if (pit && !active) build()
    if (!pit && active) teardown()
    active = pit
    events.length = 0
  })
  setTrainingTargets(targets)
  engine.addSystem(update)
}

// --- the body ------------------------------------------------------------------------

function build() {
  for (const name of PART_NAMES) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(center.x, -30, center.z) })
    GltfContainer.create(e, { src: partSrc(name) })
    bodies[name] = e
  }
  for (let i = 0; i < 12; i++) discs.push(createDecal('disc'))
  for (let i = 0; i < 8; i++) cracks.push(createDecal('crack'))
  ring = createDecal('ring')
  handDisc = createDecal('disc')
  fired = new Set()
  lastSolved = undefined
}

function teardown() {
  for (const e of Object.values(bodies)) if (e !== undefined) engine.removeEntity(e)
  bodies = {}
  for (const d of [...discs, ...cracks]) engine.removeEntity(d.entity)
  discs.length = 0
  cracks.length = 0
  if (ring) engine.removeEntity(ring.entity)
  if (handDisc) engine.removeEntity(handDisc.entity)
  ring = undefined
  handDisc = undefined
  lastSolved = undefined
}

function update(dt: number) {
  for (const ev of events) ev.age += dt
  while (events.length && events[0].age > 7) events.shift()
  if (!active || !snap) return
  snap.age += dt

  // The state and act clocks follow the host; between snapshots they run on their own.
  if (snap.state !== rState) {
    rState = snap.state
    rStateT = 0
    fired.clear()
  }
  rStateT += dt
  if (snap.act !== rAct) {
    rAct = snap.act
    rT = snap.t + snap.age
    fired.clear()
  } else {
    const prev = rT
    rT += dt
    const aim = snap.t + snap.age
    rT += (aim - rT) * Math.min(1, dt * 6)
    if (rT < prev) rT = prev
  }
  let dy = snap.yaw - rYaw
  while (dy > Math.PI) dy -= Math.PI * 2
  while (dy < -Math.PI) dy += Math.PI * 2
  rYaw += dy * Math.min(1, dt * 5)

  const solved = solvePose(poseFor({ center, yaw: rYaw, state: rState, act: rAct, t: rT, pts: snap.pts, stateT: rStateT }))
  lastSolved = solved
  for (const name of PART_NAMES) {
    const e = bodies[name]
    if (e === undefined) continue
    const j = solved.joints[name]
    const t = Transform.getMutable(e)
    t.position = Vector3.create(j.pos.x, j.pos.y, j.pos.z)
    t.rotation = { x: j.rot.x, y: j.rot.y, z: j.rot.z, w: j.rot.w }
  }

  strikes(solved)
  telegraphs(solved, dt)
}

// --- impacts -------------------------------------------------------------------------

function once(mark: number, fn: () => void) {
  if (rT >= mark && !fired.has(mark)) {
    fired.add(mark)
    fn()
  }
}

function toV(p: { x: number; y?: number; z: number }, y = 0): Vector3 {
  return Vector3.create(p.x, p.y ?? y, p.z)
}

function kick(strength: number) {
  const a = Math.random() * Math.PI * 2
  kickCrawlerCamera(Vector3.create(Math.sin(a) * strength, -strength * 0.6, Math.cos(a) * strength))
}

function strikes(solved: Solved) {
  if (rState !== 'fighting') {
    if (rState === 'dying') once(2.2, () => {
      fxSlam(toV(solved.handL), 3)
      fxSlam(toV(solved.handR), 3)
      fxSound('slam', 1)
      kick(0.5)
    })
    if (rState === 'stagger') once(0.45, () => {
      fxSlam(toV(solved.handL), 2.5)
      fxSlam(toV(solved.handR), 2.5)
      fxSound('slam', 0.8)
      kick(0.35)
    })
    return
  }
  const act = rAct
  if (!act) return
  switch (act) {
    case 'slam_l':
    case 'slam_r':
    case 'slam_lr': {
      const spec = ACTS[act]
      spec.impact.forEach((mark, i) => once(mark, () => {
        const p = snap?.pts[i] ?? snap?.pts[0]
        if (p) fxSlam(toV(p), SLAM_RADIUS)
        fxSound('slam', 1)
        kick(0.55)
      }))
      break
    }
    case 'sweep_l':
    case 'sweep_r': {
      const spec = ACTS[act]
      once(spec.windup, () => fxSound('swing_heavy', 1))
      once(spec.windup + spec.swing * 0.5, () => kick(0.25))
      break
    }
    case 'stomp': {
      const spec = ACTS.stomp
      once(spec.impact, () => {
        fxSlam(toV(solved.footR), 3.5)
        fxSound('slam', 1)
        kick(0.6)
      })
      break
    }
    case 'fissure': {
      const spec = ACTS.fissure
      once(spec.impact, () => {
        fxSlam(toV(solved.handL), 3.2)
        fxSlam(toV(solved.handR), 3.2)
        for (const p of snap?.pts ?? []) fxMagicBurst(toV(p, 0.3), { r: 1, g: 0.45, b: 0.1, a: 1 }, FISSURE_RADIUS)
        fxSound('slam', 1)
        kick(0.6)
      })
      break
    }
    case 'debris': {
      const spec = ACTS.debris
      once(spec.impact - 0.2, () => fxSound('swing_heavy', 0.8))
      once(spec.impact, () => {
        for (const p of snap?.pts ?? []) {
          fxSlam(toV(p), DEBRIS_RADIUS)
          fxImpact(toV(p, 0.6), true, false)
        }
        fxSound('slam', 0.9)
        kick(0.4)
      })
      break
    }
    case 'roar':
      once(0.4, () => {
        fxSound('roar', 1)
        kick(0.3)
      })
      break
  }
}

// --- telegraphs -----------------------------------------------------------------------

function telegraphs(solved: Solved, dt: number) {
  let used = 0
  const disc = (p: { x: number; z: number }, radius: number, progress: number, color: Color3) => {
    if (used >= discs.length) return
    updateDecal(discs[used++], true, Vector3.create(p.x, 0, p.z), radius, progress, color)
  }
  let ringOn = false
  let handOn = false
  const act = rAct
  if (rState === 'fighting' && act) {
    switch (act) {
      case 'slam_l':
      case 'slam_r':
      case 'slam_lr': {
        const spec = ACTS[act]
        spec.impact.forEach((mark, i) => {
          const p = snap?.pts[i] ?? snap?.pts[0]
          if (!p) return
          const start = i === 0 ? 0 : spec.impact[0] - 0.2
          if (rT < mark) disc(p, SLAM_RADIUS, (rT - start) / (mark - start), RED)
          else if (rT < mark + 0.35) disc(p, SLAM_RADIUS, 1, PALE)
        })
        break
      }
      case 'sweep_l':
      case 'sweep_r': {
        const spec = ACTS[act]
        const s = act === 'sweep_l' ? 1 : -1
        const t0 = spec.windup
        const t1 = spec.windup + spec.swing
        const from = s * 118
        const to = -s * 105
        const mid = (SWEEP_INNER + SWEEP_OUTER) / 2
        const now = curve(rT, [[0, s * 55], [t0, from], [t1, to], [spec.duration, s * 45]])
        if (rT < t1) {
          for (let i = 0; i < 7; i++) {
            const a = from + ((to - from) * i) / 6
            // Ahead of the fist only: the floor already swept goes dark.
            if (rT >= t0 && (s > 0 ? a > now : a < now)) continue
            const r = ((a + rYaw * (180 / Math.PI)) * Math.PI) / 180
            disc({ x: center.x + Math.sin(r) * mid, z: center.z + Math.cos(r) * mid }, 4.2, rT < t0 ? rT / t0 : 1, rT < t0 ? ORANGE : PALE)
          }
        }
        if (rT >= t0 && rT < t1) {
          handOn = true
          const h = act === 'sweep_l' ? solved.handL : solved.handR
          if (handDisc) updateDecal(handDisc, true, Vector3.create(h.x, 0, h.z), 2.6, 1, PALE)
        }
        break
      }
      case 'stomp': {
        const spec = ACTS.stomp
        ringOn = true
        if (rT < spec.impact) {
          if (ring) updateDecal(ring, true, toV(center), 3 + (spec.ringMax - 3) * (rT / spec.impact), rT / spec.impact, ORANGE)
        } else {
          const r = Math.min(spec.ringMax, (rT - spec.impact) * spec.ringSpeed)
          if (r >= spec.ringMax) ringOn = false
          else if (ring) updateDecal(ring, true, toV(center), r, 1, PALE)
        }
        break
      }
      case 'fissure': {
        const spec = ACTS.fissure
        if (rT < spec.impact) for (const p of snap?.pts ?? []) disc(p, FISSURE_RADIUS, rT / spec.impact, EMBER)
        break
      }
      case 'debris': {
        const spec = ACTS.debris
        if (rT < spec.impact) for (const p of snap?.pts ?? []) disc(p, DEBRIS_RADIUS, rT / spec.impact, ASH)
        else if (rT < spec.impact + 0.3) for (const p of snap?.pts ?? []) disc(p, DEBRIS_RADIUS, 1, PALE)
        break
      }
    }
  }
  for (let i = used; i < discs.length; i++) if (discs[i].visible) updateDecal(discs[i], false)
  if (ring && !ringOn && ring.visible) updateDecal(ring, false)
  if (handDisc && !handOn && handDisc.visible) updateDecal(handDisc, false)

  // Burning ground from the fissures: a cracked glow and embers now and again.
  const fires = snap?.fires ?? []
  embersAge += dt
  const ember = embersAge > 0.55
  if (ember) embersAge = 0
  for (let i = 0; i < cracks.length; i++) {
    const f = fires[i]
    if (!f) {
      if (cracks[i].visible) updateDecal(cracks[i], false)
      continue
    }
    const left = Math.max(0, f.left - snap!.age)
    updateDecal(cracks[i], left > 0, Vector3.create(f.x, 0, f.z), FISSURE_RADIUS, 1, EMBER)
    if (ember && left > 0) fxMagicBurst(Vector3.create(f.x + (Math.random() - 0.5) * 2, 0.2, f.z + (Math.random() - 0.5) * 2), { r: 1, g: 0.4, b: 0.08, a: 1 }, 0.6)
  }
}

// --- being hit ------------------------------------------------------------------------

function report(part: string, motion: string, finisher: boolean) {
  sendNet('hitRaid', { id: localAddress(), part, motion, finisher })
}

/** The parts a hero can hit right now: the legs always, a grounded fist, the head for a shot. */
function targets(): TrainingTarget[] {
  if (!active || !snap || !lastSolved) return []
  if (snap.state !== 'fighting' && snap.state !== 'stagger') return []
  const s = lastSolved
  const staggered = snap.state === 'stagger'
  const bonus = staggered ? 1.5 : 1
  const out: TrainingTarget[] = []
  const leg = (part: string, foot: Vec3) => out.push({
    position: Vector3.create(foot.x, 0, foot.z), scale: 3.5, material: 'stone', radius: 1.7, height: 6.5, damageScale: bonus,
    onHit: (_d, _a, motion, _heavy, finisher) => report(part, motion, finisher)
  })
  leg('leg_l', s.footL)
  leg('leg_r', s.footR)
  const hand = (part: string, h: Vec3, down: boolean) => {
    if (!down && !staggered) return
    out.push({
      position: Vector3.create(h.x, 0, h.z), scale: 1.4, material: 'stone', radius: 2.2, height: 2.6, damageScale: 1.6 * bonus,
      onHit: (_d, _a, motion, _heavy, finisher) => report(part, motion, finisher)
    })
  }
  hand('hand_l', s.handL, snap.hands.l)
  hand('hand_r', s.handR, snap.hands.r)
  out.push({
    position: Vector3.create(s.head.x, s.head.y - 1.5, s.head.z), scale: 1.7, material: 'stone', radius: 1.8, height: 3.2, rangedOnly: true,
    damageScale: 2.2 * bonus,
    onHit: (_d, _a, motion, _heavy, finisher) => report('head', motion, finisher)
  })
  return out
}
