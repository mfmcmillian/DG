// The Quartermaster's trade: the hero's extras for coin. Any copy in the bag
// that is not on a hero can go (src/shared/gearBag.ts), whatever class it was
// cut for. A copy is worth its rarity's salvage price (what a duplicate used
// to fetch on the floor) plus a share of the coin the pit's fire was fed, so
// a forged piece is never sold for scrap. The sheet (src/sellUi.tsx) lists
// the bag by rarity and lets a whole tier go at once.

import { EquipmentItem, getEquipmentItemOrNull } from './equipmentCatalog'
import { getEquippedCharacter } from './characterPicker'
import { enforceOwnedLoadout } from './inventory'
import { addCoins } from './loot'
import { forgetGear } from './newGear'
import { bagRows, GearInstance, isGearWorn, removeGear } from './shared/gearBag'
import { LEVEL_COSTS } from './upgrades'
import { Rarity, rarityOf, RARITIES } from './weapons'

/** The share of the coin fed to the pit that comes back when a forged copy is sold. */
const FORGE_REFUND = 0.3

export type SellOffer = {
  uid: string
  item: EquipmentItem
  rank: number
  rarity: Rarity
  level: number
  coins: number
}

/** What the Quartermaster pays for a copy of `item` at this rarity and level. */
export function sellPrice(item: string, rank: number, level: number): number {
  let fed = 0
  for (let i = 0; i < Math.min(level - 1, LEVEL_COSTS.length); i++) fed += LEVEL_COSTS[i]
  return RARITIES[rarityOf(item, rank)].coins + Math.round(fed * FORGE_REFUND)
}

function offerFor(row: GearInstance): SellOffer | undefined {
  const item = getEquipmentItemOrNull(row.item)
  if (!item) return undefined
  return { uid: row.uid, item, rank: row.rank, rarity: rarityOf(row.item, row.rank), level: row.level, coins: sellPrice(row.item, row.rank, row.level) }
}

/** Everything the hero could part with: every copy not on a hero, the least valuable first. */
export function sellOffers(): SellOffer[] {
  const offers: SellOffer[] = []
  for (const row of bagRows()) {
    if (isGearWorn(row)) continue
    const offer = offerFor(row)
    if (offer) offers.push(offer)
  }
  return offers.sort((a, b) => a.coins - b.coins || RARITIES[a.rarity].rank - RARITIES[b.rarity].rank || a.item.name.localeCompare(b.item.name) || a.uid.localeCompare(b.uid))
}

/** Sell one copy. The coins paid, or undefined when it is worn or gone. */
export function sellGear(uid: string): number | undefined {
  const row = bagRows().find((r) => r.uid === uid)
  if (!row || isGearWorn(row)) return undefined
  const offer = offerFor(row)
  if (!offer) return undefined
  removeGear(uid)
  forgetGear(uid)
  addCoins(offer.coins)
  // A copy that was the last of an item somebody had picked out comes off them.
  enforceOwnedLoadout(getEquippedCharacter().id)
  return offer.coins
}

/** Sell every copy listed. The coins paid in all. */
export function sellMany(uids: readonly string[]): number {
  let total = 0
  for (const uid of uids) total += sellGear(uid) ?? 0
  return total
}
