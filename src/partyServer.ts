// Host-side parties, runs and saved heroes. Runs on the headless server, and
// on a client that hosts its own fight (solo fallback), where every message
// loops back locally. Clients mirror the `parties` broadcast in party.ts.
//
// A party is a group of up to four heroes. In the hub it is `open`: members
// come and go, the leader picks a level and difficulty. `start` hands it a
// simulation of that level (dungeonEnemies.createRunSim) and the party is
// `running` until the Warlord falls or every member is down at once. It is
// then `done`: the party stands in the cleared fortress with the results up
// and decides where to go. The leader can `descend` to the next level or
// `retry` this one once everyone is ready again, or send everyone back to
// the `hall` (state `open`); left alone long enough, the host does that.

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { MAX_COMBAT_HEALTH } from './combatActions'
import { createRunSim, destroyRunSim, runStatus } from './dungeonEnemies'
import { healHero, heroHealth, RAID_RECOVER_SECONDS, RECOVER_SECONDS, reviveHero, setRecoverPolicy } from './heroVitals'
import { addXp, setXpRecord, xpRecordOf } from './heroXp'
import { heroCharacters, isHeadless, onHostStart, setMultiplayerHandlers } from './multiplayer'
import { onNet, sendNet } from './net'
import { HUB, setPartyLookup } from './partyLookup'
import {
  DIFFICULTIES, difficultyById, LevelDefinition, LEVELS, levelUnlocked, MAX_PARTY, MAX_RAID, nextLevel, previousLevel, RAID_LEVEL, RAID_PARTY
} from './shared/levels'
import { initializeColossusServer } from './raid/colossusServer'
import { clearXp, killXp, XpRecord } from './shared/progression'
import { prefsHaveDevTools, prefsOpenAll } from './shared/prefs'

type PartyState = 'open' | 'running' | 'done'

type Party = {
  id: string
  leader: string
  level: number
  diff: number
  state: PartyState
  members: string[]
  ready: Set<string>
  /** `elapsed` when the run started / ended. */
  started: number
  ended: number
  slain: number
  total: number
  won: boolean
  /** Runs this party has started; clients key their dungeon rebuild on it. */
  run: number
}

type SavedHero = {
  cid: string; body: string; hair: string; hc: string; skin: string
  loadout: string; coins: number; unlocks: string[]; prefs?: string
}

/** How long the party may stand on the results before the host walks it back to the hall. */
const DECISION_SECONDS = 120
const BROADCAST_SECONDS = 3

const parties = new Map<string, Party>()
const heroes = new Map<string, SavedHero>()
const progress = new Map<string, number[]>()
/** Wallets whose experience is loaded into src/heroXp.ts; those with unsaved gains. */
const xpLoaded = new Set<string>()
const xpDirty = new Set<string>()
const XP_SAVE_SECONDS = 8
let xpSaveAge = 0
let elapsed = 0
let broadcastAge = 0
let counter = 0
let initialized = false

export function initializePartyServer() {
  if (initialized) return
  initialized = true
  onHostStart(bind)
}

function bind() {
  if (isHeadless()) setPartyLookup(phaseOf)
  onNet('party', (msg, context) => {
    if (!context) return
    handleAction(context.from.toLowerCase(), msg.action, msg.party, msg.level, msg.diff)
  })
  onNet('saveHero', (msg, context) => {
    if (!context) return
    const id = context.from.toLowerCase()
    const hero: SavedHero = {
      cid: msg.cid, body: msg.body, hair: msg.hair, hc: msg.hc, skin: msg.skin,
      loadout: msg.loadout, coins: msg.coins, unlocks: [...msg.unlocks], prefs: msg.prefs
    }
    heroes.set(id, hero)
    void persist(id, 'hero', hero)
  })
  onNet('loadHero', (_msg, context) => {
    if (!context) return
    void answerLoad(context.from)
  })
  setMultiplayerHandlers({ leave: leaveParty })
  engine.addSystem(update)
  ensureRaid()
  // A hero who falls in the Pit waits for an ally; elsewhere the entrance takes them quickly.
  setRecoverPolicy((id) => (parties.get(RAID_PARTY)?.members.includes(id) ? RAID_RECOVER_SECONDS : RECOVER_SECONDS))
  initializeColossusServer({
    members: () => parties.get(RAID_PARTY)?.members ?? [],
    awardXp: (id, amount) => awardXp(id, amount, 'clear'),
    saveXp: saveDirtyXp
  })
  console.log('[Server] party registry ready')
}

/**
 * The raid party: one per realm, always `running` on the arena, no leader, no
 * readiness. Heroes drop in from the hall's circle and leave the same way;
 * it never disbands and never reaches a verdict (the Colossus has its own,
 * in src/raid/colossusServer.ts).
 */
function ensureRaid() {
  if (parties.has(RAID_PARTY)) return
  const party: Party = {
    id: RAID_PARTY, leader: '', level: RAID_LEVEL.id, diff: 0, state: 'running',
    members: [], ready: new Set(), started: elapsed, ended: 0, slain: 0, total: 0, won: false, run: 1
  }
  parties.set(RAID_PARTY, party)
  createRunSim(RAID_PARTY, RAID_LEVEL.id, 0)
}

// --- saved heroes ------------------------------------------------------------------

async function persist(id: string, key: string, value: unknown) {
  if (!isHeadless()) return // Storage only exists on the headless server; solo keeps the session copy.
  try {
    await Storage.player.set(id, key, value)
  } catch (error) {
    console.log(`[Server] could not save ${key} for ${id}`, error)
  }
}

async function fetch<T>(id: string, key: string): Promise<T | undefined> {
  if (!isHeadless()) return undefined
  try {
    const value = await Storage.player.get<T>(id, key)
    return value ?? undefined
  } catch (error) {
    console.log(`[Server] could not load ${key} for ${id}`, error)
    return undefined
  }
}

async function progressOf(id: string): Promise<number[]> {
  let p = progress.get(id)
  if (!p) {
    p = (await fetch<number[]>(id, 'progress')) ?? []
    progress.set(id, p)
  }
  return p
}

async function xpOf(id: string): Promise<XpRecord> {
  if (!xpLoaded.has(id)) {
    xpLoaded.add(id)
    setXpRecord(id, (await fetch<XpRecord>(id, 'xp')) ?? {})
  }
  return xpRecordOf(id)
}

/** The champion a wallet is playing right now: the synced body first, the save as a fallback. */
function championOf(id: string): string {
  return heroCharacters((owner) => owner === id)[0] ?? heroes.get(id)?.cid ?? ''
}

/** Award experience to whichever champion the wallet is playing and tell the room. */
function awardXp(id: string, amount: number, why: 'kill' | 'clear') {
  if (amount <= 0 || !xpLoaded.has(id)) return
  const cid = championOf(id)
  if (!cid) return
  const xp = addXp(id, cid, amount)
  xpDirty.add(id)
  sendNet('xp', { id, cid, xp, gained: Math.round(amount), why })
}

/** Where a wallet's champions stand, told to `to` (or the whole room). */
function tellXp(id: string, to?: string[]) {
  for (const [cid, xp] of Object.entries(xpRecordOf(id))) {
    sendNet('xp', { id, cid, xp, gained: 0, why: '' }, to ? { to } : undefined)
  }
}

function saveDirtyXp() {
  for (const id of xpDirty) void persist(id, 'xp', xpRecordOf(id))
  xpDirty.clear()
}

async function answerLoad(from: string) {
  const id = from.toLowerCase()
  let hero = heroes.get(id)
  if (!hero) {
    hero = await fetch<SavedHero>(id, 'hero')
    if (hero) heroes.set(id, hero)
  }
  const p = await progressOf(id)
  const xp = await xpOf(id)
  sendNet('savedHero', {
    id,
    found: !!hero,
    cid: hero?.cid ?? '',
    body: hero?.body ?? '',
    hair: hero?.hair ?? '',
    hc: hero?.hc ?? '',
    skin: hero?.skin ?? '',
    loadout: hero?.loadout ?? '',
    coins: hero?.coins ?? 0,
    unlocks: hero?.unlocks ?? [],
    prefs: hero?.prefs ?? '',
    progress: p,
    xp: JSON.stringify(xp)
  }, { to: [from] })
  // The room learns this wallet's levels; the newcomer learns everyone else's.
  tellXp(id)
  for (const other of xpLoaded) if (other !== id) tellXp(other, [from])
  console.log(`[Server] hero load for ${id}: ${hero ? `found (${hero.cid})` : 'nothing saved'}`)
}

async function recordClear(id: string, level: number, diff: number) {
  const p = [...(await progressOf(id))]
  while (p.length < LEVELS.length) p.push(0)
  p[level] = Math.max(p[level] ?? 0, diff + 1)
  progress.set(id, p)
  await persist(id, 'progress', p)
  sendNet('progress', { id, progress: p })
}

// --- parties -------------------------------------------------------------------------

/** The phase an address is in: its party while that party is fighting or showing results, else the hub. */
function phaseOf(id: string): string {
  const party = partyOfMember(id)
  return party && party.state !== 'open' ? party.id : HUB
}

function partyOfMember(id: string): Party | undefined {
  for (const party of parties.values()) if (party.members.includes(id)) return party
  return undefined
}

function clampLevel(id: string, level: number): number {
  const wanted = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(level) || 0))
  const prefs = heroes.get(id)?.prefs
  // Developer tools (or the older open-all switch) skip the progress gate; they do not write fake clears.
  if (prefsHaveDevTools(prefs) || prefsOpenAll(prefs)) return wanted
  const p = progress.get(id) ?? []
  for (let l: LevelDefinition | undefined = LEVELS[wanted]; l; l = previousLevel(l.id)) if (levelUnlocked(p, l.id)) return l.id
  return 0
}

function clampDiff(diff: number): number {
  return Math.max(0, Math.min(DIFFICULTIES.length - 1, Math.floor(diff) || 0))
}

function handleAction(id: string, action: string, partyId: string, level: number, diff: number) {
  switch (action) {
    case 'create': {
      leaveParty(id, false)
      counter++
      const party: Party = {
        id: `p${counter}`, leader: id, level: clampLevel(id, level), diff: clampDiff(diff), state: 'open',
        members: [id], ready: new Set([id]), started: 0, ended: 0, slain: 0, total: 0, won: false, run: 0
      }
      parties.set(party.id, party)
      console.log(`[Server] party ${party.id} created by ${id}`)
      break
    }
    case 'join': {
      const party = parties.get(partyId)
      if (!party || party.state !== 'open' || party.members.length >= MAX_PARTY) return
      if (party.members.includes(id)) return
      leaveParty(id, false)
      party.members.push(id)
      // Joining is the pick; the leader still has to start.
      party.ready.add(id)
      break
    }
    case 'leave':
      leaveParty(id, false)
      break
    case 'raid': {
      ensureRaid()
      const raid = parties.get(RAID_PARTY)!
      if (raid.members.includes(id) || raid.members.length >= MAX_RAID) return
      leaveParty(id, false)
      raid.members.push(id)
      restoreHero(id)
      console.log(`[Server] ${id} descends to the Pit (${raid.members.length} inside)`)
      break
    }
    case 'ready':
    case 'unready': {
      const party = partyOfMember(id)
      if (!party) return
      if (action === 'ready') party.ready.add(id)
      else party.ready.delete(id)
      break
    }
    case 'set': {
      const party = partyOfMember(id)
      if (!party || party.leader !== id || party.state !== 'open') return
      party.level = clampLevel(id, level)
      party.diff = clampDiff(diff)
      break
    }
    case 'start': {
      const party = partyOfMember(id)
      if (!party || party.leader !== id || party.state !== 'open') return
      if (!everyoneReady(party)) return
      beginRun(party)
      break
    }
    // The results screen's three ways out. `descend` and `retry` need the
    // party ready again, like `start`; the leader's click counts as theirs.
    case 'descend': {
      const party = partyOfMember(id)
      if (!party || party.leader !== id || party.state !== 'done' || !party.won) return
      const next = nextLevel(party.level)
      if (!next) return
      party.ready.add(id)
      if (!everyoneReady(party)) return
      // The party just cleared the level below, so the next one is open by
      // definition; no clamp against progress that may still be persisting.
      party.level = next.id
      beginRun(party)
      break
    }
    case 'retry': {
      const party = partyOfMember(id)
      if (!party || party.leader !== id || party.state !== 'done') return
      party.ready.add(id)
      if (!everyoneReady(party)) return
      beginRun(party)
      break
    }
    case 'hall': {
      const party = partyOfMember(id)
      if (!party || party.leader !== id || party.state !== 'done') return
      returnToHall(party)
      break
    }
    default:
      return
  }
  broadcast()
}

/** Everyone in, or nobody goes: a member still browsing would be pulled into a fight they did not pick. */
function everyoneReady(party: Party): boolean {
  return party.members.every((m) => party.ready.has(m))
}

function beginRun(party: Party) {
  destroyRunSim(party.id)
  party.state = 'running'
  party.started = elapsed
  party.slain = 0
  party.won = false
  party.run++
  // Everyone walks in at full health, whatever the last run left them with.
  for (const m of party.members) restoreHero(m)
  createRunSim(party.id, party.level, party.diff)
  party.total = runStatus(party.id)?.total ?? 0
  console.log(`[Server] party ${party.id} started level ${party.level + 1} (${DIFFICULTIES[party.diff].name}) with ${party.members.length} hero(es), run ${party.run}`)
}

/** Back to the hall as an open party, with the next level picked if this one was cleared. */
function returnToHall(party: Party) {
  destroyRunSim(party.id)
  party.state = 'open'
  party.ready = new Set(party.members)
  // Back in the hall on their feet; a fallen party is not still down at the bar.
  for (const m of party.members) restoreHero(m)
  const next = party.won ? nextLevel(party.level) : undefined
  if (next) party.level = clampLevel(party.leader, next.id)
}

/** Full health, up if down; the ledger broadcasts whichever it did. */
function restoreHero(id: string) {
  if (heroHealth(id) <= 0) reviveHero(id)
  else healHero(id, MAX_COMBAT_HEALTH)
}

function leaveParty(id: string, announce = true) {
  const party = partyOfMember(id)
  if (!party) return
  party.members = party.members.filter((m) => m !== id)
  party.ready.delete(id)
  // Walking out of a fight (or its results) lands in the hall on your feet.
  if (party.state !== 'open') restoreHero(id)
  if (party.id === RAID_PARTY) {
    // The arena stays; the Colossus notices on its own.
  } else if (party.members.length === 0) {
    destroyRunSim(party.id)
    parties.delete(party.id)
    console.log(`[Server] party ${party.id} disbanded`)
  } else if (party.leader === id) {
    party.leader = party.members[0]
  }
  if (announce) broadcast()
}

function finishRun(party: Party, won: boolean) {
  party.state = 'done'
  party.ended = elapsed
  party.won = won
  // Going deeper is a fresh pick for every member; the leader's click counts as theirs.
  party.ready = new Set()
  console.log(`[Server] party ${party.id} ${won ? 'cleared' : 'fell in'} level ${party.level + 1} after ${(elapsed - party.started).toFixed(0)}s`)
  if (won) {
    const level = LEVELS[party.level]
    const diff = difficultyById(party.diff)
    for (const member of party.members) {
      // A first clear at this difficulty pays double; the clear itself is recorded after.
      const first = (progress.get(member)?.[party.level] ?? 0) < party.diff + 1
      if (level) awardXp(member, clearXp(level, diff, first), 'clear')
      void recordClear(member, party.level, party.diff)
    }
  }
  saveDirtyXp()
  broadcast()
}

function update(deltaTime: number) {
  const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0
  elapsed += dt
  xpSaveAge += dt
  if (xpSaveAge >= XP_SAVE_SECONDS && xpDirty.size) {
    xpSaveAge = 0
    saveDirtyXp()
  }
  let changed = false
  for (const party of parties.values()) {
    if (party.id === RAID_PARTY) continue
    if (party.state === 'running') {
      const status = runStatus(party.id)
      if (!status) continue
      if (status.slain !== party.slain || status.total !== party.total) {
        // Every member earns each kill, whoever landed it: tanks and archers alike.
        const level = LEVELS[party.level]
        const fresh = status.slain - party.slain
        if (level && fresh > 0) {
          const each = killXp(level, difficultyById(party.diff)) * fresh
          for (const member of party.members) awardXp(member, each, 'kill')
        }
        party.slain = status.slain
        party.total = status.total
        changed = true
      }
      if (status.won) finishRun(party, true)
      else if (status.lost) finishRun(party, false)
    } else if (party.state === 'done' && elapsed - party.ended >= DECISION_SECONDS) {
      // Nobody decided; the host walks the party back to the hall.
      console.log(`[Server] party ${party.id} idled on the results, back to the hall`)
      returnToHall(party)
      changed = true
    }
  }
  broadcastAge += dt
  if (changed || broadcastAge >= BROADCAST_SECONDS) broadcast()
}

function broadcast() {
  broadcastAge = 0
  sendNet('parties', {
    list: [...parties.values()].map((p) => ({
      id: p.id, leader: p.leader, level: p.level, diff: p.diff, state: p.state,
      members: [...p.members], ready: [...p.ready],
      time: p.state === 'open' ? 0 : (p.state === 'done' ? p.ended : elapsed) - p.started,
      slain: p.slain, total: p.total, won: p.won, run: p.run,
      wait: p.state === 'done' ? Math.max(0, DECISION_SECONDS - (elapsed - p.ended)) : 0
    }))
  })
}
