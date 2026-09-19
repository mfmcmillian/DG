// Client-side view of the SDK's network handshake. The Explorer keeps scene
// logs to itself, so the recent console lines are kept here for the HUD, the
// SDK's own network debug output is switched on, and a state request is
// re-sent by hand while the sync has not completed (the SDK's retry stalls if
// a reply it does not accept clears its pending flag).

import { engine, RealmInfo } from '@dcl/sdk/ecs'
import { binaryMessageBus, isStateSyncronized, myProfile } from '@dcl/sdk/network'
import { CommsMessage } from '@dcl/sdk/network/binary-message-bus'

const MAX_LINES = 14
const NUDGE_SECONDS = 3
const lines: string[] = []
let nudgeAge = 0
let nudges = 0
let installed = false

function record(level: string, args: unknown[]) {
  const text = args.map((a) => {
    if (typeof a === 'string') return a
    if (a instanceof Error) return a.message
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
  lines.push(`${level}${text}`.slice(0, 170))
  if (lines.length > MAX_LINES) lines.shift()
}

export function installNetDebug() {
  if (installed) return
  installed = true
  ;(globalThis as { DEBUG_NETWORK_MESSAGES?: boolean }).DEBUG_NETWORK_MESSAGES = true
  const log = console.log.bind(console)
  const error = console.error.bind(console)
  console.log = (...args: unknown[]) => { record('', args); log(...args) }
  console.error = (...args: unknown[]) => { record('ERR ', args); error(...args) }
  engine.addSystem(nudgeStateRequest)
}

/** Ask the server for its state ourselves while the SDK has not got it. */
function nudgeStateRequest(dt: number) {
  if (isStateSyncronized()) return
  nudgeAge += Number.isFinite(dt) && dt > 0 ? dt : 0
  if (nudgeAge < NUDGE_SECONDS) return
  nudgeAge = 0
  if (!RealmInfo.getOrNull(engine.RootEntity)?.isConnectedSceneRoom) return
  nudges++
  binaryMessageBus.emit(CommsMessage.REQ_CRDT_STATE, new Uint8Array())
  console.log(`[DG] state request #${nudges} sent by hand; profile ${myProfile.userId ? 'known' : 'pending'}`)
}

export function recentLogs(): readonly string[] {
  return lines
}

export function netDebugSummary(): string {
  return `nudges ${nudges} | profile ${myProfile.userId ? 'known' : 'pending'}`
}
