// What armor does. Every piece is worth a few percent, by its slot and its
// rarity (a set's rarity follows the realm it drops in, src/weapons.ts
// ARMOR_RARITY): the chest, shoulders and legs take the sting out of blows
// (toughness), the head and hands put weight behind the hero's own (might),
// the boots add to the stamina bar. Wearing four pieces of one set adds a set
// bonus; all six doubles it. The host reads a hero's armor off the synced body
// like the weapon (src/multiplayer.ts heroLoadout), so a client cannot claim
// plate it is not wearing.

import { EQUIPMENT_ITEMS, EQUIPMENT_SLOTS, EquipmentItem, EquipmentLoadout, EquipmentSlot, getEquipmentItemOrNull } from './equipmentCatalog'
import { t } from './i18n'
import { baseRarityOf, Rarity } from './weapons'

/** Percent points one piece is worth at each rarity. */
const TIER: Record<Rarity, number> = { common: 1, uncommon: 1.5, rare: 2, epic: 3, legendary: 4 }
/** Stamina points a pair of boots is worth at each rarity. */
const STAMINA_TIER: Record<Rarity, number> = { common: 2, uncommon: 3, rare: 4, epic: 6, legendary: 8 }
/** Health a plate piece adds (the chest twice this); the set bonus adds it again, twice at the whole set. */
const HEALTH_TIER: Record<Rarity, number> = { common: 2, uncommon: 3, rare: 4, epic: 6, legendary: 8 }
/** Pieces of one set that earn its bonus; wearing the whole set (five or six pieces, some sets have no helm) doubles it. */
export const SET_PIECES = 4

const setSizes = new Map<string, number>()
/** How many pieces a set has: most six, a few five. */
export function setSize(set: string): number {
  let n = setSizes.get(set)
  if (n === undefined) {
    n = EQUIPMENT_ITEMS.filter((i) => i.set === set && !i.weapon).length
    setSizes.set(set, n)
  }
  return Math.max(SET_PIECES, n)
}

/** `might` and `toughness` in percent points (both positive: might is dealt, toughness is taken off); `stamina` and `health` in points. */
export type ArmorStats = { might: number; toughness: number; stamina: number; health: number }

const NOTHING: ArmorStats = { might: 0, toughness: 0, stamina: 0, health: 0 }

function add(a: ArmorStats, b: ArmorStats): ArmorStats {
  return { might: a.might + b.might, toughness: a.toughness + b.toughness, stamina: a.stamina + b.stamina, health: a.health + b.health }
}

function isArmor(item: EquipmentItem | undefined): item is EquipmentItem {
  return !!item && !item.weapon && item.slot !== 'weapon' && !!item.set
}

/** What one piece is worth on its own. Empty slots and weapons are worth nothing here. */
export function armorPieceStats(item: EquipmentItem | undefined): ArmorStats {
  if (!isArmor(item)) return NOTHING
  const rarity = baseRarityOf(item.id)
  const tier = TIER[rarity]
  const health = HEALTH_TIER[rarity]
  switch (item.slot as EquipmentSlot) {
    case 'chest': return { might: 0, toughness: tier * 2, stamina: 0, health: health * 2 }
    case 'shoulders':
    case 'legs': return { might: 0, toughness: tier, stamina: 0, health }
    case 'head':
    case 'hands': return { might: tier, toughness: 0, stamina: 0, health: 0 }
    case 'boots': return { might: 0, toughness: 0, stamina: STAMINA_TIER[rarity], health: 0 }
    default: return NOTHING
  }
}

/** The set bonus for `worn` pieces of a set of this rarity and size: might, toughness and health, doubled when the set is complete. */
export function armorSetStats(rarity: Rarity, worn: number, size: number): ArmorStats {
  if (worn < SET_PIECES) return NOTHING
  const full = worn >= size ? 2 : 1
  const tier = TIER[rarity] * full
  return { might: tier, toughness: tier, stamina: 0, health: HEALTH_TIER[rarity] * full }
}

export type ArmorBonuses = {
  /** Multiplier on damage dealt (1 = none). */
  might: number
  /** Multiplier on damage taken (1 = none). */
  toughness: number
  /** Points added to the stamina bar. */
  stamina: number
  /** Points added to the health bar. */
  health: number
  /** The set most of the armor belongs to, and how many of its pieces are worn. */
  set?: { id: string; label: string; worn: number; rarity: Rarity }
}

/** How many pieces of each set a loadout wears, most worn first. */
function setsWorn(loadout: EquipmentLoadout): Array<{ id: string; label: string; worn: number; rarity: Rarity }> {
  const counts = new Map<string, { id: string; label: string; worn: number; rarity: Rarity }>()
  for (const slot of EQUIPMENT_SLOTS) {
    if (slot.id === 'weapon') continue
    const item = getEquipmentItemOrNull(loadout[slot.id])
    if (!isArmor(item) || !item.set) continue
    const entry = counts.get(item.set) ?? { id: item.set, label: item.setLabel ?? item.set, worn: 0, rarity: baseRarityOf(item.id) }
    entry.worn++
    counts.set(item.set, entry)
  }
  return [...counts.values()].sort((a, b) => b.worn - a.worn)
}

/** Everything a loadout's armor is worth, pieces and set bonus together. */
export function armorBonuses(loadout: EquipmentLoadout | undefined): ArmorBonuses {
  if (!loadout) return { might: 1, toughness: 1, stamina: 0, health: 0 }
  let total = NOTHING
  for (const slot of EQUIPMENT_SLOTS) {
    if (slot.id !== 'weapon') total = add(total, armorPieceStats(getEquipmentItemOrNull(loadout[slot.id])))
  }
  const set = setsWorn(loadout)[0]
  if (set) total = add(total, armorSetStats(set.rarity, set.worn, setSize(set.id)))
  return {
    might: 1 + total.might / 100,
    toughness: Math.max(0.25, 1 - total.toughness / 100),
    stamina: Math.round(total.stamina),
    health: Math.round(total.health),
    set
  }
}

function pct(v: number): string {
  return Number.isInteger(v) ? `${v}` : v.toFixed(1)
}

/** What a piece is worth, in words: "-3% damage taken", "+2% damage dealt", "+6 stamina". */
export function armorStatLine(item: EquipmentItem | undefined): string {
  const s = armorPieceStats(item)
  const parts: string[] = []
  if (s.toughness) parts.push(t('-{pct}% damage taken', { pct: pct(s.toughness) }))
  if (s.might) parts.push(t('+{pct}% damage dealt', { pct: pct(s.might) }))
  if (s.stamina) parts.push(t('+{n} stamina', { n: s.stamina }))
  if (s.health) parts.push(t('+{n} health', { n: s.health }))
  return parts.join(' · ')
}

/**
 * The set line under a piece: how many of its set the hero wears and what the
 * bonus is at four pieces and at the whole set, e.g. "Jarl set 3/6 · 4 pieces: +2% dealt, -2% taken, +4 health · 6 pieces: +4% dealt, -4% taken, +8 health".
 */
export function armorSetLine(item: EquipmentItem | undefined, loadout: EquipmentLoadout): string {
  if (!isArmor(item) || !item.set) return ''
  const worn = setsWorn(loadout).find((s) => s.id === item.set)?.worn ?? 0
  const rarity = baseRarityOf(item.id)
  const size = setSize(item.set)
  const some = armorSetStats(rarity, SET_PIECES, size)
  const all = armorSetStats(rarity, size, size)
  const bonus = (s: ArmorStats) => t('+{pct}% dealt, -{pct}% taken, +{n} health', { pct: pct(s.might), n: s.health })
  return `${t('{set} set {worn}/{of}', { set: item.setLabel ?? item.set, worn, of: size })} · ${t('{n} pieces: {bonus}', { n: SET_PIECES, bonus: bonus(some) })} · ${t('{n} pieces: {bonus}', { n: size, bonus: bonus(all) })}`
}

/** The whole outfit in one line for the wardrobe: "Armor: -9% damage taken · +5% damage dealt · +8 stamina · +16 health · Jarl set 4/6". */
export function armorSummaryLine(loadout: EquipmentLoadout): string {
  const b = armorBonuses(loadout)
  const parts: string[] = []
  const taken = Math.round((1 - b.toughness) * 1000) / 10
  const dealt = Math.round((b.might - 1) * 1000) / 10
  if (taken) parts.push(t('-{pct}% damage taken', { pct: pct(taken) }))
  if (dealt) parts.push(t('+{pct}% damage dealt', { pct: pct(dealt) }))
  if (b.stamina) parts.push(t('+{n} stamina', { n: b.stamina }))
  if (b.health) parts.push(t('+{n} health', { n: b.health }))
  if (b.set && b.set.worn >= SET_PIECES) parts.push(t('{set} set {worn}/{of}', { set: b.set.label, worn: b.set.worn, of: setSize(b.set.id) }))
  return parts.length ? `${t('Armor')}: ${parts.join(' · ')}` : ''
}
