// What downloads when. The title (and later the hub where players hang out)
// waits only on the hall; a hero's outfit is fetched when we know which hero;
// a realm's enemies are fetched before its run starts. The rest streams in
// behind, in the order a new player is likely to meet it.

import { CHARACTERS } from './characterPicker'
import { fxSoundAssets, fxTextureAssets } from './combatFx'
import { AMBIENCE_ASSETS } from './dungeon/builder'
import { kitSrcsForStyle, StyleId, styleTexturesFor, STYLES } from './dungeon/config'
import { KIT } from './dungeon/kit'
import { hubFurnitureIds } from './dungeon/hub'
import { passFurnitureIds } from './dungeon/pass'
import { pitFurnitureIds } from './dungeon/pit'
import { enemyPreloadAssets } from './dungeonEnemies'
import { EquipmentLoadout } from './equipmentCatalog'
import { equipmentModelPaths } from './equipmentAvatar'
import { getCommittedLoadout } from './equipmentState'
import { isPreloadComplete, preloadGroup, PreloadGroup } from './preload'
import { projectileAssets } from './projectiles'
import { partSources } from './raid/colossusPose'
import { LEVELS, RAID_LEVEL, RAID_OPEN, REALMS } from './shared/levels'
import { t } from './i18n'

/** The hall the title looks out on, plus the small FX set every run uses. */
export const PRELOAD_HUB = 'hub'

export function heroGroupId(cid: string) {
  return `hero-${cid}`
}

export function realmGroupId(style: StyleId) {
  return `realm-${style}`
}

function realmLabel(style: StyleId) {
  return LEVELS.find((l) => l.style === style)?.name ?? REALMS.find((r) => r.style === style)?.name ?? t('the dungeon')
}

/** The saved or chosen champion's outfit and weapon; `urgent` when a button waits on it. */
export function requestHeroPreload(cid: string, loadout: EquipmentLoadout, urgent = false) {
  const name = CHARACTERS.find((c) => c.id === cid)?.name ?? t('your champion')
  preloadGroup(heroGroupId(cid), name, equipmentModelPaths(cid, loadout), urgent)
}

/** A realm's kit and its roster, for the level picked in the lobby. The Pit is authored, with the Colossus in place of a roster. */
export function requestRealmPreload(style: StyleId, urgent = false) {
  if (style === RAID_LEVEL.style) {
    preloadGroup(realmGroupId(style), RAID_LEVEL.name, [
      ...kitSrcsForStyle(STYLES[style], pitFurnitureIds()),
      ...styleTexturesFor(STYLES[style]),
      ...partSources()
    ], urgent)
    return
  }
  // The pass is drawn by hand: its lake, camp and bone field are furniture on top of the style's props.
  const furniture = style === 'pass' ? passFurnitureIds().map((id) => KIT[id].src) : []
  preloadGroup(realmGroupId(style), realmLabel(style), [
    ...kitSrcsForStyle(STYLES[style]),
    ...furniture,
    ...styleTexturesFor(STYLES[style]),
    ...enemyPreloadAssets(style)
  ], urgent)
}

export function isRealmPreloaded(style: StyleId) {
  return isPreloadComplete(realmGroupId(style))
}

/** A loading line for one group: "Loading the hall… 14 / 17". The label is a realm or champion name, or one of the phrases below. */
export function preloadCaption(group: Readonly<PreloadGroup> | undefined, verb = t('Loading')) {
  if (!group) return `${verb}\u2026`
  const counts = group.total ? ` ${group.done} / ${group.total}` : ''
  return `${verb} ${t(group.label)}\u2026${counts}`
}

/** Kick off the whole plan at start-up. Groups download two at a time in this order. */
export function planPreload() {
  // The hall is authored: its own furniture (some from the castle and forge
  // kits) rather than the style's generated prop lists.
  preloadGroup(PRELOAD_HUB, 'the hall', [
    ...kitSrcsForStyle(STYLES.hall, hubFurnitureIds()),
    ...styleTexturesFor(STYLES.hall),
    'models/loot/coin.glb', 'models/loot/heart.glb',
    ...projectileAssets(),
    ...fxSoundAssets(),
    ...AMBIENCE_ASSETS,
    ...fxTextureAssets()
  ])
  // First realm a new player enters, then the other heroes' default looks
  // (the picker shows them), then the later realms.
  const styles: StyleId[] = []
  for (const level of LEVELS) if (!styles.includes(level.style)) styles.push(level.style)
  if (styles.length) requestRealmPreload(styles[0])
  for (const c of CHARACTERS) requestHeroPreload(c.id, getCommittedLoadout(c.id))
  for (const style of styles.slice(1)) requestRealmPreload(style)
  if (RAID_OPEN) requestRealmPreload(RAID_LEVEL.style)
}
