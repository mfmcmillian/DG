// Skills: the four abilities each class earns by level and fires from keys
// 1–4. Shared by the headless server, which validates and applies them, and
// the clients, which play them and show the bar.
//
// Every skill is one of four mechanics the fight already knows how to
// resolve, so a class's kit is data, not code:
//   strike — a melee blow with its own arc, reach and step-in; can hit everyone in the arc
//   zone   — a circle of ground that hurts, at the hero's feet or where they aim, once or in ticks
//   shot   — a projectile with a twist: it pierces, chains, or bursts
//   aura   — a timed buff or a heal on the hero or the party around them
//
// A skill costs stamina like a heavy and then waits out its cooldown. Level
// gates are per slot: the first skill comes in the first run, the last takes
// a few clears.

import type { WeaponMotion } from '../combatActions'
import type { HeroClass } from '../heroClasses'

export type SkillId =
  | 'lunge' | 'whirlwind' | 'rally' | 'iron_ward'
  | 'ground_slam' | 'cleave' | 'berserk' | 'second_wind'
  | 'piercing_shot' | 'arrow_rain' | 'explosive_arrow' | 'focus'
  | 'chain_bolt' | 'fire_circle' | 'mend' | 'arcane_shield'

export type SkillEffect =
  | {
    kind: 'strike'
    /** Half-angle of the arc that counts, degrees (180 = all around). */
    arc: number
    range: number
    /** Ground the wind-up carries the hero, metres (capped at the target's distance). */
    carry: number
    /** Damage against a heavy blow (28). */
    mult: number
    /** Every enemy in the arc, or only the nearest. */
    all: boolean
    stagger: number
    knockback: number
  }
  | {
    kind: 'zone'
    at: 'self' | 'aim'
    /** How far ahead the aimed circle lands when nothing is locked on. */
    aimRange: number
    radius: number
    mult: number
    /** Blows delivered, spread over `seconds` (1 = once, on impact). */
    ticks: number
    seconds: number
    stagger: number
    knockback: number
  }
  | {
    kind: 'shot'
    variant: 'pierce' | 'chain' | 'burst'
    /** Damage against a heavy blow (28), per body hit. */
    mult: number
    /** Chain: bodies after the first, and how far the arc jumps. Burst: the blast radius. */
    chain?: number
    reach?: number
    radius?: number
    speed: number
    range: number
  }
  | {
    kind: 'aura'
    target: 'self' | 'party'
    /** Party: allies within this many metres of the caster. */
    radius: number
    seconds: number
    /** Multipliers on damage dealt / taken while it lasts (1 = unchanged). */
    might: number
    toughness: number
    /** Health restored on cast. */
    heal: number
  }

export type SkillDef = {
  id: SkillId
  name: string
  cls: HeroClass
  /** 0..3: the key (1–4) and the order the kit unlocks in. */
  slot: number
  /** Hero level that unlocks it. */
  level: number
  blurb: string
  cooldown: number
  stamina: number
  /** The clip the body plays, at its authored speed; `contact` (clip seconds) is when the effect fires, when the clip table has none. */
  motion: WeaponMotion
  contact?: number
  /** Bar tint. */
  color: [number, number, number]
  effect: SkillEffect
}

/** The levels the four slots open at, the same for every class. */
export const SKILL_LEVELS = [2, 5, 9, 14] as const

const BLADE: [number, number, number] = [0.85, 0.88, 1]
const HEAVY: [number, number, number] = [1, 0.55, 0.3]
const BOW: [number, number, number] = [0.55, 0.9, 0.5]
const MAGIC: [number, number, number] = [0.7, 0.55, 1]

export const SKILLS: Record<SkillId, SkillDef> = {
  // --- Blade: the Vanguard --------------------------------------------------------
  lunge: {
    id: 'lunge', name: 'Lunge', cls: 'blade', slot: 0, level: SKILL_LEVELS[0],
    blurb: 'A fencer\'s thrust that covers three metres and breaks a guard.',
    cooldown: 6, stamina: 15, motion: 'fencing', contact: 0.42, color: BLADE,
    effect: { kind: 'strike', arc: 30, range: 2.3, carry: 3, mult: 1.25, all: false, stagger: 1, knockback: 0.4 }
  },
  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', cls: 'blade', slot: 1, level: SKILL_LEVELS[1],
    blurb: 'One turning cut that reaches everyone around you.',
    cooldown: 10, stamina: 25, motion: 'flourish_heavy', contact: 0.98, color: BLADE,
    effect: { kind: 'strike', arc: 180, range: 2.7, carry: 0, mult: 1.1, all: true, stagger: 1, knockback: 0.5 }
  },
  rally: {
    id: 'rally', name: 'Rally', cls: 'blade', slot: 2, level: SKILL_LEVELS[2],
    blurb: 'A cry that puts a fifth more weight behind every ally\'s blows for eight seconds.',
    cooldown: 20, stamina: 10, motion: 'menace_enter', contact: 0.6, color: BLADE,
    effect: { kind: 'aura', target: 'party', radius: 9, seconds: 8, might: 1.2, toughness: 1, heal: 0 }
  },
  iron_ward: {
    id: 'iron_ward', name: 'Iron Ward', cls: 'blade', slot: 3, level: SKILL_LEVELS[3],
    blurb: 'Set your feet: blows take two fifths less out of you for six seconds.',
    cooldown: 18, stamina: 15, motion: 'flourish', contact: 0.7, color: BLADE,
    effect: { kind: 'aura', target: 'self', radius: 0, seconds: 6, might: 1, toughness: 0.6, heal: 0 }
  },

  // --- Heavy: the Berserker ---------------------------------------------------------
  ground_slam: {
    id: 'ground_slam', name: 'Ground Slam', cls: 'heavy', slot: 0, level: SKILL_LEVELS[0],
    blurb: 'Bring the iron down: everyone within three metres is hit and thrown back.',
    cooldown: 9, stamina: 25, motion: 'heavy_combo_c', contact: 0.72, color: HEAVY,
    effect: { kind: 'zone', at: 'self', aimRange: 0, radius: 3.2, mult: 1.3, ticks: 1, seconds: 0, stagger: 1.3, knockback: 0.8 }
  },
  cleave: {
    id: 'cleave', name: 'Cleave', cls: 'heavy', slot: 1, level: SKILL_LEVELS[1],
    blurb: 'A stepping cut through everything in front of you.',
    cooldown: 8, stamina: 20, motion: 'heavy_combo_a', contact: 0.86, color: HEAVY,
    effect: { kind: 'strike', arc: 75, range: 2.9, carry: 1.6, mult: 1.2, all: true, stagger: 1, knockback: 0.45 }
  },
  berserk: {
    id: 'berserk', name: 'Berserk', cls: 'heavy', slot: 2, level: SKILL_LEVELS[2],
    blurb: 'Eight seconds of a third more damage dealt, and a little more taken.',
    cooldown: 22, stamina: 10, motion: 'menace_enter', contact: 0.6, color: HEAVY,
    effect: { kind: 'aura', target: 'self', radius: 0, seconds: 8, might: 1.35, toughness: 1.15, heal: 0 }
  },
  second_wind: {
    id: 'second_wind', name: 'Second Wind', cls: 'heavy', slot: 3, level: SKILL_LEVELS[3],
    blurb: 'Shake it off: thirty health back on the spot.',
    cooldown: 25, stamina: 0, motion: 'flourish', contact: 0.7, color: HEAVY,
    effect: { kind: 'aura', target: 'self', radius: 0, seconds: 0, might: 1, toughness: 1, heal: 30 }
  },

  // --- Bow: the Scout -------------------------------------------------------------------
  piercing_shot: {
    id: 'piercing_shot', name: 'Piercing Shot', cls: 'bow', slot: 0, level: SKILL_LEVELS[0],
    blurb: 'An arrow that goes through every body in its line.',
    cooldown: 7, stamina: 15, motion: 'bow_shoot', color: BOW,
    effect: { kind: 'shot', variant: 'pierce', mult: 1.3, speed: 36, range: 18 }
  },
  arrow_rain: {
    id: 'arrow_rain', name: 'Arrow Rain', cls: 'bow', slot: 1, level: SKILL_LEVELS[1],
    blurb: 'Three volleys fall on the ground you aim at over two seconds.',
    cooldown: 12, stamina: 25, motion: 'bow_volley', color: BOW,
    effect: { kind: 'zone', at: 'aim', aimRange: 7, radius: 3, mult: 0.6, ticks: 3, seconds: 2, stagger: 0.5, knockback: 0.15 }
  },
  explosive_arrow: {
    id: 'explosive_arrow', name: 'Explosive Arrow', cls: 'bow', slot: 2, level: SKILL_LEVELS[2],
    blurb: 'An arrow that bursts where it lands, two metres around.',
    cooldown: 10, stamina: 20, motion: 'bow_shoot', color: BOW,
    effect: { kind: 'shot', variant: 'burst', mult: 1.1, radius: 2.2, speed: 30, range: 16 }
  },
  focus: {
    id: 'focus', name: 'Focus', cls: 'bow', slot: 3, level: SKILL_LEVELS[3],
    blurb: 'Breathe: for six seconds every arrow carries two fifths more.',
    cooldown: 20, stamina: 10, motion: 'menace_enter', contact: 0.6, color: BOW,
    effect: { kind: 'aura', target: 'self', radius: 0, seconds: 6, might: 1.4, toughness: 1, heal: 0 }
  },

  // --- Magic: the Striker --------------------------------------------------------------
  chain_bolt: {
    id: 'chain_bolt', name: 'Chain Bolt', cls: 'magic', slot: 0, level: SKILL_LEVELS[0],
    blurb: 'A bolt that leaps to three more enemies near the first.',
    cooldown: 7, stamina: 15, motion: 'cast_bolt', color: MAGIC,
    effect: { kind: 'shot', variant: 'chain', mult: 1, chain: 3, reach: 4.5, speed: 22, range: 14 }
  },
  fire_circle: {
    id: 'fire_circle', name: 'Fire Circle', cls: 'magic', slot: 1, level: SKILL_LEVELS[1],
    blurb: 'Burning ground where you aim: four bites of flame over four seconds.',
    cooldown: 14, stamina: 25, motion: 'cast_nova', color: MAGIC,
    effect: { kind: 'zone', at: 'aim', aimRange: 7, radius: 2.8, mult: 0.55, ticks: 4, seconds: 4, stagger: 0.4, knockback: 0.1 }
  },
  mend: {
    id: 'mend', name: 'Mend', cls: 'magic', slot: 2, level: SKILL_LEVELS[2],
    blurb: 'Thirty health to every ally within nine metres, yourself included.',
    cooldown: 20, stamina: 15, motion: 'flourish', contact: 0.7, color: MAGIC,
    effect: { kind: 'aura', target: 'party', radius: 9, seconds: 0, might: 1, toughness: 1, heal: 30 }
  },
  arcane_shield: {
    id: 'arcane_shield', name: 'Arcane Shield', cls: 'magic', slot: 3, level: SKILL_LEVELS[3],
    blurb: 'A ward over the party: blows take three tenths less for six seconds.',
    cooldown: 24, stamina: 15, motion: 'cast_nova', color: MAGIC,
    effect: { kind: 'aura', target: 'party', radius: 9, seconds: 6, might: 1, toughness: 0.7, heal: 0 }
  }
}

const BY_CLASS: Record<HeroClass, SkillDef[]> = { blade: [], heavy: [], bow: [], magic: [] }
for (const def of Object.values(SKILLS)) BY_CLASS[def.cls].push(def)
for (const kit of Object.values(BY_CLASS)) kit.sort((a, b) => a.slot - b.slot)

/** A class's four skills, in slot order. */
export function skillsFor(cls: HeroClass): SkillDef[] {
  return BY_CLASS[cls]
}

export function skillById(id: string): SkillDef | undefined {
  return (SKILLS as Record<string, SkillDef>)[id]
}

/** The skill of `cls` in `slot` if `level` has reached it. */
export function skillInSlot(cls: HeroClass, slot: number, level: number): SkillDef | undefined {
  const def = BY_CLASS[cls][slot]
  return def && level >= def.level ? def : undefined
}

/** Skills a climb from `from` to `to` opened, for the level-up notice. */
export function skillsUnlockedBetween(cls: HeroClass, from: number, to: number): SkillDef[] {
  return BY_CLASS[cls].filter((def) => def.level > from && def.level <= to)
}

/** How the bar and the tooltips describe what a skill does. */
export function skillSummary(def: SkillDef): string {
  const e = def.effect
  switch (e.kind) {
    case 'strike': return `${e.all ? 'Everyone' : 'One enemy'} within ${e.range} m · ${Math.round(e.mult * 100)}% heavy damage`
    case 'zone': return `${e.radius} m circle${e.at === 'aim' ? ' where you aim' : ' around you'} · ${e.ticks > 1 ? `${e.ticks} hits over ${e.seconds} s` : 'one hit'}`
    case 'shot': return e.variant === 'pierce' ? 'Passes through every body in line'
      : e.variant === 'chain' ? `Jumps to ${e.chain} more enemies` : `Bursts ${e.radius} m around the hit`
    case 'aura': {
      const parts: string[] = []
      if (e.heal) parts.push(`+${e.heal} health`)
      if (e.might !== 1) parts.push(`${e.might > 1 ? '+' : ''}${Math.round((e.might - 1) * 100)}% damage dealt`)
      if (e.toughness !== 1) parts.push(`${e.toughness > 1 ? '+' : ''}${Math.round((e.toughness - 1) * 100)}% damage taken`)
      if (e.seconds) parts.push(`${e.seconds} s`)
      return `${e.target === 'party' ? 'Party' : 'You'} · ${parts.join(' · ')}`
    }
  }
}
