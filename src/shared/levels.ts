// The dungeons and the difficulty table (this branch: hand-drawn maps in the
// Dungeon Quest shape, see src/dungeon/gauntlet.ts and src/dungeon/pass.ts). Pure data shared by
// the server (which simulates each party's run) and the clients (which build
// the layout and show the lobby), so a level is the same fortress everywhere.
//
// A realm is one Synty kit (a DungeonStyle) and a ladder of levels through
// it. Every level is a seed for the generator plus a tier that scales the
// enemies even on Normal; the difficulty multiplies on top. Level ids are
// flat integers across all realms: the `party` message, the saved progress
// array and every clear on record are indexed by them, so new levels are only
// ever appended to LEVELS and a realm's ladder is the order they appear in.
// The hub between runs is its own layout (HUB_LEVEL), not part of any realm.

import { StyleId } from '../dungeon/config'

export type RealmId = 'fortress' | 'pass' | 'castle' | 'forge'

export type RealmDefinition = {
  id: RealmId
  name: string
  blurb: string
  /** The kit the realm's dungeons are built from. */
  style: StyleId
}

export const REALMS: RealmDefinition[] = [
  {
    id: 'fortress', name: 'The Dark Fortress', style: 'open',
    blurb: 'The Warlord\'s keep. Black stone, cages and braziers.'
  },
  {
    id: 'pass', name: 'The Frozen Pass', style: 'pass',
    blurb: 'A gorge through the high peaks, held by the Jarl\'s Vikings. Snow, ice and axes.'
  },
  {
    id: 'castle', name: 'The Fallen Crown', style: 'castle',
    blurb: 'A king\'s castle, its garrison turned. Banners still hang in the halls.'
  },
  {
    id: 'forge', name: 'The Dwarven Forge', style: 'forge',
    blurb: 'Lava ducts and saw traps. The Forge Lord still works the anvil.'
  }
]

export type LevelDefinition = {
  id: number
  realm: RealmId
  name: string
  blurb: string
  seed: number
  style: StyleId
  /** Base enemy scaling for this level before difficulty. */
  health: number
  damage: number
  /** Coins per kill are multiplied by this and the difficulty's factor. */
  coins: number
  /** The run fails when this many seconds pass without the boss falling (0: no limit). */
  seconds: number
}

export const LEVELS: LevelDefinition[] = [
  {
    id: 0, realm: 'fortress', name: 'The Dark Fortress', seed: 1337, style: 'gauntlet',
    blurb: 'Seven rooms, two wardens, one Warlord. Ten minutes.',
    health: 1, damage: 1, coins: 1.5, seconds: 600
  },
  {
    id: 1, realm: 'pass', name: 'The Frozen Pass', seed: 2026, style: 'pass',
    blurb: 'Up the gorge: a frozen lake, two huskarls, the Jarl in his camp. Twelve minutes.',
    health: 1.35, damage: 1.25, coins: 2, seconds: 720
  }
]

export type DifficultyDefinition = {
  id: number
  name: string
  health: number
  damage: number
  /** Extra enemies added to every wave. */
  extra: number
  coins: number
  /** The hero level it asks for; the server refuses a party below it. */
  level: number
}

export const DIFFICULTIES: DifficultyDefinition[] = [
  { id: 0, name: 'Easy', health: 1, damage: 1, extra: 0, coins: 1, level: 1 },
  { id: 1, name: 'Medium', health: 1.6, damage: 1.4, extra: 1, coins: 2, level: 5 },
  { id: 2, name: 'Hard', health: 2.4, damage: 1.9, extra: 2, coins: 3, level: 10 }
]

/** The hardest difficulty a hero of this level may pick (0 when none: Easy is always open). */
export function difficultyAllowed(heroLevel: number): number {
  let best = 0
  for (const d of DIFFICULTIES) if (heroLevel >= d.level) best = d.id
  return best
}

/** The Pit of Chains is closed on this branch: one map, one boss. */
export const RAID_OPEN = false

/**
 * The hub between runs: its own small keep (the `hall` style) so coming back
 * from a fortress never looks like the same fortress emptied out. Not in
 * LEVELS, never has enemies; the scene.json spawn point sits on its entrance.
 */
export const HUB_LEVEL: LevelDefinition = {
  id: -1, realm: 'fortress', name: 'The Hall of Antrom', seed: 1, style: 'hall',
  blurb: 'Where champions gather between fortresses.',
  health: 1, damage: 1, coins: 1, seconds: 0
}

/**
 * The Pit of Chains: the realm's one raid, a ring of ruined dwarven stone over
 * lava where the Chained Colossus stands (src/raid/). Like the hub it is an
 * authored layout outside LEVELS, reached from the hall's summoning circle
 * rather than the lobby. One shared arena per realm: the raid party
 * (RAID_PARTY) never disbands and anyone may drop in while the fight is up.
 */
export const RAID_LEVEL: LevelDefinition = {
  id: -2, realm: 'forge', name: 'The Pit of Chains', seed: 2, style: 'pit',
  blurb: 'The Chained Colossus. Bring everyone.',
  health: 1, damage: 2.4, coins: 4, seconds: 0
}

export const RAID_PARTY = 'raid'
export const MAX_RAID = 8

export function realmById(id: RealmId): RealmDefinition {
  return REALMS.find((r) => r.id === id) ?? REALMS[0]
}

/** A realm's ladder, in play order. */
export function realmLevels(realm: RealmId): LevelDefinition[] {
  return LEVELS.filter((l) => l.realm === realm)
}

/** The realm a level belongs to (the first realm for the hub and unknown ids). */
export function realmOfLevel(level: number): RealmDefinition {
  return realmById(LEVELS[level]?.realm ?? REALMS[0].id)
}

/** The level that follows a cleared one on the linear ladder, or undefined after the last. */
export function nextLevel(level: number): LevelDefinition | undefined {
  return level >= 0 && level < LEVELS.length - 1 ? LEVELS[level + 1] : undefined
}

/** The level before this one on the linear ladder, or undefined for the first. */
export function previousLevel(level: number): LevelDefinition | undefined {
  return level > 0 && level < LEVELS.length ? LEVELS[level - 1] : undefined
}

export const MAX_PARTY = 4

/** A level by id, the hub and the raid included (they carry their own ids below zero). */
export function levelById(id: number): LevelDefinition {
  if (id === RAID_LEVEL.id) return RAID_LEVEL
  if (id === HUB_LEVEL.id) return HUB_LEVEL
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, Math.floor(id)))]
}

/** The level's name for the roster and prompts, whatever the id. */
export function levelNameOf(id: number): string {
  return levelById(id).name
}

export function difficultyById(id: number): DifficultyDefinition {
  return DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, Math.floor(id)))]
}

/**
 * Progress is one number per level id: 0 = never cleared, n = cleared up to
 * difficulty n-1. One linear ladder: each later level opens once the one
 * before it has been cleared. Developer tools skip this gate without writing clears.
 */
export function levelUnlocked(progress: readonly number[], level: number): boolean {
  if (level <= 0) return true
  return (progress[level - 1] ?? 0) > 0
}
