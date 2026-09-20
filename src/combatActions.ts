import { Vector3 } from '@dcl/sdk/math'
import { COMBAT_CLIPS } from './combatAnimations'

/** The sword blows every fighter (enemies included) can throw. */
export type AttackMotion = 'attack_light' | 'attack_light2' | 'attack_heavy'
/** Archer and spellblade actions, heroes only (src/heroClasses.ts). */
export type ClassAttackMotion = 'bow_shoot' | 'bow_volley' | 'bow_bash' | 'cast_bolt' | 'cast_nova'
/** The Berserker's iron: a low cross-cut, an overhead smash to end the string, and a leap that closes the gap. */
export type HeavyAttackMotion = 'attack_light3' | 'heavy_combo_c' | 'leap'
/** What a hero's light/heavy can come out as. */
export type HeroAttackMotion = AttackMotion | ClassAttackMotion | HeavyAttackMotion
export type WeaponMotion = HeroAttackMotion | 'flourish_heavy' | 'stab' | 'heavy_combo_a' | 'heavy_combo_b' | 'fencing'

/** Swings that draw a slash arc: everything a hand-held blade does, shots and the bow's shove excepted. */
export function isSlashMotion(motion: WeaponMotion): boolean {
  return motion === 'attack_light' || motion === 'attack_light2' || motion === 'attack_heavy' ||
    motion === 'attack_light3' || motion === 'heavy_combo_c' || motion === 'leap'
}

const RANGED_MOTIONS: ReadonlySet<WeaponMotion> = new Set<WeaponMotion>(['bow_shoot', 'bow_volley', 'cast_bolt', 'cast_nova'])

/** A shot: the blow lands where the projectile does, not at the contact frame. */
export function isRangedAttack(motion: WeaponMotion): boolean {
  return RANGED_MOTIONS.has(motion)
}
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
  // Shots: how far the projectile flies (src/heroClasses.ts keeps the same numbers).
  if (motion === 'bow_shoot' || motion === 'bow_volley') return 16
  if (motion === 'cast_bolt') return 14
  if (motion === 'cast_nova') return 12
  if (motion === 'leap' || motion === 'flourish_heavy') return 3.4
  if (motion === 'stab' || motion === 'heavy_combo_a' || motion === 'heavy_combo_b' || motion === 'heavy_combo_c') return 2.55
  if (motion === 'attack_heavy') return 2.15
  if (motion === 'fencing') return 2.05
  return 1.9
}

export function isHeavyMotion(motion: WeaponMotion): boolean {
  return motion === 'attack_heavy' || motion === 'flourish_heavy' || motion === 'stab' ||
    motion === 'heavy_combo_a' || motion === 'heavy_combo_b' || motion === 'heavy_combo_c' || motion === 'leap' ||
    motion === 'bow_volley' || motion === 'cast_nova'
}

/** The same sword reach applies to arena and roaming attacks, including midair strikes. */
export function attackCanReach(attacker: CombatPose, target: CombatPose, motion: WeaponMotion): boolean {
  const range = attackRange(motion)
  const aim = motion === 'leap' || motion === 'flourish_heavy' ? 0.15 : 0.55
  return Math.abs(attacker.position.y - target.position.y) <= COMBAT_RULES.maximumVerticalReach &&
    combatDistance(attacker, target) <= range && facesCombatant(attacker, target, aim)
}

/** What the weapon in hand does to a blow: class multipliers and the rarity's flat bonus. */
export type WeaponModifiers = { damage: number; stagger: number; knockback: number; bonus: number }
const PLAIN_SWORD: WeaponModifiers = { damage: 1, stagger: 1, knockback: 1, bonus: 0 }

export function resolveCombatHit(motion: WeaponMotion, guarded: boolean, finisher = false, weapon: WeaponModifiers = PLAIN_SWORD): {
  damage: number; stagger: number; knockback: number; interrupt: boolean
} {
  const heavy = isHeavyMotion(motion)
  const smash = motion === 'flourish_heavy' || motion === 'heavy_combo_c' || motion === 'leap' || motion === 'cast_nova'
  // The third light of a string breaks guard like a heavy does.
  if (guarded && !heavy && !finisher) return { damage: 0, stagger: 0, knockback: 0, interrupt: false }
  const base = smash ? 34 : motion === 'stab' ? 26 : motion === 'heavy_combo_a' || motion === 'heavy_combo_b' ? 24
    // A volley is three arrows: each one lighter than a single aimed shot.
    : motion === 'bow_volley' ? 16
    : heavy ? 28 : finisher || motion === 'attack_light3' ? 22 : motion === 'fencing' ? 12
    : motion === 'bow_shoot' ? 16 : motion === 'cast_bolt' ? 15 : motion === 'bow_bash' ? 10 : 14
  const raw = Math.round(base * weapon.damage + weapon.bonus)
  const stagger = guarded ? Math.min(0.32, COMBAT_CLIPS.hit.duration) : COMBAT_CLIPS.hit.duration * (heavy || finisher ? 1 : 0.7)
  // The bow bash is all shove: it buys the archer room rather than health.
  const knockback = guarded ? 0.1 : smash ? 0.55 : motion === 'bow_bash' ? 0.6 : heavy ? 0.36 : finisher ? 0.5 : 0.17
  return {
    damage: guarded ? Math.max(4, Math.round(raw * 0.2)) : raw,
    // A blocked blow's reel is capped as authored; a landed one carries the weapon's weight.
    stagger: guarded ? stagger : Math.min(COMBAT_CLIPS.hit.duration * 1.5, stagger * weapon.stagger),
    knockback: knockback * (guarded ? 1 : weapon.knockback),
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
  /** The wind-up's forward carry has been issued (roaming ground swings only). */
  lunged?: boolean
}

/** Jumping changes the pose/height, not attack eligibility. */
export function canStartAttack(actor: { swing?: Swing; recovery: number; health?: number; stagger?: number }): boolean {
  return !actor.swing && actor.recovery <= 0 && (actor.health ?? 1) > 0 && (actor.stagger ?? 0) <= 0
}

/** Arena and roaming share animation, contact and recovery timing. */
export function createSwing(motion: WeaponMotion, now: number, finisher = false): Swing {
  const clip = COMBAT_CLIPS[motion]
  // Timing is in real seconds: a clip shown at `rate` reaches its frames sooner.
  const rate = clip.rate ?? 1
  return { motion, elapsed: 0, startedAt: now, duration: clip.duration / rate,
    contact: (clip.contact ?? clip.duration * 0.45) / rate, contacted: false, finisher }
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
  if (motion === 'flourish_heavy' || motion === 'heavy_combo_c' || motion === 'leap' || motion === 'cast_nova') return 0.38
  if (isHeavyMotion(motion)) return 0.26
  return finisher ? 0.3 : 0.12
}
