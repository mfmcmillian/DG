// What downloads when. The title (and later the hub where players hang out)
// waits only on the hall; a hero's outfit is fetched when we know which hero;
// a realm's enemies are fetched before its run starts. The rest streams in
// behind, in the order a new player is likely to meet it.
//
// Every model the renderer takes in costs it a frame or two to parse, and it
// does so whether or not anyone is looking: a group streaming behind a player
// in the hall is a stutter for as long as it lasts. So nothing streams behind
// play. Start-up asks for two groups, the hall and the first realm, both
// behind the title (Continue waits on the first realm: whenFirstRealmReady).
// The other heroes' looks are asked for when the picker is about to show them
// (scheduleHeroPreload). The later realms and the raid are not asked for at
// all until a door needs them: the war table requests the picked realm and
// shows "Preparing…" until it is in (src/lobbyUi.tsx), the Pit gate the same
// for the raid (src/raid/raidHudUi.tsx).

import { CHARACTERS } from './characterPicker'
import { fxSoundAssets, fxTextureAssets } from './combatFx'
import { AMBIENCE_ASSETS } from './dungeon/builder'
import { kitSrcsForStyle, StyleId, styleTexturesFor, STYLES } from './dungeon/config'
import { KIT } from './dungeon/kit'
import { bogFurnitureIds } from './dungeon/bogmaw'
import { hubFurnitureIds } from './dungeon/hub'
import { passFurnitureIds } from './dungeon/pass'
import { pitFurnitureIds } from './dungeon/pit'
import { enemyPreloadAssets } from './dungeonEnemies'
import { EquipmentLoadout } from './equipmentCatalog'
import { equipmentModelPaths } from './equipmentAvatar'
import { getCommittedLoadout } from './equipmentState'
import { engine } from '@dcl/sdk/ecs'
import { getPreloadGroup, isPreloadComplete, preloadGroup, PreloadGroup } from './preload'
import { projectileAssets } from './projectiles'
import { partSources } from './raid/colossusPose'
import { LEVELS, RAID_LEVEL, REALMS } from './shared/levels'
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
  const furniture = style === 'pass' ? passFurnitureIds().map((id) => KIT[id].src) : style === 'bog' ? bogFurnitureIds().map((id) => KIT[id].src) : []
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

/** The realms' styles in the order a new player meets them. */
function realmStyles(): StyleId[] {
  const styles: StyleId[] = []
  for (const level of LEVELS) if (!styles.includes(level.style)) styles.push(level.style)
  return styles
}

let first: StyleId | undefined
/** The first realm's style: the one Continue waits on. */
export function firstRealmStyle(): StyleId {
  return (first ??= realmStyles()[0])
}

export function firstRealmGroup(): Readonly<PreloadGroup> | undefined {
  return getPreloadGroup(realmGroupId(firstRealmStyle()))
}

/** Kick off the plan at start-up: the hall, then the first realm. The rest waits for scheduleLatePreload. */
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
  const first = firstRealmStyle()
  if (first) requestRealmPreload(first)
}

let heroesRequested = false
/** Continues waiting on the first realm: resolve when it is in, or when their patience runs out. */
const waiting: Array<{ left: number; resolve: () => void }> = []

/**
 * The heroes' default looks, for a picker about to show them (New game, a save
 * that came back empty, the offline title). Once is enough.
 */
export function scheduleHeroPreload() {
  if (heroesRequested) return
  heroesRequested = true
  for (const c of CHARACTERS) requestHeroPreload(c.id, getCommittedLoadout(c.id))
}

/**
 * Resolves when the first realm's group is in, or after `capSeconds` if it is
 * not: a slow connection gets the hall with the realm still streaming, as
 * before, rather than a Continue that never lets go.
 */
export function whenFirstRealmReady(capSeconds: number): Promise<void> {
  if (isRealmPreloaded(firstRealmStyle())) return Promise.resolve()
  return new Promise((resolve) => waiting.push({ left: capSeconds, resolve }))
}

function tick(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  if (waiting.length) {
    const ready = isRealmPreloaded(firstRealmStyle())
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i]
      w.left -= span
      if (ready || w.left <= 0) {
        waiting.splice(i, 1)
        w.resolve()
      }
    }
  }
}
engine.addSystem(tick)
