// The explorer's own on-screen pad on a phone: the jump button and the ring of
// action buttons (tap, E, F, 1-4) down the right edge. In the hall only E is
// shown: the prompt rings beside the folk and the upgrade pit fill while E is
// held (hallPrompt.ts), and the tap on the ring's disc has not proved reliable
// on a phone, so the button they name stays. Everything else the hall offers
// by touch already (the HUD has its buttons), so the rest of the pad is hidden
// and the edge is ours. In a fortress E and F are shown, for the swings; the
// skills are tapped on the HUD's own skill bar (skillBarUi.tsx). The joystick
// is never touched. The crosshair is always hidden on a phone: under the
// overhead camera the pointer goes where the tap is, so a cross in the middle
// of the screen means nothing. Desktop never sets the component.

import { engine, InputAction, TouchScreenControls } from '@dcl/sdk/ecs'
import { isGodotClient } from './explorerAgent'
import { HUB } from './partyLookup'
import { myPhase } from './party'

/** Every button the pad can show; the joystick is not one of them. */
const PAD_BUTTONS: InputAction[] = [
  InputAction.IA_JUMP, InputAction.IA_POINTER, InputAction.IA_PRIMARY, InputAction.IA_SECONDARY,
  InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6
]
/** The two that stay in a fortress, and the one that stays in the hall. */
const FORTRESS_BUTTONS = new Set<InputAction>([InputAction.IA_PRIMARY, InputAction.IA_SECONDARY])
const HALL_BUTTONS = new Set<InputAction>([InputAction.IA_PRIMARY])

let inHall: boolean | undefined

export function initializeTouchControls() {
  engine.addSystem(() => {
    if (!isGodotClient()) return
    const hall = myPhase() === HUB
    if (hall === inHall) return
    inHall = hall
    TouchScreenControls.createOrReplace(engine.RootEntity, {
      touchInputs: PAD_BUTTONS.map((inputAction) => ({ inputAction, hide: !(hall ? HALL_BUTTONS : FORTRESS_BUTTONS).has(inputAction) })),
      hideJoystick: false,
      hideCrosshair: true
    })
  }, 0, 'touch-controls')
}
