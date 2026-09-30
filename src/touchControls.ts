// The explorer's own on-screen pad on a phone: the jump button and the ring of
// action buttons (tap, E, F, 1-4) down the right edge. In the hall none of them
// does anything the hall does not offer by touch already (the prompt rings take a
// tap, the HUD has its buttons), so the pad is hidden there and the edge is ours.
// In a fortress only E and F come back, for the swings; the skills are tapped on
// the HUD's own skill bar (skillBarUi.tsx). The joystick is never touched. The
// crosshair is always hidden on a phone: under the overhead camera the pointer
// goes where the tap is, so a cross in the middle of the screen means nothing.
// Desktop never sets the component.

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isGodotClient } from './explorerAgent'
import { HUB } from './partyLookup'
import { myPhase } from './party'

/** Every button the pad can show; the joystick is not one of them. */
const PAD_BUTTONS: InputAction[] = [
  InputAction.IA_JUMP, InputAction.IA_POINTER, InputAction.IA_PRIMARY, InputAction.IA_SECONDARY,
  InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6
]
/** The two that stay in a fortress. */
const FORTRESS_BUTTONS = new Set<InputAction>([InputAction.IA_PRIMARY, InputAction.IA_SECONDARY])

let inHall: boolean | undefined

export function initializeTouchControls() {
  engine.addSystem(() => {
    if (!isGodotClient()) return
    const hall = myPhase() === HUB
    if (hall === inHall) return
    inHall = hall
    TouchScreenControls.createOrReplace(engine.RootEntity, {
      touchInputs: PAD_BUTTONS.map((inputAction) => ({ inputAction, hide: hall || !FORTRESS_BUTTONS.has(inputAction) })),
      hideJoystick: false,
      hideCrosshair: true
    })
  }, 0, 'touch-controls')
}
