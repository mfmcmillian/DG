import { closeSceneCamera, openSceneCamera, SceneCameraSession } from './sceneCamera'
import { MENU_CAMERA_POSITION, MENU_CAMERA_TARGET } from './menuPreviewStage'
import { getPickerState, openPicker } from './characterPicker'
import { getPreloadState } from './preload'

let open = false
let session: SceneCameraSession | undefined

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

/** The title doubles as the loading screen: nobody enters until the preload settles. */
export function isTitleReady(): boolean {
  return getPreloadState().complete
}

export function titleBegin() {
  if (!open || !isTitleReady()) return
  closeSceneCamera(session)
  session = undefined
  open = false
  openPicker()
}

export function titleContinue() {
  if (!open || !isTitleReady() || !getPickerState().hasCreatedCharacter) return
  closeSceneCamera(session)
  session = undefined
  open = false
}
