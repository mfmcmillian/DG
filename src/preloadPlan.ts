// What downloads when. The title (and later the hub where players hang out)
// waits only on the hall; a hero's outfit is fetched when we know which hero;
// a realm's enemies are fetched before its run starts. The rest streams in
// behind, in the order a new player is likely to meet it.

import { CHARACTERS } from './characterPicker'
import { fxSoundAssets, fxTextureAssets } from './combatFx'
import { kitSrcsForStyle, StyleId, styleTexturesFor, STYLES } from './dungeon/config'
import { enemyPreloadAssets } from './dungeonEnemies'
import { EquipmentLoadout } from './equipmentCatalog'
import { equipmentModelPaths } from './equipmentAvatar'
import { getCommittedLoadout } from './equipmentState'
import { isPreloadComplete, preloadGroup, PreloadGroup } from './preload'
import { projectileAssets } from './projectiles'
import { LEVELS, REALMS } from './shared/levels'

/** The hall the title looks out on, plus the small FX set every run uses. */
export const PRELOAD_HUB = 'hub'

export function heroGroupId(cid: string) {
  return `hero-${cid}`
}

export function realmGroupId(style: StyleId) {
  return `realm-${style}`
}

function realmLabel(style: StyleId) {
  return REALMS.find((r) => r.style === style)?.name ?? 'the dungeon'
}

/** The saved or chosen champion's outfit and weapon; `urgent` when a button waits on it. */
export function requestHeroPreload(cid: string, loadout: EquipmentLoadout, urgent = false) {
  const name = CHARACTERS.find((c) => c.id === cid)?.name ?? 'your champion'
  preloadGroup(heroGroupId(cid), name, equipmentModelPaths(cid, loadout), urgent)
}

/** A realm's kit and its roster, for the level picked in the lobby. */
export function requestRealmPreload(style: StyleId, urgent = false) {
  preloadGroup(realmGroupId(style), realmLabel(style), [
    ...kitSrcsForStyle(STYLES[style]),
    ...styleTexturesFor(STYLES[style]),
    ...enemyPreloadAssets(style)
  ], urgent)
}

export function isRealmPreloaded(style: StyleId) {
  return isPreloadComplete(realmGroupId(style))
}

/** A loading line for one group: "Loading the hall… 14 / 17". */
export function preloadCaption(group: Readonly<PreloadGroup> | undefined, verb = 'Loading') {
  if (!group) return `${verb}\u2026`
  const counts = group.total ? ` ${group.done} / ${group.total}` : ''
  return `${verb} ${group.label}\u2026${counts}`
}

/** Kick off the whole plan at start-up. Groups download two at a time in this order. */
export function planPreload() {
  preloadGroup(PRELOAD_HUB, 'the hall', [
    ...kitSrcsForStyle(STYLES.hall),
    ...styleTexturesFor(STYLES.hall),
    'models/loot/coin.glb', 'models/loot/heart.glb',
    ...projectileAssets(),
    ...fxSoundAssets(),
    ...fxTextureAssets()
  ])
  // First realm a new player enters, then the other heroes' default looks
  // (the picker shows them), then the later realms.
  const styles: StyleId[] = []
  for (const level of LEVELS) if (!styles.includes(level.style)) styles.push(level.style)
  if (styles.length) requestRealmPreload(styles[0])
  for (const c of CHARACTERS) requestHeroPreload(c.id, getCommittedLoadout(c.id))
  for (const style of styles.slice(1)) requestRealmPreload(style)
}
