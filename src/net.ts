// The one door to the room. Every game message goes out through `sendNet` and
// every handler comes in through `onNet`, so the same code runs in three ways:
// on the headless server, on a client talking to it, and — when the server
// never answers — on a client that hosts its own fight. In that solo mode a
// message is not sent anywhere: it is handed straight to the handlers this
// same runtime registered, server ones included, as if it had come back over
// the wire from ourselves.

import { EventTypes } from '@dcl/sdk/network/events/registry'
import { Messages, room } from './shared/messages'

type Name = keyof typeof Messages
type Payload<K extends Name> = EventTypes<typeof Messages>[K]
type Context = { from: string }
type Handler<K extends Name> = (msg: Payload<K>, context?: Context) => void

let solo = false
let soloAddress = ''
const local = new Map<Name, Handler<Name>[]>()

/** From now on messages loop back locally; `address` is who they are from. */
export function enterSolo(address: string) {
  solo = true
  soloAddress = address
}

export function isSolo(): boolean {
  return solo
}

export function onNet<K extends Name>(type: K, handler: Handler<K>) {
  room.onMessage(type, handler)
  const list = local.get(type) ?? []
  list.push(handler as Handler<Name>)
  local.set(type, list)
}

/** `to` (server only) narrows the recipients to those addresses; solo has only ourselves anyway. */
export function sendNet<K extends Name>(type: K, msg: Payload<K>, options?: { to?: string[] }) {
  if (!solo) {
    void room.send(type, msg, options)
    return
  }
  const handlers = local.get(type)
  if (!handlers) return
  const context = { from: soloAddress }
  for (const handler of [...handlers]) handler(msg, context)
}
