import { AttackMotion, COMBAT_RULES } from './combatActions'

/** Everything an enemy can wind up: the three sword swings, or the boss's ground slam. */
export type RivalAttack = AttackMotion | 'slam'

export type RivalBrain = {
  mode: 'approach' | 'telegraph' | 'cooldown' | 'block'
  timer: number
  /** Length of the current telegraph, so presentation can show progress. */
  telegraphDuration: number
  attackCount: number
  attack: RivalAttack
}

export type RivalProfile = {
  /** Chance to raise the guard instead of attacking when in range. */
  blockChance: number
  /** Multiplies wind-up and cooldown times; below 1 is faster. */
  pace: number
  /** Fixed attack order; by default lights with every third a heavy. */
  pattern?: RivalAttack[]
  /** Distance at which a slam is chosen (boss). */
  slamRange?: number
}

export type RivalDecision = {
  advance: boolean
  block: boolean
  attack?: RivalAttack
  telegraph: string
  /** 0..1 through the current wind-up, when telegraphing. */
  telegraphProgress: number
  /** Which attack is being wound up, when telegraphing. */
  telegraphAttack?: RivalAttack
}

export const DEFAULT_PROFILE: RivalProfile = { blockChance: 0.24, pace: 1 }

export function createRivalBrain(): RivalBrain {
  return { mode: 'approach', timer: 0, telegraphDuration: 0, attackCount: 0, attack: 'attack_light' }
}

/** A round resets the sequence; a hit only cancels the current decision. */
export function resetRivalBrain(brain: RivalBrain, cooldown = 0, resetAttackSequence = true) {
  brain.mode = cooldown > 0 ? 'cooldown' : 'approach'
  brain.timer = cooldown
  brain.telegraphDuration = 0
  if (resetAttackSequence) {
    brain.attackCount = 0
    brain.attack = 'attack_light'
  }
}

export function telegraphSeconds(attack: RivalAttack, pace: number): number {
  return (attack === 'slam' ? 1.3 : attack === 'attack_heavy' ? 0.85 : 0.5) * pace
}

/** Chooses actions without moving entities or taking ownership of the camera. */
export function updateRivalBrain(
  brain: RivalBrain, dt: number, distance: number, available: boolean, profile: RivalProfile = DEFAULT_PROFILE
): RivalDecision {
  const decision: RivalDecision = { advance: false, block: false, telegraph: '', telegraphProgress: 0 }
  // Timers pause while attacking, recovering, staggered, or outside gameplay.
  if (!available) return decision

  if (brain.mode === 'block') {
    brain.timer -= dt
    decision.block = true
    if (brain.timer <= 0) {
      decision.block = false
      brain.mode = 'cooldown'
      brain.timer = 0.35 * profile.pace
    }
    return decision
  }

  if (brain.mode === 'telegraph') {
    brain.timer -= dt
    decision.telegraph = telegraphLabel(brain.attack)
    decision.telegraphAttack = brain.attack
    decision.telegraphProgress = brain.telegraphDuration > 0 ? 1 - Math.max(0, brain.timer) / brain.telegraphDuration : 1
    if (brain.timer <= 0) {
      decision.telegraph = ''
      decision.telegraphAttack = undefined
      decision.attack = brain.attack
      brain.mode = 'cooldown'
      brain.timer = (brain.attack === 'slam' ? 1.4 : brain.attack === 'attack_heavy' ? 0.8 : 0.5) * profile.pace
    }
    return decision
  }

  if (brain.mode === 'cooldown') {
    brain.timer -= dt
    if (brain.timer > 0) return decision
    brain.mode = 'approach'
  }

  // A slam covers more ground than a sword, so the boss may open with it from further out.
  const slamNext = profile.pattern && profile.slamRange !== undefined &&
    profile.pattern[brain.attackCount % profile.pattern.length] === 'slam'
  const reach = slamNext ? profile.slamRange! * 0.8 : COMBAT_RULES.approachRange
  if (distance > reach) {
    decision.advance = true
    return decision
  }

  if (!slamNext && Math.random() < profile.blockChance) {
    brain.mode = 'block'
    brain.timer = (0.6 + Math.random() * 0.3) * profile.pace
    decision.block = true
  } else {
    brain.attackCount++
    brain.attack = profile.pattern
      ? profile.pattern[(brain.attackCount - 1) % profile.pattern.length]
      : brain.attackCount % 3 === 0 ? 'attack_heavy' : brain.attackCount % 2 === 0 ? 'attack_light2' : 'attack_light'
    brain.mode = 'telegraph'
    brain.telegraphDuration = telegraphSeconds(brain.attack, profile.pace)
    brain.timer = brain.telegraphDuration
    decision.telegraph = telegraphLabel(brain.attack)
    decision.telegraphAttack = brain.attack
  }
  return decision
}

function telegraphLabel(attack: RivalAttack): string {
  return attack === 'slam' ? 'Ground slam incoming' : attack === 'attack_heavy' ? 'Heavy strike incoming' : 'Quick strike incoming'
}
