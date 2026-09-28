/**
 * Which explorer the scene is running in, as it reported itself (filled in by
 * src/clientInfo.ts). A leaf module on purpose: it is read from the camera,
 * the menus and other modules that sit deep in import cycles, and must not
 * pull anything in itself.
 */

let platform = ''
let agent = ''

export function setExplorerIdentity(reportedPlatform: string, reportedAgent: string) {
  platform = reportedPlatform
  agent = reportedAgent
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
