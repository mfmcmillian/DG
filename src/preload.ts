import { AssetLoad, AssetLoadLoadingState, engine, Entity, LoadingState } from '@dcl/sdk/ecs'

/**
 * Warms the renderer's asset cache before the title screen lets the player in.
 *
 * `AssetLoad` asks the renderer to download (and parse) each asset without
 * rendering it; the renderer appends an `AssetLoadLoadingState` entry per
 * asset as it progresses. Everything the dungeon spawns on entry (kit pieces,
 * enemy and boss outfits, the default hero outfits) is requested up front so
 * the first minute in the fortress is not spent watching bodies and floors
 * pop in over a remote content server.
 *
 * The screen never hard-blocks: assets that error out count as done, a
 * renderer that never reports is detected, and there is an overall ceiling.
 */

export type PreloadState = {
  total: number
  done: number
  /** 0..1, smoothed for the bar. */
  progress: number
  complete: boolean
  /** Seconds since the request went out. */
  elapsed: number
}

const NO_REPORT_GRACE_SECONDS = 12
const TRAILING_GRACE_SECONDS = 6
const MAX_WAIT_SECONDS = 150

const state: PreloadState = { total: 0, done: 0, progress: 0, complete: false, elapsed: 0 }
let loader: Entity | undefined
let pending = new Set<string>()
let firstReportAt: number | undefined
let modelsDoneAt: number | undefined
let systemAdded = false

export function getPreloadState(): Readonly<PreloadState> {
  return state
}

/** Request a batch of assets. Safe to call more than once; paths are deduplicated. */
export function preloadAssets(paths: string[]) {
  for (const path of paths) pending.add(path)
  if (!pending.size) {
    state.complete = true
    return
  }
  const assets = [...pending]
  state.total = assets.length
  state.complete = false
  if (loader === undefined) loader = engine.addEntity()
  AssetLoad.createOrReplace(loader, { assets })
  if (!systemAdded) {
    engine.addSystem(updatePreload)
    systemAdded = true
  }
}

function isSettled(s: LoadingState) {
  return s === LoadingState.FINISHED || s === LoadingState.FINISHED_WITH_ERROR || s === LoadingState.NOT_FOUND
}

function isModel(path: string) {
  const lower = path.toLowerCase()
  return lower.endsWith('.glb') || lower.endsWith('.gltf')
}

function updatePreload(dt: number) {
  if (state.complete || loader === undefined) return
  state.elapsed += dt

  // Latest report per asset wins.
  const latest = new Map<string, { state: LoadingState; timestamp: number }>()
  if (AssetLoadLoadingState.has(loader)) {
    for (const r of AssetLoadLoadingState.get(loader)) {
      if (!pending.has(r.asset)) continue
      const prev = latest.get(r.asset)
      if (!prev || r.timestamp >= prev.timestamp) latest.set(r.asset, { state: r.currentState, timestamp: r.timestamp })
    }
  }
  if (latest.size && firstReportAt === undefined) firstReportAt = state.elapsed

  let done = 0
  let modelsLeft = 0
  for (const path of pending) {
    const entry = latest.get(path)
    if (entry && isSettled(entry.state)) done++
    else if (isModel(path)) modelsLeft++
  }
  state.done = done
  const target = state.total ? done / state.total : 1
  state.progress = Math.max(state.progress, Math.min(target, state.progress + dt * 1.5))

  if (modelsLeft === 0 && modelsDoneAt === undefined) modelsDoneAt = state.elapsed

  const allDone = done >= state.total
  // Models are what matter for pop-in; give textures/other assets a short grace after them.
  const modelsDoneLongEnough = modelsDoneAt !== undefined && state.elapsed - modelsDoneAt >= TRAILING_GRACE_SECONDS
  // A renderer without AssetLoad support never reports anything; do not hold the player hostage.
  const unsupported = firstReportAt === undefined && state.elapsed >= NO_REPORT_GRACE_SECONDS
  const timedOut = state.elapsed >= MAX_WAIT_SECONDS

  if (allDone || modelsDoneLongEnough || unsupported || timedOut) {
    state.complete = true
    state.progress = 1
    engine.removeSystem(updatePreload)
    systemAdded = false
  }
}
