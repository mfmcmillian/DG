// Where the scene's frame goes: every system's share of the JavaScript time,
// and the gap between frames that belongs to the renderer and the CRDT send.
// Imported first from src/index.ts so that every system added after it, ours
// and the SDK's UI renderer alike, is wrapped and timed. Date.now() is a
// millisecond clock, so single frames read coarse; the readout averages over
// a two-second window, which is enough to name what is expensive.
//
// The developer panel shows it (src/dungeon/ui.tsx), and with the developer
// switch on a summary goes to the console every few seconds.

import { engine, SystemFn } from '@dcl/sdk/ecs'

type Stat = { name: string; ms: number; peak: number }

export type SystemRow = { name: string; avg: number; peak: number; share: number }
export type SystemReport = {
  /** Frames measured in the last window, per second. */
  fps: number
  /** Average JavaScript milliseconds per frame across every system. */
  frameAvg: number
  /** Worst single frame in the window. */
  framePeak: number
  /** Average milliseconds between one frame's end and the next's start: the renderer, the CRDT round trip, and waiting. */
  gapAvg: number
  /** Systems, heaviest first. */
  rows: SystemRow[]
}

const WINDOW_SECONDS = 2

const stats = new Map<string, Stat>()
const wrappedOf = new Map<SystemFn, SystemFn>()
let windowAge = 0
let frames = 0
let frameMs = 0
let framePeak = 0
let gapMs = 0
let frameStartAt = 0
let lastEndAt = 0
let thisFrame = 0
let report: SystemReport = { fps: 0, frameAvg: 0, framePeak: 0, gapAvg: 0, rows: [] }
let onReport: ((r: SystemReport) => void) | undefined

const originalAdd = engine.addSystem
const originalRemove = engine.removeSystem

engine.addSystem = (fn: SystemFn, priority?: number, name?: string) => {
  const label = name || fn.name || `system #${stats.size + 1}`
  const stat: Stat = { name: label, ms: 0, peak: 0 }
  stats.set(label, stat)
  const wrapped: SystemFn = (dt) => {
    const t0 = Date.now()
    fn(dt)
    const d = Date.now() - t0
    stat.ms += d
    thisFrame += d
    if (d > stat.peak) stat.peak = d
  }
  wrappedOf.set(fn, wrapped)
  return originalAdd(wrapped, priority, label)
}

engine.removeSystem = (selector: string | SystemFn) => {
  if (typeof selector === 'function') return originalRemove(wrappedOf.get(selector) ?? selector)
  return originalRemove(selector)
}

/** Runs before every other system: the frame's clock starts. */
function frameStart(dt: number) {
  const now = Date.now()
  if (lastEndAt) gapMs += now - lastEndAt
  frameStartAt = now
  thisFrame = 0
  if (Number.isFinite(dt) && dt > 0) windowAge += dt
  frames++
}

/** Runs after every other system: the frame's clock stops, and the window closes when it is due. */
function frameEnd() {
  const now = Date.now()
  lastEndAt = now
  const total = now - frameStartAt
  frameMs += total
  if (total > framePeak) framePeak = total
  if (windowAge < WINDOW_SECONDS || !frames) return
  const rows: SystemRow[] = []
  for (const s of stats.values()) {
    if (s.ms > 0) rows.push({ name: s.name, avg: s.ms / frames, peak: s.peak, share: frameMs ? s.ms / frameMs : 0 })
    s.ms = 0
    s.peak = 0
  }
  rows.sort((a, b) => b.avg - a.avg)
  report = { fps: frames / windowAge, frameAvg: frameMs / frames, framePeak, gapAvg: gapMs / frames, rows }
  windowAge = 0
  frames = 0
  frameMs = 0
  framePeak = 0
  gapMs = 0
  onReport?.(report)
}

originalAdd(frameStart, 1e9, 'profile-start')
originalAdd(frameEnd, -1e9, 'profile-end')

/** The last closed window. */
export function systemProfile(): Readonly<SystemReport> {
  return report
}

/** Hear every closed window (the console summary). */
export function onSystemProfile(fn: (r: SystemReport) => void) {
  onReport = fn
}

/** One line per heavy system, for the console. */
export function systemProfileText(r: SystemReport, top = 8): string {
  const head = `${r.fps.toFixed(0)} fps · js ${r.frameAvg.toFixed(1)} ms/frame (peak ${r.framePeak} ms) · outside js ${r.gapAvg.toFixed(1)} ms`
  const body = r.rows.slice(0, top).map((row) => `${row.name} ${row.avg.toFixed(2)} ms (peak ${row.peak})`).join(' · ')
  return `${head} | ${body}`
}
