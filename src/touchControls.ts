// The explorer's own on-screen pad on a phone: the jump button and the ring of
// action buttons (tap, E, F, 1-4) down the right edge. In the hall none of them
// does anything the hall does not offer by touch already (the prompt rings take a
// tap, the HUD has its buttons), so the pad is hidden there and the edge is ours.
// In a fortress the pad comes back: the swings and skills are on it. The joystick
// and the crosshair are never touched. Desktop never sets the component.

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isGodotClient } from './explorerAgent'
import { HUB } from './partyLookup'
import { myPhase } from './party'

/** Every button the pad can show; the joystick is not one of them. */
const PAD_BUTTONS: InputAction[] = [
  InputAction.IA_JUMP, InputAction.IA_POINTER, InputAction.IA_PRIMARY, InputAction.IA_SECONDARY,
  InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6
]

let hidden = false

function wantHidden(): boolean {
  return isGodotClient() && myPhase() === HUB
}

export function initializeTouchControls() {
  engine.addSystem(() => {
    const want = wantHidden()
    if (want === hidden) return
    hidden = want
    if (want) {
      TouchScreenControls.createOrReplace(engine.RootEntity, {
        touchInputs: PAD_BUTTONS.map((inputAction) => ({ inputAction, hide: true })),
        hideJoystick: false,
        hideCrosshair: false
      })
    } else {
      TouchScreenControls.deleteFrom(engine.RootEntity)
    }
  }, 0, 'touch-controls')
}
