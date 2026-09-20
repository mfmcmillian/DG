// Who gets the developer tools. Everything under the DEVELOPER heading in
// Settings, the dungeon panel, the level jump, the armoury buttons and the
// network readout are for us, not for players: they show only in a local
// preview or to the wallets listed here. A saved `devTools` preference from a
// player who is neither is simply ignored.

import { executeTask } from '@dcl/sdk/ecs'
import { getRealm } from '~system/Runtime'
import { localAddress } from './multiplayer'
import { getSettings } from './settings'

/** Wallets allowed the developer tools in the deployed scene (lower case). */
const DEVELOPERS = new Set<string>(['0xfe2d424af0df49bb3316cb2e9f574b0d09cf98ad'])

let preview = false
let asked = false

function askRealm() {
  if (asked) return
  asked = true
  executeTask(async () => {
    try {
      const realm = await getRealm({})
      preview = !!realm.realmInfo?.isPreview
    } catch {
      preview = false
    }
  })
}

/** Local preview, or one of the listed wallets. */
export function isDeveloper(): boolean {
  askRealm()
  return preview || DEVELOPERS.has(localAddress())
}

/** The developer switch is on and this player is allowed to have it. */
export function devToolsOn(): boolean {
  return getSettings().devTools && isDeveloper()
}
