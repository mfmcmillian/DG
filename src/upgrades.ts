// The upgrade pit's rules: a weapon goes into the smithy's fire with a purse of
// coins and comes out one rarity step higher (same weapon, better bonus), or
// unchanged when the fire does not take. Cheaper tiers are safer; every roll
// keeps the coins. The offering is a two-step affair so the cinematic
// (src/pitCinematic.ts) can play between them: `attemptUpgrade` spends and
// rolls, the result hovers over the fire, and `takeUpgrade` writes it to the
// hero. Leaving the hall without taking it applies it as well: nothing paid for
// is ever lost.

import { getEquipmentItemOrNull } from './equipmentCatalog'
import { ownedWeaponIds } from './inventory'
import { getLootState, spendCoins } from './loot'
import { setUpgradeRank, upgradeRankOf } from './shared/upgradeRanks'
import { nextRarity, Rarity, rarityOf, RARITIES } from './weapons'

/** What a step costs and how often the fire takes it, by the rarity the weapon has now. */
export const UPGRADE_STEPS: Record<Exclude<Rarity, 'legendary'>, { coins: number; chance: number }> = {
  common: { coins: 80, chance: 0.9 },
  uncommon: { coins: 200, chance: 0.7 },
  rare: { coins: 500, chance: 0.5 },
  epic: { coins: 1000, chance: 0.3 }
}

export type UpgradeOffer = {
  id: string
  from: Rarity
  /** Undefined at legendary: nothing higher to reach. */
  to: Rarity | undefined
  coins: number
  chance: number
  /** The purse covers it. */
  affordable: boolean
}

export type UpgradeResult = {
  id: string
  success: boolean
  from: Rarity
  /** The rarity the weapon has once taken (equals `from` on a failure). */
  to: Rarity
  /** What the offering cost. */
  coins: number
}

/** The result waiting over the fire, not yet written to the hero. */
let pending: UpgradeResult | undefined

/** What the pit would do with weapon `id` for this hero right now. */
export function upgradeOffer(id: string): UpgradeOffer {
  const from = rarityOf(id)
  const to = nextRarity(from)
  const step = from !== 'legendary' ? UPGRADE_STEPS[from] : undefined
  const coins = step?.coins ?? 0
  return { id, from, to, coins, chance: step?.chance ?? 0, affordable: !!to && getLootState().coins >= coins }
}

/** Every weapon this hero could offer, the ones that can still rise first. */
export function upgradeOffers(): UpgradeOffer[] {
  const offers = ownedWeaponIds()
    .filter((id) => id !== 'none-weapon' && !!getEquipmentItemOrNull(id)?.weapon)
    .map(upgradeOffer)
  return offers.sort((a, b) => Number(!!b.to) - Number(!!a.to) || RARITIES[b.from].rank - RARITIES[a.from].rank || a.id.localeCompare(b.id))
}

/**
 * Spend the coins and roll. Undefined when the weapon cannot rise, the purse is
 * short, or another result is still waiting to be taken.
 */
export function attemptUpgrade(id: string): UpgradeResult | undefined {
  if (pending) return undefined
  const offer = upgradeOffer(id)
  if (!offer.to || !spendCoins(offer.coins)) return undefined
  const success = Math.random() < offer.chance
  pending = { id, success, from: offer.from, to: success ? offer.to : offer.from, coins: offer.coins }
  return pending
}

export function pendingUpgrade(): UpgradeResult | undefined {
  return pending
}

/** Write the waiting result to the hero (a step up on a success) and clear it. Undefined when nothing waited. */
export function takeUpgrade(): UpgradeResult | undefined {
  const result = pending
  if (!result) return undefined
  pending = undefined
  if (result.success) setUpgradeRank(result.id, upgradeRankOf(result.id) + 1)
  return result
}
