// Player settings: the language, the camera the hero is played with, and
// whether the developer panel shows. Saved with the hero (heroSave.ts carries them as a
// JSON string in `prefs`, so new settings never need a schema change) and
// applied whenever they load or change.

import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { CameraChoice, getDungeonState, setCameraChoice } from './dungeon'
import { parsePrefs, prefsOpenAll } from './shared/prefs'
import { getLanguage, isLanguage, Language, setLanguage } from './i18n'
import { loadSeenHints, seenHints } from './hints'

/** The two cameras a player picks between; `native` stays a developer option. */
export type CameraPreference = 'crawler' | 'shoulder'

export type Settings = {
  language: Language
  camera: CameraPreference
  devTools: boolean
  /** Developer: every level of every realm selectable, whatever the progress says. The host honours it from the saved prefs. */
  openAll: boolean
}

export const CAMERA_OPTIONS: Array<{ id: CameraPreference; name: string; blurb: string }> = [
  { id: 'crawler', name: 'Overhead', blurb: 'High and pitched down, fixed heading. Walls facing the camera drop to parapets.' },
  { id: 'shoulder', name: 'Over the shoulder', blurb: 'A short boom behind the hero that turns with them.' }
]

const DEFAULTS: Settings = { language: 'en', camera: 'crawler', devTools: false, openAll: false }
const settings: Settings = { ...DEFAULTS }
let open = false

export function getSettings(): Readonly<Settings> {
  return settings
}

export function isSettingsOpen(): boolean {
  return open
}

/** Runs once when the panel closes (the lobby uses it to come back). */
let onCloseOnce: (() => void) | undefined

export function openSettings(options: { onClose?: () => void } = {}): boolean {
  if (open) return false
  open = true
  onCloseOnce = options.onClose
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  return true
}

export function closeSettings() {
  if (!open) return
  open = false
  InputModifier.deleteFrom(engine.PlayerEntity)
  const after = onCloseOnce
  onCloseOnce = undefined
  after?.()
}

/** Click = switch now and remember it. The walls swap in place, so this is safe mid-fight. */
export function setCameraPreference(camera: CameraPreference) {
  settings.camera = camera
  applyCameraSetting()
}

/**
 * Switch the game's language now. Picked on the title before there is a hero
 * to save it with; it rides along in the prefs once there is one.
 */
export function setLanguagePreference(language: Language) {
  settings.language = language
  languageChosen = true
  setLanguage(language)
}

/** A language was picked by hand this session (title flags or the settings sheet). */
let languageChosen = false

export function setDevTools(on: boolean) {
  settings.devTools = on
  if (!on) applyCameraSetting()
}

export function setOpenAll(on: boolean) {
  settings.openAll = on
}

/** Put the saved camera on, unless a developer has switched to the native camera by hand. */
export function applyCameraSetting() {
  const current: CameraChoice = getDungeonState().camera
  if (current === 'native' && settings.devTools) return
  if (current !== settings.camera) setCameraChoice(settings.camera)
}

// --- persistence (hero save) --------------------------------------------------------------

export function serializeSettings(): string {
  return JSON.stringify({
    camera: settings.camera, dev: settings.devTools ? 1 : 0, open: settings.openAll ? 1 : 0, lang: settings.language, hints: seenHints()
  })
}

export function loadSettings(json: string) {
  if (json) {
    const value = parsePrefs(json)
    settings.camera = value.camera === 'shoulder' ? 'shoulder' : 'crawler'
    settings.devTools = value.dev === 1 || value.dev === true
    settings.openAll = prefsOpenAll(json)
    // A save from before languages, or one made in another session's tongue,
    // never overrides a choice made on this title screen.
    if (isLanguage(value.lang) && !languageChosen) setLanguage(settings.language = value.lang)
    else settings.language = getLanguage()
    loadSeenHints(value.hints)
  }
  applyCameraSetting()
}
