/**
 * What happened today, counted. Server only.
 *
 * Two records in scene storage. `metrics:day:YYYY-MM-DD` is the full day: who
 * came (address -> platform) and every counter below. `metrics:summary` is the
 * same counters for every day without the addresses, one document the report
 * reads with a single signed call:
 *
 *   node tools/metrics-report.mjs
 *
 * The counters are incremented by the server as things happen, so most of them
 * cannot be inflated by a client; the exceptions (title, play, champion, and the
 * pit result, which the client reports) are first-time milestones on the
 * player's own record and count once per wallet. Per-player facts (active days,
 * sessions, seconds, milestones) live on the `visit` record in src/visitLog.ts;
 * this file holds the day's totals and derives what a program asks about from
 * both: uniques, new vs returning, sessions and their length, retention by age
 * since first visit, the funnel, runs and raids, deaths, XP, upgrades, loot.
 *
 * Everyone counts, developers included: a test session is a session, and the
 * day record names who came, so a report can leave any wallet out afterwards.
 * Days are UTC.
 */

import { engine } from '@dcl/sdk/ecs'
import { EnvVar, Storage } from '@dcl/sdk/server'
import { GAME_VERSION } from './version'
import { updateVisit } from './visitLog'

const SUMMARY_KEY = 'metrics:summary'
const DAY_PREFIX = 'metrics:day:'
/**
 * The dashboard on the website reads the summary from here; the server posts
 * it after each write, signed with the METRICS_KEY server environment
 * variable (`npx sdk-commands storage env set METRICS_KEY --value …`), which
 * the site holds too. No key, no post: the counters still land in storage.
 */
const DASHBOARD_URL = 'https://decentracraft-nine.vercel.app/api/metrics'
/** How many days the dashboard is sent; it draws at most a quarter. */
const PUSH_DAYS = 180
/** How many days the summary keeps; older ones stay in their own day records. */
const SUMMARY_DAYS = 400
/** How long a player can be gone and still be on the same session when they come back. */
const SESSION_GAP_MS = 30 * 60 * 1000
/** A player who saw the title, never pressed Play, and left inside this many seconds bounced. */
const BOUNCE_SECONDS = 180
/** Counters are written this often while anything changed. */
const FLUSH_SECONDS = 60
/** The oldest age (days since first visit) kept as its own bucket in the histogram. */
const MAX_AGE_BUCKET = 90

export type DayRuns = { enter: number; clear: number; wipe: number; leave: number; seconds: number; solo: number; grouped: number }

/** One day's counters. `players` is the only part that names anyone, and the summary drops it. */
export type DayStats = {
  day: string
  /** Address -> platform ('' until the client's hello). Uniques for the day. */
  players: Record<string, string>
  uniques: number
  /** Players whose first ever visit was today. */
  new: number
  sessions: number
  /** Total session seconds. */
  seconds: number
  /** Most players in the scene at once. */
  peak: number
  bounces: number
  /** Uniques by platform, from `players`. */
  platform: Record<string, number>
  /** Seconds from the server seeing a player to their client's hello, by platform: the load time. */
  load: Record<string, { n: number; seconds: number }>
  /** Players active today by whole days since their first visit ('0' is new); the report turns this into retention. */
  ages: Record<string, number>
  /** Players by hero level when they left. */
  levels: Record<string, number>
  /** First-ever milestones reached today: title, play, champion, dungeon, clear, death, upgrade, raid, raid-clear. */
  funnel: Record<string, number>
  /** By level id. */
  runs: Record<string, DayRuns>
  raid: { join: number; wake: number; clear: number; wipe: number; abandon: number }
  deaths: number
  xp: number
  levelUps: number
  upgrades: { attempt: number; success: number }
  /** What dropped, not what was picked up. */
  loot: { coins: number; items: number; boss: number }
  party: { formed: number; joined: number }
  /** Distinct players over the trailing 7 and 30 days, this one included. */
  window: { wau: number; mau: number }
}

export type DaySummary = Omit<DayStats, 'players'>
type Summary = { days: DaySummary[] }

/**
 * One line per player for the leaderboard: their best champion and how far it
 * has come, and lifetime counts the day records only hold as totals. Kept as
 * `metrics:heroes` and sent to the dashboard with the summary.
 */
export type HeroRow = {
  address: string
  /** The avatar's name when last seen; '' until the explorer said. */
  name: string
  /** The champion with the most XP: its id, class label, level and XP. */
  cid: string
  class: string
  level: number
  xp: number
  /** XP over every champion the wallet has played. */
  totalXp: number
  /** Levels with at least one clear, and the hardest difficulty cleared anywhere (1-based; 0 = none). */
  cleared: number
  hardest: number
  runs: number
  clears: number
  deaths: number
  raidClears: number
  sessions: number
  seconds: number
  first: number
  last: number
  coins: number
  /** Pit ranks over every piece the fire has raised. */
  ranks: number
}

/** What the party server knows about a wallet's champions, on demand. */
export type HeroFacts = Pick<HeroRow, 'cid' | 'class' | 'level' | 'xp' | 'totalXp' | 'cleared' | 'hardest' | 'coins' | 'ranks'>

type Session = { since: number; hello: boolean }

const HEROES_KEY = 'metrics:heroes'
/** How many leaderboard lines the dashboard is sent. */
const PUSH_HEROES = 300

let active = false
let current: DayStats | undefined
let summary: Summary = { days: [] }
let loaded = false
const queued: Array<(day: DayStats) => void> = []
let dirty = false
let flushIn = FLUSH_SECONDS
const sessions = new Map<string, Session>()
const lastLeft = new Map<string, number>()
let levelProbe: ((address: string) => number | undefined) | undefined
let heroProbe: ((address: string) => HeroFacts | undefined) | undefined
let nameProbe: ((address: string) => string | undefined) | undefined
const heroes = new Map<string, HeroRow>()
let heroesDirty = false

function emptyHero(address: string): HeroRow {
  const now = Date.now()
  return {
    address, name: '', cid: '', class: '', level: 0, xp: 0, totalXp: 0, cleared: 0, hardest: 0,
    runs: 0, clears: 0, deaths: 0, raidClears: 0, sessions: 0, seconds: 0, first: now, last: now, coins: 0, ranks: 0
  }
}

/** The player's leaderboard line, brought up to date from the probes, then changed. */
function touchHero(address: string, change?: (row: HeroRow) => void) {
  if (!active) return
  const id = address.toLowerCase()
  let row = heroes.get(id)
  if (!row) {
    row = emptyHero(id)
    heroes.set(id, row)
  }
  const name = nameProbe?.(id)
  if (name) row.name = name
  const facts = heroProbe?.(id)
  if (facts) Object.assign(row, facts)
  change?.(row)
  heroesDirty = true
}

/** The leaderboard, most experienced first. */
function heroRows(limit = Infinity): HeroRow[] {
  return [...heroes.values()].sort((a, b) => b.totalXp - a.totalXp || b.seconds - a.seconds).slice(0, limit)
}

function emptyDay(day: string): DayStats {
  return {
    day, players: {}, uniques: 0, new: 0, sessions: 0, seconds: 0, peak: 0, bounces: 0,
    platform: {}, load: {}, ages: {}, levels: {}, funnel: {}, runs: {},
    raid: { join: 0, wake: 0, clear: 0, wipe: 0, abandon: 0 },
    deaths: 0, xp: 0, levelUps: 0, upgrades: { attempt: 0, success: 0 }, loot: { coins: 0, items: 0, boss: 0 },
    party: { formed: 0, joined: 0 }, window: { wau: 0, mau: 0 }
  }
}

/** Who was here on each of the last 30 days, for the trailing windows. */
const recentPlayers = new Map<string, Set<string>>()

function dayString(dayNumber: number): string {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10)
}

/** Distinct players over the `span` days ending on `day`, the current record included. */
function distinctOver(day: DayStats, span: number): number {
  const seen = new Set<string>(Object.keys(day.players))
  const last = dayOf(Date.parse(day.day + 'T00:00:00Z'))
  for (let back = 1; back < span; back++) {
    const players = recentPlayers.get(dayString(last - back))
    if (players) for (const id of players) seen.add(id)
  }
  return seen.size
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayOf(ms: number): number {
  return Math.floor(ms / 86400000)
}

function bump(table: Record<string, number>, key: string, by = 1) {
  table[key] = (table[key] ?? 0) + by
}

/** Run `fn` on today's record once it is loaded, and note that something changed. */
function withDay(fn: (day: DayStats) => void) {
  if (!active) return
  if (!loaded) {
    queued.push(fn)
    return
  }
  rollDay()
  fn(current!)
  dirty = true
}

/** A new UTC day: write the old one out and start fresh. */
function rollDay() {
  const day = today()
  if (current && current.day === day) return
  if (current) void write(current)
  current = emptyDay(day)
  dirty = true
}

/** The summary row for a day: the same counters without the addresses. */
function summaryRow(day: DayStats): DaySummary {
  const { players, ...rest } = day
  void players
  return rest
}

async function write(day: DayStats) {
  // Uniques by platform are derived at write time, so a hello that arrives late still lands.
  day.platform = {}
  for (const platform of Object.values(day.players)) bump(day.platform, platform || 'unknown')
  day.uniques = Object.keys(day.players).length
  recentPlayers.set(day.day, new Set(Object.keys(day.players)))
  day.window = { wau: distinctOver(day, 7), mau: distinctOver(day, 30) }
  const rows = summary.days.filter((d) => d.day !== day.day)
  rows.push(summaryRow(day))
  rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  summary.days = rows.slice(-SUMMARY_DAYS)
  try {
    await Storage.set(DAY_PREFIX + day.day, day)
    await Storage.set(SUMMARY_KEY, summary)
    if (heroesDirty) {
      heroesDirty = false
      await Storage.set(HEROES_KEY, { rows: heroRows() })
    }
  } catch (error) {
    console.log(`[Metrics] could not write ${day.day}`, error)
  }
  await push()
}

let pushKey: string | undefined | null
let pushWarned = false

/** The summary to the website's dashboard, when there is a key to sign it with. */
async function push() {
  if (pushKey === undefined) {
    try {
      pushKey = (await EnvVar.get('METRICS_KEY')) || null
    } catch {
      pushKey = null
    }
  }
  if (!pushKey) {
    if (!pushWarned) console.log('[Metrics] no METRICS_KEY; the dashboard is not fed')
    pushWarned = true
    return
  }
  try {
    const response = await fetch(DASHBOARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-metrics-key': pushKey },
      body: JSON.stringify({
        game: 'antrom', version: GAME_VERSION, updated: Date.now(),
        days: summary.days.slice(-PUSH_DAYS), heroes: heroRows(PUSH_HEROES)
      })
    })
    if (!response.ok) console.log(`[Metrics] dashboard refused the summary: ${response.status}`)
  } catch (error) {
    console.log('[Metrics] could not reach the dashboard', error)
  }
}

async function load() {
  const day = today()
  try {
    summary = (await Storage.get<Summary>(SUMMARY_KEY)) ?? { days: [] }
    if (!Array.isArray(summary.days)) summary = { days: [] }
    // The last month of day records: who was here, for the trailing windows, and
    // today's own, since the server may have restarted part way through it.
    const since = dayString(dayOf(Date.now()) - 30)
    let stored: DayStats | undefined
    for (let offset = 0; ; ) {
      const page = await Storage.getValues({ prefix: DAY_PREFIX, limit: 100, offset })
      for (const entry of page.data) {
        const record = entry.value as DayStats | null
        if (!record || typeof record.day !== 'string' || record.day < since) continue
        recentPlayers.set(record.day, new Set(Object.keys(record.players ?? {})))
        if (record.day === day) stored = record
      }
      offset += page.data.length
      if (page.data.length === 0 || offset >= page.pagination.total) break
    }
    current = stored ? { ...emptyDay(day), ...stored } : emptyDay(day)
    const ledger = await Storage.get<{ rows: HeroRow[] }>(HEROES_KEY)
    if (ledger && Array.isArray(ledger.rows)) {
      for (const row of ledger.rows) if (row && typeof row.address === 'string') heroes.set(row.address, { ...emptyHero(row.address), ...row })
    }
  } catch (error) {
    console.log('[Metrics] could not load; counting from now', error)
    current = emptyDay(day)
  }
  loaded = true
  for (const fn of queued.splice(0)) {
    rollDay()
    fn(current!)
  }
  dirty = true
  console.log(`[Metrics] ${summary.days.length} day(s) on record, today ${day} with ${Object.keys(current.players).length} player(s) so far`)
}

function tick(dt: number) {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0
  flushIn -= step
  if (flushIn > 0) return
  flushIn = FLUSH_SECONDS
  if (!loaded) return
  rollDay()
  if (!dirty && !heroesDirty) return
  dirty = false
  void write(current!)
}

/** Starts the counters. Server only: the caller checks. */
export function initializeMetrics() {
  if (active) return
  active = true
  void load()
  engine.addSystem(tick, 0, 'metrics')
}

/** Tells the metrics how to read a player's hero level when they leave (the party server knows). */
export function setMetricsLevelProbe(probe: (address: string) => number | undefined) {
  levelProbe = probe
}

/** Tells the metrics how to read a wallet's champions for the leaderboard (the party server knows). */
export function setMetricsHeroProbe(probe: (address: string) => HeroFacts | undefined) {
  heroProbe = probe
}

/** Tells the metrics how to read a player's avatar name (the join notice keeps them). */
export function setMetricsNameProbe(probe: (address: string) => string | undefined) {
  nameProbe = probe
}

/** A player's lifetime count went up by one: a run entered or cleared, a death, the Colossus broken. */
export function metricsHeroCount(address: string, key: 'runs' | 'clears' | 'deaths' | 'raidClears') {
  touchHero(address, (row) => { row[key]++ })
}

/** A player is in the scene. Counts them for the day and opens their session. */
export function metricsEnter(address: string) {
  if (!active) return
  const id = address.toLowerCase()
  const now = Date.now()
  sessions.set(id, { since: now, hello: false })
  const resumed = now - (lastLeft.get(id) ?? 0) < SESSION_GAP_MS
  void updateVisit(id, (v) => {
    if (!resumed) v.sessions = (v.sessions ?? 0) + 1
    v.last = now
    const age = Math.max(0, dayOf(now) - dayOf(v.first))
    const activeDay = dayOf(now)
    if (!v.days) v.days = []
    const seenToday = v.days.includes(activeDay)
    if (!seenToday) v.days.push(activeDay)
    touchHero(id, (row) => {
      row.sessions = v.sessions
      row.first = Math.min(row.first, v.first)
      row.last = now
    })
    withDay((day) => {
      if (!resumed) day.sessions++
      if (!(id in day.players)) {
        day.players[id] = v.platform
        day.uniques = Object.keys(day.players).length
        if (age === 0) day.new++
        bump(day.ages, String(Math.min(age, MAX_AGE_BUCKET)))
      }
    })
    return true
  })
}

/** A player left the scene: the session's length, and whether it was a bounce. */
export function metricsLeave(address: string) {
  if (!active) return
  const id = address.toLowerCase()
  const session = sessions.get(id)
  sessions.delete(id)
  const now = Date.now()
  lastLeft.set(id, now)
  if (!session) return
  const seconds = Math.max(0, Math.round((now - session.since) / 1000))
  const level = levelProbe?.(id)
  void updateVisit(id, (v) => {
    v.seconds = (v.seconds ?? 0) + seconds
    v.last = now
    touchHero(id, (row) => {
      row.seconds = v.seconds
      row.last = now
    })
    const bounced = !!v.marks.title && !v.marks.play && seconds < BOUNCE_SECONDS
    withDay((day) => {
      day.seconds += seconds
      if (bounced) day.bounces++
      if (level !== undefined && level > 0) bump(day.levels, String(level))
    })
    return true
  })
}

/** How many are in the scene right now. */
export function metricsPresent(count: number) {
  if (!active) return
  withDay((day) => {
    if (count > day.peak) day.peak = count
  })
}

/** The client said what it is: the platform for the day's split, and the load time until it spoke. */
export function metricsHello(address: string, platform: string) {
  if (!active) return
  const id = address.toLowerCase()
  const session = sessions.get(id)
  const now = Date.now()
  withDay((day) => {
    if (id in day.players && platform) day.players[id] = platform
    if (session && !session.hello) {
      session.hello = true
      const key = platform || 'unknown'
      const load = day.load[key] ?? (day.load[key] = { n: 0, seconds: 0 })
      load.n++
      load.seconds += Math.max(0, (now - session.since) / 1000)
    }
  })
}

/**
 * A milestone. The first time a wallet reaches it, it is stamped on their
 * record and counted in the day's funnel under its base name (`dungeon:3`
 * counts as `dungeon`). Returns nothing; the stamp is what makes it once.
 */
export function metricsMark(address: string, what: string) {
  if (!active) return
  const id = address.toLowerCase()
  void updateVisit(id, (v) => {
    if (v.marks[what]) return false
    v.marks[what] = Date.now()
    const base = what.split(':')[0]
    withDay((day) => bump(day.funnel, base))
    return true
  })
}

/** A dungeon run: entered by a party of `members`, cleared, wiped, or walked out of early. */
export function metricsRun(event: 'enter' | 'clear' | 'wipe' | 'leave', levelId: number, detail: { members?: number; seconds?: number } = {}) {
  if (!active) return
  withDay((day) => {
    const key = String(levelId)
    const runs = day.runs[key] ?? (day.runs[key] = { enter: 0, clear: 0, wipe: 0, leave: 0, seconds: 0, solo: 0, grouped: 0 })
    runs[event]++
    if (event === 'enter') {
      if ((detail.members ?? 1) > 1) runs.grouped++
      else runs.solo++
    }
    if (detail.seconds) runs.seconds += Math.round(detail.seconds)
  })
}

/** The Colossus: someone went down to it, it woke, it fell, it wiped the party, or they left it. */
export function metricsRaid(event: keyof DayStats['raid']) {
  if (!active) return
  withDay((day) => { day.raid[event]++ })
}

export function metricsDeath(address: string) {
  if (!active) return
  withDay((day) => { day.deaths++ })
  metricsMark(address, 'death')
  metricsHeroCount(address, 'deaths')
}

/** Experience awarded, and the levels it crossed. */
export function metricsXp(address: string, amount: number, levelBefore: number, levelAfter: number) {
  if (!active) return
  touchHero(address)
  withDay((day) => {
    day.xp += Math.max(0, Math.round(amount))
    if (levelAfter > levelBefore) day.levelUps += levelAfter - levelBefore
  })
}

/** A piece went into the fire (as the client reports it; the result is not validated here). */
export function metricsUpgrade(address: string, success: boolean) {
  if (!active) return
  withDay((day) => {
    day.upgrades.attempt++
    if (success) day.upgrades.success++
  })
  metricsMark(address, 'upgrade')
}

/** What a kill dropped. */
export function metricsLoot(coin: number, item: string, boss: boolean) {
  if (!active) return
  withDay((day) => {
    day.loot.coins += Math.max(0, Math.round(coin))
    if (item) day.loot.items++
    if (boss) day.loot.boss++
  })
}

export function metricsParty(event: 'formed' | 'joined') {
  if (!active) return
  withDay((day) => { day.party[event]++ })
}
