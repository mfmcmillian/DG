// The hero's copies of its items: the rarity steps each fell with (a piece of
// armor or a weapon is as rare as the drop that brought it, src/weapons.ts
// rollArmorRank / rollWeaponLoot) and the level the pit has forged it to
// (1 .. MAX_LEVEL, src/upgrades.ts). Pure state, shared by the weapon and armor
// tables (src/weapons.ts, src/armor.ts) and the saved hero (src/heroSave.ts
// carries it as "id:rank" and "id:rank/level" strings).

const ranks = new Map<string, number>()
const levels = new Map<string, number>()

/** The pit forges an item this far. */
export const MAX_LEVEL = 10
/** What every level above the first adds to what the item does (damage for a weapon, every stat for armor). */
export const LEVEL_STEP = 0.05
/** Flat damage a weapon gains per level above the first, on top of the multiplier (rarity's flat bonus is 0..9). */
export const LEVEL_FLAT = 1

/** How many rarity steps `id` has been raised (0 when never). */
export function upgradeRankOf(id: string | undefined): number {
  return id ? ranks.get(id) ?? 0 : 0
}

export function setUpgradeRank(id: string, rank: number) {
  const n = Math.max(0, Math.floor(rank))
  if (n === 0) ranks.delete(id)
  else ranks.set(id, n)
}

/** The level the pit has forged `id` to: 1 when never offered. */
export function upgradeLevelOf(id: string | undefined): number {
  return id ? levels.get(id) ?? 1 : 1
}

export function setUpgradeLevel(id: string, level: number) {
  const n = clampLevel(level)
  if (n <= 1) levels.delete(id)
  else levels.set(id, n)
}

export function clampLevel(level: number): number {
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)))
}

/** The multiplier a level is worth: 1 at level 1, 1 + LEVEL_STEP per level above it. */
export function levelMultiplier(level: number): number {
  return 1 + LEVEL_STEP * (clampLevel(level) - 1)
}

/** The flat damage a weapon's level is worth: 0 at level 1, LEVEL_FLAT per level above it. */
export function levelFlatBonus(level: number): number {
  return LEVEL_FLAT * (clampLevel(level) - 1)
}

/** "id:rank" or "id:rank/level" per raised or forged item, sorted, for the save and its fingerprint. */
export function serializeUpgradeRanks(): string[] {
  const ids = new Set([...ranks.keys(), ...levels.keys()])
  const out: string[] = []
  for (const id of ids) {
    const rank = upgradeRankOf(id)
    const level = upgradeLevelOf(id)
    if (rank <= 0 && level <= 1) continue
    out.push(`${id}:${rank}${level > 1 ? `/${level}` : ''}`)
  }
  return out.sort()
}

/** Replace the tables with what a save holds; malformed entries are skipped. */
export function loadUpgradeRanks(entries: readonly string[] | undefined) {
  ranks.clear()
  levels.clear()
  for (const entry of entries ?? []) {
    const at = entry.lastIndexOf(':')
    if (at <= 0) continue
    const id = entry.slice(0, at)
    const [rankText, levelText] = entry.slice(at + 1).split('/')
    const rank = Number(rankText)
    if (Number.isFinite(rank) && rank > 0) ranks.set(id, Math.floor(rank))
    const level = Number(levelText)
    if (Number.isFinite(level) && level > 1) levels.set(id, clampLevel(level))
  }
}

/**
 * A save from before the pit forged levels (2.8.6): every rarity step it had
 * given a weapon becomes two levels, and the weapon goes back to the rarity it
 * fell with. Armor keeps its steps: they are the rarity it fell with.
 */
export function convertLegacyWeaponRanks(isWeapon: (id: string) => boolean) {
  for (const [id, rank] of [...ranks.entries()]) {
    if (!isWeapon(id)) continue
    ranks.delete(id)
    setUpgradeLevel(id, Math.max(upgradeLevelOf(id), 1 + rank * 2))
  }
}
