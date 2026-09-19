import { AvatarModifierArea, AvatarModifierType, CameraMode, engine, Entity, MainCamera, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/**
 * One AvatarModifierArea over the whole scene hides every native Decentraland
 * avatar, ours included: in the dungeon everyone is their custom body, and a
 * player who has not picked a character yet is simply not shown.
 *
 * How the Explorer implements this (unity-explorer, AvatarModifierAreaHandlerSystem
 * + SDKEntityTriggerArea): the area is a kinematic-Rigidbody BoxCollider
 * trigger, remote avatars are static trigger capsules, and the local player is
 * a CharacterController. Avatars are only found through OnTriggerEnter, and a
 * kinematic trigger vs a static capsule only fires while the kinematic body is
 * awake, which it stops being ~0.5 s after it last moved. Hence:
 *
 *  - The area is NOT carried by the player: a scene-sized box teleported every
 *    frame stuttered movement.
 *  - It is nudged by a centimetre twice a second so it never sleeps, which is
 *    what makes remote avatars already inside get reported.
 *  - Hiding is applied on *entry* only. Anything that resets an avatar's
 *    visibility while it is already inside (a camera mode change, a rebuilt
 *    remote avatar, our own character loading, a teleport) leaves it shown
 *    until it leaves and re-enters. `rearmAvatarHiding` fakes exactly that:
 *    the box jumps out of the world for one frame and comes back, so every
 *    avatar exits and re-enters and is hidden again. Camera changes are
 *    watched here; the other events call in.
 *  - The box reaches 56 m up, so an avatar dropped in from height while the
 *    ground loads is already inside when it lands.
 */
const SCENE_SIZE = 96
const MARGIN = 8
const AREA = Vector3.create(SCENE_SIZE + MARGIN, 64, SCENE_SIZE + MARGIN)
const CENTER = Vector3.create(SCENE_SIZE / 2, 24, SCENE_SIZE / 2)
const AWAY = Vector3.create(SCENE_SIZE / 2, 2000, SCENE_SIZE / 2)
const NUDGE_SECONDS = 0.4
const NUDGE = 0.01
/** Long enough to be seen by a few physics steps, whatever the frame rate; one frame can miss them all. */
const AWAY_SECONDS = 0.1

let area: Entity | undefined
let nudgeAge = 0
let nudged = false
/** Seconds left out of the world; 0 = at home. */
let awayFor = 0
let rearmRequested = false
let lastVirtualCamera: Entity | undefined
let lastCameraMode: number | undefined

export function initializeAvatarHiding() {
  if (area !== undefined) return
  area = engine.addEntity()
  Transform.create(area, { position: CENTER })
  AvatarModifierArea.create(area, { area: AREA, modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: [] })
  engine.addSystem(update)
}

/** Force every avatar in the scene through a fresh exit/enter of the area, re-applying the hide. */
export function rearmAvatarHiding() {
  if (area === undefined) return
  rearmRequested = true
}

function update(dt: number) {
  if (area === undefined) return
  watchCamera()
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  const transform = Transform.getMutable(area)
  if (rearmRequested && awayFor <= 0) {
    rearmRequested = false
    awayFor = AWAY_SECONDS
    transform.position = Vector3.clone(AWAY)
    return
  }
  if (awayFor > 0) {
    awayFor -= span
    if (awayFor <= 0) {
      awayFor = 0
      transform.position = Vector3.clone(CENTER)
      nudgeAge = 0
    }
    return
  }
  // Keep the kinematic trigger awake so avatars inside it are reported.
  nudgeAge += span
  if (nudgeAge < NUDGE_SECONDS) return
  nudgeAge = 0
  nudged = !nudged
  transform.position.y = CENTER.y + (nudged ? NUDGE : 0)
}

/** Any camera change (menu rig, dungeon camera, dev menu, first/third person) can show the local avatar again. */
function watchCamera() {
  const virtualCamera = MainCamera.getOrNull(engine.CameraEntity)?.virtualCameraEntity as Entity | undefined
  const mode = CameraMode.getOrNull(engine.CameraEntity)?.mode
  if (virtualCamera !== lastVirtualCamera || mode !== lastCameraMode) {
    const first = lastVirtualCamera === undefined && lastCameraMode === undefined
    lastVirtualCamera = virtualCamera
    lastCameraMode = mode
    if (!first) rearmAvatarHiding()
  }
}
