import { AvatarModifierArea, AvatarModifierType, engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/**
 * One AvatarModifierArea, riding on the local player, hides every native
 * Decentraland avatar that has a custom body standing in for it. Players whose
 * body is not ready (still on the title screen, or a replica that has not
 * loaded) stay excluded so they are never invisible.
 *
 * One moving area rather than a fixed one over the scene: the Explorer builds
 * the area as a kinematic physics trigger and only learns about avatars from
 * enter/exit events. A fixed trigger falls asleep, so avatars that appear
 * inside it (a player joining, or already standing there when the scene
 * loads) are never reported; only avatars that cross its edge are. Carried by
 * the player the trigger stays awake, and a small periodic nudge covers the
 * time the player stands still.
 *
 * One area rather than one per player: leaving any area re-shows an avatar
 * regardless of the other areas it is still inside, so overlapping areas would
 * flicker each other's avatars back on.
 */
const SCENE_SIZE = 96
/** Covers the whole scene from any point inside it. */
const AREA = Vector3.create(SCENE_SIZE * 2, 32, SCENE_SIZE * 2)
const AREA_HEIGHT = 1
const NUDGE_SECONDS = 0.5
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
  Transform.create(area, { parent: engine.PlayerEntity, position: Vector3.create(0, AREA_HEIGHT, 0) })
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
    const id = identity.address?.toLowerCase()
    if (id && !hidden.has(id)) excludeIds.push(id)
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
  // Keep the physics trigger awake while the player stands still, so avatars
  // that appear around them are still reported.
  nudgeAge += dt
  if (nudgeAge >= NUDGE_SECONDS) {
    nudgeAge = 0
    nudged = !nudged
    Transform.getMutable(area).position.y = AREA_HEIGHT + (nudged ? NUDGE : 0)
  }
}
