import { AvatarModifierArea, AvatarModifierType, engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/**
 * One AvatarModifierArea over the whole scene hides every native Decentraland
 * avatar that has a custom body standing in for it. Players whose body is not
 * ready (still on the title screen, or a replica that has not loaded) stay
 * excluded so they are never invisible.
 *
 * The area is static. The Explorer builds it as a physics trigger, and a
 * trigger the size of the scene carried by the player is recomputed against
 * every avatar on each frame the player moves, which stutters the player. A
 * static trigger only learns about avatars that cross its edge, so whenever
 * the set of players or hidden bodies changes it is nudged by a centimetre
 * once, which wakes it and re-reports everyone inside.
 *
 * One area rather than one per player: leaving any area re-shows an avatar
 * regardless of the other areas it is still inside, so overlapping areas would
 * flicker each other's avatars back on.
 */
const SCENE_SIZE = 96
const MARGIN = 8
const AREA = Vector3.create(SCENE_SIZE + MARGIN, 32, SCENE_SIZE + MARGIN)
const CENTER = Vector3.create(SCENE_SIZE / 2, 8, SCENE_SIZE / 2)
const NUDGE = 0.01

/** Addresses (lower-case) whose native avatar is currently replaced by a custom body. */
const hidden = new Set<string>()
let area: Entity | undefined
let exclusionsKey: string | undefined
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

function updateAvatarHiding() {
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
  if (key === exclusionsKey && AvatarModifierArea.has(area)) return
  exclusionsKey = key
  AvatarModifierArea.createOrReplace(area, {
    area: AREA,
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
    excludeIds
  })
  // One nudge per change wakes the trigger so avatars already inside are re-reported.
  nudged = !nudged
  Transform.getMutable(area).position.y = CENTER.y + (nudged ? NUDGE : 0)
}
