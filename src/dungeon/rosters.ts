// Enemy rosters per dungeon style. Same combat kit everywhere; names, weapons,
// leash and the one extra behaviour (posted guards, later traps) live here so
// fortress levels stay as they were.
//
// Fortress enemies are Sidekick characters assembled from parts. Castle and forge
// enemies are one-piece bodies (src/enemyBodies.json, built by
// scripts/export-enemy-bodies.py): Knights-pack men-at-arms and Dungeon Realms
// dwarves with the blade baked into the hand, so `weapon` there only drives
// damage and drops, and `scale` is against ~1.9 m source meshes (the dwarves
// are authored human-height and shrunk here).

import { StyleId } from './config'
import { RivalProfile } from '../rivalBrain'
import { EquipmentLoadout } from '../equipmentCatalog'

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
  /** Armor to wear instead of the character's current default outfit (fortress looks are pinned to the Starter sets). */
  armor?: Omit<EquipmentLoadout, 'weapon'>
  /** Bogmaw's specialists (src/dungeonEnemies.ts, goblin section); melee when absent. */
  kind?: 'archer' | 'bomber' | 'shaman' | 'totem'
  /** A raid boss: never leaves his spot, slams as wide as his reach, and drops hellfire on anyone who stands off (src/dungeonEnemies.ts). */
  anchored?: boolean
}

// The Starter-pack outfits the fortress rosters were built with. Hero defaults
// have since moved to the class packs (Paladin, Northman, Warden, Sorcerer), so
// the enemies keep these explicitly rather than follow the player's wardrobe.
const STARTER_KNIGHT: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'knight-head', chest: 'knight-chest', shoulders: 'knight-shoulders', hands: 'knight-hands', legs: 'knight-legs', boots: 'knight-boots'
}
const STARTER_SCOUT: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'scout-head', chest: 'scout-chest', shoulders: 'scout-shoulders', hands: 'scout-hands', legs: 'scout-legs', boots: 'scout-boots'
}
const STARTER_STRIKER: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'striker-head', chest: 'striker-chest', shoulders: 'striker-shoulders', hands: 'striker-hands', legs: 'striker-legs', boots: 'striker-boots'
}
const PUMPKIN_BRUTE: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'brute-head', chest: 'none-chest', shoulders: 'none-shoulders', hands: 'none-hands', legs: 'none-legs', boots: 'none-boots'
}

export type Roster = {
  striker: Archetype
  scout: Archetype
  guard: Archetype
  boss: Archetype
  posted?: Archetype
  /** Bogmaw's specialists; a wave naming one falls back to the scout / striker where a roster has none. */
  archer?: Archetype
  bomber?: Archetype
  shaman?: Archetype
  totem?: Archetype
  /** A warden room's big body (the Crypt's Gargoyle); the grown guard stands in where a roster has none. */
  beast?: Archetype
}

const FORTRESS: Roster = {
  striker: {
    name: 'Striker', characterId: 'striker', weapon: 'fk-axe-06', health: 90, scale: 1, damageScale: 1,
    aggro: 6.5, leash: 11, speed: 1.15, profile: { blockChance: 0.15, pace: 0.8 }, role: 'grunt', armor: STARTER_STRIKER
  },
  scout: {
    name: 'Scout', characterId: 'scout', weapon: 'gb-sword-02', health: 75, scale: 0.95, damageScale: 0.85,
    aggro: 7.5, leash: 11, speed: 1.2, profile: { blockChance: 0.2, pace: 0.9 }, role: 'grunt', armor: STARTER_SCOUT
  },
  guard: {
    name: 'Vault Guard', characterId: 'vanguard', weapon: 'dr-warhammer-large-02', health: 150, scale: 1.08, damageScale: 1.15,
    aggro: 5, leash: 10, speed: 0.9, profile: { blockChance: 0.5, pace: 1.1 }, role: 'elite', armor: STARTER_KNIGHT
  },
  boss: {
    name: 'Warlord', characterId: 'brute', weapon: 'df-sword-02', health: 460, scale: 1.48,
    damageScale: 1.7, aggro: 11, leash: 18, speed: 1.08,
    profile: { blockChance: 0.08, pace: 0.82, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.6 },
    role: 'boss', armor: PUMPKIN_BRUTE
  }
}

const CASTLE: Roster = {
  striker: {
    name: 'Hall Knight', characterId: 'kn-knight', weapon: 'fk-axe-06', health: 95, scale: 1, damageScale: 1.05,
    aggro: 6.5, leash: 11, speed: 1.1, profile: { blockChance: 0.2, pace: 0.85 }, role: 'grunt'
  },
  scout: {
    name: 'Hall Scout', characterId: 'kn-soldier', weapon: 'fk-dagger-03', health: 78, scale: 0.95, damageScale: 0.88,
    aggro: 7.5, leash: 11, speed: 1.22, profile: { blockChance: 0.18, pace: 0.88 }, role: 'grunt'
  },
  guard: {
    name: 'Cage Brute', characterId: 'kn-soldier-b', weapon: 'fk-hammer-04', health: 160, scale: 1.1, damageScale: 1.2,
    aggro: 5, leash: 10, speed: 0.88, profile: { blockChance: 0.45, pace: 1.15 }, role: 'elite'
  },
  posted: {
    name: 'Posted Knight', characterId: 'kn-knight-b', weapon: 'fk-sword-08', health: 130, scale: 1.04, damageScale: 1.1,
    aggro: 4.5, leash: 4.2, speed: 0.7, profile: { blockChance: 0.58, pace: 1.05 }, role: 'elite', posted: true
  },
  boss: {
    name: 'Usurper', characterId: 'kn-knight-c', weapon: 'fk-sword-18', health: 500, scale: 1.4,
    damageScale: 1.75, aggro: 11, leash: 18, speed: 1.06,
    profile: { blockChance: 0.1, pace: 0.8, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.6 },
    role: 'boss'
  }
}

const FORGE: Roster = {
  striker: {
    name: 'Forge Hand', characterId: 'dr-dwarf-worker', weapon: 'dr-axe-small-01', health: 100, scale: 0.9, damageScale: 1.08,
    aggro: 6.2, leash: 11, speed: 1.05, profile: { blockChance: 0.18, pace: 0.85 }, role: 'grunt'
  },
  scout: {
    name: 'Lava Scout', characterId: 'dr-dwarf-miner', weapon: 'dr-sword-medium-01', health: 80, scale: 0.86, damageScale: 0.9,
    aggro: 7.6, leash: 11, speed: 1.24, profile: { blockChance: 0.16, pace: 0.86 }, role: 'grunt'
  },
  guard: {
    name: 'Cog Bruiser', characterId: 'dr-dwarf-soldier', weapon: 'dr-warhammer-large-01', health: 170, scale: 1.0, damageScale: 1.22,
    aggro: 5, leash: 10, speed: 0.86, profile: { blockChance: 0.48, pace: 1.12 }, role: 'elite'
  },
  boss: {
    name: 'Forge Lord', characterId: 'dr-dwarf-king', weapon: 'dr-warhammer-large-04', health: 540, scale: 1.3,
    damageScale: 1.8, aggro: 11, leash: 18, speed: 1.02,
    profile: { blockChance: 0.12, pace: 0.84, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.8 },
    role: 'boss'
  }
}

// The Frozen Pass's Vikings are Sidekick characters like the fortress's, in the
// Vikings-pack sets the wardrobe already carries (Raider, Karl, Huskarl, Jarl)
// with the pack's own axes and hammers in hand.
const RAIDER: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'raider-head', chest: 'raider-chest', shoulders: 'raider-shoulders', hands: 'raider-hands', legs: 'raider-legs', boots: 'raider-boots'
}
const KARL: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'karl-head', chest: 'karl-chest', shoulders: 'none-shoulders', hands: 'karl-hands', legs: 'karl-legs', boots: 'karl-boots'
}
const HUSKARL: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'huskarl-head', chest: 'huskarl-chest', shoulders: 'huskarl-shoulders', hands: 'huskarl-hands', legs: 'huskarl-legs', boots: 'huskarl-boots'
}
const JARL: Omit<EquipmentLoadout, 'weapon'> = {
  head: 'jarl-head', chest: 'jarl-chest', shoulders: 'jarl-shoulders', hands: 'jarl-hands', legs: 'jarl-legs', boots: 'jarl-boots'
}

const PASS: Roster = {
  striker: {
    name: 'Raider', characterId: 'striker', weapon: 'vk-axe-01', health: 105, scale: 1.02, damageScale: 1.1,
    aggro: 6.5, leash: 11, speed: 1.15, profile: { blockChance: 0.15, pace: 0.8 }, role: 'grunt', armor: RAIDER
  },
  scout: {
    name: 'Karl', characterId: 'scout', weapon: 'vk-sword-01', health: 85, scale: 0.97, damageScale: 0.9,
    aggro: 7.5, leash: 11, speed: 1.22, profile: { blockChance: 0.2, pace: 0.9 }, role: 'grunt', armor: KARL
  },
  guard: {
    name: 'Huskarl', characterId: 'vanguard', weapon: 'vk-hammer-02', health: 175, scale: 1.1, damageScale: 1.25,
    aggro: 5, leash: 10, speed: 0.9, profile: { blockChance: 0.5, pace: 1.1 }, role: 'elite', armor: HUSKARL
  },
  boss: {
    name: 'Jarl', characterId: 'brute', weapon: 'vk-largeaxe-01', health: 560, scale: 1.45,
    damageScale: 1.85, aggro: 11, leash: 18, speed: 1.06,
    profile: { blockChance: 0.12, pace: 0.82, pattern: ['attack_light', 'attack_heavy', 'attack_light2', 'slam'], slamRange: 3.8 },
    role: 'boss', armor: JARL
  }
}

// Bogmaw's goblins: the Goblin War Camp characters on the Polygon rig with their
// weapons baked in (scripts/enemy-bodies.json). Human-sized in the pack, so the
// scales make them goblins; the King alone stands tall. The specialists are read
// by src/dungeonEnemies.ts through `kind`: archers keep their distance and shoot,
// bombers run in and go off (goblins near them too), shamans mend their kin and
// spit venom, faster while a totem of theirs stands.
const BOG: Roster = {
  striker: {
    name: 'Goblin Cutter', characterId: 'gb-cutter', weapon: 'gb-cleaver-01', health: 110, scale: 0.88, damageScale: 1.15,
    aggro: 7, leash: 12, speed: 1.25, profile: { blockChance: 0.1, pace: 0.75 }, role: 'grunt'
  },
  scout: {
    name: 'Goblin Sneak', characterId: 'gb-sneak', weapon: 'gb-dagger-01', health: 85, scale: 0.8, damageScale: 0.95,
    aggro: 8, leash: 12, speed: 1.35, profile: { blockChance: 0.12, pace: 0.8 }, role: 'grunt'
  },
  guard: {
    name: 'Goblin Brute', characterId: 'gb-brute', weapon: 'gb-club-02', health: 190, scale: 1.08, damageScale: 1.3,
    aggro: 5.5, leash: 11, speed: 0.92, profile: { blockChance: 0.45, pace: 1.1 }, role: 'elite'
  },
  boss: {
    name: 'Goblin King', characterId: 'gb-king', weapon: 'gb-club-04', health: 640, scale: 1.32,
    damageScale: 1.9, aggro: 12, leash: 22, speed: 1.08,
    profile: { blockChance: 0.1, pace: 0.8, pattern: ['attack_light', 'attack_heavy', 'slam', 'attack_light2'], slamRange: 4 },
    role: 'boss'
  },
  archer: {
    name: 'Goblin Archer', characterId: 'gb-archer', weapon: 'gb-dagger-01', health: 70, scale: 0.84, damageScale: 1.0,
    aggro: 14, leash: 16, speed: 1.15, profile: { blockChance: 0, pace: 1 }, role: 'grunt', kind: 'archer'
  },
  bomber: {
    name: 'Goblin Bomber', characterId: 'gb-bomber', weapon: 'gb-club-01', health: 60, scale: 0.82, damageScale: 1.0,
    aggro: 11, leash: 16, speed: 1.6, profile: { blockChance: 0, pace: 1 }, role: 'grunt', kind: 'bomber'
  },
  shaman: {
    name: 'Goblin Shaman', characterId: 'gb-shaman', weapon: 'gb-club-01', health: 120, scale: 0.9, damageScale: 1.0,
    aggro: 13, leash: 16, speed: 1.05, profile: { blockChance: 0, pace: 1 }, role: 'elite', kind: 'shaman'
  },
  totem: {
    name: 'War Totem', characterId: 'bog-totem', weapon: 'gb-club-01', health: 160, scale: 1, damageScale: 0,
    aggro: 0, leash: 0, speed: 0, profile: { blockChance: 0, pace: 1 }, role: 'grunt', kind: 'totem'
  }
}

// The Crypt's dead: the Dark Fantasy characters on the Polygon rig with their
// weapons baked in (scripts/enemy-bodies.json, pack `dk`). Skeletons are the
// grunts, the ranger shoots (`archer`), the witch is the `shaman` (mends her
// dead, hexes the living, faster while a bone ward stands: the `totem`), the
// Gargoyle is the Chapel's `beast`, and the Lich raises his later waves himself.
const CRYPT: Roster = {
  striker: {
    name: 'Risen Ghoul', characterId: 'dk-skeleton-flesh', weapon: 'dk-sickle-01', health: 115, scale: 1.0, damageScale: 1.15,
    aggro: 7, leash: 12, speed: 1.2, profile: { blockChance: 0.08, pace: 0.75 }, role: 'grunt'
  },
  scout: {
    name: 'Skeleton', characterId: 'dk-skeleton', weapon: 'dk-sword-03', health: 90, scale: 0.98, damageScale: 0.95,
    aggro: 8, leash: 12, speed: 1.3, profile: { blockChance: 0.15, pace: 0.85 }, role: 'grunt'
  },
  guard: {
    name: 'Bone Knight', characterId: 'dk-skeleton-heavy', weapon: 'dk-mace-01', health: 200, scale: 1.08, damageScale: 1.3,
    aggro: 5.5, leash: 11, speed: 0.9, profile: { blockChance: 0.5, pace: 1.1 }, role: 'elite'
  },
  boss: {
    name: 'Morvane the Lich', characterId: 'dk-darklord', weapon: 'dk-scythe-01', health: 700, scale: 1.3,
    damageScale: 1.95, aggro: 12, leash: 22, speed: 1.04,
    profile: { blockChance: 0.1, pace: 0.8, pattern: ['attack_light', 'attack_heavy', 'slam', 'attack_light2'], slamRange: 4 },
    role: 'boss'
  },
  archer: {
    name: 'Skeleton Ranger', characterId: 'dk-skeleton-ranger', weapon: 'dk-sword-01', health: 75, scale: 0.98, damageScale: 1.05,
    aggro: 14, leash: 16, speed: 1.15, profile: { blockChance: 0, pace: 1 }, role: 'grunt', kind: 'archer'
  },
  shaman: {
    name: 'Grave Witch', characterId: 'dk-witch', weapon: 'dk-staff-01', health: 130, scale: 0.98, damageScale: 1.05,
    aggro: 13, leash: 16, speed: 1.05, profile: { blockChance: 0, pace: 1 }, role: 'elite', kind: 'shaman'
  },
  totem: {
    name: 'Bone Ward', characterId: 'crypt-totem', weapon: 'dk-sword-03', health: 170, scale: 1, damageScale: 0,
    aggro: 0, leash: 0, speed: 0, profile: { blockChance: 0, pace: 1 }, role: 'grunt', kind: 'totem'
  },
  beast: {
    name: 'Chapel Gargoyle', characterId: 'dk-gargoyle', weapon: 'dk-hammer-01', health: 900, scale: 1.55, damageScale: 1.7,
    aggro: 9, leash: 14, speed: 0.98, profile: { blockChance: 0.3, pace: 1.0, pattern: ['attack_light', 'attack_heavy', 'slam', 'attack_light2'], slamRange: 3.8 }, role: 'elite'
  }
}

// The Barrow Yard (Gravewatch's Rounds, src/dungeon/barrowYard.ts): the Crypt's
// dead, with the Barrow Warden, a bone knight grown, holding the barrow as the
// run's "boss" so a four-minute run has an end.
const YARD: Roster = {
  ...CRYPT,
  boss: {
    name: 'Barrow Warden', characterId: 'dk-skeleton-heavy', weapon: 'dk-mace-01', health: 560, scale: 1.3, damageScale: 1.6,
    aggro: 10, leash: 20, speed: 0.98,
    profile: { blockChance: 0.25, pace: 0.9, pattern: ['attack_light', 'attack_heavy', 'slam', 'attack_light2'], slamRange: 3.6 },
    role: 'boss'
  }
}

/**
 * The Rising (src/raid/risingServer.ts): the Dark Fantasy Demon from
 * BigCharacters.fbx at giant scale on the boss brain, with the Crypt's dead as
 * the waves he raises. His health and damage are retuned to the crowd when the
 * fight is made (src/shared/gravewatch.ts risingBossHp); these are the floor.
 */
export const RISING_DEMON: Archetype = {
  name: 'The Demon', characterId: 'dk-demon', weapon: 'dk-halberd-01', health: 4200, scale: 3.0, damageScale: 2.4,
  aggro: 20, leash: 45, speed: 0,
  profile: { blockChance: 0.05, pace: 0.75, pattern: ['slam', 'attack_heavy', 'slam', 'attack_light', 'slam'], slamRange: 6 },
  role: 'boss', anchored: true
}
const RISING: Roster = { ...CRYPT, boss: RISING_DEMON }

const BY_STYLE: Partial<Record<StyleId, Roster>> = {
  castle: CASTLE,
  forge: FORGE,
  pass: PASS,
  bog: BOG,
  crypt: CRYPT,
  yard: YARD
}

export function rosterFor(style: StyleId): Roster {
  return BY_STYLE[style] ?? FORTRESS
}

/** The Rising's cast: the yard's dead under the Demon. */
export function risingRoster(): Roster {
  return RISING
}

export function allRosterArchetypes(): Archetype[] {
  const seen = new Set<Archetype>()
  for (const roster of [FORTRESS, CASTLE, FORGE, PASS, BOG, CRYPT, YARD, RISING]) {
    seen.add(roster.striker)
    seen.add(roster.scout)
    seen.add(roster.guard)
    seen.add(roster.boss)
    if (roster.posted) seen.add(roster.posted)
    if (roster.archer) seen.add(roster.archer)
    if (roster.bomber) seen.add(roster.bomber)
    if (roster.shaman) seen.add(roster.shaman)
    if (roster.totem) seen.add(roster.totem)
    if (roster.beast) seen.add(roster.beast)
  }
  return [...seen]
}
