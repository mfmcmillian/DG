import { executeTask } from '@dcl/sdk/ecs'
import { closeSceneCamera, openSceneCamera, prepareSceneCameraReturn, SceneCameraSession } from './sceneCamera'
import { MENU_CAMERA_POSITION, MENU_CAMERA_TARGET } from './menuPreviewStage'
import { getPickerState, openPicker } from './characterPicker'
import { isPreloadComplete } from './preload'
import { heroGroupId, PRELOAD_HUB } from './preloadPlan'
import { continueSavedHero, getHeroSaveState } from './heroSave'

let open = false
let session: SceneCameraSession | undefined
/** A saved-hero continue is being prepared (placement, body load). */
let resuming = false

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

export function titleBegin() {
  if (!open || !isTitleReady() || resuming) return
  closeSceneCamera(session)
  session = undefined
  open = false
  openPicker()
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
