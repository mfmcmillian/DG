/**
 * Moving saves between homes. Server-side storage is a drawer per scene: the
 * LAND at -17,123 and a World keep separate ones, and a scene can only open
 * its own. So the move is two steps, no website in between:
 *
 *  1. Export (old home). A developer presses "Export saves" in the dev panel;
 *     the server lists every wallet with saved values, reads all their keys
 *     and writes the lot into scene storage as `export:0`, `export:1`, ...
 *     plus `export:index`. `sdk-commands storage scene get export:N` pulls
 *     them out into data/legacy-saves.json (wallet -> key -> value).
 *
 *  2. Seed (new home). That file ships inside the deploy. The first time a
 *     wallet is looked up and it has no `hero` here yet, its entry from the
 *     file is written into this scene's drawer before anything is read.
 *     Wallets that already saved here are left alone; wallets missing from
 *     the file start fresh, as they would have anyway.
 */

import { Storage } from '@dcl/sdk/server'
import { getStorageServerUrl } from '@dcl/sdk/server/storage-url'
import { decodeUtf8 } from '@dcl/sdk/internal/utf8'
import { readFile } from '~system/Runtime'
import { signedFetch } from '~system/SignedFetch'
import { isHeadless } from './multiplayer'
import { onNet } from './net'
import { DEVELOPERS } from './shared/developers'

type Entry = Record<string, unknown>
type Saves = Record<string, Entry>

const LEGACY_FILE = 'data/legacy-saves.json'
/** Scene values may be 512 KB; chunks stay well under. */
const CHUNK_BYTES = 350_000
const PAGE = 100

// --- export --------------------------------------------------------------------------

async function listWallets(): Promise<string[]> {
  const base = await getStorageServerUrl()
  const wallets: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await signedFetch({ url: `${base}/players?limit=${PAGE}&offset=${offset}`, init: { method: 'GET', headers: {} } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} listing players`)
    const body = JSON.parse(res.body || '{}') as { data?: string[]; pagination?: { total?: number } }
    const page = body.data ?? []
    for (const w of page) wallets.push(w.toLowerCase())
    const total = body.pagination?.total ?? 0
    if (page.length < PAGE || wallets.length >= total) break
  }
  return wallets
}

async function readAll(wallet: string): Promise<Entry> {
  const entry: Entry = {}
  for (let offset = 0; ; offset += PAGE) {
    const page = await Storage.player.getValues(wallet, { limit: PAGE, offset })
    for (const { key, value } of page.data) entry[key] = value
    if (page.data.length < PAGE) break
  }
  return entry
}

let exporting = false

async function exportSaves(): Promise<string> {
  const wallets = await listWallets()
  const chunks: Saves[] = [{}]
  let size = 0
  for (const wallet of wallets) {
    const entry = await readAll(wallet)
    const bytes = JSON.stringify(entry).length + wallet.length + 8
    if (size + bytes > CHUNK_BYTES && size > 0) {
      chunks.push({})
      size = 0
    }
    chunks[chunks.length - 1][wallet] = entry
    size += bytes
  }
  for (let i = 0; i < chunks.length; i++) await Storage.set(`export:${i}`, chunks[i])
  await Storage.set('export:index', { chunks: chunks.length, players: wallets.length, when: Date.now() })
  return `${wallets.length} wallet(s) in ${chunks.length} chunk(s)`
}

/** The server side of the dev panel's "Export saves" button. */
export function initializeSaveMigration() {
  onNet('exportSaves', (_msg, context) => {
    if (!context || !isHeadless()) return
    const from = context.from.toLowerCase()
    if (!DEVELOPERS.has(from)) return
    if (exporting) {
      console.log('[Server] export already running')
      return
    }
    exporting = true
    console.log(`[Server] export of saves asked by ${from}`)
    exportSaves()
      .then((summary) => console.log(`[Server] export done: ${summary}`))
      .catch((error) => console.log('[Server] export failed', error))
      .finally(() => { exporting = false })
  })
}

// --- seed ----------------------------------------------------------------------------

let legacy: Promise<Saves> | undefined
const seeding = new Map<string, Promise<void>>()

function legacySaves(): Promise<Saves> {
  if (!legacy) {
    legacy = (async () => {
      try {
        const { content } = await readFile({ fileName: LEGACY_FILE })
        const parsed = JSON.parse(decodeUtf8(content)) as Saves
        console.log(`[Server] legacy saves on board: ${Object.keys(parsed).length} wallet(s)`)
        return parsed
      } catch {
        return {}
      }
    })()
  }
  return legacy
}

/**
 * Whether the wallet already has a hero here. Asked of the service directly:
 * Storage.player.get answers null for "absent" and for "the request failed"
 * alike, and only a confirmed absence may be seeded over.
 */
async function heroPresent(id: string): Promise<boolean | undefined> {
  const base = await getStorageServerUrl()
  const res = await signedFetch({ url: `${base}/players/${encodeURIComponent(id)}/values/hero`, init: { method: 'GET', headers: {} } })
  if (res.ok) return true
  if (res.status === 404) return false
  console.log(`[Server] could not check ${id} for a hero: ${res.status} ${res.statusText} ${res.body || ''}`.slice(0, 300))
  return undefined
}

/** Resolves true when the wallet is settled (seeded, already here, or not in the file); false when it should be tried again. */
async function seed(id: string): Promise<boolean> {
  const entry = (await legacySaves())[id]
  if (!entry) return true
  try {
    const present = await heroPresent(id)
    if (present === undefined) return false
    if (present) return true
    for (const [key, value] of Object.entries(entry)) {
      if (!(await Storage.player.set(id, key, value))) {
        console.log(`[Server] seeding ${id} stopped at ${key}; will try again on the next read`)
        return false
      }
    }
    console.log(`[Server] seeded ${id} from ${LEGACY_FILE} (${Object.keys(entry).join(', ')})`)
    return true
  } catch (error) {
    console.log(`[Server] could not seed ${id}`, error)
    return false
  }
}

/**
 * Before this scene reads a wallet's saves for the first time: if the wallet
 * has nothing here but is in the legacy file, copy the file's entry in.
 * Safe to await from every read site; it runs once per wallet per boot.
 */
export function seedLegacySave(address: string): Promise<void> {
  if (!isHeadless()) return Promise.resolve()
  const id = address.toLowerCase()
  let pending = seeding.get(id)
  if (!pending) {
    pending = seed(id).then((settled) => {
      if (!settled) seeding.delete(id)
    })
    seeding.set(id, pending)
  }
  return pending
}
