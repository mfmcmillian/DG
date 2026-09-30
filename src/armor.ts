// What armor does. Every piece is worth a few percent, by its slot, its
// rarity (the difficulty it fell on, kept as the hero's rank for that piece,
// src/weapons.ts rollArmorRank) and the level the pit has forged it to: the
// chest, shoulders and legs take the sting out of blows (toughness), the head
// and hands put weight behind the hero's own (might), the boots add to the
// stamina bar. Wearing four pieces of one set adds a set
// bonus; all six doubles it. The host reads a hero's armor off the synced body
// like the weapon (src/multiplayer.ts heroLoadout), so a client cannot claim
// plate it is not wearing.

import { EQUIPMENT_ITEMS, EQUIPMENT_SLOTS, EquipmentItem, EquipmentLoadout, EquipmentSlot, getEquipmentItemOrNull } from './equipmentCatalog'
import { t } from './i18n'
import { affixOf } from './shared/affixes'
import { levelMultiplier, upgradeAffixOf, upgradeLevelOf, upgradeRankOf } from './shared/upgradeRanks'
import { Rarity, RARITIES, rarityOf } from './weapons'

/** How rare a hero's copy of an item is, by id: this hero's own ranks by default, a synced body's on the host. */
export type RankOf = (itemId: string) => number
/** The level the pit has forged a hero's copy of an item to, by id: likewise this hero's own by default. */
export type LevelOf = (itemId: string) => number
/** The affix a hero's copy of an item fell with (shared/affixes.ts index), by id: likewise this hero's own by default. */
export type AffixOf = (itemId: string) => number

/** Percent points one piece is worth at each rarity. */
const TIER: Record<Rarity, number> = { common: 1, uncommon: 1.5, rare: 2, epic: 3, legendary: 4 }
/** Stamina points a pair of boots is worth at each rarity. */
const STAMINA_TIER: Record<Rarity, number> = { common: 2, uncommon: 3, rare: 4, epic: 6, legendary: 8 }
/** Health a plate piece adds (the chest twice this); the set bonus adds it again, twice at the whole set. */
const HEALTH_TIER: Record<Rarity, number> = { common: 2, uncommon: 3, rare: 4, epic: 6, legendary: 8 }
/** Pieces of one set that earn its bonus; wearing the whole set (five or six pieces, some sets have no helm) doubles it. */
export const SET_PIECES = 4

/**
 * What a set leans to: every piece of it carries a little of that stat on top
 * of its slot's, so a Knight's glove is not a Sorcerer's glove. Plate leans to
 * toughness, hunters and rogues to stamina, casters to might, the hardy folk
 * of the north and the bog to health. A set not listed leans by its id.
 */
export type ArmorLean = 'toughness' | 'might' | 'stamina' | 'health'
export const SET_LEANS: Record<string, ArmorLean> = {
  // Starters and the fortress
  knight: 'toughness', scout: 'stamina', striker: 'might', brute: 'health',
  trapper: 'stamina', herbalist: 'might', herder: 'health', hearth: 'might', smith: 'toughness',
  // Thornwood
  elf: 'stamina', sentinel: 'toughness', dusk: 'stamina', sunleaf: 'might', thorn: 'stamina', stag: 'health',
  // The crypt
  sorc: 'might', hexer: 'might', druid: 'health', witch: 'stamina', spectral: 'might', sage: 'toughness',
  barrow: 'stamina', lich: 'might', gravebound: 'toughness', deathless: 'toughness', gravelord: 'health',
  // The castle
  paladin: 'toughness', blackguard: 'might', crusader: 'toughness', sovereign: 'might', ironclad: 'toughness', chevalier: 'stamina',
  // The pass
  viking: 'health', jarl: 'toughness', raider: 'stamina', karl: 'health', huskarl: 'toughness', ulfhednar: 'might',
  // The bog
  hexroot: 'might', warboss: 'health', bonegnaw: 'health', kingsown: 'toughness', stalker: 'stamina',
  // Jade
  ronin: 'stamina', shrine: 'might', crimson: 'toughness', shogun: 'might', oni: 'health',
  // The coast
  freebooter: 'stamina', buccaneer: 'health', corsair: 'might', seadog: 'health', admiral: 'toughness'
}
const LEAN_ORDER: ArmorLean[] = ['toughness', 'might', 'stamina', 'health']

export function setLean(set: string): ArmorLean {
  const listed = SET_LEANS[set]
  if (listed) return listed
  let h = 5381
  for (let i = 0; i < set.length; i++) h = (Math.imul(h, 33) ^ set.charCodeAt(i)) >>> 0
  return LEAN_ORDER[h % LEAN_ORDER.length]
}

/** The lean, in words, for the card. */
export function leanLabel(lean: ArmorLean): string {
  return lean === 'toughness' ? t('Toughness') : lean === 'might' ? t('Might') : lean === 'stamina' ? t('Stamina') : t('Health')
}

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

/** What the slot alone is worth at this rarity and forge level. */
function slotStats(slot: EquipmentSlot, rarity: Rarity, forged: number): ArmorStats {
  const tier = TIER[rarity] * forged
  const health = HEALTH_TIER[rarity] * forged
  switch (slot) {
    case 'chest': return { might: 0, toughness: tier * 2, stamina: 0, health: health * 2 }
    case 'shoulders':
    case 'legs': return { might: 0, toughness: tier, stamina: 0, health }
    case 'head':
    case 'hands': return { might: tier, toughness: 0, stamina: 0, health: 0 }
    case 'boots': return { might: 0, toughness: 0, stamina: STAMINA_TIER[rarity] * forged, health: 0 }
    default: return NOTHING
  }
}

/** What the set's lean adds to each of its pieces: half a tier of the leaned stat. */
function leanStats(lean: ArmorLean, rarity: Rarity, forged: number): ArmorStats {
  const half = 0.5 * forged
  switch (lean) {
    case 'toughness': return { might: 0, toughness: TIER[rarity] * half, stamina: 0, health: 0 }
    case 'might': return { might: TIER[rarity] * half, toughness: 0, stamina: 0, health: 0 }
    case 'stamina': return { might: 0, toughness: 0, stamina: STAMINA_TIER[rarity] * half, health: 0 }
    case 'health': return { might: 0, toughness: 0, stamina: 0, health: HEALTH_TIER[rarity] * half }
  }
}

/** What the copy's affix adds, forged along with the rest. */
function affixStats(affix: number, forged: number): ArmorStats {
  const mark = affixOf(affix)
  if (!mark || mark.kind !== 'armor') return NOTHING
  return { might: (mark.might ?? 0) * forged, toughness: (mark.toughness ?? 0) * forged, stamina: (mark.stamina ?? 0) * forged, health: (mark.health ?? 0) * forged }
}

/** What one piece is worth on its own: its slot, its set's lean, and the copy's affix. Empty slots and weapons are worth nothing here. */
export function armorPieceStats(item: EquipmentItem | undefined, rankOf: RankOf = upgradeRankOf, levelOf: LevelOf = upgradeLevelOf, affixOfItem: AffixOf = upgradeAffixOf): ArmorStats {
  if (!isArmor(item)) return NOTHING
  const rarity = rarityOf(item.id, rankOf(item.id))
  const forged = levelMultiplier(levelOf(item.id))
  return add(add(slotStats(item.slot as EquipmentSlot, rarity, forged), leanStats(setLean(item.set!), rarity, forged)), affixStats(affixOfItem(item.id), forged))
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

/** How many pieces of each set a loadout wears, most worn first. A set is as rare as its least rare worn piece. */
function setsWorn(loadout: EquipmentLoadout, rankOf: RankOf): Array<{ id: string; label: string; worn: number; rarity: Rarity }> {
  const counts = new Map<string, { id: string; label: string; worn: number; rarity: Rarity }>()
  for (const slot of EQUIPMENT_SLOTS) {
    if (slot.id === 'weapon') continue
    const item = getEquipmentItemOrNull(loadout[slot.id])
    if (!isArmor(item) || !item.set) continue
    const rarity = rarityOf(item.id, rankOf(item.id))
    const entry = counts.get(item.set) ?? { id: item.set, label: item.setLabel ?? item.set, worn: 0, rarity }
    entry.worn++
    if (RARITIES[rarity].rank < RARITIES[entry.rarity].rank) entry.rarity = rarity
    counts.set(item.set, entry)
  }
  return [...counts.values()].sort((a, b) => b.worn - a.worn)
}

/** Everything a loadout's armor is worth, pieces and set bonus together. */
export function armorBonuses(loadout: EquipmentLoadout | undefined, rankOf: RankOf = upgradeRankOf, levelOf: LevelOf = upgradeLevelOf, affixOfItem: AffixOf = upgradeAffixOf): ArmorBonuses {
  if (!loadout) return { might: 1, toughness: 1, stamina: 0, health: 0 }
  let total = NOTHING
  for (const slot of EQUIPMENT_SLOTS) {
    if (slot.id !== 'weapon') total = add(total, armorPieceStats(getEquipmentItemOrNull(loadout[slot.id]), rankOf, levelOf, affixOfItem))
  }
  const set = setsWorn(loadout, rankOf)[0]
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
  const r = Math.round(v * 10) / 10
  return Number.isInteger(r) ? `${r}` : r.toFixed(1)
}

/** What a piece is worth, in words: "-3% damage taken", "+2% damage dealt", "+6 stamina". */
export function armorStatLine(item: EquipmentItem | undefined, rank?: number, level?: number, affix?: number): string {
  const s = armorPieceStats(item, rank === undefined ? undefined : () => rank, level === undefined ? undefined : () => level as number, affix === undefined ? undefined : () => affix as number)
  const parts: string[] = []
  if (s.toughness) parts.push(t('-{pct}% damage taken', { pct: pct(s.toughness) }))
  if (s.might) parts.push(t('+{pct}% damage dealt', { pct: pct(s.might) }))
  if (s.stamina) parts.push(t('+{n} stamina', { n: pct(s.stamina) }))
  if (s.health) parts.push(t('+{n} health', { n: pct(s.health) }))
  if (level === undefined) level = item ? upgradeLevelOf(item.id) : 1
  if (level > 1) parts.push(t('Level {n}: +{pct}% to all of it', { n: level, pct: pct((levelMultiplier(level) - 1) * 100) }))
  return parts.join(' · ')
}

/**
 * The set line under a piece: how many of its set the hero wears and what the
 * bonus is at four pieces and at the whole set, e.g. "Jarl set 3/6 · 4 pieces: +2% dealt, -2% taken, +4 health · 6 pieces: +4% dealt, -4% taken, +8 health".
 */
export function armorSetLine(item: EquipmentItem | undefined, loadout: EquipmentLoadout): string {
  if (!isArmor(item) || !item.set) return ''
  const worn = setsWorn(loadout, upgradeRankOf).find((s) => s.id === item.set)?.worn ?? 0
  const rarity = rarityOf(item.id)
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
