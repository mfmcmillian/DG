/**
 * Who came by, on what, and how far they got. Server only.
 *
 * A player's `visit` record in server-side storage: the explorer they arrive
 * with (`hello`, sent by the client from getExplorerInformation), how many
 * times they have come, and the first time they reached each milestone the
 * client marks (title screen shown, champion picked, a dungeon entered). It
 * answers "did the visitor on mobile get past the title?" after the fact:
 *
 *   npx sdk-commands storage player get visit --address 0x...
 *
 * The join notice (src/joinNotify.ts) reads the platform from here.
 */
import { Storage } from '@dcl/sdk/server'
import { onNet } from './net'

export type Visit = {
  /** "desktop" | "mobile" | "vr" | "web", as the explorer reports itself; '' until the client says. */
  platform: string
  agent: string
  /** Epoch ms. */
  first: number
  last: number
  visits: number
  /** Milestone -> epoch ms of the first time it was reached. */
  marks: Record<string, number>
}

const KEY = 'visit'
/** Milestones the client may mark; anything else is dropped (the message is public). */
const MARKS = new Set(['title', 'champion', 'champion-new', 'dungeon', 'raid'])

const records = new Map<string, Visit>()
const loading = new Map<string, Promise<Visit>>()
let initialized = false

export function initializeVisitLog() {
  if (initialized) return
  initialized = true
  onNet('hello', (msg, context) => {
    if (!context) return
    const platform = String(msg.platform || '').slice(0, 16)
    const agent = String(msg.agent || '').slice(0, 48)
    console.log(`[Client ${context.from}] explorer ${agent || '?'} on ${platform || '?'}`)
    void record(context.from, (v) => {
      if (v.platform === platform && v.agent === agent) return false
      v.platform = platform
      v.agent = agent
      return true
    })
  })
  onNet('mark', (msg, context) => {
    if (!context) return
    const what = String(msg.what || '')
    const base = what.split(':')[0]
    if (!MARKS.has(base)) return
    console.log(`[Client ${context.from}] reached ${what}`)
    void record(context.from, (v) => {
      if (v.marks[what]) return false
      v.marks[what] = Date.now()
      return true
    })
  })
}

/** A player walked in: another visit on their record. */
export function noteArrival(address: string) {
  void record(address, (v) => {
    v.visits += 1
    v.last = Date.now()
    return true
  })
}

/** The explorer platform the player said they are on, once their `hello` has arrived. */
export function platformOf(address: string): { platform: string; agent: string } | undefined {
  const v = records.get(address.toLowerCase())
  return v && v.platform ? { platform: v.platform, agent: v.agent } : undefined
}

async function load(address: string): Promise<Visit> {
  const id = address.toLowerCase()
  const have = records.get(id)
  if (have) return have
  let pending = loading.get(id)
  if (!pending) {
    pending = (async () => {
      let stored: Visit | undefined
      try {
        stored = (await Storage.player.get<Visit>(id, KEY)) ?? undefined
      } catch (error) {
        console.log(`[Server] could not load ${KEY} for ${id}`, error)
      }
      const now = Date.now()
      const v: Visit = {
        platform: stored?.platform ?? '', agent: stored?.agent ?? '',
        first: stored?.first ?? now, last: stored?.last ?? now, visits: stored?.visits ?? 0,
        marks: stored?.marks ?? {}
      }
      records.set(id, v)
      loading.delete(id)
      return v
    })()
    loading.set(id, pending)
  }
  return pending
}

/** Apply a change to the player's record and write it back when it changed anything. */
async function record(address: string, change: (v: Visit) => boolean) {
  const id = address.toLowerCase()
  const v = await load(id)
  if (!change(v)) return
  try {
    await Storage.player.set(id, KEY, v)
  } catch (error) {
    console.log(`[Server] could not save ${KEY} for ${id}`, error)
  }
}
