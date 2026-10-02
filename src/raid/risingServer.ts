// The Rising, on the headless host: Saturdays 9:15 PM ET everyone who signed
// up is walked into the Barrow Yard together and the Demon climbs out of the
// ritual circle, grown to the crowd. Sign-ups open a day before (kept in world
// Storage so a restart keeps the list), the sheet becomes the lobby a quarter
// hour before, latecomers press Join until 10 PM. Raid rules: a downed hero is
// raised by an ally standing over them for three seconds, or stands up alone
// after thirty; the whole party down is a wipe and everyone walks back to the
// hall, free to come again while the gate is open. A win pays embers and raid
// loot to everyone in the arena and flips the week's wearable live for the
// whole server. Dev wallets may open a test arena at any hour.
//
// The party, the sim and the Demon's brain belong to partyServer/dungeonEnemies;
// this file is the clock, the roster and the verdict.

import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { holdRun, runBoss, runStatus, tuneRunBoss } from '../dungeonEnemies'
import { weaponPoolFor } from '../heroClasses'
import { heroDownFor, reviveHero } from '../heroVitals'
import { metricsHeroCount, metricsMark } from '../metrics'
import { allFighters, heroCharacters, heroPosition, NetFighter } from '../multiplayer'
import { sendNet } from '../net'
import { awardXpTo, ensureRising, inOtherRun, risingAdd, risingDisband, risingLeave, risingMembers } from '../partyServer'
import { newGearUid } from '../shared/gearBag'
import {
  GW_RISING_FIGHT_EMBERS, GW_RISING_OPEN_MS, GW_RISING_UNLOCKS, GW_RISING_WIN_EMBERS, GwRisingPhase, risingAt, risingBossHp, risingDamageMult, risingKey
} from '../shared/gravewatch'
import { RISING_PARTY } from '../shared/levels'
import { rollRaidDrop } from '../weapons'

type Hooks = {
  credit: (id: string, amount: number, why: string) => void
  /** The week's wearable is live for everyone. */
  won: (item: 'w1' | 'w2' | 'w3') => void
  isGuest: (id: string) => boolean
  isDev: (id: string) => boolean
  /** Push a fresh sheet to one client. */
  tell: (id: string) => void
  /** A piece of armor at the hero's feet, rolled as a boss drop. */
  rewardGear: (id: string, x: number, z: number, source: 'elite' | 'boss') => void
}

type Record_ = { signed: string[]; result: '' | 'won'; winners?: string[] }

/** The Demon wakes this long after the move. */
const WAKE_SECONDS = 30
/** The fallen see the wipe for this long before the walk back. */
const WIPE_SECONDS = 5
/** The slain Demon lies there this long before the arena empties. */
const AFTER_WIN_SECONDS = 25
/** A dev test arena closes once it has stood empty this long. */
const TEST_EMPTY_SECONDS = 90
const REVIVE_SECONDS = 3
const REVIVE_RADIUS = 2.4
const XP_WIN = 320

let hooks: Hooks | undefined
/** The Rising whose list is loaded: its start and the signed wallets. */
let start = 0
let signed = new Set<string>()
let result: '' | 'won' = ''
let loaded = false
let loadingFor = -1
/** Whether the mass move for `start` has been done (once per Rising, restart included: a restart during the fight moves again). */
let moved = false
/** Everyone who stood in the arena this Rising (the fight embers are theirs once, win or lose). */
const fought = new Set<string>()
const paidFight = new Set<string>()
let wipeIn = 0
let winIn = 0
let lastCrowd = -1
let emptyFor = 0
/** A dev's out-of-hours arena. */
let testing = false
const revive = new Map<string, number>()
let announced: GwRisingPhase | '' = ''

export function initializeRisingServer(h: Hooks) {
  hooks = h
  engine.addSystem(update)
  console.log('[Rising] the clock is set')
}

// --- the list ----------------------------------------------------------------------------------

async function load(forStart: number) {
  if (loadingFor === forStart) return
  loadingFor = forStart
  let stored: Record_ | undefined
  try {
    stored = forStart > 0 ? ((await Storage.get<Record_>(risingKey(forStart))) ?? undefined) : undefined
  } catch (error) {
    console.log('[Rising] could not read the list', error)
  }
  if (loadingFor !== forStart) return
  start = forStart
  signed = new Set(stored?.signed ?? [])
  result = stored?.result ?? ''
  moved = false
  fought.clear()
  paidFight.clear()
  loaded = true
  console.log(`[Rising] ${forStart > 0 ? new Date(forStart).toISOString() : 'no Rising ahead'}: ${signed.size} signed up${result ? `, ${result}` : ''}`)
}

async function save(winners?: string[]) {
  if (start <= 0) return
  try {
    const record: Record_ = { signed: [...signed], result }
    if (winners) record.winners = winners
    await Storage.set(risingKey(start), record)
  } catch (error) {
    console.log('[Rising] could not save the list', error)
  }
}

// --- the clock ---------------------------------------------------------------------------------

function arenaOpen(): boolean {
  return risingMembers().length > 0 || runStatus(RISING_PARTY) !== undefined
}

function update(dt: number) {
  if (!hooks) return
  const now = Date.now()
  const at = risingAt(now)
  if (!loaded || at.start !== start) {
    if (loadingFor !== at.start) void load(at.start)
    if (!loaded) return
  }
  if (at.phase !== announced) {
    announced = at.phase
    console.log(`[Rising] phase ${at.phase}`)
  }

  // 9:15: the move. Everyone signed up who stands in the hall (or in an open party) goes in together.
  if (at.phase === 'fight' && !moved && result !== 'won') {
    moved = true
    const comers = [...signed].filter((id) => heroPosition(id) !== undefined && !inOtherRun(id))
    ensureRising(Math.max(signed.size, comers.length))
    for (const id of comers) risingAdd(id)
    holdRun(RISING_PARTY, WAKE_SECONDS)
    for (const id of comers) fought.add(id)
    console.log(`[Rising] begins: ${comers.length} of ${signed.size} signed heroes walked into the yard`)
    for (const id of comers) hooks.tell(id)
  }

  // 10 PM: the gate shuts. Whoever is still inside fought.
  if (at.phase !== 'fight' && !testing && arenaOpen()) {
    close('the gate shuts')
    return
  }

  if (!arenaOpen()) return
  const members = risingMembers()
  for (const id of members) fought.add(id)

  // The Demon grows and shrinks with the crowd.
  if (members.length !== lastCrowd && members.length > 0) {
    lastCrowd = members.length
    tuneRunBoss(RISING_PARTY, risingBossHp(members.length), risingDamageMult(members.length))
  }

  // A test arena that stands empty closes on its own.
  if (testing) {
    emptyFor = members.length === 0 ? emptyFor + dt : 0
    if (emptyFor >= TEST_EMPTY_SECONDS) {
      close('the test arena stood empty')
      return
    }
  }

  const fighters = allFighters().filter((f) => members.includes(f.address))
  tendDowned(dt, fighters)

  const status = runStatus(RISING_PARTY)
  if (!status) return
  if (winIn > 0) {
    winIn -= dt
    if (winIn <= 0) {
      winIn = 0
      close('the Demon is slain')
    }
    return
  }
  if (status.won) {
    win(members, fighters)
    return
  }
  if (wipeIn > 0) {
    wipeIn -= dt
    if (wipeIn <= 0) {
      wipeIn = 0
      for (const id of members) if (heroDownFor(id) !== undefined) reviveHero(id, true)
      risingDisband()
      lastCrowd = -1
      revive.clear()
      console.log('[Rising] the party has fallen; the yard is empty again')
      for (const id of members) hooks.tell(id)
    }
    return
  }
  if (status.lost) {
    wipeIn = WIPE_SECONDS
    notice(members, 'THE PARTY HAS FALLEN')
    for (const id of members) metricsMark(id, 'rising-wipe')
    console.log('[Rising] wipes the party')
  }
}

/** Pay the fight embers to everyone who stood in the arena, once per Rising. */
function payFight(why: string) {
  if (!hooks || testing) return
  for (const id of fought) {
    if (paidFight.has(id)) continue
    paidFight.add(id)
    hooks.credit(id, GW_RISING_FIGHT_EMBERS, why)
  }
}

function win(members: string[], fighters: NetFighter[]) {
  if (!hooks) return
  const boss = runBoss(RISING_PARTY)
  console.log(`[Rising] ${boss?.name ?? 'the Demon'} is slain by ${members.length} heroes`)
  notice(members, `${(boss?.name ?? 'THE DEMON').toUpperCase()} IS SLAIN`)
  const cids = heroCharacters((owner) => members.includes(owner))
  const pool = weaponPoolFor(cids)
  for (const id of members) {
    metricsMark(id, 'rising-win')
    metricsHeroCount(id, 'raidClears')
    if (!testing) {
      hooks.credit(id, GW_RISING_WIN_EMBERS, 'the Rising won')
      awardXpTo(id, XP_WIN)
    }
    const mine = heroCharacters((owner) => owner === id)
    const { id: item, up } = rollRaidDrop(mine.length ? weaponPoolFor(mine) : pool)
    const f = fighters.find((x) => x.address === id)
    const at = f ? f.position : heroPosition(id) ?? { x: 85, z: 96 }
    sendNet('loot', { party: RISING_PARTY, x: at.x, z: at.z, coin: 60, heart: 1, item, boss: true, up, uid: item ? newGearUid() : '' }, { to: [id] })
    hooks.rewardGear(id, at.x + 0.6, at.z - 0.6, 'boss')
  }
  for (const id of members) if (heroDownFor(id) !== undefined) reviveHero(id, true)
  if (!testing) {
    payFight('the Rising fought')
    result = 'won'
    void save(members)
    const item = GW_RISING_UNLOCKS[start]
    if (item) hooks.won(item)
  }
  winIn = AFTER_WIN_SECONDS
  for (const id of members) hooks.tell(id)
}

/** Everyone out, the arena gone; the next Join (while the gate is open) raises a fresh Demon. */
function close(why: string) {
  if (!hooks) return
  const members = risingMembers()
  for (const id of members) if (heroDownFor(id) !== undefined) reviveHero(id, true)
  if (!testing) payFight('the Rising fought')
  risingDisband()
  testing = false
  wipeIn = 0
  winIn = 0
  lastCrowd = -1
  emptyFor = 0
  revive.clear()
  console.log(`[Rising] closed: ${why}`)
  for (const id of members) hooks.tell(id)
}

function notice(to: string[], text: string) {
  if (to.length) sendNet('gwNote', { text }, { to })
}

// --- downed heroes (the raid's rule) -------------------------------------------------------

function tendDowned(dt: number, fighters: NetFighter[]) {
  const down: string[] = []
  for (const f of fighters) {
    const id = f.address
    if (heroDownFor(id) === undefined) {
      revive.delete(id)
      continue
    }
    down.push(id)
    let helped = false
    for (const other of fighters) {
      if (other.address === id || other.health <= 0) continue
      const dx = other.position.x - f.position.x
      const dz = other.position.z - f.position.z
      if (dx * dx + dz * dz < REVIVE_RADIUS * REVIVE_RADIUS) {
        helped = true
        break
      }
    }
    const k = revive.get(id) ?? 0
    const next = helped ? k + dt / REVIVE_SECONDS : Math.max(0, k - dt / 1.5)
    if (next >= 1) {
      revive.delete(id)
      reviveHero(id, true)
      notice([id], 'Raised')
    } else revive.set(id, next)
  }
  for (const id of [...revive.keys()]) if (!down.includes(id)) revive.delete(id)
}

// --- the sheet -----------------------------------------------------------------------------------

export function risingSnapshot(id: string, now: number): { start: number; phase: GwRisingPhase; signed: number; signedUp: boolean; arena: number } {
  const at = risingAt(now)
  const members = risingMembers()
  let phase: GwRisingPhase = at.phase
  if (testing && arenaOpen()) phase = 'fight'
  else if (at.phase === 'fight' && result === 'won') phase = 'closed'
  return { start: at.start, phase, signed: signed.size, signedUp: signed.has(id), arena: members.length }
}

/** sign up / unsign / join / leave; the short reason when refused, '' when done. */
export function risingAct(id: string, what: string): string {
  if (!hooks) return ''
  const at = risingAt(Date.now())
  switch (what) {
    case 'signup':
      if (at.phase !== 'signup' && at.phase !== 'lobby') return 'closed'
      if (signed.has(id)) return ''
      signed.add(id)
      metricsMark(id, 'rising-signup')
      void save()
      return 'signed'
    case 'unsign':
      if (!signed.delete(id)) return ''
      void save()
      return ''
    case 'join': {
      const dev = hooks.isDev(id)
      if (at.phase !== 'fight' && !dev) return 'closed'
      if (at.phase === 'fight' && result === 'won') return 'won'
      if (inOtherRun(id)) return 'busy'
      if (!arenaOpen()) {
        testing = at.phase !== 'fight'
        ensureRising(Math.max(signed.size, 1))
        holdRun(RISING_PARTY, testing ? 10 : WAKE_SECONDS)
        lastCrowd = -1
        emptyFor = 0
        console.log(`[Rising] ${testing ? 'a test arena' : 'the arena'} opens for ${id}`)
      }
      if (!risingAdd(id)) return ''
      if (!testing) fought.add(id)
      return 'joined'
    }
    case 'leave':
      risingLeave(id)
      return ''
    default:
      return ''
  }
}

/** For the server logs. */
export function risingStatus(): string {
  const boss = runBoss(RISING_PARTY)
  return `${risingAt(Date.now()).phase}${testing ? ' (test)' : ''}, ${signed.size} signed, ${risingMembers().length} in the yard${boss ? `, ${boss.name} ${boss.health}/${boss.max}` : ''}`
}
