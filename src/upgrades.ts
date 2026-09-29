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
import { FREE_COPY, getCommittedLoadout, isUsableByHero } from './inventory'
import { getLootState, spendCoins } from './loot'
import { addGear, bagRow, bagRows, bagRowsOf, isGearWorn, LEVEL_FLAT, LEVEL_STEP, MAX_LEVEL, setGearLevel } from './shared/gearBag'
import { Rarity, rarityOf, RARITIES } from './weapons'

/** What the step from level `i + 1` to `i + 2` costs. */
export const LEVEL_COSTS = [60, 120, 200, 300, 420, 560, 720, 900, 1100]
/** For the sheet's blurb: what one level adds, in percent, and the flat damage a weapon gains besides. */
export const LEVEL_PERCENT = Math.round(LEVEL_STEP * 100)
export const LEVEL_FLAT_DAMAGE = LEVEL_FLAT

export type UpgradeOffer = {
  /** The copy offered (src/shared/gearBag.ts), or a starter's free copy ('s:<item>'), which the fire makes real. */
  uid: string
  /** The catalog item, for the card and the FX. */
  id: string
  /** The copy's rarity steps. */
  rank: number
  /** The level the item has now. */
  from: number
  /** Undefined at MAX_LEVEL: nothing higher to reach. */
  to: number | undefined
  coins: number
  /** The item's rarity, for the card's colour. */
  rarity: Rarity
  /** The purse covers it. */
  affordable: boolean
  /** The hero has it on right now: what the fire does to it shows in the next fight. */
  equipped: boolean
}

export type UpgradeResult = {
  uid: string
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

/** What the pit would do with the copy `uid` for this hero right now; undefined when the hero has no such copy. */
export function upgradeOffer(uid: string): UpgradeOffer | undefined {
  const free = uid.startsWith(FREE_COPY)
  const row = free ? undefined : bagRow(uid)
  const id = free ? uid.slice(FREE_COPY.length) : row?.item
  if (!id || !getEquipmentItemOrNull(id)) return undefined
  const from = row?.level ?? 1
  const rank = row?.rank ?? 0
  const to = from < MAX_LEVEL ? from + 1 : undefined
  const coins = to ? LEVEL_COSTS[Math.min(LEVEL_COSTS.length - 1, from - 1)] : 0
  const slot = getEquipmentItemOrNull(id)?.slot
  const equipped = slot !== undefined && getCommittedLoadout()[slot] === id && (row ? isGearWorn(row) : !bagRowsOf(id).length)
  return { uid, id, rank, from, to, coins, rarity: rarityOf(id, rank), affordable: !!to && getLootState().coins >= coins, equipped }
}

/**
 * Everything this hero could offer: every copy in the bag its class can use,
 * and the free copy of a starter it owns no copy of. The ones that can still
 * rise first, what the hero wears before the rest, then the furthest along.
 */
export function upgradeOffers(): UpgradeOffer[] {
  const offers: UpgradeOffer[] = []
  for (const row of bagRows()) {
    const item = getEquipmentItemOrNull(row.item)
    if (!item || item.slot === 'weapon' && !item.weapon || !item.weapon && !item.set || !isUsableByHero(row.item)) continue
    const offer = upgradeOffer(row.uid)
    if (offer) offers.push(offer)
  }
  const worn = getCommittedLoadout()
  for (const slot of ['weapon', 'head', 'chest', 'shoulders', 'hands', 'legs', 'boots'] as const) {
    const id = worn[slot]
    const item = getEquipmentItemOrNull(id)
    if (!item || (slot === 'weapon' ? !item.weapon : !item.set) || bagRowsOf(id).length) continue
    const offer = upgradeOffer(FREE_COPY + id)
    if (offer) offers.push(offer)
  }
  return offers.sort((a, b) =>
    Number(!!b.to) - Number(!!a.to) || Number(b.equipped) - Number(a.equipped) || b.from - a.from
    || RARITIES[b.rarity].rank - RARITIES[a.rarity].rank || a.id.localeCompare(b.id) || a.uid.localeCompare(b.uid))
}

/**
 * Spend the coins. Undefined when the item cannot rise, the purse is short, or
 * another result is still waiting to be taken.
 */
export function attemptUpgrade(uid: string): UpgradeResult | undefined {
  if (pending) return undefined
  const offer = upgradeOffer(uid)
  if (!offer?.to || !spendCoins(offer.coins)) return undefined
  pending = { uid, id: offer.id, success: true, from: offer.from, to: offer.to, coins: offer.coins, rarity: offer.rarity, max: offer.to >= MAX_LEVEL }
  return pending
}

export function pendingUpgrade(): UpgradeResult | undefined {
  return pending
}

/**
 * Write the waiting result to the hero (the next level) and clear it. A
 * starter's free copy, forged, becomes a real copy in the bag (never refused:
 * it was already on the hero). Undefined when nothing waited.
 */
export function takeUpgrade(): UpgradeResult | undefined {
  const result = pending
  if (!result) return undefined
  pending = undefined
  if (!result.success) return result
  if (result.uid.startsWith(FREE_COPY)) {
    const row = addGear(result.id, 0, result.to, undefined, true)
    if (row) result.uid = row.uid
  } else {
    const row = bagRow(result.uid)
    if (row) setGearLevel(result.uid, Math.max(row.level, result.to))
  }
  return result
}
