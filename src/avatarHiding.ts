import { AvatarModifierArea, AvatarModifierType, engine, Entity, Transform } from '@dcl/sdk/ecs'
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
 */
const SCENE_SIZE = 96
const MARGIN = 8
const AREA = Vector3.create(SCENE_SIZE + MARGIN, 32, SCENE_SIZE + MARGIN)
const CENTER = Vector3.create(SCENE_SIZE / 2, 8, SCENE_SIZE / 2)
const NUDGE_SECONDS = 0.4
const NUDGE = 0.01

let area: Entity | undefined
let nudgeAge = 0
let nudged = false

export function initializeAvatarHiding() {
  if (area !== undefined) return
  area = engine.addEntity()
  Transform.create(area, { position: CENTER })
  AvatarModifierArea.create(area, { area: AREA, modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: [] })
  engine.addSystem(keepAreaAwake)
}

/** Keep the kinematic trigger awake so avatars inside it are reported. */
function keepAreaAwake(dt: number) {
  if (area === undefined) return
  nudgeAge += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (nudgeAge < NUDGE_SECONDS) return
  nudgeAge = 0
  nudged = !nudged
  Transform.getMutable(area).position.y = CENTER.y + (nudged ? NUDGE : 0)
}
