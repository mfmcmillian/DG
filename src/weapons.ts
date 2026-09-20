// Weapons as loot: classes, rarities and drop tables. Pure data and pure
// functions, used by the host (drop rolls, hit resolution), the client
// (damage numbers, pickups, inventory) and the UI (colors, labels).
//
// The look of a weapon is its GLB; how it fights is its class; how rare it is
// decides its flat damage bonus and how often the dungeon hands one over.

import { Color4 } from '@dcl/sdk/math'
import { ArmorRealm, EQUIPMENT_ITEMS, EquipmentItem, getEquipmentItemOrNull } from './equipmentCatalog'
import { classAllowsArmor } from './heroClasses'

export type WeaponClass = 'sword' | 'dagger' | 'axe' | 'mace' | 'hammer' | 'club' | 'great' | 'bow' | 'staff' | 'sceptre'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type WeaponStats = {
  /** Multiplier on a blow's base damage. */
  damage: number
  /** Multiplier on how long the target reels. */
  stagger: number
  /** Multiplier on how far the target is shoved. */
  knockback: number
  /** Flat damage added before guard reduction (from rarity). */
  bonus: number
}

export const WEAPON_CLASSES: Record<WeaponClass, { label: string; blurb: string } & Omit<WeaponStats, 'bonus'>> = {
  sword: { label: 'Sword', blurb: 'Balanced. The blade every clip was made for.', damage: 1, stagger: 1, knockback: 1 },
  dagger: { label: 'Dagger', blurb: 'Light and quick. Less weight behind every cut.', damage: 0.82, stagger: 0.7, knockback: 0.6 },
  axe: { label: 'Axe', blurb: 'Heavy edge. Hits harder, shoves less.', damage: 1.2, stagger: 1, knockback: 0.9 },
  mace: { label: 'Mace', blurb: 'Blunt weight. Reels the target and breaks stances.', damage: 1.05, stagger: 1.4, knockback: 1.3 },
  hammer: { label: 'Hammer', blurb: 'Slow iron. Long stagger, long shove.', damage: 1.1, stagger: 1.5, knockback: 1.5 },
  club: { label: 'Club', blurb: 'Crude and heavy. More shove than cut.', damage: 0.9, stagger: 1.2, knockback: 1.3 },
  great: { label: 'Greatweapon', blurb: 'Two hands\' worth of steel swung with one. Everything hits harder.', damage: 1.35, stagger: 1.25, knockback: 1.35 },
  // Class weapons: the archer's and the spellblade's. Their reach is in the motion, not the class.
  bow: { label: 'Bow', blurb: 'Arrows from range. Light shafts reel less; a volley makes up for it.', damage: 1, stagger: 0.8, knockback: 0.7 },
  staff: { label: 'Staff', blurb: 'Bolts and bursts. Hits stagger more than they shove.', damage: 1, stagger: 1.2, knockback: 0.8 },
  sceptre: { label: 'Sceptre', blurb: 'A short casting focus. Sharper bolts, less weight behind the stagger.', damage: 1.1, stagger: 0.9, knockback: 0.7 }
}

export const RARITIES: Record<Rarity, { label: string; rank: number; bonus: number; color: Color4; coins: number }> = {
  common: { label: 'Common', rank: 0, bonus: 0, color: Color4.create(0.82, 0.82, 0.8, 1), coins: 3 },
  uncommon: { label: 'Uncommon', rank: 1, bonus: 2, color: Color4.create(0.45, 0.9, 0.45, 1), coins: 6 },
  rare: { label: 'Rare', rank: 2, bonus: 4, color: Color4.create(0.4, 0.7, 1, 1), coins: 12 },
  epic: { label: 'Epic', rank: 3, bonus: 6, color: Color4.create(0.78, 0.5, 1, 1), coins: 25 },
  legendary: { label: 'Legendary', rank: 4, bonus: 9, color: Color4.create(1, 0.72, 0.25, 1), coins: 50 }
}

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export type DropSource = 'grunt' | 'elite' | 'boss'

const SWORD_STATS: WeaponStats = { damage: 1, stagger: 1, knockback: 1, bonus: 0 }

export function weaponInfo(id: string): EquipmentItem['weapon'] | undefined {
  return getEquipmentItemOrNull(id)?.weapon
}

/** How this weapon id fights. Unknown or missing weapons fight like a plain sword. */
export function weaponStats(id: string | undefined, withBonus = true): WeaponStats {
  const info = id ? weaponInfo(id) : undefined
  if (!info) return SWORD_STATS
  const cls = WEAPON_CLASSES[info.class]
  return { damage: cls.damage, stagger: cls.stagger, knockback: cls.knockback, bonus: withBonus ? RARITIES[info.rarity].bonus : 0 }
}

/** An armor set's rank follows where it is found: the deeper the realm, the rarer the piece. */
export const ARMOR_RARITY: Record<Exclude<ArmorRealm, ''>, Rarity> = { fortress: 'uncommon', castle: 'rare', forge: 'epic', raid: 'legendary' }

/** How rare a loot item is: a weapon's own rarity, or an armor piece's by its realm. Starter gear is common. */
export function rarityOf(id: string): Rarity {
  const item = getEquipmentItemOrNull(id)
  if (item?.weapon) return item.weapon.rarity
  return item?.realm ? ARMOR_RARITY[item.realm] : 'common'
}

/** Armor pieces of every set found in `realm`, for a class (by its character id). */
export function armorDropsFor(characterId: string, realm: Exclude<ArmorRealm, ''>): EquipmentItem[] {
  return EQUIPMENT_ITEMS.filter((item) => !item.weapon && item.realm === realm && classAllowsArmor(characterId, item.hero))
}

/** How often a slain enemy leaves a piece of armor when it left no weapon. The boss always does. */
const ARMOR_CHANCE: Record<DropSource, number> = { grunt: 0.04, elite: 0.14, boss: 1 }

/**
 * Roll an armor drop for a slain enemy: a piece of one of the realm's sets for
 * a random character present, or '' for nothing.
 */
export function rollArmorDrop(source: DropSource, realm: ArmorRealm, characterIds: string[], rng: () => number = Math.random): string {
  if (!realm || !characterIds.length || rng() >= ARMOR_CHANCE[source]) return ''
  const cid = characterIds[Math.min(characterIds.length - 1, Math.floor(rng() * characterIds.length))]
  const pieces = armorDropsFor(cid, realm)
  if (!pieces.length) return ''
  return pieces[Math.min(pieces.length - 1, Math.floor(rng() * pieces.length))].id
}

export function rarityColor(id: string): Color4 {
  return RARITIES[rarityOf(id)].color
}

/** "Epic · Sword · Dark Fortress" */
export function weaponSubtitle(item: EquipmentItem): string {
  if (!item.weapon) return ''
  return `${RARITIES[item.weapon.rarity].label} · ${WEAPON_CLASSES[item.weapon.class].label} · ${item.weapon.pack}`
}

/** "+20% damage · +40% stagger · +4 damage" for the inventory. */
export function weaponStatLine(item: EquipmentItem): string {
  if (!item.weapon) return ''
  const s = weaponStats(item.id)
  const parts: string[] = []
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`
  if (s.damage !== 1) parts.push(`${pct(s.damage - 1)} damage`)
  if (s.stagger !== 1) parts.push(`${pct(s.stagger - 1)} stagger`)
  if (s.knockback !== 1) parts.push(`${pct(s.knockback - 1)} knockback`)
  if (s.bonus) parts.push(`+${s.bonus} flat damage`)
  return parts.length ? parts.join(' · ') : 'Balanced'
}

// --- drop tables (host) --------------------------------------------------------------


/** Chance that a slain enemy of this kind drops a weapon at all. */
const DROP_CHANCE: Record<DropSource, number> = { grunt: 0.05, elite: 0.3, boss: 1 }

/**
 * Rarity weights at the first fortress on Normal. Each step of level or
 * difficulty moves weight up the ladder; the boss rolls two steps ahead of
 * the room he is in, and never below rare.
 */
const BASE_WEIGHTS: Record<Rarity, number> = { common: 58, uncommon: 30, rare: 10, epic: 2, legendary: 0 }

function rarityWeights(steps: number): Record<Rarity, number> {
  const w = { ...BASE_WEIGHTS }
  for (let i = 0; i < steps; i++) {
    // Shift a slice of every tier one rung up.
    const shift = { common: w.common * 0.3, uncommon: w.uncommon * 0.25, rare: w.rare * 0.25, epic: w.epic * 0.3 }
    w.common -= shift.common
    w.uncommon += shift.common - shift.uncommon
    w.rare += shift.uncommon - shift.rare
    w.epic += shift.rare - shift.epic
    w.legendary += shift.epic
  }
  return w
}

export function allWeapons(): EquipmentItem[] {
  return EQUIPMENT_ITEMS.filter((item) => !!item.weapon)
}

/**
 * Roll a weapon drop for a slain enemy: the item id, or '' for nothing.
 * `level` and `diff` are the run's indices (0-based); `rng` is 0..1. `pool`
 * restricts the draw to weapon classes somebody in the party can use
 * (src/heroClasses.ts weaponPoolFor); undefined means every class.
 */
/** The Colossus's reward: a Legendary the hero's class can wield, or the best below it. */
export function rollRaidDrop(pool: WeaponClass[], rng: () => number = Math.random): string {
  const usable = allWeapons().filter((item) => pool.includes(item.weapon!.class))
  let candidates: EquipmentItem[] = []
  for (let rank = RARITIES.legendary.rank; rank >= 0 && !candidates.length; rank--) {
    candidates = usable.filter((item) => item.weapon!.rarity === RARITY_ORDER[rank])
  }
  if (!candidates.length) return ''
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))].id
}

export function rollWeaponDrop(
  source: DropSource, level: number, diff: number, rng: () => number = Math.random, pool?: WeaponClass[]
): string {
  if (rng() >= DROP_CHANCE[source]) return ''
  const steps = level + diff + (source === 'boss' ? 2 : source === 'elite' ? 1 : 0)
  const weights = rarityWeights(steps)
  if (source === 'boss') {
    weights.common = 0
    weights.uncommon = 0
    weights.rare = Math.max(weights.rare, 1)
  }
  let total = 0
  for (const r of RARITY_ORDER) total += weights[r]
  let pick = rng() * total
  let rarity: Rarity = 'common'
  for (const r of RARITY_ORDER) {
    pick -= weights[r]
    if (pick <= 0) {
      rarity = r
      break
    }
  }
  const usable = pool ? allWeapons().filter((item) => pool.includes(item.weapon!.class)) : allWeapons()
  // A class with no weapon at the rolled rarity takes the nearest rarity below it.
  let candidates: EquipmentItem[] = []
  for (let rank = RARITIES[rarity].rank; rank >= 0 && !candidates.length; rank--) {
    candidates = usable.filter((item) => item.weapon!.rarity === RARITY_ORDER[rank])
  }
  if (!candidates.length) return ''
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))].id
}
