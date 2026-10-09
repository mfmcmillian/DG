// The explorer's own on-screen pad on a phone supplies only movement. Its
// generic Jump/Walk/E/F buttons are hidden: src/mobileCombatUi.tsx draws clear,
// correctly labelled Light, Heavy, Guard and Dodge controls instead. Skills are
// tapped on the HUD's own skill bar (skillBarUi.tsx). The joystick is never touched. The
// crosshair is always hidden on a phone: under the overhead camera the pointer
// goes where the tap is, so a cross in the middle of the screen means nothing.
// Desktop never sets the component.

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isGodotClient } from './explorerAgent'
import { HUB } from './partyLookup'
import { myPhase } from './party'
import { tutorialActive } from './tutorial'
import { releaseTouchCombatControls } from './combatControls'

/** Every button the pad can show; the joystick is not one of them. */
const PAD_BUTTONS: InputAction[] = [
  InputAction.IA_JUMP, InputAction.IA_WALK, InputAction.IA_POINTER, InputAction.IA_PRIMARY, InputAction.IA_SECONDARY,
  InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6
]
let shownMode = ''

export function initializeTouchControls() {
  engine.addSystem(() => {
    if (!isGodotClient()) return
    const hall = myPhase() === HUB
    const training = tutorialActive()
    const mode = training ? 'training' : hall ? 'hall' : 'fortress'
    if (mode === shownMode) return
    shownMode = mode
    releaseTouchCombatControls()
    TouchScreenControls.createOrReplace(engine.RootEntity, {
      touchInputs: PAD_BUTTONS.map((inputAction) => ({
        inputAction,
        hide: true
      })),
      hideJoystick: false,
      hideCrosshair: true
    })
  }, 0, 'touch-controls')
}
