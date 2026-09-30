/**
 * Where the game lives now. The same build goes to the LAND at -17,123 and to
 * the World; the World copy carries a worldConfiguration in its scene.json
 * (tools/world.mjs adds it), the LAND copy does not. A LAND copy that is not a
 * local preview is the old home: its title shows one button that sends the
 * player to the World, and nothing else.
 */

import { executeTask } from '@dcl/sdk/ecs'
import { changeRealm } from '~system/RestrictedActions'
import { getRealm, getSceneInformation } from '~system/Runtime'

export const WORLD_NAME = 'dungeons.dcl.eth'

let moved = false

/**
 * A local preview, however the explorer reports it. The desktop client sets
 * `isPreview`; the mobile client opened from the `--mobile` QR does not, but
 * it names the realm LocalPreview and serves it from the PC's LAN address.
 */
function isLocalPreview(realm: { realmInfo?: { isPreview?: boolean; realmName?: string; baseUrl?: string } }): boolean {
  const info = realm.realmInfo
  if (!info) return false
  if (info.isPreview || info.realmName === 'LocalPreview') return true
  const host = (info.baseUrl ?? '').replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0]
  return host === 'localhost' || /^127\./.test(host) || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
}

export function initializeHome() {
  executeTask(async () => {
    try {
      const realm = await getRealm({})
      if (isLocalPreview(realm)) return
      const info = await getSceneInformation({})
      const meta = JSON.parse(info.metadataJson || '{}') as { worldConfiguration?: { name?: string } }
      moved = !meta.worldConfiguration?.name
      if (moved) console.log(`[DG] old home: the title points to ${WORLD_NAME}`)
    } catch {
      moved = false
    }
  })
}

/** This copy is the old LAND home; the World is where players should be. */
export function hasMoved(): boolean {
  return moved
}

/** Take the player to the World. The explorer asks them to confirm. */
export function goToNewHome() {
  void changeRealm({ realm: WORLD_NAME, message: `Dungeons of Antrom has moved to ${WORLD_NAME}. Go there now?` })
}
