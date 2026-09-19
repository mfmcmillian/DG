// Scene-owned third-person camera with a fixed, short boom. The SDK has no way
// to cap the native camera's zoom, so this replaces it: mouse-look from
// PrimaryPointerInfo, a clamped pitch, and our own de-occluder that eases the
// boom in fast and back out slowly instead of snapping.

import {
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
  easeOut: 3
}

let rig: Entity | undefined
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
    if (rig === undefined) {
      rig = engine.addEntity()
      Transform.create(rig, {})
      VirtualCamera.create(rig, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.4) } })
      probe = engine.addEntity()
      Transform.create(probe, {})
    }
    const player = Transform.getOrNull(engine.PlayerEntity)?.position
    if (player) applyPose(player, 0)
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig })
  } else {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    if (probe !== undefined && Raycast.has(probe)) Raycast.deleteFrom(probe)
  }
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
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return

  const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? true
  const delta = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenDelta
  if (locked && delta) {
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

  applyPose(player, dt)
}

function applyPose(player: Vector3, _dt: number) {
  if (rig === undefined || probe === undefined) return
  const rotation = Quaternion.fromEulerDegrees(pitch, yaw, 0)
  const right = Vector3.rotate(Vector3.Right(), rotation)
  const back = Vector3.rotate(Vector3.Backward(), rotation)
  const pivot = Vector3.create(
    player.x + right.x * SHOULDER_CAMERA.shoulder,
    player.y + SHOULDER_CAMERA.pivotHeight,
    player.z + right.z * SHOULDER_CAMERA.shoulder
  )
  const position = Vector3.add(pivot, Vector3.scale(back, boom))

  const t = Transform.getMutable(rig)
  t.position = position
  t.rotation = rotation

  // Probe for next frame: from the pivot straight down the boom.
  Transform.getMutable(probe).position = pivot
  Raycast.createOrReplace(probe, {
    direction: { $case: 'globalDirection', globalDirection: back },
    maxDistance: SHOULDER_CAMERA.distance + SHOULDER_CAMERA.wallPadding,
    queryType: RaycastQueryType.RQT_QUERY_ALL,
    collisionMask: CAMERA_LAYER,
    continuous: false
  })
}
