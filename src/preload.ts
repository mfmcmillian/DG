import { AssetLoad, AssetLoadLoadingState, engine, Entity, LoadingState } from '@dcl/sdk/ecs'

/**
 * Warms the renderer's asset cache in named groups, so each door waits only on
 * what lies behind it: the title on the hall, "Continue" on the saved hero's
 * outfit, "Start run" on the chosen realm's enemies. Everything else downloads
 * in the background, one group at a time in the order requested.
 *
 * `AssetLoad` asks the renderer to download (and parse) each asset without
 * rendering it; the renderer appends an `AssetLoadLoadingState` entry per asset
 * as it progresses. Only models are counted toward a group's gate: textures
 * and sounds are requested too, but the renderer does not reliably report
 * them, and waiting for a report that never comes is what used to hold the
 * title for its full grace period.
 *
 * A group never hard-blocks: a renderer that never reports is detected, and a
 * group whose models stop making progress is released with the stragglers
 * named (see `stalledOn`) so a player is not held hostage by one file.
 */

export type PreloadGroup = {
  id: string
  /** What the loading line calls it: "the hall", "your champion". */
  label: string
  /** Models counted toward the gate. */
  total: number
  done: number
  /** 0..1, smoothed for the bar. */
  progress: number
  complete: boolean
  /** Seconds since this group's request went out. */
  elapsed: number
  /** A model that has not reported for a while, once the group looks stuck. */
  stalledOn?: string
  /** Models the group was released without (stalled or errored). */
  stragglers: string[]
}

type Group = PreloadGroup & {
  assets: string[]
  models: Set<string>
  entity?: Entity
  started: boolean
  firstReportAt?: number
  lastProgressAt: number
  /** Timestamp counter per model; only reports newer than the request count. */
  settled: Set<string>
}

/** Nothing reported at all: the renderer does not support AssetLoad. */
const NO_REPORT_GRACE_SECONDS = 12
/** No model settled for this long: name the straggler on the loading line. */
const STALL_NOTICE_SECONDS = 8
/** No model settled for this long: release the group without it. */
const STALL_RELEASE_SECONDS = 25
/** Ceiling per group, whatever happens. */
const MAX_WAIT_SECONDS = 60
/** Groups downloading at once (the renderer parallelises within one); the rest queue in request order. */
const IN_FLIGHT = 1

const groups = new Map<string, Group>()
const order: string[] = []
let systemAdded = false

function isSettled(s: LoadingState) {
  return s === LoadingState.FINISHED || s === LoadingState.FINISHED_WITH_ERROR || s === LoadingState.NOT_FOUND
}

function isModel(path: string) {
  const lower = path.toLowerCase()
  return lower.endsWith('.glb') || lower.endsWith('.gltf')
}

/**
 * Request a group. Calling again with the same id adds to it (paths are
 * deduplicated; a completed group reopens if new models arrive). Groups start
 * downloading in the order they were first requested, IN_FLIGHT at a time.
 * `urgent` groups (something a button is waiting on) start at once, ahead of
 * the queue.
 */
export function preloadGroup(id: string, label: string, paths: string[], urgent = false) {
  let g = groups.get(id)
  if (!g) {
    g = {
      id, label, total: 0, done: 0, progress: 0, complete: false, elapsed: 0, stragglers: [],
      assets: [], models: new Set(), started: false, lastProgressAt: 0, settled: new Set()
    }
    groups.set(id, g)
    order.push(id)
  }
  let added = false
  for (const path of paths) {
    if (g.assets.includes(path)) continue
    g.assets.push(path)
    if (isModel(path)) g.models.add(path)
    added = true
  }
  g.total = g.models.size
  if (added && g.complete && g.done < g.total) {
    g.complete = false
    g.lastProgressAt = g.elapsed
  }
  if (!g.total) g.complete = true
  if (added && g.started) request(g)
  if (!systemAdded) {
    engine.addSystem(updatePreload)
    systemAdded = true
  }
  if (urgent && !g.started && !g.complete) {
    order.splice(order.indexOf(id), 1)
    order.unshift(id)
    start(g)
  }
  schedule()
}

export function getPreloadGroup(id: string): Readonly<PreloadGroup> | undefined {
  return groups.get(id)
}

export function isPreloadComplete(id: string): boolean {
  return groups.get(id)?.complete ?? true
}

/** "Enter anyway": let the gate open now; whatever is left streams in as it arrives. */
export function releasePreload(id: string) {
  const g = groups.get(id)
  if (!g || g.complete) return
  const left = [...g.models].filter((m) => !g.settled.has(m))
  g.stragglers.push(...left)
  console.log(`[DG] preload "${g.id}" skipped by the player after ${g.elapsed.toFixed(0)}s with ${left.length} model(s) left: ${left.join(', ')}`)
  g.complete = true
  g.progress = 1
  g.stalledOn = undefined
  schedule()
}

/** The group currently downloading that a loading line should talk about (earliest incomplete). */
export function currentPreloadGroup(): Readonly<PreloadGroup> | undefined {
  for (const id of order) {
    const g = groups.get(id)!
    if (!g.complete && g.started) return g
  }
  return undefined
}

/** Every group, in request order, for the developer readout. */
export function allPreloadGroups(): ReadonlyArray<Readonly<PreloadGroup>> {
  return order.map((id) => groups.get(id)!)
}

function request(g: Group) {
  if (g.entity === undefined) g.entity = engine.addEntity()
  AssetLoad.createOrReplace(g.entity, { assets: [...g.assets] })
}

function schedule() {
  let inFlight = 0
  for (const id of order) {
    const g = groups.get(id)!
    if (g.started && !g.complete) inFlight++
  }
  for (const id of order) {
    if (inFlight >= IN_FLIGHT) return
    const g = groups.get(id)!
    if (g.started || g.complete) continue
    start(g)
    inFlight++
  }
}

function start(g: Group) {
  g.started = true
  g.elapsed = 0
  g.lastProgressAt = 0
  request(g)
}

function updatePreload(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return
  let released = false
  for (const id of order) {
    const g = groups.get(id)!
    if (!g.started || g.complete) continue
    g.elapsed += dt
    if (g.entity !== undefined && AssetLoadLoadingState.has(g.entity)) {
      for (const r of AssetLoadLoadingState.get(g.entity)) {
        if (!g.models.has(r.asset) || g.settled.has(r.asset)) continue
        if (g.firstReportAt === undefined) g.firstReportAt = g.elapsed
        if (isSettled(r.currentState)) {
          g.settled.add(r.asset)
          g.lastProgressAt = g.elapsed
          if (r.currentState !== LoadingState.FINISHED) g.stragglers.push(r.asset)
        }
      }
    }
    g.done = g.settled.size
    const target = g.total ? g.done / g.total : 1
    g.progress = Math.max(g.progress, Math.min(target, g.progress + dt * 1.5))

    const quiet = g.elapsed - g.lastProgressAt
    g.stalledOn = quiet >= STALL_NOTICE_SECONDS ? [...g.models].find((m) => !g.settled.has(m)) : undefined

    const allDone = g.done >= g.total
    const unsupported = g.firstReportAt === undefined && g.elapsed >= NO_REPORT_GRACE_SECONDS
    const stalled = g.firstReportAt !== undefined && quiet >= STALL_RELEASE_SECONDS
    const timedOut = g.elapsed >= MAX_WAIT_SECONDS
    if (allDone || unsupported || stalled || timedOut) {
      if (!allDone) {
        const left = [...g.models].filter((m) => !g.settled.has(m))
        g.stragglers.push(...left)
        console.log(`[DG] preload "${g.id}" released after ${g.elapsed.toFixed(0)}s with ${left.length} model(s) unreported` +
          (unsupported ? ' (renderer never reported)' : '') + `: ${left.slice(0, 5).join(', ')}${left.length > 5 ? ', …' : ''}`)
      } else if (g.elapsed > 1) {
        console.log(`[DG] preload "${g.id}": ${g.total} model(s) in ${g.elapsed.toFixed(1)}s`)
      }
      g.complete = true
      g.progress = 1
      g.stalledOn = undefined
      released = true
    }
  }
  if (released) schedule()
}
