// The hero's upgrades: how many rarity steps the pit has given each item id.
// Pure state, shared by the weapon tables (src/weapons.ts reads it to raise a
// weapon's rarity and damage bonus) and the saved hero (src/heroSave.ts carries
// it as "id:ranks" strings). The logic that grants a step is src/upgrades.ts.

const ranks = new Map<string, number>()

/** How many rarity steps `id` has been raised (0 when never). */
export function upgradeRankOf(id: string | undefined): number {
  return id ? ranks.get(id) ?? 0 : 0
}

export function setUpgradeRank(id: string, rank: number) {
  const n = Math.max(0, Math.floor(rank))
  if (n === 0) ranks.delete(id)
  else ranks.set(id, n)
}

/** "id:ranks" per upgraded item, sorted, for the save and its fingerprint. */
export function serializeUpgradeRanks(): string[] {
  return [...ranks.entries()].filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).sort()
}

/** Replace the table with what a save holds; malformed entries are skipped. */
export function loadUpgradeRanks(entries: readonly string[] | undefined) {
  ranks.clear()
  for (const entry of entries ?? []) {
    const at = entry.lastIndexOf(':')
    if (at <= 0) continue
    const n = Number(entry.slice(at + 1))
    if (Number.isFinite(n) && n > 0) ranks.set(entry.slice(0, at), Math.floor(n))
  }
}
