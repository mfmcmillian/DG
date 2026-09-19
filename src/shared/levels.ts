// The realms, their dungeons and the difficulty table. Pure data shared by
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

export type RealmId = 'fortress' | 'castle' | 'forge'

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
}

export const LEVELS: LevelDefinition[] = [
  {
    id: 0, realm: 'fortress', name: 'The Dark Fortress', seed: 1337, style: 'open',
    blurb: 'Ten rooms, one Warlord. Where every champion starts.',
    health: 1, damage: 1, coins: 1
  },
  {
    id: 1, realm: 'fortress', name: 'The Vaults', seed: 36, style: 'open',
    blurb: 'Thirteen rooms and three treasure vaults, each with its guard.',
    health: 1.15, damage: 1.1, coins: 1.3
  },
  {
    id: 2, realm: 'fortress', name: 'The Sunken Halls', seed: 153, style: 'open',
    blurb: 'Eight rooms deep before the Warlord. Longer corridors, more patrols.',
    health: 1.3, damage: 1.2, coins: 1.6
  },
  {
    id: 3, realm: 'fortress', name: 'The Warren', seed: 302, style: 'open',
    blurb: 'Twenty-eight doorways. Enemies come from more than one side.',
    health: 1.5, damage: 1.35, coins: 2
  },
  {
    id: 4, realm: 'fortress', name: 'The Deep Keep', seed: 2318, style: 'open',
    blurb: 'Eleven rooms deep, the longest road to the Warlord. Bring a party.',
    health: 1.75, damage: 1.5, coins: 2.5
  },
  // --- The Fallen Crown (castle kit, Fantasy Kingdom) ---------------------------
  {
    id: 5, realm: 'castle', name: 'The Fallen Crown', seed: 4471, style: 'castle',
    blurb: 'A king\'s castle, its garrison turned. Banners still hang in the halls.',
    health: 2, damage: 1.65, coins: 3
  },
  // --- The Dwarven Forge (forge kit, Dungeon Realms) -----------------------------
  {
    id: 6, realm: 'forge', name: 'The Dwarven Forge', seed: 7729, style: 'forge',
    blurb: 'Lava ducts and saw traps. The Forge Lord still works the anvil.',
    health: 2.2, damage: 1.8, coins: 3.4
  }
]

export type DifficultyDefinition = {
  id: number
  name: string
  health: number
  damage: number
  /** Extra enemies added to every combat room. */
  extra: number
  coins: number
}

export const DIFFICULTIES: DifficultyDefinition[] = [
  { id: 0, name: 'Normal', health: 1, damage: 1, extra: 0, coins: 1 },
  { id: 1, name: 'Hard', health: 1.5, damage: 1.35, extra: 1, coins: 2 },
  { id: 2, name: 'Nightmare', health: 2.2, damage: 1.8, extra: 1, coins: 3 }
]

/**
 * The hub between runs: its own small keep (the `hall` style) so coming back
 * from a fortress never looks like the same fortress emptied out. Not in
 * LEVELS, never has enemies; the scene.json spawn point sits on its entrance.
 */
export const HUB_LEVEL: LevelDefinition = {
  id: -1, realm: 'fortress', name: 'The Hall of Antrom', seed: 1, style: 'hall',
  blurb: 'Where champions gather between fortresses.',
  health: 1, damage: 1, coins: 1
}

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

export function levelById(id: number): LevelDefinition {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, Math.floor(id)))]
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
