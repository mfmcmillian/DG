// What a hero's copy of an item is worth lives in the bag now (gearBag.ts):
// one row per copy with the rarity it fell at and the level the pit forged
// it to. This module keeps the names the weapon and armor tables, the synced
// look and the pit have always used; `upgradeRankOf(id)` and
// `upgradeLevelOf(id)` answer for the copy of `id` the hero has in use.

export {
  clampLevel, LEVEL_FLAT, LEVEL_STEP, levelFlatBonus, levelMultiplier, MAX_LEVEL, upgradeAffixOf, upgradeLevelOf, upgradeRankOf
} from './gearBag'
