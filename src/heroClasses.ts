// Hero classes. A class is tied to the character: Vanguard and Brute fight
// with the blade set every sword clip was made for, Scout is the archer and
// Striker the spellblade. The class decides which weapons the hero may carry,
// what the light string / heavy / guard play as, and whether an attack is a
// swing (hits at the contact frame) or a shot (spawns a projectile at it).
//
// Nothing here is saved or synced: the class derives from the `cid` every
// HeroBody and hero save already carries.

import type { EquipmentMotion } from './combatAnimations'
import type { HeroAttackMotion } from './combatActions'
import type { WeaponClass } from './weapons'

export type HeroClass = 'blade' | 'bow' | 'magic'

export type ProjectileKind = 'arrow' | 'bolt' | 'orb'

/** How a ranged motion's projectile flies. Damage comes from `resolveCombatHit`, like a swing. */
export type ShotProfile = {
  kind: ProjectileKind
  /** Metres per second. */
  speed: number
  /** Metres before the projectile fades. Also the host's reach check for the motion. */
  range: number
  /** Metres from the projectile's centre that count as a hit on an enemy. */
  radius: number
  /** Projectiles per shot; more than one fans out over `spread` degrees. */
  count: number
  spread: number
  /** Orbs that go off: every enemy within this many metres of the impact is hit. */
  burst?: number
}

export interface HeroClassDefinition {
  id: HeroClass
  label: string
  blurb: string
  /** Weapon classes the hero can equip; loot for the party is drawn from these. */
  weaponClasses: WeaponClass[]
  /** Always owned; what a fresh hero holds. */
  starterWeapon: string
  /** The light string, cycled by combo step; the last is the finisher. */
  light: HeroAttackMotion[]
  heavy: HeroAttackMotion
  /** Played instead of the light when an enemy stands this close (ranged classes). */
  pointBlank?: { motion: HeroAttackMotion; range: number }
  block: EquipmentMotion
  /** Soft lock-on: the nearest enemy inside this half-angle (degrees) and range is aimed at. */
  aimCone: number
  ranged: Partial<Record<HeroAttackMotion, ShotProfile>>
}

export const HERO_CLASSES: Record<HeroClass, HeroClassDefinition> = {
  blade: {
    id: 'blade',
    label: 'Blade',
    blurb: 'Steel in hand. Light strings, heavy blows and a guard to hide behind.',
    weaponClasses: ['sword', 'dagger', 'axe', 'mace', 'hammer', 'club', 'great'],
    starterWeapon: 'pride-sword',
    light: ['attack_light', 'attack_light2', 'attack_light'],
    heavy: 'attack_heavy',
    block: 'block',
    aimCone: 40,
    ranged: {}
  },
  bow: {
    id: 'bow',
    label: 'Bow',
    blurb: 'Arrows from range; a leaping volley for the heavy, the bow itself when they close in.',
    weaponClasses: ['bow'],
    starterWeapon: 'bw-longbow-01',
    light: ['bow_shoot', 'bow_shoot', 'bow_shoot'],
    heavy: 'bow_volley',
    pointBlank: { motion: 'bow_bash', range: 1.7 },
    block: 'bow_block',
    aimCone: 35,
    ranged: {
      bow_shoot: { kind: 'arrow', speed: 30, range: 16, radius: 0.6, count: 1, spread: 0 },
      bow_volley: { kind: 'arrow', speed: 30, range: 16, radius: 0.6, count: 3, spread: 14 }
    }
  },
  magic: {
    id: 'magic',
    label: 'Magic',
    blurb: 'Bolts from the staff; a slow orb that bursts for the heavy, the staff\'s heel up close.',
    weaponClasses: ['staff'],
    starterWeapon: 'dr-staff-01',
    light: ['cast_bolt', 'cast_bolt', 'cast_bolt'],
    heavy: 'cast_nova',
    pointBlank: { motion: 'attack_light', range: 1.7 },
    block: 'block',
    aimCone: 35,
    ranged: {
      cast_bolt: { kind: 'bolt', speed: 20, range: 14, radius: 0.7, count: 1, spread: 0 },
      cast_nova: { kind: 'orb', speed: 9, range: 12, radius: 0.9, count: 1, spread: 0, burst: 2.5 }
    }
  }
}

const CLASS_OF_CHARACTER: Record<string, HeroClass> = {
  vanguard: 'blade',
  brute: 'blade',
  scout: 'bow',
  striker: 'magic'
}

/** Unknown characters (another build's hero, an enemy body) fight as blades. */
export function classOfCharacter(characterId: string | undefined): HeroClass {
  return (characterId && CLASS_OF_CHARACTER[characterId]) || 'blade'
}

export function heroClassOf(characterId: string | undefined): HeroClassDefinition {
  return HERO_CLASSES[classOfCharacter(characterId)]
}

/** The projectile a motion fires, if it is a shot rather than a swing. */
export function shotProfile(characterId: string | undefined, motion: HeroAttackMotion): ShotProfile | undefined {
  return heroClassOf(characterId).ranged[motion]
}

/** The profile a motion fires for whichever class owns it (a remote shot arrives before the shooter's body is known). */
export function shotProfileForMotion(motion: HeroAttackMotion): ShotProfile | undefined {
  for (const cls of Object.values(HERO_CLASSES)) {
    const profile = cls.ranged[motion]
    if (profile) return profile
  }
  return undefined
}

export function isRangedMotion(characterId: string | undefined, motion: HeroAttackMotion): boolean {
  return !!shotProfile(characterId, motion)
}

/** Whether this hero may carry the weapon (by its class). Unknown weapons are allowed so old saves keep working. */
export function classAllowsWeapon(characterId: string | undefined, weaponClass: WeaponClass | undefined): boolean {
  if (!weaponClass) return true
  return heroClassOf(characterId).weaponClasses.includes(weaponClass)
}

/** Weapon classes any of these characters can use; the loot pool for a party. */
export function weaponPoolFor(characterIds: Iterable<string>): WeaponClass[] {
  const out = new Set<WeaponClass>()
  for (const id of characterIds) for (const c of heroClassOf(id).weaponClasses) out.add(c)
  if (!out.size) for (const c of HERO_CLASSES.blade.weaponClasses) out.add(c)
  return [...out]
}
