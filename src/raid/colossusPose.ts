// The Chained Colossus's skeleton and the poses it strikes, as pure maths.
// The server runs these to know where a hand comes down and where a leg
// stands; every client runs the same curves from the same (act, t) to place
// the ten stone segments, so the telegraph on the floor and the fist that
// lands on it always agree. No engine types here: the body is entities on
// the client only (colossusClient.ts) and nothing at all on the server.
//
// Frames: the root stands on the floor at the arena's centre facing `yaw`
// (+Z forward, x = sin yaw); the chest joint hangs `rootY` above it and every
// other joint is a fixed offset from its parent (colossusParts.json, from the
// pack's own split points). A segment's mesh hangs below its joint, so a
// joint's rotation swings the limb. Arms and legs are placed by two-bone IK
// toward targets, which is how a hand finds a point on the floor.

import parts from './colossusParts.json'

export type Vec3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }

export type PartName =
  'chest' | 'head' | 'arm_l_upper' | 'arm_l_lower' | 'arm_r_upper' | 'arm_r_lower' |
  'leg_l_upper' | 'leg_l_lower' | 'leg_r_upper' | 'leg_r_lower'

export const PART_NAMES: PartName[] = [
  'chest', 'head', 'arm_l_upper', 'arm_l_lower', 'arm_r_upper', 'arm_r_lower',
  'leg_l_upper', 'leg_l_lower', 'leg_r_upper', 'leg_r_lower'
]

type PartSpec = { src: string; parent: string | null; offset: number[]; min: number[]; max: number[]; tris: number }
const SPEC = parts.parts as Record<PartName, PartSpec>

export function partSrc(name: PartName): string {
  return SPEC[name].src
}

export function partSources(): string[] {
  return PART_NAMES.map((n) => SPEC[n].src)
}

// --- vectors and quaternions ---------------------------------------------------

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3): Vec3 => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const len = (a: Vec3): number => Math.sqrt(dot(a, a))
export const norm = (a: Vec3): Vec3 => {
  const l = len(a)
  return l > 1e-9 ? scale(a, 1 / l) : v3(0, 1, 0)
}
export const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => v3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)

export const QI: Quat = { x: 0, y: 0, z: 0, w: 1 }

export function qAxis(axis: Vec3, radians: number): Quat {
  const a = norm(axis)
  const s = Math.sin(radians / 2)
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(radians / 2) }
}

/** a then b: rotating by `a` in `b`'s frame, i.e. world = qMul(parent, local). */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  }
}

export const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })

export function qRot(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y
  const iy = q.w * v.y + q.z * v.x - q.x * v.z
  const iz = q.w * v.z + q.x * v.y - q.y * v.x
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z
  return v3(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  )
}

/** The shortest rotation taking unit `from` onto unit `to`. */
export function qFromTo(from: Vec3, to: Vec3): Quat {
  const f = norm(from)
  const t = norm(to)
  const d = dot(f, t)
  if (d > 0.99999) return QI
  if (d < -0.99999) {
    // Opposite: half a turn about any perpendicular axis.
    const axis = Math.abs(f.x) < 0.9 ? cross(f, v3(1, 0, 0)) : cross(f, v3(0, 1, 0))
    return qAxis(axis, Math.PI)
  }
  const axis = cross(f, t)
  const q = { x: axis.x, y: axis.y, z: axis.z, w: 1 + d }
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
}

export function qSlerp(a: Quat, b: Quat, k: number): Quat {
  let cosom = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  let bx = b.x, by = b.y, bz = b.z, bw = b.w
  if (cosom < 0) {
    cosom = -cosom
    bx = -bx; by = -by; bz = -bz; bw = -bw
  }
  let s0: number, s1: number
  if (1 - cosom > 1e-6) {
    const om = Math.acos(cosom)
    const so = Math.sin(om)
    s0 = Math.sin((1 - k) * om) / so
    s1 = Math.sin(k * om) / so
  } else {
    s0 = 1 - k
    s1 = k
  }
  return { x: s0 * a.x + s1 * bx, y: s0 * a.y + s1 * by, z: s0 * a.z + s1 * bz, w: s0 * a.w + s1 * bw }
}

const deg = (d: number) => (d * Math.PI) / 180
/** Pitch about X (positive nods forward), yaw about Y, roll about Z; applied yaw, then pitch, then roll. */
export function qEuler(pitch: number, yaw: number, roll: number): Quat {
  return qMul(qMul(qAxis(v3(0, 1, 0), deg(yaw)), qAxis(v3(1, 0, 0), deg(pitch))), qAxis(v3(0, 0, 1), deg(roll)))
}

// --- the skeleton ------------------------------------------------------------------

const off = (n: PartName): Vec3 => v3(SPEC[n].offset[0], SPEC[n].offset[1], SPEC[n].offset[2])

/** Chest joint height with the feet on the floor, from the export's rest pose. */
export const REST_ROOT_Y = 7.327
/** Standing height: head top over the floor at rest. */
export const STANDING_HEIGHT = REST_ROOT_Y + off('head').y + SPEC.head.max[1]

type Limb = {
  upper: PartName
  lower: PartName
  /** Bone axes in each segment's own frame (unit), and their lengths. */
  a1: Vec3; l1: number
  a2: Vec3; l2: number
  /** The end effector in the lower segment's frame. */
  tip: Vec3
}

function limb(upper: PartName, lower: PartName, tipX: number): Limb {
  const elbow = off(lower)
  const l1 = len(elbow)
  const tip = v3(tipX, SPEC[lower].min[1] + 0.35, 0)
  const l2 = len(tip)
  return { upper, lower, a1: norm(elbow), l1, a2: norm(tip), l2, tip }
}

export const ARM_L = limb('arm_l_upper', 'arm_l_lower', 0.15)
export const ARM_R = limb('arm_r_upper', 'arm_r_lower', -0.25)
export const LEG_L = limb('leg_l_upper', 'leg_l_lower', 0.76)
export const LEG_R = limb('leg_r_upper', 'leg_r_lower', -0.6)

/** Where the soles stand in the root's frame at rest: the legs are solved to hold these. */
export const REST_FEET: { l: Vec3; r: Vec3 } = (() => {
  const foot = (leg: Limb) => {
    const hip = add(v3(0, REST_ROOT_Y, 0), off(leg.upper))
    const knee = add(hip, off(leg.lower))
    const tip = add(knee, leg.tip)
    return v3(tip.x, 0, tip.z)
  }
  return { l: foot(LEG_L), r: foot(LEG_R) }
})()

// --- poses -----------------------------------------------------------------------------

/** A limb's goal: a world-space point for the tip, with a hint for which way the joint bends. */
export type LimbGoal = { target: Vec3; bend: Vec3 }

export type Pose = {
  root: Vec3
  yaw: number
  rootY: number
  chest: Quat
  head: Quat
  armL: LimbGoal
  armR: LimbGoal
  /** Feet targets in world space (planted unless a foot is lifting). */
  footL: Vec3
  footR: Vec3
}

export type Joint = { pos: Vec3; rot: Quat }
export type Solved = {
  joints: Record<PartName, Joint>
  handL: Vec3
  handR: Vec3
  footL: Vec3
  footR: Vec3
  /** The head's centre and the top of the skull. */
  head: Vec3
  headTop: Vec3
  shoulderL: Vec3
  shoulderR: Vec3
}

/** Two-bone IK: joint rotations (in the parent's frame) for `limb` hanging from world `root`/`rootRot` to reach `goal`. */
function solveLimb(limb: Limb, rootPos: Vec3, rootRot: Quat, goal: LimbGoal): { upper: Quat; lower: Quat; mid: Vec3; tip: Vec3 } {
  const toTarget = sub(goal.target, rootPos)
  let d = len(toTarget)
  const maxReach = limb.l1 + limb.l2 - 0.02
  const minReach = Math.abs(limb.l1 - limb.l2) + 0.02
  d = Math.max(minReach, Math.min(maxReach, d))
  const dir = norm(toTarget)
  // Angle between the upper bone and the line to the target (law of cosines).
  const cosA = (limb.l1 * limb.l1 + d * d - limb.l2 * limb.l2) / (2 * limb.l1 * d)
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)))
  // Bend away from the line toward the hint.
  let side = sub(goal.bend, scale(dir, dot(goal.bend, dir)))
  if (len(side) < 1e-4) side = Math.abs(dir.y) < 0.9 ? cross(dir, v3(0, 1, 0)) : cross(dir, v3(1, 0, 0))
  side = norm(side)
  const axis = cross(dir, side)
  const upperDir = qRot(qAxis(axis, -alpha), dir)
  const mid = add(rootPos, scale(upperDir, limb.l1))
  const lowerDir = norm(sub(add(rootPos, scale(dir, d)), mid))
  // Local rotations: parent^-1 * (world direction of the bone), against the bone's rest axis.
  const upperLocal = qFromTo(limb.a1, qRot(qConj(rootRot), upperDir))
  const upperWorld = qMul(rootRot, upperLocal)
  const lowerLocal = qFromTo(limb.a2, qRot(qConj(upperWorld), lowerDir))
  const lowerWorld = qMul(upperWorld, lowerLocal)
  const tip = add(mid, qRot(lowerWorld, limb.tip))
  return { upper: upperLocal, lower: lowerLocal, mid, tip }
}

export function solvePose(p: Pose): Solved {
  const rootRot = qAxis(v3(0, 1, 0), p.yaw)
  const chestPos = add(p.root, v3(0, p.rootY, 0))
  const chestRot = qMul(rootRot, p.chest)
  const joints = {} as Record<PartName, Joint>
  joints.chest = { pos: chestPos, rot: chestRot }
  const headPos = add(chestPos, qRot(chestRot, off('head')))
  const headRot = qMul(chestRot, p.head)
  joints.head = { pos: headPos, rot: headRot }

  const arm = (limb: Limb, goal: LimbGoal) => {
    const shoulder = add(chestPos, qRot(chestRot, off(limb.upper)))
    const s = solveLimb(limb, shoulder, chestRot, goal)
    joints[limb.upper] = { pos: shoulder, rot: qMul(chestRot, s.upper) }
    joints[limb.lower] = { pos: s.mid, rot: qMul(joints[limb.upper].rot, s.lower) }
    return { shoulder, tip: s.tip }
  }
  const al = arm(ARM_L, p.armL)
  const ar = arm(ARM_R, p.armR)
  // Knees bend forward (+Z of the root), a touch outward.
  const kneeHint = (side: number) => qRot(rootRot, v3(side * 0.25, -0.15, 1))
  const ll = arm(LEG_L, { target: p.footL, bend: kneeHint(1) })
  const lr = arm(LEG_R, { target: p.footR, bend: kneeHint(-1) })

  return {
    joints,
    handL: al.tip, handR: ar.tip,
    footL: ll.tip, footR: lr.tip,
    head: add(headPos, qRot(headRot, v3(0.1, 1.2, 0))),
    headTop: add(headPos, qRot(headRot, v3(0, SPEC.head.max[1], 0))),
    shoulderL: al.shoulder, shoulderR: ar.shoulder
  }
}

// --- the acts --------------------------------------------------------------------------

export type Act =
  '' | 'slam_l' | 'slam_r' | 'slam_lr' | 'sweep_l' | 'sweep_r' | 'stomp' | 'roar' | 'fissure' | 'debris'
export type BossState = 'dormant' | 'waking' | 'fighting' | 'stagger' | 'dying' | 'dead'

/** Timing of each act in seconds; the server lands its blows on these marks and the client draws to them. */
export const ACTS = {
  slam_l: { duration: 5.2, impact: [1.45], hold: 3.0, telegraph: 1.45, recover: 0.8 },
  slam_r: { duration: 5.2, impact: [1.45], hold: 3.0, telegraph: 1.45, recover: 0.8 },
  /** Left hand first, right hand a beat after; both stay down. */
  slam_lr: { duration: 6.4, impact: [1.3, 2.5], hold: 3.0, telegraph: 1.3, recover: 0.9 },
  sweep_l: { duration: 3.6, windup: 1.5, swing: 0.85, telegraph: 1.5 },
  sweep_r: { duration: 3.6, windup: 1.5, swing: 0.85, telegraph: 1.5 },
  stomp: { duration: 3.2, impact: 1.15, ringSpeed: 11, ringMax: 16, telegraph: 1.15 },
  roar: { duration: 2.6 },
  fissure: { duration: 3.0, impact: 1.5, telegraph: 1.5, burn: 8 },
  debris: { duration: 3.2, impact: 1.7, telegraph: 1.7 }
} as const

/** How far from its centre a slam can land, and how wide the fist's crater is. */
export const SLAM_REACH = 9.2
export const SLAM_RADIUS = 4.2
/** The sweep passes over this band of floor in front of the Colossus. */
export const SWEEP_INNER = 2.6
export const SWEEP_OUTER = 10.8
export const STOMP_BAND = 1.25
export const FISSURE_RADIUS = 3.2
export const DEBRIS_RADIUS = 2.6

/** Ease in and out between 0 and 1. */
export function smooth(k: number): number {
  const t = Math.max(0, Math.min(1, k))
  return t * t * (3 - 2 * t)
}

/** Piecewise curve: value at `t` across [time, value] keys with a smooth step between them. */
export function curve(t: number, keys: Array<[number, number]>): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      return v0 + (v1 - v0) * smooth((t - t0) / Math.max(1e-6, t1 - t0))
    }
  }
  return keys[keys.length - 1][1]
}

function curve3(t: number, keys: Array<[number, Vec3]>): Vec3 {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1]
      const [t1, v1] = keys[i]
      return lerp3(v0, v1, smooth((t - t0) / Math.max(1e-6, t1 - t0)))
    }
  }
  return keys[keys.length - 1][1]
}

export type PoseInput = {
  center: Vec3
  yaw: number
  state: BossState
  act: Act
  /** Seconds into the act, or into the state when no act is under way. */
  t: number
  /** The act's ground points (world): slam targets, the stomp foot, fissure/debris spots. */
  pts: Vec3[]
  /** Seconds since the state began, for breathing and for the wake and death curves. */
  stateT: number
}

/** A point in the root's frame (x right, y up, z forward) as a world point. */
export function bodyPoint(center: Vec3, yaw: number, x: number, y: number, z: number): Vec3 {
  return add(center, qRot(qAxis(v3(0, 1, 0), yaw), v3(x, y, z)))
}

/** The point on the floor a slam actually reaches for a target at `at`. */
export function slamPoint(center: Vec3, at: Vec3): Vec3 {
  const d = sub(v3(at.x, 0, at.z), v3(center.x, 0, center.z))
  const l = len(d)
  const r = Math.min(SLAM_REACH, Math.max(3.2, l))
  const dir = l > 0.01 ? scale(d, 1 / l) : v3(0, 0, 1)
  return add(v3(center.x, 0, center.z), scale(dir, r))
}

/** Which arm reaches a world point: the +X side of the body is the left arm's. */
export function armFor(center: Vec3, yaw: number, at: Vec3): 'l' | 'r' {
  const local = qRot(qConj(qAxis(v3(0, 1, 0), yaw)), sub(at, center))
  return local.x >= 0 ? 'l' : 'r'
}

/**
 * The pose for a moment of the fight. Everything is built on the fighting
 * stance: a hunched crouch with both fists hanging low, feet planted.
 */
export function poseFor(input: PoseInput): Pose {
  const { center, yaw, state, act, t, stateT } = input
  const bp = (x: number, y: number, z: number) => bodyPoint(center, yaw, x, y, z)
  const breathe = Math.sin(stateT * 1.1)
  // Stance.
  let rootY = REST_ROOT_Y - 0.5 + 0.1 * breathe
  let chestPitch = 16 + 2 * breathe
  let chestYaw = 0
  let chestRoll = 0
  let headPitch = -6
  let headYaw = 0
  let handL = bp(4.0, 3.4 + 0.15 * breathe, 2.2)
  let handR = bp(-4.0, 3.4 + 0.15 * breathe, 2.2)
  let bendL = bp(6, 5, -3)
  let bendR = bp(-6, 5, -3)
  let footL = bodyPoint(center, yaw, REST_FEET.l.x, 0, REST_FEET.l.z)
  let footR = bodyPoint(center, yaw, REST_FEET.r.x, 0, REST_FEET.r.z)

  const kneel = (k: number) => {
    // Sunk onto its haunches, fists on the floor before it, head hung.
    rootY = rootY + (3.9 - rootY) * k
    chestPitch = chestPitch + (34 - chestPitch) * k
    headPitch = headPitch + (28 - headPitch) * k
    handL = lerp3(handL, bp(3.6, 0.25, 4.6), k)
    handR = lerp3(handR, bp(-3.6, 0.25, 4.6), k)
  }

  switch (state) {
    case 'dormant':
      kneel(1)
      break
    case 'waking': {
      // Four seconds: the head comes up first, then the body, fists lifting off the floor last.
      const k = 1 - smooth(stateT / 4)
      kneel(k)
      headPitch += curve(stateT, [[0, 0], [1.2, -14], [2.4, 0]])
      break
    }
    case 'dying': {
      // Buckles: knees, then the torso pitches over its fists, the head drops.
      const k = smooth(stateT / 2.2)
      kneel(k)
      chestPitch += curve(stateT, [[0, 0], [1.4, 6], [3.2, 40]])
      headPitch += curve(stateT, [[0, 0], [1.6, 0], [3.4, 30]])
      rootY -= curve(stateT, [[0, 0], [2.6, 0], [4.2, 0.8]])
      break
    }
    case 'dead':
      kneel(1)
      chestPitch += 40
      headPitch += 30
      rootY -= 0.8
      break
    case 'stagger': {
      // Reels: torso thrown back and rolling, head lolling within a sword's reach.
      const k = smooth(Math.min(1, stateT / 0.5))
      const wobble = Math.sin(stateT * 2.6) * (1 - stateT / 5)
      rootY -= 1.9 * k
      chestPitch += (42 + 6 * wobble) * k
      chestRoll = 9 * wobble * k
      headPitch += 26 * k
      handL = lerp3(handL, bp(4.8, 0.3, 4.8), k)
      handR = lerp3(handR, bp(-4.8, 0.3, 4.8), k)
      break
    }
    case 'fighting':
      break
  }

  if (state === 'fighting' && act) {
    const p0 = input.pts[0] ?? bp(0, 0, 7)
    const p1 = input.pts[1] ?? p0
    switch (act) {
      case 'slam_l':
      case 'slam_r':
      case 'slam_lr': {
        const spec = ACTS[act]
        const two = act === 'slam_lr'
        const first = act === 'slam_r' ? 'r' : 'l'
        const slam = (side: 'l' | 'r', at: Vec3, start: number, impact: number) => {
          const s = side === 'l' ? 1 : -1
          const rest = side === 'l' ? handL : handR
          const raised = bp(s * 3.4, 10.5, -1.5)
          const down = v3(at.x, 0.35, at.z)
          const lift = impact + spec.hold
          const hand = curve3(t, [[start, rest], [impact - 0.25, raised], [impact, down], [lift, down], [lift + spec.recover, rest]])
          if (side === 'l') {
            handL = hand
            bendL = curve3(t, [[start, bendL], [impact - 0.25, bp(7, 12, -6)], [impact, bp(s * 5, 6, 2)]])
          } else {
            handR = hand
            bendR = curve3(t, [[start, bendR], [impact - 0.25, bp(-7, 12, -6)], [impact, bp(s * 5, 6, 2)]])
          }
        }
        slam(first, p0, 0, spec.impact[0])
        if (two) slam('r', p1, spec.impact[0] - 0.2, spec.impact[1] ?? spec.impact[0] + 1.2)
        const lastImpact = spec.impact[spec.impact.length - 1]
        const lift = lastImpact + spec.hold
        // The body rears back for the raise and folds forward into the blow, then stays down over the fist.
        chestPitch += curve(t, [[0, 0], [spec.impact[0] - 0.3, -14], [spec.impact[0], 46], [lift, 44], [lift + spec.recover, 0]])
        rootY += curve(t, [[0, 0], [spec.impact[0] - 0.3, 0.6], [spec.impact[0], -3.1], [lift, -3.0], [lift + spec.recover, 0]])
        headPitch += curve(t, [[0, 0], [spec.impact[0] - 0.3, -20], [spec.impact[0], 10], [lift, 10], [lift + spec.recover, 0]])
        break
      }
      case 'sweep_l':
      case 'sweep_r': {
        const spec = ACTS[act]
        const s = act === 'sweep_l' ? 1 : -1
        // The arm cocks out to its own side, then carves across the front to the far side at knee height.
        const t0 = spec.windup
        const t1 = spec.windup + spec.swing
        const radius = 7.8
        const angle = curve(t, [[0, s * 55], [t0, s * 118], [t1, -s * 105], [spec.duration, s * 45]])
        const height = curve(t, [[0, 3.2], [t0, 2.6], [t0 + 0.12, 0.8], [t1, 0.9], [spec.duration, 3.2]])
        const a = deg(angle)
        const hand = bp(Math.sin(a) * radius, height, Math.cos(a) * radius)
        const bend = bp(Math.sin(a) * 6, 8, Math.cos(a) * 6 - 4)
        if (s > 0) {
          handL = hand
          bendL = bend
        } else {
          handR = hand
          bendR = bend
        }
        chestYaw = curve(t, [[0, 0], [t0, s * 28], [t1, -s * 34], [spec.duration, 0]])
        chestPitch += curve(t, [[0, 0], [t0, 8], [t0 + 0.15, 30], [t1, 28], [spec.duration, 0]])
        rootY += curve(t, [[0, 0], [t0, 0.2], [t0 + 0.15, -1.6], [t1, -1.4], [spec.duration, 0]])
        break
      }
      case 'stomp': {
        const spec = ACTS.stomp
        // The right foot lifts high and comes down where it stood; the body leans onto the left.
        const up = curve(t, [[0, 0], [spec.impact - 0.3, 3.4], [spec.impact, 0]])
        footR = add(footR, v3(0, up, 0))
        chestRoll = curve(t, [[0, 0], [spec.impact - 0.3, 10], [spec.impact, -4], [spec.impact + 0.5, 0]])
        chestPitch += curve(t, [[0, 0], [spec.impact - 0.3, -6], [spec.impact, 22], [spec.impact + 0.6, 0]])
        rootY += curve(t, [[0, 0], [spec.impact - 0.3, 0.15], [spec.impact, -1.0], [spec.impact + 0.6, 0]])
        handL = curve3(t, [[0, handL], [spec.impact - 0.3, bp(4.6, 4.5, 0.5)], [spec.impact, bp(4.2, 1.0, 3.2)], [spec.impact + 0.6, handL]])
        handR = curve3(t, [[0, handR], [spec.impact - 0.3, bp(-4.6, 4.5, 0.5)], [spec.impact, bp(-4.2, 1.0, 3.2)], [spec.impact + 0.6, handR]])
        break
      }
      case 'roar':
      case 'debris': {
        const spec = ACTS[act]
        const peak = act === 'roar' ? 0.9 : ACTS.debris.impact - 0.2
        // Rears up to its full height, fists high, head thrown back.
        rootY += curve(t, [[0, 0], [peak, 1.1], [spec.duration, 0]])
        chestPitch += curve(t, [[0, 0], [peak, -26], [spec.duration, 0]])
        headPitch += curve(t, [[0, 0], [peak, -30], [spec.duration, 0]])
        handL = curve3(t, [[0, handL], [peak, bp(4.4, 12.6, 0.8)], [spec.duration, handL]])
        handR = curve3(t, [[0, handR], [peak, bp(-4.4, 12.6, 0.8)], [spec.duration, handR]])
        bendL = bp(8, 9, -4)
        bendR = bp(-8, 9, -4)
        break
      }
      case 'fissure': {
        const spec = ACTS.fissure
        // Both fists rise and hammer the floor either side of the feet; the ground splits where the heroes stand.
        const impact = spec.impact
        const downL = bp(3.8, 0.35, 3.4)
        const downR = bp(-3.8, 0.35, 3.4)
        handL = curve3(t, [[0, handL], [impact - 0.3, bp(3.6, 10.4, -1)], [impact, downL], [impact + 0.9, downL], [spec.duration, handL]])
        handR = curve3(t, [[0, handR], [impact - 0.3, bp(-3.6, 10.4, -1)], [impact, downR], [impact + 0.9, downR], [spec.duration, handR]])
        chestPitch += curve(t, [[0, 0], [impact - 0.3, -16], [impact, 40], [impact + 0.9, 38], [spec.duration, 0]])
        rootY += curve(t, [[0, 0], [impact - 0.3, 0.7], [impact, -2.6], [impact + 0.9, -2.5], [spec.duration, 0]])
        headPitch += curve(t, [[0, 0], [impact - 0.3, -22], [impact, 12], [spec.duration, 0]])
        bendL = bp(7, 12, -6)
        bendR = bp(-7, 12, -6)
        break
      }
    }
  }

  return {
    root: v3(center.x, 0, center.z),
    yaw,
    rootY,
    chest: qEuler(chestPitch, chestYaw, chestRoll),
    head: qEuler(headPitch, headYaw, 0),
    armL: { target: handL, bend: bendL },
    armR: { target: handR, bend: bendR },
    footL,
    footR
  }
}

/** Solve the moment in one call. */
export function solveFor(input: PoseInput): Solved {
  return solvePose(poseFor(input))
}
