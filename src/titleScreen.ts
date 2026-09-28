import { executeTask } from '@dcl/sdk/ecs'
import { closeSceneCamera, openSceneCamera, prepareSceneCameraReturn, SceneCameraSession } from './sceneCamera'
import { MENU_CAMERA_POSITION, MENU_CAMERA_TARGET } from './menuPreviewStage'
import { closePicker, getPickerState, openPicker } from './characterPicker'
import { isPreloadComplete } from './preload'
import { heroGroupId, PRELOAD_HUB } from './preloadPlan'
import { continueSavedHero, getHeroSaveState, isHeroSavePending, isHeroSaveUnreachable } from './heroSave'

let open = false
let session: SceneCameraSession | undefined
/** A saved-hero continue is being prepared (placement, body load). */
let resuming = false
/** The title asked "Change champion?" and waits on the answer. */
let changing = false
/** The picker was opened from a title that held a saved champion: it offers the way back. */
let pickerFromSave = false

export function isTitleOpen(): boolean {
  return open
}

export function openTitle() {
  if (open) return
  const next = openSceneCamera('title', MENU_CAMERA_POSITION, MENU_CAMERA_TARGET)
  if (!next) return
  session = next
  open = true
}

/** The title doubles as the loading screen: nobody enters until the hall is in. */
export function isTitleReady(): boolean {
  return isPreloadComplete(PRELOAD_HUB)
}

/** "Continue" also waits on the saved champion's outfit, so it does not stand there in pieces. */
export function isSavedHeroReady(): boolean {
  const save = getHeroSaveState()
  return save.found && isPreloadComplete(heroGroupId(save.cid))
}

export function isTitleResuming(): boolean {
  return resuming
}

/**
 * The wallet has not yet said whether it holds a champion. Nothing that makes a
 * new one may be pressed meanwhile: it would overwrite the saved one unseen.
 * Hosting alone (the server unreachable) the answer never comes, and the title
 * says so instead.
 */
export function isTitleLooking(): boolean {
  return isHeroSavePending() && !isHeroSaveUnreachable() && !getPickerState().hasCreatedCharacter
}

export function isTitleChanging(): boolean {
  return changing
}

/** "Change champion" on a title with a saved one: ask first, a stray click costs nothing. */
export function titleAskChange() {
  if (!open || resuming) return
  changing = true
}

export function titleCancelChange() {
  changing = false
}

/** The class picker came from a title with a saved champion, so it has a Back. */
export function isPickerFromSave(): boolean {
  return pickerFromSave
}

export function titleBegin() {
  if (!open || !isTitleReady() || resuming || isTitleLooking()) return
  pickerFromSave = getHeroSaveState().found && !getPickerState().hasCreatedCharacter
  changing = false
  closeSceneCamera(session)
  session = undefined
  open = false
  openPicker()
}

/** Back from the class picker to the title's Continue, nothing chosen. */
export function pickerBackToTitle() {
  if (!pickerFromSave || getPickerState().hasCreatedCharacter || !getPickerState().open) return
  pickerFromSave = false
  closePicker()
  openTitle()
}

/** A hero made earlier this session: just drop the title. */
export function titleContinue() {
  if (!open || !isTitleReady() || resuming || !getPickerState().hasCreatedCharacter) return
  closeSceneCamera(session)
  session = undefined
  open = false
}

/**
 * The hero saved under this wallet: stand it on the hub's entrance and drop
 * the title. Placement runs while the title still owns the camera, the same
 * way the creator hands over, so the follow camera opens on the hero in place.
 */
export function titleResumeSaved() {
  if (!open || !isTitleReady() || resuming || !isSavedHeroReady()) return
  const current = session
  resuming = true
  executeTask(async () => {
    try {
      await prepareSceneCameraReturn(current, true)
      if (!continueSavedHero()) throw new Error('The saved hero could not be taken up')
      closeSceneCamera(current)
      session = undefined
      open = false
    } catch (error) {
      console.log('Saved hero continue failed', error)
    } finally {
      resuming = false
    }
  })
}
