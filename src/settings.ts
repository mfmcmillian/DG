// Player settings: the language, the camera the hero is played with, and
// whether the developer panel shows. Saved with the hero (heroSave.ts carries them as a
// JSON string in `prefs`, so new settings never need a schema change) and
// applied whenever they load or change.

import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { CameraChoice, getDungeonState, setCameraChoice } from './dungeon'
import { parsePrefs, prefsOpenAll } from './shared/prefs'
import { getLanguage, isLanguage, Language, setLanguage } from './i18n'
import { loadSeenHints, seenHints } from './hints'
import { loadNewGear, newGearIds } from './newGear'

/** The two cameras a player picks between. */
export type CameraPreference = 'crawler' | 'native'

export type Settings = {
  language: Language
  camera: CameraPreference
  devTools: boolean
  /**
   * Fight as the player's own Decentraland avatar (src/nativeHero.ts): the
   * Synty body stays hidden and the clips play on the avatar as scene emotes.
   */
  nativeAvatar: boolean
  /** Developer: every level of every realm selectable, whatever the progress says. The host honours it from the saved prefs. */
  openAll: boolean
}

export const CAMERA_OPTIONS: Array<{ id: CameraPreference; name: string; blurb: string }> = [
  { id: 'crawler', name: 'Overhead', blurb: 'High and pitched down, fixed heading. Walls facing the camera drop to parapets.' },
  { id: 'native', name: 'Third person', blurb: 'The Decentraland camera: behind the hero, turns with the mouse, zoom as you like.' }
]

const DEFAULTS: Settings = { language: 'en', camera: 'crawler', devTools: false, nativeAvatar: false, openAll: false }
/** Bumping this puts every saved hero back on the default camera on their next load. */
const CAMERA_GENERATION = 2
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

/** Switch bodies now; the hide area and the published look follow on the next tick. */
export function setNativeAvatar(on: boolean) {
  settings.nativeAvatar = on
}

export function setOpenAll(on: boolean) {
  settings.openAll = on
}

/** Put the saved camera on. */
export function applyCameraSetting() {
  const current: CameraChoice = getDungeonState().camera
  if (current !== settings.camera) setCameraChoice(settings.camera)
}

// --- persistence (hero save) --------------------------------------------------------------

export function serializeSettings(): string {
  return JSON.stringify({
    camera: settings.camera, camV: CAMERA_GENERATION, dev: settings.devTools ? 1 : 0, nat: settings.nativeAvatar ? 1 : 0, open: settings.openAll ? 1 : 0, lang: settings.language, hints: seenHints(), fresh: newGearIds(), lv: 1, ps: 1
  })
}

export function loadSettings(json: string) {
  if (json) {
    const value = parsePrefs(json)
    // Everyone starts overhead. A save from before this generation (including the
    // weeks the shoulder camera was the default) goes back to it once; a choice
    // made since is kept. The shoulder camera is gone: a hero saved on it takes
    // the third-person camera that replaced it.
    const chosen = value.camera === 'native' || value.camera === 'shoulder'
    settings.camera = value.camV === CAMERA_GENERATION && chosen ? 'native' : 'crawler'
    settings.devTools = value.dev === 1 || value.dev === true
    settings.openAll = prefsOpenAll(json)
    // A save from before languages, or one made in another session's tongue,
    // never overrides a choice made on this title screen.
    if (isLanguage(value.lang) && !languageChosen) setLanguage(settings.language = value.lang)
    else settings.language = getLanguage()
    loadSeenHints(value.hints)
    loadNewGear(value.fresh)
  }
  applyCameraSetting()
}
