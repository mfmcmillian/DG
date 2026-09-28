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

/**
 * The Godot explorer: the mobile app (and its desktop builds). It differs from
 * the Unity client in ways the scene works around; each workaround names the
 * difference where it is applied. False until the explorer has answered.
 */
export function isGodotClient(): boolean {
  return agent.toLowerCase() === 'godot'
}

/** Whether the explorer has said what it is yet (it answers within the first few ticks). */
export function clientKnown(): boolean {
  return agent !== '' || platform !== ''
}

/**
 * Whether text markup (`<b>…</b>`) may sit on top of something tappable. The
 * Godot client draws marked-up text with a RichTextLabel, which swallows
 * touches, so a bold caption laid over a button eats the tap meant for the
 * button; plain text lets it through. A label that has once been rich stays
 * rich there, so this is decided before the first draw and an unknown client
 * is treated as Godot.
 */
export function markupOverTapsOk(): boolean {
  return agent !== '' && !isGodotClient()
}

/** A milestone reached this session (sent once per session; the server keeps the first time ever). */
export function markMilestone(what: string) {
  if (marked.has(what)) return
  marked.add(what)
  publishMark(what)
}
