/**
 * What the client tells the server about itself, for the visit log
 * (src/visitLog.ts): the explorer it runs in, and the milestones it reaches.
 * Nothing here changes play.
 */
import { executeTask } from '@dcl/sdk/ecs'
import { getExplorerInformation } from '~system/Runtime'
import { publishHello, publishMark } from './multiplayer'

let platform = ''
let agent = ''
const marked = new Set<string>()

export function initializeClientInfo() {
  executeTask(async () => {
    try {
      const info = await getExplorerInformation({})
      platform = info.platform || ''
      agent = info.agent || ''
    } catch (error) {
      console.log('[DG] explorer information unavailable', error)
    }
    console.log(`[DG] explorer ${agent || '?'} on ${platform || '?'}`)
    publishHello(platform, agent)
  })
}

/** The explorer's own word for where it runs: "desktop", "mobile", "vr" or "web" ('' until known). */
export function clientPlatform(): string {
  return platform
}

/** A milestone reached this session (sent once per session; the server keeps the first time ever). */
export function markMilestone(what: string) {
  if (marked.has(what)) return
  marked.add(what)
  publishMark(what)
}
