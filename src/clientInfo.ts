/**
 * What the client tells the server about itself, for the visit log
 * (src/visitLog.ts): the explorer it runs in, and the milestones it reaches.
 * Nothing here changes play. What the explorer said is kept in
 * src/explorerAgent.ts, a leaf module, so anything may read it.
 */
import { executeTask } from '@dcl/sdk/ecs'
import { getExplorerInformation } from '~system/Runtime'
import { publishHello, publishMark } from './multiplayer'
import { setExplorerIdentity } from './explorerAgent'

export { clientPlatform, isGodotClient, clientKnown, markupOverTapsOk } from './explorerAgent'

const marked = new Set<string>()

export function initializeClientInfo() {
  executeTask(async () => {
    let platform = ''
    let agent = ''
    try {
      const info = await getExplorerInformation({})
      platform = info.platform || ''
      agent = info.agent || ''
    } catch (error) {
      console.log('[DG] explorer information unavailable', error)
    }
    setExplorerIdentity(platform, agent)
    console.log(`[DG] explorer ${agent || '?'} on ${platform || '?'}`)
    publishHello(platform, agent)
  })
}

/** A milestone reached this session (sent once per session; the server keeps the first time ever). */
export function markMilestone(what: string) {
  if (marked.has(what)) return
  marked.add(what)
  publishMark(what)
}
