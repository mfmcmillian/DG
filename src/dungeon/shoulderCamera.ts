// Scene-owned third-person camera with a fixed, short boom. The SDK has no way
// to cap the native camera's zoom, so this replaces it: mouse-look from
// PrimaryPointerInfo, a clamped pitch, and our own de-occluder that eases the
// boom in fast and back out slowly instead of snapping.

import {
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  MainCamera,
  PointerLock,
  PrimaryPointerInfo,
  Raycast,
  RaycastQueryType,
  RaycastResult,
  Transform,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

/** Collider layer the boom ray tests against. Walls/floors/props carry it; door trim does not. */
export const CAMERA_LAYER = ColliderLayer.CL_CUSTOM1

export const SHOULDER_CAMERA = {
  /** Boom length in metres. This is the "zoom" the player can no longer change. */
  distance: 3.2,
  /** Sideways offset so the avatar sits left of centre, over-the-shoulder style. */
  shoulder: 0.45,
  /** Pivot height above the player's feet. */
  pivotHeight: 1.55,
  /** Degrees per pixel of mouse travel. */
  sensitivity: 0.12,
  invertY: false,
  pitchMin: -25,
  pitchMax: 65,
  /** Gap kept between the camera and whatever the boom ray hits. */
  wallPadding: 0.3,
  /** Ease rates (1/s): pull in quickly, let out gently. */
  easeIn: 14,
  easeOut: 3,
  /** How far away the rig's heading target sits; see setShoulderCamera. */
  headingDistance: 50000
}

// The camera must not be positioned from the scene: the scene ticks at ~40 Hz
// while the renderer draws faster, so a camera placed by the scene shows the
// avatar juddering against the world. Instead the rig is a child of the player
// entity (the renderer moves it every frame), its Billboard replaces the
// inherited avatar yaw with "face the heading target" (a point so far away
// that walking cannot swing it), and the camera mount and the aim point are
// children of the rig. The scene only moves things when the mouse turns the
// view or the boom shortens against a wall.
let rig: Entity | undefined
let heading: Entity | undefined
let mount: Entity | undefined
let aim: Entity | undefined
let probe: Entity | undefined
let enabled = false
let yaw = 180
let pitch = 15
let boom = SHOULDER_CAMERA.distance
let systemAdded = false

export function isShoulderCameraOn(): boolean {
  return enabled
}

export function setShoulderCamera(on: boolean) {
  if (on === enabled) return
  enabled = on
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(updateShoulderCamera)
  }
  if (on) {
    // Coming from the Explorer's own camera, start from where the player is
    // already looking so there is no snap. Coming from another scene camera
    // (the overhead one is pitched 58 degrees down and points north whatever
    // the hero faces), settle behind the hero at a comfortable pitch instead.
    const cam = Transform.getOrNull(engine.CameraEntity)
    const fromScene = MainCamera.getOrNull(engine.CameraEntity)?.virtualCameraEntity !== undefined
    if (fromScene) {
      const hero = Transform.getOrNull(engine.PlayerEntity)
      yaw = hero ? Quaternion.toEulerAngles(hero.rotation).y : 0
      pitch = 12
    } else if (cam) {
      const e = Quaternion.toEulerAngles(cam.rotation)
      yaw = e.y
      pitch = clamp(normalizePitch(e.x), SHOULDER_CAMERA.pitchMin, SHOULDER_CAMERA.pitchMax)
    }
    boom = SHOULDER_CAMERA.distance
    if (rig === undefined || heading === undefined || mount === undefined || aim === undefined || probe === undefined) {
      heading = engine.addEntity()
      Transform.create(heading, { position: headingTarget() })
      rig = engine.addEntity()
      Transform.create(rig, { parent: engine.PlayerEntity })
      Billboard.create(rig, { billboardMode: BillboardMode.BM_Y, targetEntity: heading })
      aim = engine.addEntity()
      Transform.create(aim, { parent: rig })
      mount = engine.addEntity()
      Transform.create(mount, { parent: rig })
      VirtualCamera.create(mount, { lookAtEntity: aim, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.4) } })
      probe = engine.addEntity()
      Transform.create(probe, { parent: rig })
    }
    applyPose()
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: mount })
  } else {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    if (probe !== undefined && Raycast.has(probe)) Raycast.deleteFrom(probe)
  }
}

/** World point the rig's Billboard faces: far out along the view heading. */
function headingTarget(): Vector3 {
  const rad = (yaw * Math.PI) / 180
  return Vector3.create(Math.sin(rad) * SHOULDER_CAMERA.headingDistance, 0, Math.cos(rad) * SHOULDER_CAMERA.headingDistance)
}

/** World -> rig frame. The Billboard leaves the rig's local +Z pointing away from the heading target, a yaw of (yaw + 180). */
function toRig(world: Vector3): Vector3 {
  return Vector3.rotate(world, Quaternion.fromEulerDegrees(0, -(yaw + 180), 0))
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Euler pitch comes back in 0..360; fold it to -180..180. */
function normalizePitch(x: number): number {
  return x > 180 ? x - 360 : x
}

function updateShoulderCamera(dt: number) {
  if (!enabled || rig === undefined || probe === undefined) return
  const yawBefore = yaw
  const pitchBefore = pitch
  const boomBefore = boom

  const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? true
  const delta = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenDelta
  if (locked && delta && (delta.x !== 0 || delta.y !== 0)) {
    yaw = (yaw + delta.x * SHOULDER_CAMERA.sensitivity) % 360
    const dy = delta.y * SHOULDER_CAMERA.sensitivity * (SHOULDER_CAMERA.invertY ? 1 : -1)
    pitch = clamp(pitch + dy, SHOULDER_CAMERA.pitchMin, SHOULDER_CAMERA.pitchMax)
  }

  // Our de-occluder: shorten the boom to whatever the ray from the pivot hit last frame.
  let allowed = SHOULDER_CAMERA.distance
  const result = RaycastResult.getOrNull(probe)
  if (result) {
    for (const hit of result.hits) {
      if (hit.length !== undefined) allowed = Math.min(allowed, Math.max(0.6, hit.length - SHOULDER_CAMERA.wallPadding))
    }
  }
  const rate = allowed < boom ? SHOULDER_CAMERA.easeIn : SHOULDER_CAMERA.easeOut
  boom += (allowed - boom) * (1 - Math.exp(-dt * rate))
  if (Math.abs(boom - allowed) < 0.001) boom = allowed

  // Touch the transforms only when something changed; the renderer carries the rig otherwise.
  if (yaw !== yawBefore || pitch !== pitchBefore || boom !== boomBefore) applyPose()
  else castProbe()
}

/** Lay the mount, aim and probe out in the rig frame for the current yaw, pitch and boom. */
function applyPose() {
  if (rig === undefined || heading === undefined || mount === undefined || aim === undefined || probe === undefined) return
  const rotation = Quaternion.fromEulerDegrees(pitch, yaw, 0)
  const right = Vector3.rotate(Vector3.Right(), rotation)
  const back = Vector3.rotate(Vector3.Backward(), rotation)
  // Pivot relative to the player's feet: over the shoulder, at chest height.
  const pivot = Vector3.create(right.x * SHOULDER_CAMERA.shoulder, SHOULDER_CAMERA.pivotHeight, right.z * SHOULDER_CAMERA.shoulder)

  Transform.getMutable(heading).position = headingTarget()
  Transform.getMutable(aim).position = toRig(pivot)
  Transform.getMutable(mount).position = toRig(Vector3.add(pivot, Vector3.scale(back, boom)))
  Transform.getMutable(probe).position = toRig(pivot)
  castProbe()
}

/**
 * De-occluder ray for next tick: from the pivot (the probe rides the rig, so
 * its origin is wherever the renderer has the player) straight down the boom.
 * Recast every tick: `continuous: false` results go stale as the player walks.
 */
function castProbe() {
  if (probe === undefined) return
  const back = Vector3.rotate(Vector3.Backward(), Quaternion.fromEulerDegrees(pitch, yaw, 0))
  Raycast.createOrReplace(probe, {
    direction: { $case: 'globalDirection', globalDirection: back },
    maxDistance: SHOULDER_CAMERA.distance + SHOULDER_CAMERA.wallPadding,
    queryType: RaycastQueryType.RQT_QUERY_ALL,
    collisionMask: CAMERA_LAYER,
    continuous: false
  })
}
