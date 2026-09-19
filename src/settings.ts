// Player settings: the camera the hero is played with, and whether the
// developer panel shows. Saved with the hero (heroSave.ts carries them as a
// JSON string in `prefs`, so new settings never need a schema change) and
// applied whenever they load or change.

import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { CameraChoice, getDungeonState, setCameraChoice } from './dungeon'
import { inRun } from './party'

/** The two cameras a player picks between; `native` stays a developer option. */
export type CameraPreference = 'crawler' | 'shoulder'

export type Settings = {
  camera: CameraPreference
  devTools: boolean
}

export const CAMERA_OPTIONS: Array<{ id: CameraPreference; name: string; blurb: string }> = [
  { id: 'crawler', name: 'Overhead', blurb: 'High and pitched down, fixed heading. Walls facing the camera drop to parapets.' },
  { id: 'shoulder', name: 'Over the shoulder', blurb: 'A short boom behind the hero that turns with them.' }
]

const DEFAULTS: Settings = { camera: 'crawler', devTools: false }
const settings: Settings = { ...DEFAULTS }
let open = false

export function getSettings(): Readonly<Settings> {
  return settings
}

export function isSettingsOpen(): boolean {
  return open
}

export function openSettings() {
  if (open) return
  open = true
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
}

export function closeSettings() {
  if (!open) return
  open = false
  InputModifier.deleteFrom(engine.PlayerEntity)
}

export function setCameraPreference(camera: CameraPreference) {
  settings.camera = camera
  // Switching overhead <-> shoulder rebuilds the walls (parapets face the
  // overhead camera), which would also sweep the loot off the floor mid-run.
  // In a fortress the choice waits for the next dungeon load; in the hall it is instant.
  if (!inRun()) applyCameraSetting()
}

/** True while the saved camera is not the one in use (waiting for the next dungeon load). */
export function cameraChangePending(): boolean {
  const current = getDungeonState().camera
  return current !== 'native' && current !== settings.camera
}

export function setDevTools(on: boolean) {
  settings.devTools = on
  if (!on) applyCameraSetting()
}

/**
 * Put the saved camera on, unless a developer has switched to the native camera
 * by hand. `rebuild: false` when a loadDungeon follows anyway.
 */
export function applyCameraSetting(rebuild = true) {
  const current: CameraChoice = getDungeonState().camera
  if (current === 'native' && settings.devTools) return
  if (current !== settings.camera) setCameraChoice(settings.camera, rebuild)
}

// --- persistence (hero save) --------------------------------------------------------------

export function serializeSettings(): string {
  return JSON.stringify({ camera: settings.camera, dev: settings.devTools ? 1 : 0 })
}

export function loadSettings(json: string) {
  if (json) {
    try {
      const value = JSON.parse(json) as { camera?: unknown; dev?: unknown }
      settings.camera = value.camera === 'shoulder' ? 'shoulder' : 'crawler'
      settings.devTools = value.dev === 1 || value.dev === true
    } catch {
      Object.assign(settings, DEFAULTS)
    }
  }
  applyCameraSetting()
}
