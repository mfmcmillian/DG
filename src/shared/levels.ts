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

export type RealmId = 'fortress' | 'pass' | 'castle' | 'forge' | 'bog' | 'thornwood' | 'crypt' | 'jade' | 'coast'

export type RealmDefinition = {
  id: RealmId
  name: string
  blurb: string
  /** The kit the realm's dungeons are built from. */
  style: StyleId
  /**
   * Which Sidekick packs dress the realm: every armor set from these packs is
   * tagged with the realm and drops nowhere else (scripts/outfits/outfits.json).
   */
  packs: string
  /** No map yet: the war table shows the page as coming soon and its sets cannot drop. */
  comingSoon?: boolean
}

export const REALMS: RealmDefinition[] = [
  {
    id: 'fortress', name: 'The Dark Fortress', style: 'open', packs: 'Fantasy Villagers, Starter',
    blurb: 'The Warlord\'s keep. Black stone, cages and braziers.'
  },
  {
    id: 'pass', name: 'The Frozen Pass', style: 'pass', packs: 'Viking Warriors',
    blurb: 'A gorge through the high peaks, held by the Jarl\'s Vikings. Snow, ice and axes.'
  },
  {
    id: 'bog', name: 'Bogmaw', style: 'bog', packs: 'Goblin Fighters',
    blurb: 'A goblin war camp in the swamp. Palisades, ballistas, bombs and the gong of the Goblin King.'
  },
  {
    id: 'castle', name: 'The Fallen Crown', style: 'castle', packs: 'Fantasy Knights', comingSoon: true,
    blurb: 'A king\'s castle, its garrison turned. Banners still hang in the halls.'
  },
  {
    id: 'thornwood', name: 'The Thornwood', style: 'open', packs: 'Elven Warriors', comingSoon: true,
    blurb: 'An elven wood gone wild. Living briar, old stone and archers who never miss.'
  },
  {
    id: 'crypt', name: 'The Crypt', style: 'crypt', packs: 'Fantasy Sorcerers, Fantasy Skeletons',
    blurb: 'Barrows under the hill. The sorcerers went down to study the dead, and stayed.'
  },
  {
    id: 'jade', name: 'The Jade Gate', style: 'open', packs: 'Samurai Warriors', comingSoon: true,
    blurb: 'A shrine fortress beyond the eastern sea. Lacquered plate and very sharp steel.'
  },
  {
    id: 'coast', name: 'The Drowned Coast', style: 'open', packs: 'Pirate Captains', comingSoon: true,
    blurb: 'A smugglers\' harbour of wrecks and sea caves. Cutlasses, powder and the Admiral\'s flag.'
  },
  {
    // The raid's ground only (RAID_LEVEL): no pack dresses it and no ladder level is set in it.
    id: 'forge', name: 'The Dwarven Forge', style: 'forge', packs: '',
    blurb: 'Lava ducts and saw traps. The Forge Lord still works the anvil.'
  }
]

/** The realms with no map yet, in the order the war table pages them after the last dungeon. */
export const COMING_SOON: RealmDefinition[] = REALMS.filter((r) => r.comingSoon)

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
  },
  {
    id: 2, realm: 'bog', name: 'Bogmaw', seed: 4041, style: 'bog',
    blurb: 'Through the marsh: the palisade and its ballistas, the bone yard, the shaman totems, the Goblin King. Fourteen minutes.',
    health: 1.7, damage: 1.5, coins: 2.6, seconds: 840
  },
  {
    id: 3, realm: 'crypt', name: 'The Crypt', seed: 6066, style: 'crypt',
    blurb: 'Under the hill: the graveyard, the ossuary and its Bone Warden, the witches\' catacombs, the Gargoyle\'s chapel, and Morvane the Lich, who raises what you kill. Fifteen minutes.',
    health: 2.0, damage: 1.7, coins: 3.0, seconds: 900
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

/**
 * The Barrow Yard: Gravewatch's graveyard (src/dungeon/barrowYard.ts), drawn
 * with the Crypt's kit on its own `yard` style. Outside the ladder and open to
 * everyone: a four-minute two-stage run for the daily Rounds (any party may
 * pick it), and on Saturday nights the Rising's arena, where the whole server
 * fights the Demon in one party (RISING_PARTY, src/raid/risingServer.ts).
 */
export const BARROW_YARD: LevelDefinition = {
  id: -3, realm: 'crypt', name: 'The Barrow Yard', seed: 3131, style: 'yard',
  blurb: 'The graveyard under the hill. Two stages, five minutes: the dead claw out of the graves at the Lychgate, and the Barrow Warden holds the barrow with two witches raising.',
  health: 1.6, damage: 1.5, coins: 2.2, seconds: 300
}

export const RISING_PARTY = 'rising'

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

/**
 * Whose armor sets a realm's dungeons drop: its own, since every Sidekick pack
 * dresses one realm (src/outfitCatalog.json). A realm with no map yet lends to
 * nobody; its sets wait, marked coming soon, until the map ships. Rarity is not
 * the realm's: a piece is as rare as the difficulty it fell on (src/weapons.ts rollArmorRank).
 */
export const ARMOR_DROP_REALMS: Record<RealmId, readonly RealmId[]> = {
  fortress: ['fortress'], pass: ['pass'], bog: ['bog'], castle: ['castle'], forge: ['forge'], thornwood: ['thornwood'], crypt: ['crypt'], jade: ['jade'], coast: ['coast']
}

/** The maps whose enemies drop a realm's armor sets, by name. */
export function armorDropLevels(realm: RealmId): LevelDefinition[] {
  return LEVELS.filter((l) => ARMOR_DROP_REALMS[l.realm].includes(realm))
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
  if (id === BARROW_YARD.id) return BARROW_YARD
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
