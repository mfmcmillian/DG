// Bogmaw: a goblin war camp in the swamp, drawn by hand in the gauntlet's
// terms (rooms sealed until cleared, enemies in waves, two wardens, the Goblin
// King on his headquarters at the top). Open air: 6.6 m palisade modules for
// walls, the camp gate for doorways, mud underfoot, marsh and mud cliffs all
// round (src/backdrop.ts). The same every run, so it can be learned.
//
// Plan (16 x 16 cells of 10 m on the 160 m plot, cells 2..14 in use so every
// piece stays inside the parcels; north is -Z, the crawler camera looks north;
// the party spawns at the bottom right and climbs west, then north, then east):
//
//        x  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   y  1    .  .  .  .  .  .  K  K  K  K  K  K  .  .  .  .     K the King's Camp, 60 x 50 m
//      2    .  .  .  .  .  .  K  K  K  K  K  K  .  .  .  .
//      3    .  .  .  .  .  .  K  K  K  K  K  K  .  .  .  .
//      4    .  .  .  .  .  .  K  K  K  K  K  K  .  .  .  .
//      5    .  .  .  .  .  .  K  K  K  K  K  K  .  .  .  .
//      6    .  .  .  .  .  .  .  .  .  .  .  c  .  .  .  .
//      7    .  .  .  .  .  .  .  .  .  .  S  S  S  S  .  .     S the Shaman's Rise (warden), 40 x 30 m
//      8    .  .  .  .  .  .  .  .  .  .  S  S  S  S  .  .
//      9    .  .  .  B  B  B  B  B  c  c  S  S  S  S  .  .     B the Bone Yard, 50 x 20 m
//     10    .  .  .  B  B  B  B  B  .  .  .  .  .  .  .  .
//     11    .  .  .  .  c  .  .  .  .  .  .  .  .  .  .  .
//     12    .  .  P  P  P  P  c  c  M  M  M  M  M  .  .  .     P the Palisade (warden), 40 x 30 m
//     13    .  .  P  P  P  P  .  .  M  M  M  M  M  E  E  .     M the Marsh Road, 50 x 30 m
//     14    .  .  P  P  P  P  .  .  M  M  M  M  M  E  E  .     E the entrance: the spawn
//
// The grid starts at (0, 0): cell (x, y) covers metres x*10..x*10+10.

import { authoredDungeon, Rect } from './authored'
import { KitId } from './kit'
import { Dungeon, Furniture, Room } from './generator'
import { propsFor, Stage } from './stages'

const SIZE = 16
const TILE = 10

const E: Rect = { x: 13, y: 13, w: 2, h: 2 }
const K: Rect = { x: 6, y: 1, w: 6, h: 5 }
const M: Rect = { x: 8, y: 12, w: 5, h: 3 }
const C1: Rect = { x: 6, y: 12, w: 2, h: 1 }
const P: Rect = { x: 2, y: 12, w: 4, h: 3 }
const C2: Rect = { x: 4, y: 11, w: 1, h: 1 }
const B: Rect = { x: 3, y: 9, w: 5, h: 2 }
const C3: Rect = { x: 8, y: 9, w: 2, h: 1 }
const S: Rect = { x: 10, y: 7, w: 4, h: 3 }
const C4: Rect = { x: 11, y: 6, w: 1, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...K, kind: 'boss' },
  { ...M, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...P, kind: 'treasure' }, { ...C2, kind: 'quiet' },
  { ...B, kind: 'combat' }, { ...C3, kind: 'quiet' },
  { ...S, kind: 'treasure' }, { ...C4, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[13, 13], [12, 13]],                         // entrance -> the Marsh Road
  [[8, 12], [7, 12]], [[6, 12], [5, 12]],       // Marsh Road -> track -> the Palisade
  [[4, 12], [4, 11]], [[4, 11], [4, 10]],       // Palisade -> track -> the Bone Yard
  [[7, 9], [8, 9]], [[9, 9], [10, 9]],          // Bone Yard -> track -> the Shaman's Rise
  [[11, 7], [11, 6]], [[11, 6], [11, 5]]        // Rise -> track -> the King's Camp
]

const LINKS: Array<[number, number]> = [
  [0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 1]
]

/**
 * The fights, in order. Room indices are into ROOMS above. Archers appear on
 * the road, bombers in the bone yard, the shaman and its totems on the rise.
 * The King's later waves are not on the wave clock: he calls them by the gong
 * as his health falls past each wave's share (src/dungeonEnemies.ts tickGong).
 */
export const BOG_STAGES: Stage[] = [
  { room: 2, rect: M, kind: 'combat', name: 'The Marsh Road', entry: 'e', gate: [[8, 12], [7, 12]],
    waves: [['scout', 'scout', 'archer'], ['striker', 'archer', 'archer', 'scout']] },
  { room: 4, rect: P, kind: 'warden', name: 'The Palisade', entry: 'e', gate: [[4, 12], [4, 11]],
    waves: [['guard', 'archer', 'archer'], ['warden', 'archer']] },
  { room: 6, rect: B, kind: 'combat', name: 'The Bone Yard', entry: 's', gate: [[7, 9], [8, 9]],
    waves: [['bomber', 'scout', 'scout'], ['striker', 'bomber', 'bomber', 'archer'], ['guard', 'striker', 'bomber']] },
  { room: 8, rect: S, kind: 'warden', name: 'The Shaman\'s Rise', entry: 'w', gate: [[11, 7], [11, 6]],
    waves: [['totem', 'totem', 'shaman', 'scout', 'scout'], ['warden', 'shaman', 'totem']] },
  { room: 1, rect: K, kind: 'boss', name: 'The Goblin King', entry: 's',
    waves: [['boss', 'guard', 'archer'], ['striker', 'striker', 'archer', 'bomber'], ['guard', 'shaman', 'bomber', 'bomber']] }
]

/** The King's gong and the war balloon's anchor, in world metres (the furniture below puts the models there). */
export const BOG_GONG = { x: 90, z: 33 }
export const BOG_ANCHOR = { x: 100, z: 54 }

/**
 * The camp's traps, in world metres; src/bogTraps.ts runs them (the host
 * decides the blows, every client shows them). Pits and mud on the Marsh
 * Road, the ballistas on the Palisade's towers, the logs over the Bone Yard,
 * the war balloon over the King's Camp.
 */
export const BOG_TRAPS = {
  /** Spike pits along the road's line, between the planks. */
  pits: [{ x: 118, z: 131 }, { x: 108, z: 128.5 }, { x: 97, z: 130 }, { x: 88, z: 136 }],
  /** Deep mud under the algae (the bog_algae furniture above). */
  mud: [{ x: 112, z: 142 }, { x: 96, z: 140 }, { x: 118, z: 124 }, { x: 90, z: 134 }],
  mudRadius: 2.6,
  /** Ballistas on the watchtowers' decks (the flat boards at 4.65 m, under the hide roof), covering the yard. */
  ballistas: [{ x: 57, z: 123, y: 4.65 }, { x: 57, z: 147, y: 4.65 }],
  yard: { x0: 20, x1: 60, z0: 118, z1: 152 },
  /** Logs hung from crossbeams, swinging north-south across the yard's width. */
  logs: [{ x: 48, z: 100 }, { x: 66, z: 100 }],
  logPivotY: 7.5,
  logRope: 5.8,
  /** The balloon's slow circle over the camp, and the room it bombs. */
  balloon: { x: 90, z: 35, y: 16, ring: 9 },
  camp: { x0: 60, x1: 120, z0: 8, z1: 62 }
}

/** Grid cell (fractional) under a point in metres. */
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: wx / TILE - 0.5, y: wz / TILE - 0.5 }
}

const FURNITURE: Furniture[] = [
  // --- the entrance: the swamp's edge, the party's fire, old stones ---------------
  { id: 'bog_campfire', ...m(141, 144) },
  { id: 'bog_bedroll', ...m(138.5, 146.5), yaw: 40, collide: false },
  { id: 'bog_bedroll', ...m(144, 147), yaw: -60, collide: false },
  { id: 'bog_sacks', ...m(146, 143), yaw: 15, collide: false },
  { id: 'bog_ruins_pillar', ...m(133, 133), yaw: 10 },
  { id: 'bog_ruins_pillar', ...m(147, 133), yaw: -25 },
  { id: 'bog_planks', ...m(134, 135), yaw: 90, collide: false },
  { id: 'bog_reeds', ...m(132, 147), collide: false },
  { id: 'bog_reeds', ...m(148, 138), collide: false },
  { id: 'bog_mushrooms', ...m(136, 132), collide: false },

  // --- the Marsh Road: planks over the mud, algae over the deep patches -------------
  { id: 'bog_planks', ...m(125, 135), yaw: 90, collide: false },
  { id: 'bog_planks', ...m(120, 135), yaw: 90, collide: false },
  { id: 'bog_planks', ...m(115, 134), yaw: 80, collide: false },
  { id: 'bog_planks', ...m(110, 132), yaw: 70, collide: false },
  { id: 'bog_planks', ...m(105, 130), yaw: 70, collide: false },
  { id: 'bog_planks', ...m(100, 128), yaw: 75, collide: false },
  { id: 'bog_planks', ...m(95, 126), yaw: 85, collide: false },
  { id: 'bog_planks', ...m(90, 125), yaw: 90, collide: false },
  { id: 'bog_planks', ...m(85, 125), yaw: 90, collide: false },
  { id: 'bog_algae', ...m(112, 142), yaw: 20, collide: false },
  { id: 'bog_algae', ...m(96, 140), yaw: -50, collide: false },
  { id: 'bog_algae', ...m(118, 124), yaw: 70, collide: false },
  { id: 'bog_algae', ...m(90, 134), yaw: 110, collide: false },
  { id: 'bog_tree_b', ...m(100, 147), yaw: 30 },
  { id: 'bog_tree', ...m(86, 146), yaw: 200 },
  { id: 'bog_tree_c', ...m(122, 146), yaw: 80 },
  { id: 'bog_platform', ...m(84, 138), yaw: 90 },
  { id: 'bog_tent_c', ...m(125, 147), yaw: 150 },
  { id: 'bog_stump', ...m(128, 124), yaw: 0 },
  { id: 'bog_mushroom_big', ...m(86, 131), yaw: 0 },
  { id: 'bog_mushroom_big', ...m(104, 143), yaw: 120 },
  { id: 'bog_mound', ...m(110, 140), collide: false },
  { id: 'bog_mound', ...m(92, 128), collide: false },
  { id: 'bog_bones_b', ...m(117, 146), yaw: 40, collide: false },
  { id: 'bog_ruins_wall', ...m(88, 140), yaw: 20 },
  { id: 'bog_ruins_pillar', ...m(92, 146), yaw: 0 },
  { id: 'bog_reeds', ...m(83, 143), collide: false },
  { id: 'bog_reeds', ...m(128, 142), collide: false },
  { id: 'bog_grass', ...m(101, 122), collide: false },
  { id: 'bog_grass', ...m(113, 128), collide: false },
  { id: 'bog_grass', ...m(122, 138), collide: false },

  // --- the track to the Palisade: heads on stakes, the goblins' welcome -------------
  { id: 'bog_head_spike', ...m(70, 122), yaw: 10 },
  { id: 'bog_head_spike', ...m(70, 128), yaw: -20 },
  { id: 'bog_skull_pile', ...m(65, 127.5), yaw: 40, collide: false },

  // --- the Palisade: watchtowers by the gate, cover in the yard, the warden's fire ---
  { id: 'bog_tower', ...m(57, 123), yaw: 180 },
  { id: 'bog_tower', ...m(57, 147), yaw: 0 },
  { id: 'bog_barrier', ...m(40, 128), yaw: 10 },
  { id: 'bog_barrier', ...m(34, 140), yaw: -30 },
  { id: 'bog_barrier', ...m(46, 144), yaw: 60 },
  { id: 'bog_barrier', ...m(28, 132), yaw: 100 },
  { id: 'bog_spikes', ...m(24, 124), yaw: 40 },
  { id: 'bog_spikes', ...m(24, 146), yaw: -40 },
  { id: 'bog_firepit', ...m(40, 135) },
  { id: 'bog_tent_b', ...m(26, 136), yaw: 90 },
  { id: 'bog_weapon_rack', ...m(50, 148), yaw: 180 },
  { id: 'bog_target', ...m(30, 147.5), yaw: 180 },
  { id: 'bog_target', ...m(33, 147.5), yaw: 170 },
  { id: 'bog_flag', ...m(22.5, 135), yaw: 90 },
  { id: 'bog_flag', ...m(52, 122.5), yaw: 0 },
  { id: 'bog_barrel', ...m(51, 146), yaw: 0 },
  { id: 'bog_crate', ...m(52.5, 147.5), yaw: 25 },

  // --- the track to the Bone Yard -------------------------------------------------------
  { id: 'bog_head_spike', ...m(42, 118), yaw: 0 },
  { id: 'bog_head_spike', ...m(48, 118), yaw: 0 },

  // --- the Bone Yard: what the camp ate, the great skull, the hanging cages -------------
  { id: 'bog_bones', ...m(35, 93), yaw: 30, collide: false },
  { id: 'bog_bones', ...m(52, 107), yaw: -80, collide: false },
  { id: 'bog_bones', ...m(70, 93), yaw: 160, collide: false },
  { id: 'bog_bones_b', ...m(44, 96), yaw: 20, collide: false },
  { id: 'bog_bones_b', ...m(63, 106), yaw: -110, collide: false },
  { id: 'bog_bone_skull', ...m(75, 106), yaw: -60 },
  { id: 'bog_bone_rib', ...m(58, 92), yaw: 15, collide: false },
  { id: 'bog_skull_pile', ...m(38, 105), yaw: 0, collide: false },
  { id: 'bog_skull_pile_b', ...m(66, 95), yaw: 70, collide: false },
  { id: 'bog_skull_pile', ...m(56, 108), yaw: 120, collide: false },
  { id: 'bog_skeleton_cage', ...m(33, 107), yaw: 20 },
  { id: 'bog_skeleton_cage', ...m(77, 92), yaw: -30 },
  { id: 'bog_gibbet', ...m(36, 100), yaw: 90 },
  { id: 'bog_cage', ...m(41, 92), yaw: 10 },
  { id: 'bog_effigy_big', ...m(55, 91.6), yaw: 0 },
  { id: 'bog_tree_d', ...m(32, 92.5), yaw: 40 },
  { id: 'bog_meat_rack', ...m(72, 108), yaw: 180 },
  { id: 'bog_mushrooms', ...m(60, 103), collide: false },
  { id: 'bog_reeds', ...m(78.5, 108.5), collide: false },
  { id: 'bog_grass', ...m(47, 108), collide: false },

  // --- the track to the Rise: planks again -------------------------------------------------
  { id: 'bog_planks', ...m(85, 95), yaw: 90, collide: false },
  { id: 'bog_planks', ...m(90, 95), yaw: 90, collide: false },
  { id: 'bog_planks', ...m(95, 95), yaw: 90, collide: false },

  // --- the Shaman's Rise: the hut, the shrine, braziers, effigies -----------------------
  { id: 'bog_shaman_hut', ...m(128, 78), yaw: 180 },
  { id: 'bog_shrine', ...m(120, 92), yaw: 0 },
  { id: 'bog_effigy', ...m(104, 73), yaw: 150 },
  { id: 'bog_effigy_b', ...m(136, 97), yaw: -120 },
  { id: 'bog_brazier', ...m(106, 76) },
  { id: 'bog_brazier', ...m(106, 96) },
  { id: 'bog_brazier', ...m(134, 96) },
  { id: 'bog_brazier', ...m(116, 88) },
  { id: 'bog_drum', ...m(120, 76), yaw: 20 },
  { id: 'bog_drum', ...m(123, 77), yaw: -40 },
  { id: 'bog_hide_rack', ...m(110, 73), yaw: 0 },
  { id: 'bog_mushroom_big', ...m(103, 88), yaw: 60 },
  { id: 'bog_mushrooms', ...m(133, 90), collide: false },
  { id: 'bog_tree_c', ...m(137.5, 88), yaw: 200 },
  { id: 'bog_skull_pile', ...m(118, 95), yaw: 90, collide: false },
  { id: 'bog_reeds', ...m(102, 98), collide: false },

  // --- the track to the King's Camp ----------------------------------------------------------
  { id: 'bog_head_spike', ...m(112, 62), yaw: 0 },
  { id: 'bog_head_spike', ...m(118, 62), yaw: 0 },
  { id: 'bog_flag', ...m(111, 68), yaw: 90 },
  { id: 'bog_flag', ...m(119, 68), yaw: -90 },

  // --- the King's Camp: the headquarters, the gong, the war machines, the tents -----------
  { id: 'bog_hq', ...m(90, 22), yaw: 180 },
  { id: 'bog_gong', ...m(90, 33), yaw: 180, tag: 'gong' },
  { id: 'bog_drum', ...m(84, 34), yaw: 30 },
  { id: 'bog_drum', ...m(96, 34), yaw: -30 },
  { id: 'bog_drum', ...m(86, 36.5), yaw: 80 },
  { id: 'bog_firepit', ...m(90, 44) },
  { id: 'bog_tent_leader', ...m(66, 18), yaw: 120 },
  { id: 'bog_tent_leader', ...m(114, 18), yaw: -120 },
  { id: 'bog_tent_a', ...m(66, 50), yaw: 60 },
  { id: 'bog_tent_b', ...m(114, 50), yaw: -60 },
  { id: 'bog_warhorn', ...m(72, 30), yaw: 90 },
  { id: 'bog_warhorn', ...m(108, 30), yaw: -90 },
  { id: 'bog_tower_b', ...m(63, 57), yaw: 0 },
  { id: 'bog_tower_b', ...m(105, 57), yaw: 0 },
  { id: 'bog_cage_wagon', ...m(70, 40), yaw: 30 },
  { id: 'bog_trebuchet', ...m(108, 42), yaw: -150 },
  { id: 'bog_spit', ...m(98, 46), yaw: 90 },
  { id: 'bog_meat_rack', ...m(78, 52), yaw: 0 },
  { id: 'bog_weapon_rack', ...m(104, 26), yaw: -90 },
  { id: 'bog_effigy_big', ...m(74, 20), yaw: 90 },
  { id: 'bog_effigy_big', ...m(106, 20), yaw: -90 },
  { id: 'bog_flag', ...m(80, 32), yaw: 180 },
  { id: 'bog_flag', ...m(100, 32), yaw: 180 },
  { id: 'bog_flag', ...m(62, 12), yaw: 0 },
  { id: 'bog_flag', ...m(118, 12), yaw: 0 },
  { id: 'bog_barrel', ...m(72, 46), yaw: 0 },
  { id: 'bog_barrel', ...m(73.5, 47.2), yaw: 40 },
  { id: 'bog_crate', ...m(71, 48), yaw: 15 },
  { id: 'bog_anchor', ...m(100, 54), yaw: 0, tag: 'anchor' },
  { id: 'bog_brazier', ...m(82, 30) },
  { id: 'bog_brazier', ...m(98, 30) },
  { id: 'bog_brazier', ...m(84, 50) },
  { id: 'bog_brazier', ...m(96, 50) },
  { id: 'bog_skull_pile', ...m(88, 38), yaw: 0, collide: false },
  { id: 'bog_skull_pile_b', ...m(93, 37), yaw: 50, collide: false },
  { id: 'bog_reeds', ...m(62, 30), collide: false },
  { id: 'bog_reeds', ...m(118, 36), collide: false },
  { id: 'bog_mushrooms', ...m(64, 44), collide: false }
]

export function bogDungeon(torchEvery = 1): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 4041, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE, links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 8 : 5, DOORWAYS)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by BOG_STAGES.
    const stage = BOG_STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}

/** Where the camp's fires burn (src/bogFx.ts puts flames there): the braziers, the fire pits, the party's campfire. */
export function bogFires(): Array<{ x: number; z: number; y: number; size: number; light: boolean }> {
  return FURNITURE.flatMap((f) => {
    const fire = f.id === 'bog_brazier' ? { y: 0.85, size: 0.55 } : f.id === 'bog_firepit' ? { y: 0.7, size: 1.4 } : f.id === 'bog_campfire' ? { y: 0.45, size: 0.8 } : undefined
    if (!fire) return []
    const x = f.x * TILE + TILE / 2
    const z = f.y * TILE + TILE / 2
    // Lights on the big fires and on the King's braziers; the rest glow by their flames alone.
    return [{ x, z, ...fire, light: f.id !== 'bog_brazier' || z < 60 }]
  })
}

/** The shaman's shrine on the Rise: the ritual burns there whatever the fight. */
export const BOG_SHRINE = { x: 120, z: 92 }

/** The rooms as metre boxes, for the fog and the fireflies (the entrance first, then the road to the King). */
export const BOG_ROOM_BOXES = [E, M, P, B, S, K].map((r) => ({ x: r.x * TILE, z: r.y * TILE, w: r.w * TILE, d: r.h * TILE }))

/** Every kit piece Bogmaw's furniture and traps place (for the preload plan). */
export function bogFurnitureIds(): KitId[] {
  const traps: KitId[] = ['bog_spikes', 'bog_ballista', 'bog_log', 'bog_balloon', 'bog_bomb']
  return [...new Set([...FURNITURE.map((f) => f.id), ...traps])]
}
