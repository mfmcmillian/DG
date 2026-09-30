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
//   whose Billboard predates `targetEntity`, and used on the Godot client (the
//   mobile app): it carries player-parented entities with the avatar every
//   render frame, yaw included, but evaluates Billboards only once per scene
//   tick, so between ticks the rigid rig swings with every wobble of the
//   avatar's heading and the camera shakes around the player. Damped mode never
//   inherits the yaw. On desktop the look-at keeps the avatar pinned per frame;
//   on Godot the camera holds a fixed orientation instead (see fixedRotation),
//   because there a look-at chasing the per-frame avatar tilts the whole view.
//
//   On Godot the damped path is a *relay* (see stepRelay): that client advances
//   Tweens only once per scene tick too, so a rig placed or tweened from the
//   scene moves in tick-sized steps against an avatar that moves every frame.
//   The one thing its camera controller does interpolate per render frame is
//   the transition between two virtual cameras, so the scene hands the camera a
//   fresh mount every tick and the controller glides it there.

import {
  Billboard, BillboardMode, EasingFunction, engine, Entity, MainCamera, Transform, Tween, VirtualCamera
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { clientKnown, isGodotClient } from '../explorerAgent'

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

/** The default boom, and the one a style asked for; the mount glides between them. */
const DEFAULT_BOOM = { height: CRAWLER_CAMERA.height, pitch: CRAWLER_CAMERA.pitch }
let boomFrom = { ...DEFAULT_BOOM }
let boomTarget = { ...DEFAULT_BOOM }
let boomBlend = 1
const BOOM_SECONDS = 1.6

/**
 * Pull the camera back (or bring it home with no argument). While the camera
 * is on, the change glides over a second and a half; otherwise it applies the
 * moment the camera next comes on.
 */
export function setCrawlerBoom(boom?: { height: number; pitch: number }) {
  const target = boom ?? DEFAULT_BOOM
  if (target.height === boomTarget.height && target.pitch === boomTarget.pitch) return
  boomTarget = { ...target }
  if (!enabled) {
    CRAWLER_CAMERA.height = target.height
    CRAWLER_CAMERA.pitch = target.pitch
    boomBlend = 1
    return
  }
  boomFrom = { height: CRAWLER_CAMERA.height, pitch: CRAWLER_CAMERA.pitch }
  boomBlend = 0
}

/** Advance the boom glide; true while it is still moving. */
function stepBoom(dt: number): boolean {
  if (boomBlend >= 1) return false
  boomBlend = Math.min(1, boomBlend + dt / BOOM_SECONDS)
  const k = boomBlend < 0.5 ? 2 * boomBlend * boomBlend : 1 - Math.pow(-2 * boomBlend + 2, 2) / 2
  CRAWLER_CAMERA.height = boomFrom.height + (boomTarget.height - boomFrom.height) * k
  CRAWLER_CAMERA.pitch = boomFrom.pitch + (boomTarget.pitch - boomFrom.pitch) * k
  return true
}

/** Diagnostics for the HUD: frames the follow system has run, rig position, player position, last error. */
export function crawlerDebug(): string {
  const camera = Transform.getOrNull(engine.CameraEntity)?.position
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const f = (v: Vector3 | undefined) => (v ? `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}` : '-')
  const rate = relayTickAvg > 0 ? ` · ${(1 / relayTickAvg).toFixed(0)} Hz` : ''
  return `${CRAWLER_CAMERA.mode} · tick ${ticks}${rate} · cam ${f(camera)} · player ${f(player)}${lastError ? ` · ERR ${lastError}` : ''}`
}

export function isCrawlerCameraOn(): boolean {
  return enabled
}

let tickMin = Infinity
let tickMax = 0

/** For the periodic client report: the scene tick the mobile camera is working with, since the last call. */
export function crawlerTickNote(): string {
  if (!enabled || !isGodotClient()) return ''
  const ms = (s: number) => (s * 1000).toFixed(0)
  const note = `cam tick ${(1 / relayTickAvg).toFixed(0)} Hz (${Number.isFinite(tickMin) ? ms(tickMin) : '-'}–${ms(tickMax)} ms), glide ${ms(relayTime)} ms, lead ${Vector3.length(relayLead).toFixed(2)} m`
  tickMin = Infinity
  tickMax = 0
  return note
}

/** The mode is settled once the explorer has said what it is; until then the default rig may already be up. */
let modeChosen = false

/**
 * Godot gets the damped rig (see the header). The hub asks for the camera on
 * the first tick, before the explorer has answered, so a rigid rig may already
 * exist by the time the answer comes: it is torn down and the damped one built
 * in its place, live if the camera is on.
 */
function chooseMode(): boolean {
  if (modeChosen || !clientKnown()) return false
  modeChosen = true
  if (wantedMode() === CRAWLER_CAMERA.mode) return false
  rebuild()
  return true
}

/** Which rig this client gets. */
function wantedMode(): 'rigid' | 'damped' {
  return isGodotClient() ? 'damped' : 'rigid'
}

/** Whether the damped rig is driven as the Godot relay rather than by scene tweens. */
function relayOn(): boolean {
  return isGodotClient()
}

/** Tear the current rig down and bring the wanted one up in its place, live if the camera is on. */
function rebuild() {
  if (rig !== undefined && Tween.has(rig)) Tween.deleteFrom(rig)
  relayStop()
  for (const entity of [mount, heading, rig]) if (entity !== undefined) engine.removeEntity(entity)
  mount = heading = rig = undefined
  mountKicked = false
  glideStart = undefined
  CRAWLER_CAMERA.mode = wantedMode()
  if (enabled) {
    enabled = false
    setCrawlerCamera(true)
  }
}

export function setCrawlerCamera(on: boolean) {
  if (on === enabled) return
  enabled = on
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(followPlayer)
  }
  // A rebuild has already brought the camera up.
  if (on && chooseMode()) return
  if (aim === undefined) {
    aim = engine.addEntity()
    Transform.create(aim, { parent: engine.PlayerEntity, position: Vector3.create(0, CRAWLER_CAMERA.aimHeight, 0) })
  }
  if (CRAWLER_CAMERA.mode === 'rigid') {
    setRigidCamera(on)
    return
  }
  if (on) {
    if (relayOn()) {
      kick = Vector3.Zero()
      relayStart()
      return
    }
    if (rig === undefined) {
      rig = engine.addEntity()
      Transform.create(rig, { position: Vector3.create(48, CRAWLER_CAMERA.height, 60) })
    }
    // The scene ticks at ~40 Hz while the renderer draws faster, so a camera
    // that is positioned *and* aimed from the scene shows the avatar juddering
    // against the world. Aiming at an entity parented to the player makes the
    // renderer keep the avatar pinned on screen every frame; the small positional
    // steps then only show up as parallax on geometry at other depths.
    // On Godot the aim is what tilts the world (see fixedRotation): the rig holds its orientation instead.
    VirtualCamera.createOrReplace(rig, {
      lookAtEntity: isGodotClient() ? undefined : aim,
      defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }
    })
    if (isGodotClient()) Transform.getMutable(rig).rotation = fixedRotation()
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
    relayStop()
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

/** Where the overhead camera sits for a hero standing at `player`, at rest; a shot ends here so the hand-back is a short blend (src/cinematics.ts). */
export function crawlerCameraPose(player: Vector3): Vector3 {
  return desiredPosition(player, Vector3.Zero())
}

/**
 * The orientation the camera has when it sits at the offset and looks at the
 * aim: heading `yaw`, pitched down onto a point `aimHeight` above the feet. On
 * Godot the camera is given this outright instead of a look-at. That client
 * moves the avatar every render frame but places the camera once per tick (then
 * glides it), so a look-at riding on the avatar has the camera pivot to keep up
 * between ticks and the whole world tilts with every step. Held to one
 * orientation, the lag shows only as the hero drifting a little on screen.
 */
function fixedRotation(): Quaternion {
  const offset = cameraOffset()
  const back = Math.hypot(offset.x, offset.z)
  const pitch = (Math.atan2(offset.y - CRAWLER_CAMERA.aimHeight, back) * 180) / Math.PI
  return Quaternion.fromEulerDegrees(pitch, CRAWLER_CAMERA.yaw, 0)
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
  const booming = stepBoom(dt)
  kick = Vector3.scale(kick, Math.exp(-dt * CRAWLER_CAMERA.kickDecay))
  const kicking = Vector3.length(kick) > 0.002
  if (!kicking && !mountKicked && !booming) return
  Transform.getMutable(mount).position = rigidMountPosition(kicking ? kick : Vector3.Zero())
  mountKicked = kicking
}

// --- damped mode -------------------------------------------------------------

function followPlayer(dt: number) {
  if (!modeChosen) chooseMode()
  if (!enabled || dt <= 0) return
  ticks++
  relayTickAvg += (dt - relayTickAvg) * 0.2
  relayTickPeak = Math.max(dt, relayTickPeak * Math.exp(-dt * RELAY.peakDecay))
  tickMin = Math.min(tickMin, dt)
  tickMax = Math.max(tickMax, dt)
  try {
    if (CRAWLER_CAMERA.mode === 'rigid') stepRigid(dt)
    else step(dt)
  } catch (error) {
    lastError = String(error)
    console.error('crawler camera', error)
  }
}

function step(dt: number) {
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return

  // A style's boom glides here too; desiredPosition reads the blended values.
  const booming = stepBoom(dt)
  clock += dt
  if (relayOn()) {
    stepRelay(dt, player)
    return
  }
  if (rig === undefined) return
  if (booming && isGodotClient()) Transform.getMutable(rig).rotation = fixedRotation()
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

// --- Godot relay ---------------------------------------------------------------
//
// Godot's camera controller (dcl_global_camera_controller.gd) applies scene
// Transforms and Tweens once per scene tick, so anything the scene moves
// steps at tick rate while the avatar moves every render frame; the camera
// used to be placed that way, and the world snapped along beside the walking
// hero. What that controller does do every render frame is glide the camera
// from wherever it is to a *newly targeted* virtual camera over the target's
// transition time, reading the target's transform live. So each tick the scene
// puts a spare mount where the camera should be, gives it a transition a few
// ticks long, and retargets MainCamera at it: the camera is always mid-glide
// toward a fresh mount, moving every frame, and the next tick redirects it
// before it arrives. The mounts hold the crawler's fixed orientation rather
// than looking at the avatar (see fixedRotation), so the lag never tilts the view.
//
// Arriving matters: when a glide completes the controller *reparents* the
// camera under that mount, and if that mount were later moved the camera would
// jump with it. The scene cannot ask where the camera is parented, so it keeps
// book: a mount whose target was held for about its transition time may have
// been reached and is retired from reuse; one held well past it certainly was,
// and every earlier retiree is then free again, because the camera can only
// be under the mount it reached last.

const RELAY = {
  /** Transition length in scene ticks; the camera must not arrive before the next retarget. */
  spanTicks: 4,
  /** ...and at least this many times the longest recent tick, which is forgotten at this rate (1/s). */
  peakSpan: 2,
  peakDecay: 0.7,
  minTime: 0.05,
  maxTime: 0.5,
  /** The first glide, from the player's own camera into the dungeon. */
  entryTime: 0.8,
  /** Held this close (s) to its transition time, a mount is treated as reached. */
  reachSlack: 0.025,
  /** Held this long (s) past it, a mount was certainly reached and every older retiree is free. */
  settled: 0.25,
  /** Retirees beyond this many are recycled oldest first; the camera is not under a mount that old. */
  maxRetired: 24,
  /** Targets closer than this (m) count as unchanged and hold the current mount. */
  holdEpsilon: 0.001,
  /**
   * The hero's velocity: sample window (s) and the span it needs before it is
   * trusted, and the easing (1/s) on top. The player arrives in tick-sized
   * steps, so a short window or a quick ease reads that beat as velocity.
   */
  leadWindow: 0.25,
  leadMinSpan: 0.1,
  velocityEase: 5,
  /**
   * The camera's offset from its ideal spot dies away at this rate (1/s), on the
   * move and once the hero has stopped (a 133 ms glide closes 30% / 50% of it);
   * never more than this share in one glide, the camera's position being a tick old.
   */
  correctRate: 2.7,
  correctStoppedRate: 5.2,
  correctMax: 0.7,
  /** A hero who moved less than this (m) over this long (s) has stopped; the allowance grows when the ticks run longer than the window. */
  stopWindow: 0.1,
  stopDistance: 0.05,
  /** A hero who moved farther than this (m) in one tick was moved, not running (a run covers ~0.2 m at 30 Hz). */
  jumpDistance: 0.7,
  /** Below this speed (m/s) and offset (m) the mount goes to the ideal spot and holds, so a stop is a stop. */
  restSpeed: 0.05,
  restOffset: 0.03
}

/** The mount MainCamera points at, where it was put, and when. */
let relayCurrent: Entity | undefined
let relayTarget: Vector3 | undefined
let relaySwitched = 0
let relayTime = 0
/** Mounts free to be moved, and mounts the camera may be parented under. */
const relayPool: Entity[] = []
let relayRetired: Entity[] = []
/** Smoothed scene tick length (s). */
let relayTickAvg = 0.05
/** The longest recent tick, forgotten over a second or two; a glide must outlast it. */
let relayTickPeak = 0.05
/** Player samples for the lead's velocity, and the eased lead itself. */
const relaySamples: Array<{ t: number; p: Vector3 }> = []
/** The hero's eased ground velocity, and the glide's worth of it the mount is placed ahead (for the report). */
let relayVelocity = Vector3.Zero()
let relayLead = Vector3.Zero()
/** Smoothed player position the mounts are placed from. */
let relayEstimate: Vector3 | undefined
/** Until this clock the hero has just jumped and the mount goes straight to the ideal spot. */
let relayJumpUntil = 0
/** A scripted move (lunge, roll) the scene issued and expects to see land soon. */
let relayShift: Vector3 | undefined
let relayShiftUntil = 0

/**
 * The scene is about to carry the player `delta` along the ground (a swing's
 * lunge, the dodge roll). Godot does it as one teleport; knowing the step, the
 * relay slides its history along with it, so the step is neither read as a
 * sprint nor as a jump, and the camera catches up over a few glides as after
 * any other offset.
 */
export function noteScriptedMove(delta: Vector3) {
  if (Vector3.length(delta) < 0.05) return
  relayShift = Vector3.create(delta.x, 0, delta.z)
  relayShiftUntil = clock + 0.4
}

function relayMount(): Entity {
  const spare = relayPool.shift()
  if (spare !== undefined) return spare
  const mount = engine.addEntity()
  Transform.create(mount)
  return mount
}

function relayStart() {
  // Whatever the camera was under before is off limits until a settled hold proves otherwise.
  if (relayCurrent !== undefined) relayRetired.push(relayCurrent)
  relayCurrent = undefined
  relayTarget = undefined
  relaySamples.length = 0
  relayVelocity = Vector3.Zero()
  relayLead = Vector3.Zero()
  relayEstimate = undefined
  relayJumpUntil = 0
  relayShift = undefined
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (player) stepRelay(0, player)
}

function relayStop() {
  if (relayCurrent !== undefined) relayRetired.push(relayCurrent)
  relayCurrent = undefined
  relayTarget = undefined
}

/**
 * Godot per tick: retarget the camera at a spare mount placed where it should
 * be, glide time a few ticks. Straight from the player sample: the lead, which
 * retracted after a stop and read as the camera wandering on, is gone, and the
 * glide already lags a little. A target that has not moved holds the current
 * mount, so a stop is a stop.
 */
function stepRelay(dt: number, player: Vector3) {
  kick = Vector3.scale(kick, Math.exp(-dt * CRAWLER_CAMERA.kickDecay))
  // A glide the camera finishes before the next tick arrives is a halt, and a
  // fortress tick (enemies, spawns) spikes far above the hall's average: the
  // glide covers the longest recent tick with room to spare, not just the mean.
  // The camera's speed is the hero's either way; a longer glide only spreads
  // the correction out a little.
  const glideTime = Math.min(RELAY.maxTime, Math.max(RELAY.minTime, RELAY.spanTicks * relayTickAvg, RELAY.peakSpan * relayTickPeak))
  // Godot's movePlayerTo ignores `duration`, so a dodge roll or a swing's lunge
  // (playerCharacter.ts glidePlayer) is a 2-3 m teleport there. Read as motion
  // it is a 12 m/s sprint that throws the mount ahead and hauls the camera back
  // on every swing. Farther than a run covers in a tick is a jump: forget the
  // velocity and glide straight to the new spot for one glide.
  const last = relaySamples[relaySamples.length - 1]
  // A step the scene announced (noteScriptedMove): once most of it shows in the
  // sample, move the history along with it. The velocity and the stop reading
  // are then about the hero's own motion; the camera closes the new offset
  // through the correction share below, a glide at a time.
  if (relayShift && last) {
    if (clock > relayShiftUntil) relayShift = undefined
    else if (Vector3.dot(Vector3.subtract(player, last.p), relayShift) > 0.5 * Vector3.lengthSquared(relayShift)) {
      for (const sample of relaySamples) sample.p = Vector3.add(sample.p, relayShift)
      if (relayEstimate) relayEstimate = Vector3.add(relayEstimate, relayShift)
      relayShift = undefined
    }
  }
  if (last && Vector3.distance(player, last.p) > RELAY.jumpDistance) {
    relaySamples.length = 0
    relayVelocity = Vector3.Zero()
    relayEstimate = undefined
    relayJumpUntil = clock + glideTime
  }
  relaySamples.push({ t: clock, p: Vector3.clone(player) })
  while (relaySamples.length > 2 && clock - relaySamples[1].t >= RELAY.leadWindow) relaySamples.shift()
  const span = clock - relaySamples[0].t
  let velocity = Vector3.Zero()
  if (span >= RELAY.leadMinSpan) velocity = Vector3.scale(Vector3.subtract(player, relaySamples[0].p), 1 / span)
  // The hero halts within a few frames; a velocity averaged over a quarter
  // second would carry the camera on past them and slide it back. Barely any
  // movement over the last tenth of a second is a stop: the velocity is cut at once.
  // Read against the newest sample at least half the window old, however old
  // that is: when the fortress slows the ticks past the window there is no
  // sample inside it, and a stop that went unread left the camera running on
  // and sliding back after every halt. The allowance grows with the gap.
  let stopped = false
  for (let i = relaySamples.length - 1; i >= 0; i--) {
    const age = clock - relaySamples[i].t
    if (age < RELAY.stopWindow * 0.5) continue
    stopped = Vector3.distance(player, relaySamples[i].p) < RELAY.stopDistance * Math.max(1, age / RELAY.stopWindow)
    break
  }
  if (stopped) velocity = Vector3.Zero()
  const flat = Vector3.create(velocity.x, 0, velocity.z)
  relayVelocity = stopped || dt <= 0 ? flat : Vector3.lerp(relayVelocity, flat, 1 - Math.exp(-dt * RELAY.velocityEase))
  // The samples step (zero, then double) as the renderer's frames beat against
  // our ticks; aimed straight at them, the camera's speed flips every tick and
  // the run stutters. Dead-reckon the player along the windowed velocity and
  // pull toward each sample gently, as the desktop path does.
  relayEstimate = relayEstimate && dt > 0 && !stopped
    ? Vector3.lerp(Vector3.add(relayEstimate, Vector3.scale(velocity, dt)), player, 1 - Math.exp(-dt * CRAWLER_CAMERA.playerTrust))
    : Vector3.clone(player)
  if (Vector3.distance(relayEstimate, player) > 1.5) relayEstimate = Vector3.clone(player)
  const ideal = Vector3.add(desiredPosition(relayEstimate, Vector3.Zero()), kick)
  // The renderer glides at (mount - camera) / glide time, so a mount placed from
  // the hero alone makes the camera's speed depend on how long the last tick
  // took, and the phone's ticks vary threefold: the run stutters. Place the mount
  // from where the camera *is* instead (the renderer reports it every frame):
  // a glide's worth of the hero's velocity ahead, plus a share of the offset
  // from the ideal spot, so the speed is the hero's whatever the tick timing
  // and the position error dies away over a few glides.
  const camera = Transform.getOrNull(engine.CameraEntity)?.position
  let target = ideal
  if (camera && relayCurrent !== undefined && clock >= relayJumpUntil && Vector3.distance(camera, ideal) < 4) {
    const offset = Vector3.subtract(ideal, camera)
    const resting = Vector3.length(relayVelocity) < RELAY.restSpeed && Vector3.length(offset) < RELAY.restOffset
    if (!resting) {
      // The share closed per glide follows the glide's length, so the offset
      // dies away at one rate in seconds whether the glide is short or, after a
      // long tick, stretched: a fixed share left the camera trailing for
      // seconds after every hitch.
      const rate = stopped ? RELAY.correctStoppedRate : RELAY.correctRate
      const correct = Math.min(RELAY.correctMax, 1 - Math.exp(-glideTime * rate))
      target = Vector3.add(camera, Vector3.add(Vector3.scale(relayVelocity, glideTime), Vector3.scale(offset, correct)))
      target.y = ideal.y
    }
  }
  relayLead = Vector3.scale(relayVelocity, glideTime)
  if (relayCurrent !== undefined && relayTarget && Vector3.distance(relayTarget, target) < RELAY.holdEpsilon) return

  const next = relayMount()
  if (relayCurrent !== undefined) {
    const held = clock - relaySwitched
    if (held >= relayTime + RELAY.settled) {
      relayPool.push(...relayRetired)
      relayRetired = [relayCurrent]
    } else if (held >= relayTime - RELAY.reachSlack) {
      relayRetired.push(relayCurrent)
      if (relayRetired.length > RELAY.maxRetired) relayPool.push(relayRetired.shift()!)
    } else {
      relayPool.push(relayCurrent)
    }
  }
  relayTime = relayCurrent === undefined ? RELAY.entryTime : glideTime
  const transform = Transform.getMutable(next)
  transform.position = target
  transform.rotation = fixedRotation()
  VirtualCamera.createOrReplace(next, {
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(relayTime) }
  })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: next })
  relayCurrent = next
  relayTarget = target
  relaySwitched = clock
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
