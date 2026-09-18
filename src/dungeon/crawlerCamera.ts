// Diablo-style camera for the open style: high, pitched down, fixed heading.
// It looks over the walls, so nothing can ever get between it and the player
// and the Explorer's de-occluder never has to pull in.
//
// Two implementations share this file:
//
// 'rigid' (default) — the camera is locked to the avatar *by the renderer*.
//   The rig is a child of the player entity, so the renderer carries it with
//   the avatar every frame; a Billboard facing a distant fixed target cancels
//   the avatar's yaw so the heading stays put; the camera sits on a child of
//   that rig at the fixed offset. No scene code runs between the avatar and
//   the camera, so there is nothing left to lag or jitter — this is exactly
//   how Diablo-style games place their camera.
//
// 'damped' (fallback) — the scene computes a smoothed follow path with a little
//   lead in the direction of travel and hands the renderer long straight glides.
//   Being scene-driven it is always a message hop behind the avatar, which at
//   running speed reads as faint shake in the walls. Kept for Explorer builds
//   whose Billboard predates `targetEntity`.

import {
  Billboard, BillboardMode, EasingFunction, engine, Entity, MainCamera, Transform, Tween, VirtualCamera
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

export const CRAWLER_CAMERA = {
  mode: 'rigid' as 'rigid' | 'damped',
  /** Distance (m) of the rigid rig's heading target; the farther, the smaller the heading drift across the dungeon. */
  headingDistance: 50000,
  /** Degrees below horizontal. */
  pitch: 58,
  /** Compass heading the camera looks along: 180 = towards -Z (from the entrance into the dungeon). */
  yaw: 180,
  height: 11,
  /** Height above the player's feet the camera aims at. */
  aimHeight: 1.0,
  /** How fast the camera catches up (1/s). Higher is stiffer. */
  follow: 5,
  /** Seconds of travel to lead the player by, and the cap on that lead in metres. */
  leadTime: 0.35,
  leadMax: 2,
  /** Velocity is measured over this window, then the lead itself is eased at this rate (1/s). */
  velocityWindow: 0.25,
  leadEase: 4,
  /** The player sample is dead-reckoned from its windowed velocity and pulled to fresh samples at this rate (1/s). */
  playerTrust: 8,
  /** The renderer is handed a straight glide this long (s); it is only replaced when the path leaves it. */
  glide: 6,
  /** Renew the glide this long (s) before it would run out. */
  glideRenew: 0.15,
  /** How far (m) the renderer's glide may drift from the path before it is re-aimed. */
  glideTolerance: 0.04,
  /** Extra tolerance (m) per m/s² of path acceleration, so bends are lagged a little rather than chased tick by tick. */
  glideBendSlack: 0.006,
  /** A glide far off the path closes its gap over this long (s); small drifts are absorbed over the whole glide. */
  glideCatchUp: 0.12,
  /** Path velocity for short glides follows the path at this rate (1/s): quick, so starts and stops aim true. */
  quickEase: 200,
  /** Path velocity for long glides at this rate (1/s): calm, so the player-sample beat cannot bend a 6 s line. */
  calmEase: 5,
  /** Glides shorter than this (s) use the quick velocity, longer ones blend toward the calm one. */
  calmAbove: 1,
  /** Residual velocity ripple (m/s) a long glide is allowed before its end counts as off the path. */
  velocityRipple: 0.02,
  /** Path acceleration is read from a velocity eased at this rate, over this baseline (s), less this floor (m/s²). */
  accelEase: 14,
  accelBaseline: 0.2,
  accelFloor: 0.03,
  /** The path's peak acceleration is forgotten at this rate (1/s). */
  accelDecay: 6,
  /** Impact kicks decay at this rate (1/s). */
  kickDecay: 9
}

let rig: Entity | undefined
/** Look-at target riding on the player entity, so the renderer aims the camera every frame. */
let aim: Entity | undefined
/** Rigid mode: the far-away heading target, and the camera mount hanging off the rig at the fixed offset. */
let heading: Entity | undefined
let mount: Entity | undefined
let mountKicked = false
let enabled = false
let current: Vector3 | undefined
let lastPlayer: Vector3 | undefined
let velocity = Vector3.Zero()
let lead = Vector3.Zero()
const samples: Array<{ t: number; p: Vector3 }> = []
let clock = 0
let systemAdded = false
/** Smoothed player position: what the samples would read if they arrived every frame. */
let playerEstimate: Vector3 | undefined
let previousGoal: Vector3 | undefined
/** Velocity of the goal path at three time scales: quick (short glides), mid (acceleration), calm (long glides). */
let quickVelocity = Vector3.Zero()
let midVelocity = Vector3.Zero()
let calmVelocity = Vector3.Zero()
const midHistory: Array<{ t: number; v: Vector3 }> = []
/** Recent peak acceleration of the goal path (m/s²); bounds how long a straight glide can stay on it. */
let pathAccel = 0
/** Our model of the glide the renderer is currently interpolating: `glideStart` → `glideEnd` over `glideDuration` from `glideT0`. */
let glideStart: Vector3 | undefined
let glideEnd = Vector3.Zero()
let glideDuration = 1
let glideT0 = 0
let kick = Vector3.Zero()

/** Nudge the camera (world-space metres); it springs back on its own. Used for hit feedback. */
export function kickCrawlerCamera(offset: Vector3) {
  if (!enabled) return
  kick = Vector3.add(kick, offset)
  const length = Vector3.length(kick)
  if (length > 0.6) kick = Vector3.scale(kick, 0.6 / length)
}
let ticks = 0
let lastError = ''

/** Diagnostics for the HUD: frames the follow system has run, rig position, player position, last error. */
export function crawlerDebug(): string {
  const camera = Transform.getOrNull(engine.CameraEntity)?.position
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const f = (v: Vector3 | undefined) => (v ? `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}` : '-')
  return `${CRAWLER_CAMERA.mode} · tick ${ticks} · cam ${f(camera)} · player ${f(player)}${lastError ? ` · ERR ${lastError}` : ''}`
}

export function isCrawlerCameraOn(): boolean {
  return enabled
}

export function setCrawlerCamera(on: boolean) {
  if (on === enabled) return
  enabled = on
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(followPlayer)
  }
  if (aim === undefined) {
    aim = engine.addEntity()
    Transform.create(aim, { parent: engine.PlayerEntity, position: Vector3.create(0, CRAWLER_CAMERA.aimHeight, 0) })
  }
  if (CRAWLER_CAMERA.mode === 'rigid') {
    setRigidCamera(on)
    return
  }
  if (on) {
    if (rig === undefined) {
      rig = engine.addEntity()
      Transform.create(rig, { position: Vector3.create(48, CRAWLER_CAMERA.height, 60) })
    }
    // The scene ticks at ~40 Hz while the renderer draws faster, so a camera
    // that is positioned *and* aimed from the scene shows the avatar juddering
    // against the world. Aiming at an entity parented to the player makes the
    // renderer keep the avatar pinned on screen every frame; the small positional
    // steps then only show up as parallax on geometry at other depths.
    VirtualCamera.createOrReplace(rig, {
      lookAtEntity: aim,
      defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }
    })
    current = undefined
    playerEstimate = undefined
    previousGoal = undefined
    quickVelocity = Vector3.Zero()
    midVelocity = Vector3.Zero()
    calmVelocity = Vector3.Zero()
    midHistory.length = 0
    pathAccel = 0
    glideStart = undefined
    lastPlayer = undefined
    velocity = Vector3.Zero()
    lead = Vector3.Zero()
    samples.length = 0
    if (Tween.has(rig)) Tween.deleteFrom(rig)
    const player = Transform.getOrNull(engine.PlayerEntity)?.position
    if (player) Transform.getMutable(rig).position = desiredPosition(player, Vector3.Zero())
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig })
  } else {
    // Hand control back to the player's own camera with a blend instead of a cut.
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    if (rig !== undefined && Tween.has(rig)) Tween.deleteFrom(rig)
    glideStart = undefined
  }
}

/** Unit vector along the camera's compass heading (the direction it looks, flattened). */
function headingDirection(): Vector3 {
  const rad = (CRAWLER_CAMERA.yaw * Math.PI) / 180
  return Vector3.create(Math.sin(rad), 0, Math.cos(rad))
}

/** Camera offset from the player's feet: `back` metres opposite to the heading, `height` up. */
function cameraOffset(): Vector3 {
  const { pitch, height } = CRAWLER_CAMERA
  const back = height / Math.tan((pitch * Math.PI) / 180)
  const dir = headingDirection()
  return Vector3.create(-dir.x * back, height, -dir.z * back)
}

function desiredPosition(player: Vector3, lead: Vector3): Vector3 {
  const offset = cameraOffset()
  return Vector3.create(player.x + lead.x + offset.x, player.y + offset.y, player.z + lead.z + offset.z)
}

// --- rigid mode --------------------------------------------------------------

function setRigidCamera(on: boolean) {
  if (!on) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    return
  }
  if (rig === undefined || heading === undefined || mount === undefined) {
    // The rig rides on the player. Its Billboard overwrites the inherited avatar
    // yaw every frame with "face the heading target", and the target is so far
    // away that the rig's own travel cannot measurably swing that direction, so
    // the rig's frame is a constant: local +Z points *away* from the target.
    heading = engine.addEntity()
    const dir = headingDirection()
    Transform.create(heading, { position: Vector3.scale(dir, CRAWLER_CAMERA.headingDistance) })
    rig = engine.addEntity()
    Transform.create(rig, { parent: engine.PlayerEntity })
    Billboard.create(rig, { billboardMode: BillboardMode.BM_Y, targetEntity: heading })
    // Local +Z is -heading, so the world offset `-dir * back` is local `+back`.
    mount = engine.addEntity()
    Transform.create(mount, { parent: rig, position: rigidMountPosition(Vector3.Zero()) })
    VirtualCamera.create(mount, {
      lookAtEntity: aim,
      defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }
    })
  }
  kick = Vector3.Zero()
  Transform.getMutable(mount).position = rigidMountPosition(Vector3.Zero())
  mountKicked = false
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: mount })
}

/** The mount's position in the rig frame for a given world-space kick. */
function rigidMountPosition(worldKick: Vector3): Vector3 {
  const { height } = CRAWLER_CAMERA
  const back = height / Math.tan((CRAWLER_CAMERA.pitch * Math.PI) / 180)
  // Rig frame: +Z = -heading. That is a yaw of (heading yaw + 180°) about Y.
  const toLocal = Quaternion.fromEulerDegrees(0, -(CRAWLER_CAMERA.yaw + 180), 0)
  const localKick = Vector3.rotate(worldKick, toLocal)
  return Vector3.create(localKick.x, height + localKick.y, back + localKick.z)
}

/** Rigid mode per tick: only the hit kick is scene-driven, and only while it lasts. */
function stepRigid(dt: number) {
  if (mount === undefined) return
  kick = Vector3.scale(kick, Math.exp(-dt * CRAWLER_CAMERA.kickDecay))
  const kicking = Vector3.length(kick) > 0.002
  if (!kicking && !mountKicked) return
  Transform.getMutable(mount).position = rigidMountPosition(kicking ? kick : Vector3.Zero())
  mountKicked = kicking
}

// --- damped mode -------------------------------------------------------------

function followPlayer(dt: number) {
  if (!enabled || rig === undefined || dt <= 0) return
  ticks++
  try {
    if (CRAWLER_CAMERA.mode === 'rigid') stepRigid(dt)
    else step(dt)
  } catch (error) {
    lastError = String(error)
    console.error('crawler camera', error)
  }
}

function step(dt: number) {
  if (rig === undefined) return
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return

  clock += dt
  // The renderer hands us the player position at its own cadence, so a
  // per-frame delta alternates between zero and double. Measure velocity over a
  // window instead, then ease the lead so it cannot flicker.
  samples.push({ t: clock, p: Vector3.clone(player) })
  while (samples.length > 2 && clock - samples[1].t >= CRAWLER_CAMERA.velocityWindow) samples.shift()
  const oldest = samples[0]
  const span = clock - oldest.t
  if (span > 0.05) velocity = Vector3.scale(Vector3.subtract(player, oldest.p), 1 / span)

  lastPlayer = Vector3.clone(player)

  // The samples step (zero, then double) as the renderer's cadence beats against
  // ours. Dead-reckon the player along the windowed velocity and pull toward each
  // sample gently; the result moves the way the avatar actually does.
  playerEstimate = playerEstimate
    ? Vector3.lerp(Vector3.add(playerEstimate, Vector3.scale(velocity, dt)), player, 1 - Math.exp(-dt * CRAWLER_CAMERA.playerTrust))
    : Vector3.clone(player)
  if (Vector3.distance(playerEstimate, player) > 1.5) playerEstimate = Vector3.clone(player)

  let wanted = Vector3.scale(Vector3.create(velocity.x, 0, velocity.z), CRAWLER_CAMERA.leadTime)
  const leadLength = Vector3.length(wanted)
  if (leadLength > CRAWLER_CAMERA.leadMax) wanted = Vector3.scale(wanted, CRAWLER_CAMERA.leadMax / leadLength)
  lead = Vector3.lerp(lead, wanted, 1 - Math.exp(-dt * CRAWLER_CAMERA.leadEase))
  kick = Vector3.scale(kick, Math.exp(-dt * CRAWLER_CAMERA.kickDecay))

  const target = desiredPosition(playerEstimate, lead)
  current = current ? Vector3.lerp(current, target, 1 - Math.exp(-dt * CRAWLER_CAMERA.follow)) : target
  // Kicks bypass the follow smoothing so an impact reads as a sharp nudge.
  const goal = Vector3.add(current, kick)

  // The scene ticks at ~40 Hz but the screen draws faster. Rather than teleport
  // the rig to `goal` each tick, hand the renderer a long straight glide and let
  // it interpolate every frame. The glide is only replaced when the path leaves
  // it (or it is about to run out), and a replacement starts from where the
  // renderer's glide *is*, steering back onto the path, so the position never
  // hops. Restarting a fresh tween every tick instead lands each one after a
  // variable 1-2 render frames of the previous glide, and at running speed that
  // beat is a few centimetres of shake in the walls. Rotation comes from the look-at.
  const {
    glide, glideCatchUp, glideTolerance, glideBendSlack, quickEase, calmEase, calmAbove,
    velocityRipple, accelEase, accelBaseline, accelFloor, accelDecay
  } = CRAWLER_CAMERA
  if (previousGoal) {
    // The player-sample beat (40 Hz ticks reading 60 Hz frames) leaves a faint
    // ripple on the path. Starts and stops need a velocity that reacts at once;
    // a 6 s glide needs one the ripple cannot bend; acceleration is read from a
    // middle one over a baseline, with a floor, so the ripple never registers.
    const stepVelocity = Vector3.scale(Vector3.subtract(goal, previousGoal), 1 / dt)
    quickVelocity = Vector3.lerp(quickVelocity, stepVelocity, 1 - Math.exp(-dt * quickEase))
    midVelocity = Vector3.lerp(midVelocity, stepVelocity, 1 - Math.exp(-dt * accelEase))
    calmVelocity = Vector3.lerp(calmVelocity, stepVelocity, 1 - Math.exp(-dt * calmEase))
    midHistory.push({ t: clock, v: midVelocity })
    while (midHistory.length > 2 && clock - midHistory[1].t >= accelBaseline) midHistory.shift()
    const span = clock - midHistory[0].t
    const accel = span > 0.05 ? Math.max(0, Vector3.distance(midVelocity, midHistory[0].v) / span - accelFloor) : 0
    pathAccel = Math.max(accel, pathAccel * Math.exp(-dt * accelDecay))
  }
  previousGoal = goal
  const velocityFor = (seconds: number) => Vector3.lerp(quickVelocity, calmVelocity, Math.min(1, seconds / calmAbove))
  const pathAhead = (seconds: number, horizon: number) => Vector3.add(goal, Vector3.scale(velocityFor(horizon), seconds))

  const predicted = glidePosition()
  if (!predicted || Vector3.distance(goal, predicted) > 4) {
    park(goal)
    return
  }
  // The glide is sound while the rig is on the path and the glide still ends
  // where the path will be when it ends, allowing for the bend the path's
  // current acceleration will put in it over that time and the ripple.
  // While the path is bending (a sprint starting, a stop, a corner) a straight
  // glide cannot hug it anyway, and a few centimetres of extra lag against an
  // already-smoothed path is invisible where every restart is not: let the
  // tolerance breathe with the acceleration.
  const tolerance = glideTolerance + glideBendSlack * pathAccel
  const age = clock - glideT0
  const remaining = Math.max(0, glideDuration - age)
  const gap = Vector3.distance(goal, predicted)
  const bend = 0.5 * pathAccel * remaining * remaining
  const endTolerance = tolerance + bend + velocityRipple * remaining
  const offPath = gap > tolerance || Vector3.distance(pathAhead(remaining, glideDuration), glideEnd) > endTolerance
  const moving = Vector3.length(quickVelocity) > 0.01
  const expiring = moving && remaining < Math.min(CRAWLER_CAMERA.glideRenew, glideDuration * 0.25)
  // At rest with the glide run out, close whatever small offset the last bend left.
  const settling = !moving && remaining === 0 && gap > 0.01
  if (!offPath && !expiring && !settling) return

  // A straight glide is only as long as the path's curvature lets it stay within
  // tolerance; on a straight run that is the full length, through a corner or a
  // stop it is a fraction of a second. A large gap, from a kick or a sudden
  // sprint, is closed fast. Either way the tween ends on the path.
  const urgency = Math.min(1, Math.max(0, (gap - tolerance) / (4 * tolerance)))
  const curvatureLimit = pathAccel > 1e-4 ? Math.sqrt((2 * tolerance) / pathAccel) : glide
  const duration = Math.max(glideCatchUp, Math.min(glide, curvatureLimit, glide + (glideCatchUp - glide) * urgency))
  const end = moving ? pathAhead(duration, duration) : goal
  if (Vector3.distance(end, predicted) < 0.005) {
    park(goal)
    return
  }
  glideStart = predicted
  glideEnd = end
  glideDuration = duration
  glideT0 = clock
  Tween.setMove(rig, predicted, end, duration * 1000, EasingFunction.EF_LINEAR)
}

/** Where the renderer's current glide has the rig by now (it holds its end once it runs out). */
function glidePosition(): Vector3 | undefined {
  if (!glideStart) return undefined
  const k = Math.min(1, (clock - glideT0) / glideDuration)
  return Vector3.lerp(glideStart, glideEnd, k)
}

/** At rest (or on a cut): stop gliding and hold the rig at `at`. */
function park(at: Vector3) {
  if (rig === undefined) return
  if (Tween.has(rig)) Tween.deleteFrom(rig)
  Transform.getMutable(rig).position = at
  glideStart = at
  glideEnd = at
  glideDuration = 1
  glideT0 = clock
}
