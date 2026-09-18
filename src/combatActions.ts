import { Vector3 } from '@dcl/sdk/math'
import { COMBAT_CLIPS } from './combatAnimations'

export type AttackMotion = 'attack_light' | 'attack_light2' | 'attack_heavy'
export type WeaponMotion = AttackMotion | 'attack_light3' | 'flourish_heavy' | 'stab' | 'heavy_combo_a' | 'heavy_combo_b' | 'heavy_combo_c' | 'leap' | 'fencing'
export type CombatPose = { position: Vector3; facing: number }
export const MAX_COMBAT_HEALTH = 100
export const STAMINA = {
  max: 100,
  heavyCost: 30,
  dodgeCost: 18,
  regenPerSecond: 26,
  regenDelay: 0.6
} as const
/** A light string continues if the next light starts within this long after the previous one ends. */
export const COMBO_WINDOW = 0.7
/** Tapped inputs that arrive mid-swing are kept this long and fired when the fighter is free. */
export const INPUT_BUFFER = 0.4
export const COMBAT_RULES = {
  approachRange: 1.72,
  approachStop: 1.65,
  rivalSpeed: 1.9,
  bodySeparation: 0.95,
  maximumVerticalReach: 1.4
} as const

export function combatDistance(first: CombatPose, second: CombatPose): number {
  const x = first.position.x - second.position.x
  const z = first.position.z - second.position.z
  return Math.sqrt(x * x + z * z)
}

export function facesCombatant(attacker: CombatPose, target: CombatPose, minimumDot: number): boolean {
  const distance = combatDistance(attacker, target)
  if (distance < 0.0001) return true
  return (Math.sin(attacker.facing) * (target.position.x - attacker.position.x) +
    Math.cos(attacker.facing) * (target.position.z - attacker.position.z)) / distance >= minimumDot
}

export function attackRange(motion: WeaponMotion): number {
  if (motion === 'leap' || motion === 'flourish_heavy') return 3.4
  if (motion === 'stab' || motion === 'heavy_combo_a' || motion === 'heavy_combo_b' || motion === 'heavy_combo_c') return 2.55
  if (motion === 'attack_heavy') return 2.15
  if (motion === 'fencing') return 2.05
  return 1.9
}

export function isHeavyMotion(motion: WeaponMotion): boolean {
  return motion === 'attack_heavy' || motion === 'flourish_heavy' || motion === 'stab' ||
    motion === 'heavy_combo_a' || motion === 'heavy_combo_b' || motion === 'heavy_combo_c' || motion === 'leap'
}

/** The same sword reach applies to arena and roaming attacks, including midair strikes. */
export function attackCanReach(attacker: CombatPose, target: CombatPose, motion: WeaponMotion): boolean {
  const range = attackRange(motion)
  const aim = motion === 'leap' || motion === 'flourish_heavy' ? 0.15 : 0.55
  return Math.abs(attacker.position.y - target.position.y) <= COMBAT_RULES.maximumVerticalReach &&
    combatDistance(attacker, target) <= range && facesCombatant(attacker, target, aim)
}

export function resolveCombatHit(motion: WeaponMotion, guarded: boolean, finisher = false): {
  damage: number; stagger: number; knockback: number; interrupt: boolean
} {
  const heavy = isHeavyMotion(motion)
  const smash = motion === 'flourish_heavy' || motion === 'heavy_combo_c' || motion === 'leap'
  // The third light of a string breaks guard like a heavy does.
  if (guarded && !heavy && !finisher) return { damage: 0, stagger: 0, knockback: 0, interrupt: false }
  const raw = smash ? 34 : motion === 'stab' ? 26 : motion === 'heavy_combo_a' || motion === 'heavy_combo_b' ? 24
    : heavy ? 28 : finisher || motion === 'attack_light3' ? 22 : motion === 'fencing' ? 12 : 14
  return {
    damage: guarded ? Math.max(4, Math.round(raw * 0.2)) : raw,
    stagger: guarded ? Math.min(0.32, COMBAT_CLIPS.hit.duration) : COMBAT_CLIPS.hit.duration * (heavy || finisher ? 1 : 0.7),
    knockback: guarded ? 0.1 : smash ? 0.55 : heavy ? 0.36 : finisher ? 0.5 : 0.17,
    interrupt: true
  }
}

export type Swing = {
  motion: WeaponMotion
  elapsed: number
  startedAt: number
  duration: number
  contact: number
  contacted: boolean
  /** Third light in a string: heavier hit, longer recovery. */
  finisher?: boolean
}

/** Jumping changes the pose/height, not attack eligibility. */
export function canStartAttack(actor: { swing?: Swing; recovery: number; health?: number; stagger?: number }): boolean {
  return !actor.swing && actor.recovery <= 0 && (actor.health ?? 1) > 0 && (actor.stagger ?? 0) <= 0
}

/** Arena and roaming share animation, contact and recovery timing. */
export function createSwing(motion: WeaponMotion, now: number, finisher = false): Swing {
  const clip = COMBAT_CLIPS[motion]
  return { motion, elapsed: 0, startedAt: now, duration: clip.duration,
    contact: clip.contact ?? clip.duration * 0.45, contacted: false, finisher }
}

export function advanceAttack(swing: Swing, now: number, dt: number, onContact: () => void): boolean {
  // A newly selected action starts its animation at time zero this update.
  if (swing.startedAt === now) return false
  swing.elapsed += dt
  if (!swing.contacted && swing.elapsed >= swing.contact) {
    swing.contacted = true
    onContact()
  }
  return swing.elapsed >= swing.duration
}

export function attackRecovery(motion: WeaponMotion, finisher = false): number {
  if (motion === 'flourish_heavy' || motion === 'heavy_combo_c' || motion === 'leap') return 0.38
  if (isHeavyMotion(motion)) return 0.26
  return finisher ? 0.3 : 0.12
}
