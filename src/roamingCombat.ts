import { Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import {
  advanceAttack, attackRecovery, AttackMotion, canStartAttack, COMBO_WINDOW, createSwing,
  INPUT_BUFFER, MAX_COMBAT_HEALTH, STAMINA, Swing
} from './combatActions'
import { COMBAT_CLIPS, EquipmentMotion, JumpMotion, NATIVE_JUMP_CLIPS } from './combatAnimations'
import { CombatControlAction, createCombatControls, readCombatControls, resetCombatControls } from './combatControls'
import { getEquipmentJumpMotion, setEquipmentMotion } from './equipmentAvatar'

type NativeJump = {
  motion: JumpMotion
  phase: 'air' | 'land'
  elapsed: number
  descending: boolean
  stillSeconds: number
  poseOverride?: EquipmentMotion
}

type Dodge = {
  elapsed: number
  /** Unit direction on the ground. */
  direction: Vector3
  travelling: boolean
  pose: EquipmentMotion
}

export type AttackContext = { finisher: boolean }

export type RoamingCombatHooks = {
  /** A swing has just been selected; a good moment to lock on and step in. */
  onAttackStart?: (motion: AttackMotion, context: AttackContext) => void
  /** A ground swing's wind-up is under way: carry the body forward into the
   *  hit over `seconds` (the step the swing clips are animated with). */
  onAttackLunge?: (motion: AttackMotion, seconds: number) => void
  /** The swing reached its contact frame. */
  onAttackContact?: (motion: AttackMotion, context: AttackContext) => void
  /** The swing (and its recovery) is over, or was interrupted. */
  onAttackEnd?: () => void
  /** The roll's tuck has begun: carry the body along `direction` for `distance`
   *  metres over `seconds`. Fired once per dodge. */
  onDodgeTravel?: (direction: Vector3, distance: number, seconds: number) => void
  onDodgeStart?: (direction: Vector3) => void
  /** Heavy or dodge attempted without stamina. */
  onExhausted?: () => void
  /** Movement input on the ground plane (camera-relative), or undefined when idle. */
  moveDirection?: () => Vector3 | undefined
  /** Where to hop when dodging without movement input (a backstep). */
  retreatDirection?: () => Vector3 | undefined
}

/** The dodge is Synty's forward combat roll (`dodge_roll`) played hurried. */
const ROLL_SECONDS = COMBAT_CLIPS.dodge_roll.duration / (COMBAT_CLIPS.dodge_roll.rate ?? 1)
export const DODGE = {
  /** Real-time length of the roll, plus a beat of recovery before the next action. */
  duration: ROLL_SECONDS,
  /** Damage is ignored for this long from the start of the dodge; the rise at the end is punishable. */
  invulnerable: 0.55,
  /** Ground the roll covers, and the window of the clip it covers it in: the
   *  tuck through the roll. The first frames are the crouch, the last the rise. */
  distance: 2.8,
  travelStart: 0.08,
  travelEnd: ROLL_SECONDS * 0.86
} as const

/**
 * Ground swings are a commitment, as in Diablo or Hades: the host roots the
 * native controller for the swing, the wind-up carries the body forward instead
 * of free steering, and once the blow has landed a movement input may cut the
 * follow-through short. Swings started in the air are left alone.
 */
export const SWING = {
  /** The lunge is issued a beat after the pose so the host's input freeze is up first. */
  lungeDelay: 0.06,
  /** Follow-through that must play after contact before movement may cancel the swing. */
  cancelAfterContact: 0.08
} as const

export function createRoamingCombat() {
  return {
    controls: createCombatControls(),
    health: MAX_COMBAT_HEALTH, stagger: 0,
    stamina: STAMINA.max as number, staminaDelay: 0,
    elapsed: 0, recovery: 0,
    /** Index of the next light in the string (0..2); the third is the finisher. */
    comboStep: 0, comboWindow: 0,
    buffered: undefined as { action: CombatControlAction; ttl: number } | undefined,
    swing: undefined as Swing | undefined,
    /** Space held with the guard up. */
    blocking: false,
    jump: undefined as NativeJump | undefined,
    dodge: undefined as Dodge | undefined,
    jumpRequest: 0,
    positionSampleElapsed: 0,
    previousPosition: undefined as Vector3 | undefined
  }
}

type RoamingCombat = ReturnType<typeof createRoamingCombat>

export function resetRoamingCombat(combat: RoamingCombat) {
  resetCombatControls(combat.controls)
  combat.elapsed = 0
  combat.recovery = 0
  combat.stagger = 0
  combat.comboStep = 0
  combat.comboWindow = 0
  combat.buffered = undefined
  combat.swing = undefined
  combat.blocking = false
  combat.jump = undefined
  combat.dodge = undefined
  combat.jumpRequest = 0
  combat.positionSampleElapsed = 0
  combat.previousPosition = undefined
}

export function restoreRoamingHealth(combat: RoamingCombat) {
  resetRoamingCombat(combat)
  combat.health = MAX_COMBAT_HEALTH
  combat.stamina = STAMINA.max
  combat.staminaDelay = 0
}

export function isRoamingInvulnerable(combat: RoamingCombat): boolean {
  return !!combat.dodge && combat.dodge.elapsed < DODGE.invulnerable
}

export function isRoamingBlocking(combat: RoamingCombat): boolean {
  return combat.blocking
}

/** Returns true when this blow was the killing one. */
export function hitRoamingCharacter(combat: RoamingCombat, damage: number, stagger: number): boolean {
  if (combat.health <= 0) return false
  combat.health = Math.max(0, combat.health - damage)
  combat.stagger = Math.max(combat.stagger, stagger)
  combat.swing = undefined
  combat.buffered = undefined
  combat.comboStep = 0
  combat.comboWindow = 0
  if (combat.health > 0) {
    if (combat.jump) combat.jump.poseOverride = 'hit'
    return false
  }
  // Dead: the body falls and stays down until the world restores it.
  combat.stagger = 0
  combat.recovery = 0
  combat.dodge = undefined
  combat.blocking = false
  if (combat.jump) combat.jump.poseOverride = 'death'
  return true
}

export function isRoamingDead(combat: RoamingCombat): boolean {
  return combat.health <= 0
}

export function healRoamingCharacter(combat: RoamingCombat, amount: number): number {
  const before = combat.health
  combat.health = Math.min(MAX_COMBAT_HEALTH, combat.health + amount)
  return combat.health - before
}

/** Only owns the outfit's action pose. Explorer owns movement, jump and camera. */
export function updateRoamingCombat(
  combat: RoamingCombat, root: Entity, position: Vector3, dt: number, armed: boolean, moving: boolean,
  hooks: RoamingCombatHooks = {}
): EquipmentMotion | undefined {
  if (!Number.isFinite(dt) || dt <= 0) return currentMotion(combat)
  const previous = combat.previousPosition
  // A teleport is neither a jump nor a new attack input. Dodge hops are our own teleports.
  if (previous && !combat.dodge && Vector3.distance(position, previous) > Math.max(1.5, dt * 16)) {
    resetRoamingCombat(combat)
    combat.previousPosition = { ...position }
    return undefined
  }
  combat.previousPosition = { ...position }
  combat.elapsed += dt
  const hadSwingOrRecovery = !!combat.swing || combat.recovery > 0
  combat.recovery = Math.max(0, combat.recovery - dt)
  combat.stagger = Math.max(0, combat.stagger - dt)
  combat.jumpRequest = Math.max(0, combat.jumpRequest - dt)
  combat.comboWindow = Math.max(0, combat.comboWindow - dt)
  if (combat.comboWindow === 0 && !combat.swing) combat.comboStep = 0
  if (combat.buffered) {
    combat.buffered.ttl -= dt
    if (combat.buffered.ttl <= 0) combat.buffered = undefined
  }

  // Stamina regenerates after a short pause following any spend.
  combat.staminaDelay = Math.max(0, combat.staminaDelay - dt)
  if (combat.staminaDelay === 0 && combat.stamina < STAMINA.max) {
    combat.stamina = Math.min(STAMINA.max, combat.stamina + STAMINA.regenPerSecond * dt)
  }

  const { action, blockHeld, dodgePressed } = readCombatControls(combat.controls, dt)

  const dy = previous ? position.y - previous.y : 0
  const dx = previous ? position.x - previous.x : 0
  const dz = previous ? position.z - previous.z : 0
  // Horizontal travel proves this is a fresh movement sample. Identical snapshots
  // between native updates must not be mistaken for an airborne player landing.
  const horizontalSample = dx * dx + dz * dz > 0.00000001
  combat.positionSampleElapsed += dt
  const verticalSpeed = dy / combat.positionSampleElapsed
  if (horizontalSample || Math.abs(dy) > 0.0001) combat.positionSampleElapsed = 0

  // --- dodge -----------------------------------------------------------------
  if (combat.dodge) {
    const dodge = combat.dodge
    dodge.elapsed += dt
    // The travel is issued a tick or two after the pose so the input freeze the
    // host puts up on dodge start is in place before the body starts moving.
    if (!dodge.travelling && dodge.elapsed >= DODGE.travelStart) {
      dodge.travelling = true
      hooks.onDodgeTravel?.(dodge.direction, DODGE.distance, DODGE.travelEnd - DODGE.travelStart)
    }
    if (dodge.elapsed >= DODGE.duration) {
      combat.dodge = undefined
      combat.recovery = Math.max(combat.recovery, 0.05)
    }
  } else if (dodgePressed && combat.stagger <= 0 && combat.health > 0 && !combat.jump) {
    // Ctrl (the SDK's IA_WALK) is the dodge: it cancels recovery, the guard and un-started swings.
    if (combat.stamina < STAMINA.dodgeCost) {
      hooks.onExhausted?.()
    } else {
      const input = hooks.moveDirection?.() ?? hooks.retreatDirection?.()
      const direction = input && Vector3.lengthSquared(input) > 0.01
        ? Vector3.normalize(Vector3.create(input.x, 0, input.z))
        : undefined
      if (direction) {
        combat.stamina -= STAMINA.dodgeCost
        combat.staminaDelay = STAMINA.regenDelay
        if (combat.swing) hooks.onAttackEnd?.()
        combat.swing = undefined
        combat.blocking = false
        combat.buffered = undefined
        combat.recovery = 0
        const pose: EquipmentMotion = 'dodge_roll'
        combat.dodge = { elapsed: 0, direction, travelling: false, pose }
        hooks.onDodgeStart?.(direction)
        setEquipmentMotion(root, pose, true)
        return currentMotion(combat)
      }
    }
  }

  // --- native jump (kept for scenes that still allow it) ----------------------
  const takingOff = combat.jump?.phase !== 'air' && combat.jumpRequest > 0 && dy > 0.003 && dy / dt > 0.3 && !combat.dodge
  if (takingOff) {
    const motion = getEquipmentJumpMotion(root)
    combat.jumpRequest = 0
    combat.jump = { motion, phase: 'air', elapsed: 0, descending: false, stillSeconds: 0,
      poseOverride: combat.stagger > 0 ? 'hit' : combat.swing?.motion }
    if (!combat.swing && combat.stagger <= 0) setEquipmentMotion(root, NATIVE_JUMP_CLIPS[motion].air, true)
  } else if (combat.jump) {
    const jump = combat.jump
    jump.elapsed += dt
    if (jump.phase === 'air') {
      if (dy < -0.003) jump.descending = true
      jump.stillSeconds = Math.abs(dy) < 0.003 ? jump.stillSeconds + dt : 0
      const movingTouchdown = horizontalSample && Math.abs(verticalSpeed) <= 0.03
      const landed = jump.descending && (movingTouchdown || jump.stillSeconds >= 0.08)
      if (landed || (jump.elapsed > 0.4 && jump.stillSeconds >= 0.25)) {
        jump.phase = 'land'
        jump.elapsed = 0
      }
    }
    if (jump.phase === 'land' && (moving || jump.poseOverride || jump.elapsed >= COMBAT_CLIPS[NATIVE_JUMP_CLIPS[jump.motion].land].duration)) {
      combat.jump = undefined
    }
  }

  // --- attacks ---------------------------------------------------------------
  // Inputs that cannot start right now are buffered so a tap during a swing's
  // recovery still comes out, and a heavy tapped mid-string fires as its ender.
  const wantedAction = action === 'light' || action === 'heavy' ? action : undefined
  // Space holds the guard up whenever the fighter is otherwise free. An attack
  // input always wins over a held guard so E/F stay responsive.
  combat.blocking = armed && blockHeld && !wantedAction && !combat.swing && !combat.dodge &&
    combat.stagger <= 0 && combat.health > 0
  if (combat.blocking) {
    combat.comboStep = 0
    combat.comboWindow = 0
    combat.buffered = undefined
  }
  if (wantedAction && armed && !canStartAttack(combat)) {
    combat.buffered = { action: wantedAction, ttl: INPUT_BUFFER }
  }
  if (armed && !combat.dodge && canStartAttack(combat)) {
    const chosen = wantedAction ?? combat.buffered?.action
    if (chosen) {
      combat.buffered = undefined
      let motion: AttackMotion | undefined
      let finisher = false
      if (chosen === 'heavy') {
        if (combat.stamina >= STAMINA.heavyCost) {
          combat.stamina -= STAMINA.heavyCost
          combat.staminaDelay = STAMINA.regenDelay
          motion = 'attack_heavy'
          combat.comboStep = 0
        } else {
          hooks.onExhausted?.()
          // Fall back to a light so a held F never leaves the player standing still.
          motion = lightMotion(combat)
          finisher = combat.comboStep === 2
          combat.comboStep = (combat.comboStep + 1) % 3
        }
      } else {
        motion = lightMotion(combat)
        finisher = combat.comboStep === 2
        combat.comboStep = (combat.comboStep + 1) % 3
      }
      combat.comboWindow = 0
      combat.swing = createSwing(motion, combat.elapsed, finisher)
      if (combat.jump) combat.jump.poseOverride = motion
      setEquipmentMotion(root, motion, true)
      hooks.onAttackStart?.(motion, { finisher })
    }
  }
  const swing = combat.swing
  if (swing && advanceAttack(swing, combat.elapsed, dt, () => hooks.onAttackContact?.(swing.motion as AttackMotion, { finisher: !!swing.finisher }))) {
    combat.swing = undefined
    combat.recovery = attackRecovery(swing.motion, !!swing.finisher)
    // The string may continue for a moment after the recovery; a finisher ends it.
    combat.comboWindow = swing.motion === 'attack_heavy' || swing.finisher ? 0 : combat.recovery + COMBO_WINDOW
    if (swing.finisher || swing.motion === 'attack_heavy') combat.comboStep = 0
  } else if (swing && !combat.jump) {
    if (!swing.lunged && swing.elapsed >= SWING.lungeDelay) {
      swing.lunged = true
      // A swing that touched down late in its wind-up (started in the air) has no time left to travel.
      if (!swing.contacted && swing.contact - swing.elapsed >= 0.1) {
        hooks.onAttackLunge?.(swing.motion as AttackMotion, swing.contact - swing.elapsed)
      }
    }
    // Move-cancel: once the blow has landed, WASD ends the follow-through and the
    // hero is walking again. A buffered attack means the player wants the string
    // to continue, so it is left to play out.
    const wantsToMove = swing.contacted && swing.elapsed >= swing.contact + SWING.cancelAfterContact &&
      !combat.buffered && !!hooks.moveDirection?.()
    if (wantsToMove) {
      combat.swing = undefined
      combat.recovery = 0
      combat.comboWindow = swing.motion === 'attack_heavy' || swing.finisher ? 0 : COMBO_WINDOW
      if (swing.finisher || swing.motion === 'attack_heavy') combat.comboStep = 0
    }
  }
  if (hadSwingOrRecovery && !combat.swing && combat.recovery === 0) hooks.onAttackEnd?.()
  return currentMotion(combat)
}

/** The native controller is held still: rolling, rooted in a ground swing, or dead. */
export function isRoamingRooted(combat: RoamingCombat): boolean {
  return combat.health <= 0 || !!combat.dodge || (!!combat.swing && !combat.jump)
}

function lightMotion(combat: RoamingCombat): AttackMotion {
  return combat.comboStep === 1 ? 'attack_light2' : 'attack_light'
}

function currentMotion(combat: RoamingCombat): EquipmentMotion | undefined {
  if (combat.health <= 0) return 'death'
  if (combat.stagger > 0) return 'hit'
  if (combat.swing) return combat.swing.motion
  if (combat.blocking) return 'block'
  if (combat.dodge) return combat.dodge.pose
  // If a swing ends in the air, hold its final pose until landing. Re-selecting
  // the jump clip here would rewind the body to takeoff partway through flight.
  if (combat.jump) return combat.jump.poseOverride ?? NATIVE_JUMP_CLIPS[combat.jump.motion][combat.jump.phase]
  return undefined
}
