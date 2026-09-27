// Weapons as loot: classes, rarities and drop tables. Pure data and pure
// functions, used by the host (drop rolls, hit resolution), the client
// (damage numbers, pickups, inventory) and the UI (colors, labels).
//
// The look of a weapon is its GLB; how it fights is its class; how rare it is
// decides its flat damage bonus and how often the dungeon hands one over.

import { Color4 } from '@dcl/sdk/math'
import { ArmorRealm, EQUIPMENT_ITEMS, EquipmentItem, getEquipmentItemOrNull } from './equipmentCatalog'
import { t } from './i18n'
import { levelFlatBonus, levelMultiplier, upgradeLevelOf, upgradeRankOf } from './shared/upgradeRanks'

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

/**
 * Pride weapons sit above legendary: legendary's flat bonus and more, and a
 * multiplier on top of the class's. They never roll in the common loot; the
 * Colossus leaves one now and then, and a Hard fortress boss rarely.
 */
export const PRIDE = { damage: 1.15, bonus: 5, raidChance: 0.12, bossChance: 0.04 }

export function weaponInfo(id: string): EquipmentItem['weapon'] | undefined {
  return getEquipmentItemOrNull(id)?.weapon
}

/**
 * How this weapon id fights. Unknown or missing weapons fight like a plain sword.
 * The rarity bonus counts the steps the drop fell with and the damage the pit's
 * level: this hero's by default, or `rank` and `level` when the host scores a
 * blow with what the striker's HeroBody declares.
 */
export function weaponStats(id: string | undefined, withBonus = true, rank?: number, level?: number): WeaponStats {
  const info = id ? weaponInfo(id) : undefined
  if (!info) return SWORD_STATS
  const cls = WEAPON_CLASSES[info.class]
  const rarity = raiseRarity(info.rarity, rank ?? upgradeRankOf(id))
  const pride = info.pride ? PRIDE.damage : 1
  const at = level ?? upgradeLevelOf(id)
  const forged = levelMultiplier(at)
  return {
    damage: cls.damage * pride * forged, stagger: cls.stagger, knockback: cls.knockback,
    bonus: withBonus ? RARITIES[rarity].bonus + (info.pride ? PRIDE.bonus : 0) + levelFlatBonus(at) : 0
  }
}

/** `steps` rarity tiers above `rarity`, capped at legendary. */
export function raiseRarity(rarity: Rarity, steps: number): Rarity {
  const at = Math.min(RARITY_ORDER.length - 1, RARITIES[rarity].rank + Math.max(0, Math.floor(steps)))
  return RARITY_ORDER[at]
}

/** The tier above `rarity`, or undefined at legendary. */
export function nextRarity(rarity: Rarity): Rarity | undefined {
  return RARITY_ORDER[RARITIES[rarity].rank + 1]
}

/**
 * How rare an item is as printed: a weapon's own rarity, the least it ever
 * falls as. Armor has no printed rarity: every piece is common on the page.
 * The copy a hero owns is as rare as the drop that brought it (rollArmorRank,
 * rollWeaponLoot), kept as rarity steps above the page.
 */
export function baseRarityOf(id: string): Rarity {
  const item = getEquipmentItemOrNull(id)
  return item?.weapon ? item.weapon.rarity : 'common'
}

/** How rare this hero's copy of an item is: its printed rarity raised by the steps its drop fell with. */
export function rarityOf(id: string, rank: number = upgradeRankOf(id)): Rarity {
  return raiseRarity(baseRarityOf(id), rank)
}

/** Armor pieces of every set found in `realms`. Any class wears any set. */
export function armorDropsFor(realms: readonly ArmorRealm[]): EquipmentItem[] {
  return EQUIPMENT_ITEMS.filter((item) => !item.weapon && !!item.realm && realms.includes(item.realm))
}

/** How often a slain enemy leaves a piece of armor when it left no weapon. The boss always does. */
const ARMOR_CHANCE: Record<DropSource, number> = { grunt: 0.04, elite: 0.14, boss: 1 }

/**
 * Roll an armor drop for a slain enemy: a piece of one of the sets the map
 * drops (ARMOR_DROP_REALMS), or '' for nothing.
 */
export function rollArmorDrop(source: DropSource, realms: readonly ArmorRealm[], rng: () => number = Math.random): string {
  if (!realms.length || rng() >= ARMOR_CHANCE[source]) return ''
  const pieces = armorDropsFor(realms)
  if (!pieces.length) return ''
  return pieces[Math.min(pieces.length - 1, Math.floor(rng() * pieces.length))].id
}

/**
 * How rare a piece of armor falls, by the run's difficulty and who dropped it,
 * as percent weights common..legendary. Two steps per difficulty; an elite is
 * half a difficulty ahead of the grunts, the boss a whole one. Easy grunts
 * never leave better than rare; only Hard leaves legendary.
 */
const ARMOR_RANK_WEIGHTS: number[][] = [
  [60, 30, 10, 0, 0],
  [40, 35, 20, 5, 0],
  [15, 40, 35, 10, 0],
  [8, 28, 38, 20, 6],
  [0, 15, 40, 30, 15],
  [0, 8, 32, 38, 22],
  [0, 0, 25, 45, 30]
]

/** The rarity steps (0 common .. 4 legendary) a fresh armor drop carries. `diff` is the run's difficulty index. */
export function rollArmorRank(source: DropSource, diff: number, rng: () => number = Math.random): number {
  const step = Math.max(0, Math.min(ARMOR_RANK_WEIGHTS.length - 1, diff * 2 + (source === 'boss' ? 2 : source === 'elite' ? 1 : 0)))
  const weights = ARMOR_RANK_WEIGHTS[step]
  let pick = rng() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < weights.length; i++) {
    pick -= weights[i]
    if (pick < 0) return i
  }
  return weights.length - 1
}

export function rarityColor(id: string): Color4 {
  return RARITIES[rarityOf(id)].color
}

/** "Epic · Level 4 · Sword · Dark Fortress" */
export function weaponSubtitle(item: EquipmentItem): string {
  if (!item.weapon) return ''
  const rarity = t(RARITIES[rarityOf(item.id)].label)
  const level = upgradeLevelOf(item.id)
  const forged = level > 1 ? ` · ${t('Level {n}', { n: level })}` : ''
  const pride = item.weapon.pride ? `${t('Pride')} · ` : ''
  return `${pride}${rarity}${forged} · ${t(WEAPON_CLASSES[item.weapon.class].label)} · ${item.weapon.pack}`
}

/** "+20% damage · +40% stagger · +4 flat damage · Level 6: +25% damage, +5 flat" for the inventory. */
export function weaponStatLine(item: EquipmentItem): string {
  if (!item.weapon) return ''
  const s = weaponStats(item.id)
  const parts: string[] = []
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`
  if (s.damage !== 1) parts.push(t('{pct} damage', { pct: pct(s.damage - 1) }))
  if (s.stagger !== 1) parts.push(t('{pct} stagger', { pct: pct(s.stagger - 1) }))
  if (s.knockback !== 1) parts.push(t('{pct} knockback', { pct: pct(s.knockback - 1) }))
  if (s.bonus) parts.push(t('+{n} flat damage', { n: s.bonus }))
  const level = upgradeLevelOf(item.id)
  if (level > 1) parts.push(t('Level {n}: {pct} damage, +{flat} flat', { n: level, pct: pct(levelMultiplier(level) - 1), flat: levelFlatBonus(level) }))
  return parts.length ? parts.join(' · ') : t('Balanced')
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

/** The weapons ordinary drops draw from: everything but the Pride tier. */
function lootWeapons(): EquipmentItem[] {
  return allWeapons().filter((item) => !item.weapon!.pride)
}

/** A Pride weapon somebody in `pool` can wield, or '' when the pack has none for them. */
export function rollPrideDrop(pool: WeaponClass[] | undefined, rng: () => number = Math.random): string {
  const candidates = allWeapons().filter((item) => item.weapon!.pride && (!pool || pool.includes(item.weapon!.class)))
  if (!candidates.length) return ''
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))].id
}

/**
 * Roll a weapon drop for a slain enemy: the item id, or '' for nothing.
 * `level` and `diff` are the run's indices (0-based); `rng` is 0..1. `pool`
 * restricts the draw to weapon classes somebody in the party can use
 * (src/heroClasses.ts weaponPoolFor); undefined means every class.
 */
/** The Colossus's reward: now and then a Pride weapon, else a Legendary the hero's class can wield, or the best below it. */
export function rollRaidDrop(pool: WeaponClass[], rng: () => number = Math.random): string {
  if (rng() < PRIDE.raidChance) {
    const pride = rollPrideDrop(pool, rng)
    if (pride) return pride
  }
  const usable = lootWeapons().filter((item) => pool.includes(item.weapon!.class))
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
  return rollWeaponLoot(source, level, diff, rng, pool).id
}

/** How often a drop is a lesser weapon raised to the rolled rarity rather than one printed at it. */
const RAISED_SHARE = 0.5

/**
 * Roll a weapon drop with the rarity it falls as: `up` steps above the weapon's
 * printed rarity (0 when it falls as printed). The rolled rarity is met either
 * by a weapon printed at it or, half the time, by a lesser one raised to it, so
 * the same sword can fall Common one day and Epic another. Pride weapons never
 * rise.
 */
export function rollWeaponLoot(
  source: DropSource, level: number, diff: number, rng: () => number = Math.random, pool?: WeaponClass[]
): { id: string; up: number } {
  if (rng() >= DROP_CHANCE[source]) return { id: '', up: 0 }
  // A Hard fortress boss, rarely, leaves a Pride weapon.
  if (source === 'boss' && diff >= 2 && rng() < PRIDE.bossChance) {
    const pride = rollPrideDrop(pool, rng)
    if (pride) return { id: pride, up: 0 }
  }
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
  const usable = pool ? lootWeapons().filter((item) => pool.includes(item.weapon!.class)) : lootWeapons()
  const target = RARITIES[rarity].rank
  const printed = usable.filter((item) => item.weapon!.rarity === rarity)
  const lesser = usable.filter((item) => RARITIES[item.weapon!.rarity].rank < target)
  const draw = (list: EquipmentItem[]) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
  if (lesser.length && (!printed.length || rng() < RAISED_SHARE)) {
    const pick = draw(lesser)
    return { id: pick.id, up: target - RARITIES[pick.weapon!.rarity].rank }
  }
  if (printed.length) return { id: draw(printed).id, up: 0 }
  // A class with nothing at or below the rolled rarity takes the nearest above it, as printed.
  let candidates: EquipmentItem[] = []
  for (let rank = target + 1; rank < RARITY_ORDER.length && !candidates.length; rank++) {
    candidates = usable.filter((item) => item.weapon!.rarity === RARITY_ORDER[rank])
  }
  if (!candidates.length) return { id: '', up: 0 }
  return { id: draw(candidates).id, up: 0 }
}
