import { engine, InputAction, inputSystem, PointerEventType, PointerLock } from '@dcl/sdk/ecs'

export type CombatControlAction = 'light' | 'heavy' | 'jump'

export type CombatControls = {
  armed: boolean
  delay: number
  pointerArmed: boolean
  pointerDelay: number
  previousPointerLock: boolean
}

export function createCombatControls(): CombatControls {
  const controls: CombatControls = {
    armed: false, delay: 0, pointerArmed: false, pointerDelay: 0, previousPointerLock: false
  }
  resetCombatControls(controls)
  return controls
}

export function resetCombatControls(controls: CombatControls, delay = 0.2) {
  controls.armed = false
  controls.delay = delay
  controls.pointerArmed = false
  controls.pointerDelay = 0.18
  controls.previousPointerLock = false
}

export function readCombatControls(controls: CombatControls, dt: number): {
  acceptsKeys: boolean
  jumpPressed: boolean
  /** Space held: raise the guard (dungeon). */
  blockHeld: boolean
  /** IA_WALK tapped (Ctrl in the Unity Explorer): dodge roll (dungeon). */
  dodgePressed: boolean
  action?: CombatControlAction
} {
  const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false
  if (locked !== controls.previousPointerLock) {
    controls.pointerArmed = false
    controls.pointerDelay = 0.18
    controls.previousPointerLock = locked
  }
  controls.delay = Math.max(0, controls.delay - dt)
  if (!controls.armed && controls.delay === 0 && keyboardActionButtonsReleased()) controls.armed = true
  controls.pointerDelay = Math.max(0, controls.pointerDelay - dt)
  if (locked && controls.pointerDelay === 0 && !inputSystem.isPressed(InputAction.IA_POINTER)) controls.pointerArmed = true
  if (!locked) controls.pointerArmed = false

  // Explorer disables its Player input map when chat or menus have focus.
  // Mouse capture must not gate keyboard movement or E/F/Space.
  const acceptsKeys = controls.armed
  // The native controller can jump while scene attack controls are rearming.
  const jumpPressed = inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN)
  const blockHeld = acceptsKeys && inputSystem.isPressed(InputAction.IA_JUMP)
  const dodgePressed = acceptsKeys && inputSystem.isTriggered(InputAction.IA_WALK, PointerEventType.PET_DOWN)
  if (!acceptsKeys) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed }
  if (jumpPressed) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed, action: 'jump' }
  // Holding an attack key keeps requesting the attack; the fighter only accepts
  // it once the current swing and its recovery are over, so a held key chains
  // strikes back to back. A fresh press still wins over a key that was held.
  if (inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed, action: 'heavy' }
  if (
    inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) ||
    (locked && controls.pointerArmed && inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN))
  ) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed, action: 'light' }
  if (inputSystem.isPressed(InputAction.IA_SECONDARY)) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed, action: 'heavy' }
  if (
    inputSystem.isPressed(InputAction.IA_PRIMARY) ||
    (locked && controls.pointerArmed && inputSystem.isPressed(InputAction.IA_POINTER))
  ) return { acceptsKeys, jumpPressed, blockHeld, dodgePressed, action: 'light' }
  return { acceptsKeys, jumpPressed, blockHeld, dodgePressed }
}

export function actionButtonsReleased() {
  return !inputSystem.isPressed(InputAction.IA_POINTER) && keyboardActionButtonsReleased()
}

function keyboardActionButtonsReleased() {
  return !inputSystem.isPressed(InputAction.IA_PRIMARY) &&
    !inputSystem.isPressed(InputAction.IA_SECONDARY) &&
    !inputSystem.isPressed(InputAction.IA_JUMP)
}
