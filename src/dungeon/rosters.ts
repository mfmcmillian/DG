// Enemy rosters per dungeon style. Same combat kit everywhere; names, weapons,
// leash and the one extra behaviour (posted guards, later traps) live here so
// fortress levels stay as they were.

import { StyleId } from './config'
import { RivalProfile } from '../rivalBrain'

export type EnemyRole = 'grunt' | 'elite' | 'boss'

export type Archetype = {
  name: string
  characterId: string
  weapon: string
  health: number
  scale: number
  damageScale: number
  aggro: number
  leash: number
  speed: number
  profile: RivalProfile
  role: EnemyRole
  /** Castle: hold a doorway instead of chasing across the room. */
  posted?: boolean
}

export type Roster = {
  striker: Archetype
  scout: Archetype
  guard: Archetype
  boss: Archetype
  posted?: Archetype
}

const FORTRESS: Roster = {
  striker: {
    name: 'Striker', characterId: 'striker', weapon: 'fk-axe-06', health: 90, scale: 1, damageScale: 1,
    aggro: 6.5, leash: 11, speed: 1.15, profile: { blockChance: 0.15, pace: 0.8 }, role: 'grunt'
  },
  scout: {
    name: 'Scout', characterId: 'scout', weapon: 'gb-sword-02', health: 75, scale: 0.95, damageScale: 0.85,
    aggro: 7.5, leash: 11, speed: 1.2, profile: { blockChance: 0.2, pace: 0.9 }, role: 'grunt'
  },
  guard: {
    name: 'Vault Guard', characterId: 'vanguard', weapon: 'dr-warhammer-large-02', health: 150, scale: 1.08, damageScale: 1.15,
    aggro: 5, leash: 10, speed: 0.9, profile: { blockChance: 0.5, pace: 1.1 }, role: 'elite'
  },
  boss: {
    name: 'Warlord', characterId: 'brute', weapon: 'df-sword-02', health: 460, scale: 1.48,
    damageScale: 1.7, aggro: 11, leash: 18, speed: 1.08,
    profile: { blockChance: 0.08, pace: 0.82, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.6 },
    role: 'boss'
  }
}

const CASTLE: Roster = {
  striker: {
    name: 'Hall Knight', characterId: 'striker', weapon: 'fk-axe-06', health: 95, scale: 1, damageScale: 1.05,
    aggro: 6.5, leash: 11, speed: 1.1, profile: { blockChance: 0.2, pace: 0.85 }, role: 'grunt'
  },
  scout: {
    name: 'Hall Scout', characterId: 'scout', weapon: 'fk-dagger-03', health: 78, scale: 0.95, damageScale: 0.88,
    aggro: 7.5, leash: 11, speed: 1.22, profile: { blockChance: 0.18, pace: 0.88 }, role: 'grunt'
  },
  guard: {
    name: 'Cage Brute', characterId: 'vanguard', weapon: 'fk-hammer-04', health: 160, scale: 1.1, damageScale: 1.2,
    aggro: 5, leash: 10, speed: 0.88, profile: { blockChance: 0.45, pace: 1.15 }, role: 'elite'
  },
  posted: {
    name: 'Posted Knight', characterId: 'vanguard', weapon: 'fk-sword-08', health: 130, scale: 1.04, damageScale: 1.1,
    aggro: 4.5, leash: 4.2, speed: 0.7, profile: { blockChance: 0.58, pace: 1.05 }, role: 'elite', posted: true
  },
  boss: {
    name: 'Usurper', characterId: 'brute', weapon: 'fk-sword-18', health: 500, scale: 1.5,
    damageScale: 1.75, aggro: 11, leash: 18, speed: 1.06,
    profile: { blockChance: 0.1, pace: 0.8, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.6 },
    role: 'boss'
  }
}

const FORGE: Roster = {
  striker: {
    name: 'Forge Hand', characterId: 'striker', weapon: 'dr-axe-small-01', health: 100, scale: 1, damageScale: 1.08,
    aggro: 6.2, leash: 11, speed: 1.05, profile: { blockChance: 0.18, pace: 0.85 }, role: 'grunt'
  },
  scout: {
    name: 'Lava Scout', characterId: 'scout', weapon: 'dr-sword-medium-01', health: 80, scale: 0.95, damageScale: 0.9,
    aggro: 7.6, leash: 11, speed: 1.24, profile: { blockChance: 0.16, pace: 0.86 }, role: 'grunt'
  },
  guard: {
    name: 'Cog Bruiser', characterId: 'vanguard', weapon: 'dr-warhammer-large-01', health: 170, scale: 1.12, damageScale: 1.22,
    aggro: 5, leash: 10, speed: 0.86, profile: { blockChance: 0.48, pace: 1.12 }, role: 'elite'
  },
  boss: {
    name: 'Forge Lord', characterId: 'brute', weapon: 'dr-warhammer-large-04', health: 540, scale: 1.52,
    damageScale: 1.8, aggro: 11, leash: 18, speed: 1.02,
    profile: { blockChance: 0.12, pace: 0.84, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.8 },
    role: 'boss'
  }
}

const BY_STYLE: Partial<Record<StyleId, Roster>> = {
  castle: CASTLE,
  forge: FORGE
}

export function rosterFor(style: StyleId): Roster {
  return BY_STYLE[style] ?? FORTRESS
}

export function allRosterArchetypes(): Archetype[] {
  const seen = new Set<Archetype>()
  for (const roster of [FORTRESS, CASTLE, FORGE]) {
    seen.add(roster.striker)
    seen.add(roster.scout)
    seen.add(roster.guard)
    seen.add(roster.boss)
    if (roster.posted) seen.add(roster.posted)
  }
  return [...seen]
}
