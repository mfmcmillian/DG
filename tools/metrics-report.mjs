#!/usr/bin/env node
// The numbers a program asks for, from the server's day counters (src/metrics.ts).
//
//   node tools/metrics-report.mjs                 signs one storage read and prints the last 30 days
//   node tools/metrics-report.mjs --days 7        a shorter window
//   node tools/metrics-report.mjs summary.json    from a saved copy (raw JSON or the CLI's printout)
//   node tools/metrics-report.mjs --csv days.csv  also writes one row per day
//
// The storage read is `npx sdk-commands storage scene get metrics:summary`,
// which opens the linker page for a signature; set DCL_PRIVATE_KEY to skip it.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  if (at < 0) return fallback
  const value = args[at + 1]
  args.splice(at, 2)
  return value
}
const windowDays = Math.max(1, Number(flag('--days', '30')) || 30)
const csvPath = flag('--csv', '')
const file = args.find((a) => !a.startsWith('--'))

function extractJson(text) {
  const marker = text.indexOf("Value for 'metrics:summary'")
  const from = text.indexOf('{', marker < 0 ? 0 : marker)
  const to = text.lastIndexOf('}')
  if (from < 0 || to < from) throw new Error('no JSON in the storage output')
  return JSON.parse(text.slice(from, to + 1))
}

function readSummary() {
  if (file) return extractJson(readFileSync(file, 'utf8'))
  const cli = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const run = spawnSync(cli, ['sdk-commands', 'storage', 'scene', 'get', 'metrics:summary'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], shell: process.platform === 'win32' })
  if (run.status !== 0) {
    process.stderr.write(run.stdout || '')
    throw new Error(`storage read failed (exit ${run.status})`)
  }
  return extractJson(run.stdout)
}

const summary = readSummary()
const all = Array.isArray(summary.days) ? [...summary.days].sort((a, b) => (a.day < b.day ? -1 : 1)) : []
if (all.length === 0) {
  console.log('No days on record yet.')
  process.exit(0)
}
const byDay = new Map(all.map((d) => [d.day, d]))
const last = all[all.length - 1].day
const cutoff = shiftDay(last, -(windowDays - 1))
const days = all.filter((d) => d.day >= cutoff)

function shiftDay(day, by) {
  return new Date(Date.parse(day + 'T00:00:00Z') + by * 86400000).toISOString().slice(0, 10)
}
const sum = (rows, pick) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0)
const sumTable = (rows, pick) => {
  const out = {}
  for (const row of rows) for (const [key, value] of Object.entries(pick(row) ?? {})) out[key] = (out[key] ?? 0) + (Number(value) || 0)
  return out
}
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–')
const minutes = (seconds) => `${(seconds / 60).toFixed(1)} min`
const line = (label, value) => console.log(`  ${label.padEnd(42)} ${value}`)
const heading = (title) => console.log(`\n${title}\n${'-'.repeat(title.length)}`)

console.log(`Dungeons of Antrom · ${days[0].day} to ${last} (${days.length} day${days.length === 1 ? '' : 's'} with data; ${all.length} on record)`)

heading('Players')
const latest = days[days.length - 1]
const uniques = days.map((d) => d.uniques || 0)
line('Trailing 30-day players (MAU)', String(latest.window?.mau ?? '–'))
line('Trailing 7-day players (WAU)', String(latest.window?.wau ?? '–'))
line('Daily players, average / best', `${(sum(days, (d) => d.uniques) / days.length).toFixed(1)} / ${Math.max(...uniques)}`)
line('New players', String(sum(days, (d) => d.new)))
line('Returning player-days', String(sum(days, (d) => d.uniques) - sum(days, (d) => d.new)))
line('Stickiness (avg daily / MAU)', latest.window?.mau ? pct(sum(days, (d) => d.uniques) / days.length, latest.window.mau) : '–')
line('Peak in the scene at once', String(Math.max(...days.map((d) => d.peak || 0))))

heading('Sessions')
const sessions = sum(days, (d) => d.sessions)
const seconds = sum(days, (d) => d.seconds)
line('Sessions', String(sessions))
line('Average session', sessions ? minutes(seconds / sessions) : '–')
line('Sessions per player-day', sum(days, (d) => d.uniques) ? (sessions / sum(days, (d) => d.uniques)).toFixed(2) : '–')
line('Title bounces (left < 3 min, no Play)', `${sum(days, (d) => d.bounces)} (${pct(sum(days, (d) => d.bounces), sessions)} of sessions)`)

heading('Platform (player-days)')
const platform = sumTable(days, (d) => d.platform)
const platformTotal = Object.values(platform).reduce((a, b) => a + b, 0)
for (const [name, count] of Object.entries(platform).sort((a, b) => b[1] - a[1])) line(name, `${count} (${pct(count, platformTotal)})`)
const load = {}
for (const d of days) for (const [name, entry] of Object.entries(d.load ?? {})) {
  const slot = load[name] ?? (load[name] = { n: 0, seconds: 0 })
  slot.n += entry.n || 0
  slot.seconds += entry.seconds || 0
}
for (const [name, entry] of Object.entries(load)) if (entry.n) line(`Load time until hello, ${name}`, `${(entry.seconds / entry.n).toFixed(1)} s over ${entry.n}`)

heading('Retention (classic day-N, cohorts inside the window)')
for (const n of [1, 3, 7, 14, 30]) {
  let cohort = 0
  let back = 0
  for (const d of days) {
    const target = byDay.get(shiftDay(d.day, n))
    if (!target || !(d.new > 0)) continue
    cohort += d.new
    back += Number(target.ages?.[String(n)]) || 0
  }
  line(`D${n}`, cohort ? `${pct(back, cohort)} (${back} of ${cohort})` : 'no cohort old enough')
}

heading('Funnel (first-ever milestones reached in the window)')
const funnel = sumTable(days, (d) => d.funnel)
const steps = ['title', 'play', 'champion', 'dungeon', 'clear', 'death', 'upgrade', 'raid', 'raid-clear']
const top = funnel.title || 0
let previous = top
for (const step of steps) {
  const count = funnel[step] || 0
  line(step, `${count}  ${pct(count, top)} of title, ${pct(count, previous)} of previous`)
  if (count > 0) previous = count
}
const newCount = sum(days, (d) => d.new)
line('champion-new (made a champion)', `${funnel['champion-new'] || 0} of ${newCount} new`)

heading('Dungeon runs by level')
const runs = {}
for (const d of days) for (const [level, r] of Object.entries(d.runs ?? {})) {
  const slot = runs[level] ?? (runs[level] = { enter: 0, clear: 0, wipe: 0, leave: 0, seconds: 0, solo: 0, grouped: 0 })
  for (const key of Object.keys(slot)) slot[key] += r[key] || 0
}
for (const [level, r] of Object.entries(runs).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const finished = r.clear + r.wipe
  line(`Level ${Number(level) + 1}`, `${r.enter} runs · cleared ${pct(r.clear, finished)} · wiped ${pct(r.wipe, finished)} · left early ${r.leave} · ${finished ? minutes(r.seconds / finished) : '–'} · grouped ${pct(r.grouped, r.enter)}`)
}
if (Object.keys(runs).length === 0) line('none', '')

heading('The Colossus')
const raid = { join: 0, wake: 0, clear: 0, wipe: 0, abandon: 0 }
for (const d of days) for (const key of Object.keys(raid)) raid[key] += d.raid?.[key] || 0
line('Went down to it', String(raid.join))
line('Woke it / broke it / wiped / walked away', `${raid.wake} / ${raid.clear} / ${raid.wipe} / ${raid.abandon}`)

heading('Progress and economy')
line('Deaths', String(sum(days, (d) => d.deaths)))
line('XP awarded', String(sum(days, (d) => d.xp)))
line('Level-ups', String(sum(days, (d) => d.levelUps)))
const attempts = sum(days, (d) => d.upgrades?.attempt)
line('Pit upgrades (attempt / success)', `${attempts} / ${sum(days, (d) => d.upgrades?.success)}`)
line('Loot dropped (coins / items / boss)', `${sum(days, (d) => d.loot?.coins)} / ${sum(days, (d) => d.loot?.items)} / ${sum(days, (d) => d.loot?.boss)}`)
line('Parties formed / joined', `${sum(days, (d) => d.party?.formed)} / ${sum(days, (d) => d.party?.joined)}`)
const levels = sumTable(days, (d) => d.levels)
const levelRows = Object.entries(levels).sort((a, b) => Number(a[0]) - Number(b[0]))
if (levelRows.length) {
  const buckets = {}
  for (const [level, count] of levelRows) {
    const from = Math.floor((Number(level) - 1) / 10) * 10 + 1
    const key = `${from}-${from + 9}`
    buckets[key] = (buckets[key] ?? 0) + count
  }
  line('Hero levels at leaving', Object.entries(buckets).map(([range, count]) => `${range}: ${count}`).join(' · '))
}

heading('Per day')
for (const d of days) {
  console.log(`  ${d.day}  players ${String(d.uniques || 0).padStart(3)}  new ${String(d.new || 0).padStart(3)}  sessions ${String(d.sessions || 0).padStart(3)}  avg ${d.sessions ? minutes(d.seconds / d.sessions).padStart(9) : '        –'}  peak ${String(d.peak || 0).padStart(2)}  runs ${String(Object.values(d.runs ?? {}).reduce((a, r) => a + (r.enter || 0), 0)).padStart(3)}  deaths ${String(d.deaths || 0).padStart(3)}`)
}

if (csvPath) {
  const columns = ['day', 'uniques', 'new', 'wau', 'mau', 'sessions', 'seconds', 'peak', 'bounces', 'mobile', 'desktop', 'runs', 'clears', 'wipes', 'deaths', 'xp', 'levelUps', 'upgrades', 'raidJoins', 'raidClears']
  const rows = all.map((d) => [
    d.day, d.uniques || 0, d.new || 0, d.window?.wau ?? '', d.window?.mau ?? '', d.sessions || 0, d.seconds || 0, d.peak || 0, d.bounces || 0,
    d.platform?.mobile || 0, d.platform?.desktop || 0,
    Object.values(d.runs ?? {}).reduce((a, r) => a + (r.enter || 0), 0),
    Object.values(d.runs ?? {}).reduce((a, r) => a + (r.clear || 0), 0),
    Object.values(d.runs ?? {}).reduce((a, r) => a + (r.wipe || 0), 0),
    d.deaths || 0, d.xp || 0, d.levelUps || 0, d.upgrades?.attempt || 0, d.raid?.join || 0, d.raid?.clear || 0
  ])
  writeFileSync(csvPath, [columns.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n')
  console.log(`\nWrote ${rows.length} day rows to ${csvPath}`)
}
