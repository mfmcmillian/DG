// The upgrade pit's rules: a weapon or a piece of armor goes into the smithy's
// fire with a purse of coins and comes out one level stronger (same item, same
// rarity, a little more of everything it does), up to MAX_LEVEL. The fire always
// takes; the price climbs with the level. The offering is a two-step affair so
// the cinematic (src/pitCinematic.ts) can play between them: `attemptUpgrade`
// spends, the result hovers over the fire, and `takeUpgrade` writes it to the
// hero. Leaving the hall without taking it applies it as well: nothing paid for
// is ever lost. Rarity is no longer the pit's business: an item is as rare as
// the drop that brought it (src/weapons.ts rollArmorRank / rollWeaponLoot).

import { getEquipmentItemOrNull } from './equipmentCatalog'
import { ownedArmorIds, ownedWeaponIds } from './inventory'
import { getLootState, spendCoins } from './loot'
import { LEVEL_STEP, MAX_LEVEL, setUpgradeLevel, upgradeLevelOf } from './shared/upgradeRanks'
import { Rarity, rarityOf, RARITIES } from './weapons'

/** What the step from level `i + 1` to `i + 2` costs. */
export const LEVEL_COSTS = [60, 120, 200, 300, 420, 560, 720, 900, 1100]
/** For the sheet's blurb: what one level adds, in percent. */
export const LEVEL_PERCENT = Math.round(LEVEL_STEP * 100)

export type UpgradeOffer = {
  id: string
  /** The level the item has now. */
  from: number
  /** Undefined at MAX_LEVEL: nothing higher to reach. */
  to: number | undefined
  coins: number
  /** The item's rarity, for the card's colour. */
  rarity: Rarity
  /** The purse covers it. */
  affordable: boolean
}

export type UpgradeResult = {
  id: string
  /** The fire always takes now; kept for the cinematic's beats. */
  success: boolean
  from: number
  /** The level the item has once taken. */
  to: number
  /** What the offering cost. */
  coins: number
  rarity: Rarity
  /** The last level: the fire makes a show of it. */
  max: boolean
}

/** The result waiting over the fire, not yet written to the hero. */
let pending: UpgradeResult | undefined

/** What the pit would do with item `id` for this hero right now. */
export function upgradeOffer(id: string): UpgradeOffer {
  const from = upgradeLevelOf(id)
  const to = from < MAX_LEVEL ? from + 1 : undefined
  const coins = to ? LEVEL_COSTS[Math.min(LEVEL_COSTS.length - 1, from - 1)] : 0
  return { id, from, to, coins, rarity: rarityOf(id), affordable: !!to && getLootState().coins >= coins }
}

/** Everything this hero could offer, weapons then armor, the ones that can still rise first, the furthest along before the rest. */
export function upgradeOffers(): UpgradeOffer[] {
  const offers = [
    ...ownedWeaponIds().filter((id) => id !== 'none-weapon' && !!getEquipmentItemOrNull(id)?.weapon),
    ...ownedArmorIds()
  ].map(upgradeOffer)
  return offers.sort((a, b) => Number(!!b.to) - Number(!!a.to) || b.from - a.from || RARITIES[b.rarity].rank - RARITIES[a.rarity].rank || a.id.localeCompare(b.id))
}

/**
 * Spend the coins. Undefined when the item cannot rise, the purse is short, or
 * another result is still waiting to be taken.
 */
export function attemptUpgrade(id: string): UpgradeResult | undefined {
  if (pending) return undefined
  const offer = upgradeOffer(id)
  if (!offer.to || !spendCoins(offer.coins)) return undefined
  pending = { id, success: true, from: offer.from, to: offer.to, coins: offer.coins, rarity: offer.rarity, max: offer.to >= MAX_LEVEL }
  return pending
}

export function pendingUpgrade(): UpgradeResult | undefined {
  return pending
}

/** Write the waiting result to the hero (the next level) and clear it. Undefined when nothing waited. */
export function takeUpgrade(): UpgradeResult | undefined {
  const result = pending
  if (!result) return undefined
  pending = undefined
  if (result.success) setUpgradeLevel(result.id, Math.max(upgradeLevelOf(result.id), result.to))
  return result
}
