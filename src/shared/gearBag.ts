// The hero's bag: every weapon and piece of armor the wallet owns, one row per
// copy. A drop is its own object with the rarity it fell at (0 common .. 4
// legendary) and the level the pit has forged it to (1 .. MAX_LEVEL), so two
// Broadswords can sit side by side, one common and one legendary, and either
// could change hands one day. The bag has a ceiling per kind (BAG_CAPS); what
// the hero wears does not count against it, and a drop that finds its kind full
// stays on the floor (src/loot.ts). Extras go to the Quartermaster for coin
// (src/sell.ts).
//
// Pure state, no catalog import: who is a weapon and what is worn are told to
// it once at start-up (setGearProbes), so the server can load the module too.
// The saved hero carries the bag as "uid|item|rank|level|a|affix" strings
// (src/heroSave.ts), `a` marking the copy the hero uses for that item and the
// last field the affix a Rare or better drop fell with (affixes.ts; absent or 0
// for none, and absent on saves from before affixes).

import { clampAffix } from './affixes'

export type GearInstance = {
  /** This copy's id, minted where it fell (the host's loot roll) or when a save was converted. */
  uid: string
  /** The catalog item id. */
  item: string
  /** Rarity steps: 0 common .. 4 legendary. */
  rank: number
  /** The pit's level, 1 when never offered. */
  level: number
  /** The bonus the drop fell with (affixes.ts index), 0 for none. Set where it fell; never changes. */
  affix: number
}

export type BagKind = 'weapon' | 'armor'

/** How many copies of each kind the bag holds, worn ones aside. */
export const BAG_CAPS: Record<BagKind, number> = { weapon: 60, armor: 120 }

/** The pit forges an item this far. */
export const MAX_LEVEL = 10
/** What every level above the first adds to what the item does (damage for a weapon, every stat for armor). */
export const LEVEL_STEP = 0.05
/** Flat damage a weapon gains per level above the first, on top of the multiplier (rarity's flat bonus is 0..9). */
export const LEVEL_FLAT = 1
/** The rarest a copy can be. */
export const MAX_RANK = 4

const bag = new Map<string, GearInstance>()
/** For each item the hero owns copies of, the copy in use: the one on the hero, or the one to put on. */
const active = new Map<string, string>()
/** How many copies of each item the bag holds, so owning and the copy in use are answered without a scan. */
const copies = new Map<string, number>()
/** Counts up on every change, so a caller that runs each frame (the save's dirty check) can compare a number instead of the bag. */
let revision = 0

let kindOf: (item: string) => BagKind = () => 'weapon'
let wornProbe: (item: string) => boolean = () => false

/**
 * Tell the bag which items are weapons and which items are on a hero right
 * now, so it can count what is loose. Installed by the client's inventory.
 */
export function setGearProbes(kind: (item: string) => BagKind, worn: (item: string) => boolean) {
  kindOf = kind
  wornProbe = worn
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)))
}

export function clampRank(rank: number): number {
  return Math.max(0, Math.min(MAX_RANK, Math.floor(Number.isFinite(rank) ? rank : 0)))
}

/** The multiplier a level is worth: 1 at level 1, 1 + LEVEL_STEP per level above it. */
export function levelMultiplier(level: number): number {
  return 1 + LEVEL_STEP * (clampLevel(level) - 1)
}

/** The flat damage a weapon's level is worth: 0 at level 1, LEVEL_FLAT per level above it. */
export function levelFlatBonus(level: number): number {
  return LEVEL_FLAT * (clampLevel(level) - 1)
}

/** A fresh copy id: the moment in base 36 and a little noise, short enough for the save. */
export function newGearUid(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0')
}

// --- reading -----------------------------------------------------------------------------

export function bagRows(): GearInstance[] {
  return [...bag.values()]
}

export function bagRow(uid: string | undefined): GearInstance | undefined {
  return uid ? bag.get(uid) : undefined
}

/** Every copy of `item` the hero owns, the copy in use first, then the rarest and furthest forged. */
export function bagRowsOf(item: string): GearInstance[] {
  const chosen = active.get(item)
  return bagRows().filter((row) => row.item === item).sort((a, b) =>
    Number(b.uid === chosen) - Number(a.uid === chosen) || b.rank - a.rank || b.level - a.level || a.uid.localeCompare(b.uid))
}

export function ownsGear(item: string): boolean {
  return (copies.get(item) ?? 0) > 0
}

/** Changes on every write; equal numbers mean an unchanged bag. */
export function bagRevision(): number {
  return revision
}

/**
 * The copy of `item` the hero uses: the one marked active, else the best
 * owned. Read many times a frame (the synced look, the legendary check, every
 * stat), so an item with no copies answers from the count, not a scan.
 */
export function activeGear(item: string | undefined): GearInstance | undefined {
  if (!item || !(copies.get(item) ?? 0)) return undefined
  const chosen = bag.get(active.get(item) ?? '')
  if (chosen && chosen.item === item) return chosen
  const best = bagRowsOf(item)[0]
  if (best) active.set(item, best.uid)
  return best
}

/** How many rarity steps `id`'s copy in use has been raised (0 when never, or when the hero owns none). */
export function upgradeRankOf(id: string | undefined): number {
  return activeGear(id)?.rank ?? 0
}

/** The level the pit has forged `id`'s copy in use to: 1 when never offered. */
export function upgradeLevelOf(id: string | undefined): number {
  return activeGear(id)?.level ?? 1
}

/** The affix `id`'s copy in use carries (affixes.ts index): 0 when none, or when the hero owns none. */
export function upgradeAffixOf(id: string | undefined): number {
  return activeGear(id)?.affix ?? 0
}

/** A copy is worn when it is the one in use for an item a hero has on. */
export function isGearWorn(row: GearInstance): boolean {
  return wornProbe(row.item) && activeGear(row.item)?.uid === row.uid
}

/** Copies of `kind` lying loose in the bag: everything but what is worn. */
export function bagCount(kind: BagKind): number {
  let n = 0
  for (const row of bag.values()) if (kindOf(row.item) === kind && !isGearWorn(row)) n++
  return n
}

export function bagFull(kind: BagKind): boolean {
  return bagCount(kind) >= BAG_CAPS[kind]
}

export function gearKindOf(item: string): BagKind {
  return kindOf(item)
}

// --- writing -----------------------------------------------------------------------------

/**
 * Put a copy in the bag. Undefined when its kind is full (unless `force`: a
 * save being read back or the developer's grant-all are never refused). A
 * first copy of an item becomes the one in use.
 */
export function addGear(item: string, rank: number, level = 1, uid = newGearUid(), force = false, affix = 0): GearInstance | undefined {
  if (bag.has(uid)) return bag.get(uid)
  if (!force && bagFull(kindOf(item))) return undefined
  const row: GearInstance = { uid, item, rank: clampRank(rank), level: clampLevel(level), affix: clampAffix(affix) }
  bag.set(uid, row)
  copies.set(item, (copies.get(item) ?? 0) + 1)
  if (!active.has(item)) active.set(item, uid)
  revision++
  return row
}

/** Take a copy out (sold, or traded away). The item's copy in use moves to the best remaining. */
export function removeGear(uid: string): GearInstance | undefined {
  const row = bag.get(uid)
  if (!row) return undefined
  bag.delete(uid)
  const left = (copies.get(row.item) ?? 1) - 1
  if (left > 0) copies.set(row.item, left)
  else copies.delete(row.item)
  if (active.get(row.item) === uid) {
    active.delete(row.item)
    const next = bagRowsOf(row.item)[0]
    if (next) active.set(row.item, next.uid)
  }
  revision++
  return row
}

export function setGearLevel(uid: string, level: number): boolean {
  const row = bag.get(uid)
  if (!row) return false
  row.level = clampLevel(level)
  revision++
  return true
}

/** Make `uid` the copy the hero uses for its item. */
export function setActiveGear(uid: string): boolean {
  const row = bag.get(uid)
  if (!row) return false
  active.set(row.item, uid)
  revision++
  return true
}

export function clearBag() {
  bag.clear()
  active.clear()
  copies.clear()
  revision++
}

// --- the save ----------------------------------------------------------------------------

/** "uid|item|rank|level|a|affix" per copy (the last two only when set), sorted, for the save and its fingerprint. */
export function serializeBag(): string[] {
  const out: string[] = []
  for (const row of bag.values()) {
    const flag = active.get(row.item) === row.uid ? 'a' : ''
    const tail = row.affix ? `|${flag}|${row.affix}` : flag ? `|${flag}` : ''
    out.push(`${row.uid}|${row.item}|${row.rank}|${row.level}${tail}`)
  }
  return out.sort()
}

/** Replace the bag with what a save holds; malformed rows are skipped. */
export function loadBag(entries: readonly string[] | undefined) {
  clearBag()
  for (const entry of entries ?? []) {
    const [uid, item, rankText, levelText, flag, affixText] = entry.split('|')
    if (!uid || !item) continue
    const row: GearInstance = { uid, item, rank: clampRank(Number(rankText)), level: clampLevel(Number(levelText)), affix: clampAffix(Number(affixText)) }
    bag.set(uid, row)
    copies.set(item, (copies.get(item) ?? 0) + 1)
    if (flag === 'a' || !active.has(item)) active.set(item, uid)
  }
  revision++
}

/**
 * A save from before the bag (2.8.34 and earlier) owned one copy per item:
 * `unlocks` said which, `ups` ("id:rank" or "id:rank/level") how rare and how
 * far forged. Each becomes one row. Weapons then fell no lower than their
 * printed rarity and their steps counted from there, so `printedRank` is added
 * to a weapon's steps to land on the rarity the hero saw.
 */
export function convertLegacyBag(unlocks: readonly string[], ups: readonly string[], printedRank: (item: string) => number) {
  const ranks = new Map<string, { rank: number; level: number }>()
  for (const entry of ups ?? []) {
    const at = entry.lastIndexOf(':')
    if (at <= 0) continue
    const [rankText, levelText] = entry.slice(at + 1).split('/')
    ranks.set(entry.slice(0, at), { rank: Number(rankText) || 0, level: Number(levelText) || 1 })
  }
  const items = new Set<string>([...unlocks, ...ranks.keys()])
  for (const item of items) {
    const up = ranks.get(item) ?? { rank: 0, level: 1 }
    addGear(item, printedRank(item) + up.rank, up.level, `m-${item}`, true)
  }
}
