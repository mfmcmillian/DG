import { AvatarModifierArea, AvatarModifierType, engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/**
 * One AvatarModifierArea over the whole scene hides every native Decentraland
 * avatar that has a custom body standing in for it. Players whose body is not
 * ready (still on the title screen, or a replica that has not loaded) stay
 * excluded so they are never invisible.
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
 *  - Exclusion ids are compared case-sensitively against the profile id, so
 *    both spellings are sent.
 *
 * One area rather than one per player: HideAvatar on an excluded avatar sets
 * hidden = false, so overlapping areas would re-show each other's avatars.
 */
const SCENE_SIZE = 96
const MARGIN = 8
const AREA = Vector3.create(SCENE_SIZE + MARGIN, 32, SCENE_SIZE + MARGIN)
const CENTER = Vector3.create(SCENE_SIZE / 2, 8, SCENE_SIZE / 2)
const NUDGE_SECONDS = 0.4
const NUDGE = 0.01

/** Addresses (lower-case) whose native avatar is currently replaced by a custom body. */
const hidden = new Set<string>()
let area: Entity | undefined
let exclusionsKey: string | undefined
let nudgeAge = 0
let nudged = false

export function initializeAvatarHiding() {
  if (area !== undefined) return
  area = engine.addEntity()
  Transform.create(area, { position: CENTER })
  engine.addSystem(updateAvatarHiding)
}

/** Hide (or show again) the native avatar of this player. */
export function setNativeAvatarHidden(address: string, hide: boolean) {
  const id = address.toLowerCase()
  if (!id) return
  if (hide) hidden.add(id)
  else hidden.delete(id)
}

function updateAvatarHiding(dt: number) {
  if (area === undefined) return
  if (hidden.size === 0) {
    // Removing the component shows everyone the trigger still holds.
    if (AvatarModifierArea.has(area)) AvatarModifierArea.deleteFrom(area)
    exclusionsKey = undefined
    return
  }
  // Everyone in the scene without a custom body keeps their native avatar. The
  // list is sorted so an unchanged set is not resent (the renderer re-applies
  // the area to every avatar inside on each change).
  const excludeIds: string[] = []
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = identity.address
    if (!address) continue
    const lower = address.toLowerCase()
    if (hidden.has(lower)) continue
    excludeIds.push(lower)
    if (address !== lower) excludeIds.push(address)
  }
  excludeIds.sort()
  const key = excludeIds.join('|')
  if (key !== exclusionsKey || !AvatarModifierArea.has(area)) {
    exclusionsKey = key
    AvatarModifierArea.createOrReplace(area, {
      area: AREA,
      modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
      excludeIds
    })
  }
  // Keep the kinematic trigger awake so avatars inside it are reported.
  nudgeAge += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (nudgeAge >= NUDGE_SECONDS) {
    nudgeAge = 0
    nudged = !nudged
    Transform.getMutable(area).position.y = CENTER.y + (nudged ? NUDGE : 0)
  }
}
