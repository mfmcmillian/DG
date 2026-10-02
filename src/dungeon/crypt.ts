// The Crypt: barrows under the hill, drawn by hand in the gauntlet's terms
// (rooms sealed until cleared, enemies in waves, two wardens, the Lich in his
// vault at the top). Synty's Dark Fantasy pack (scripts/realms/crypt.json):
// 10 m stone-block walls welded from 2.5 m pieces, 6 m tall under a roof the
// third-person camera sees; a gothic archway between pillars for doorways; a
// half wall for the camera's cutaway; candle sconces on the walls. The same
// every run, so it can be learned.
//
// Plan (16 x 16 cells of 10 m on the 160 m plot, cells 2..14 in use so every
// piece stays inside the parcels; north is -Z, the crawler camera looks north;
// the party spawns at the bottom right in the graveyard and goes west through
// the Lychgate, down into the Ossuary, north along the Catacombs, east into
// the Chapel, and north to the Vault):
//
//        x  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   y  1    .  .  .  .  .  V  V  V  V  V  V  .  .  .  .  .     V the Lich's Vault, 60 x 40 m
//      2    .  .  .  .  .  V  V  V  V  V  V  .  .  .  .  .
//      3    .  .  .  .  .  V  V  V  V  V  V  .  .  .  .  .
//      4    .  .  .  .  .  V  V  V  V  V  V  .  .  .  .  .
//      5    .  .  .  .  .  .  .  .  .  .  c  c  .  .  .  .
//      6    .  .  .  .  .  .  .  .  .  .  H  H  H  H  .  .     H the Chapel (warden: the Gargoyle), 40 x 40 m
//      7    .  .  C  C  C  C  C  C  c  c  H  H  H  H  .  .     C the Catacombs, 60 x 20 m
//      8    .  .  C  C  C  C  C  C  .  .  H  H  H  H  .  .
//      9    .  .  .  c  .  .  .  .  .  .  H  H  H  H  .  .
//     10    .  .  .  c  .  .  .  .  .  .  .  .  .  .  .  .
//     11    .  .  O  O  O  O  .  .  .  .  .  .  .  .  .  .     O the Ossuary (warden: the Bone Warden), 40 x 30 m
//     12    .  .  O  O  O  O  c  L  L  L  L  .  .  .  .  .     L the Lychgate (the graveyard), 40 x 30 m
//     13    .  .  O  O  O  O  .  L  L  L  L  c  E  E  .  .     E the entrance: the spawn, outside the gate
//     14    .  .  .  .  .  .  .  L  L  L  L  .  E  E  .  .
//
// The grid starts at (0, 0): cell (x, y) covers metres x*10..x*10+10.

import { authoredDungeon, Rect } from './authored'
import { KitId } from './kit'
import { Dungeon, Furniture, Room } from './generator'
import { propsFor, Stage } from './stages'

const SIZE = 16
const TILE = 10

const E: Rect = { x: 12, y: 13, w: 2, h: 2 }
const V: Rect = { x: 5, y: 1, w: 6, h: 4 }
const L: Rect = { x: 7, y: 12, w: 4, h: 3 }
const C1: Rect = { x: 11, y: 13, w: 1, h: 1 }
const O: Rect = { x: 2, y: 11, w: 4, h: 3 }
const C2: Rect = { x: 6, y: 12, w: 1, h: 1 }
const C: Rect = { x: 2, y: 7, w: 6, h: 2 }
const C3: Rect = { x: 3, y: 9, w: 1, h: 2 }
const H: Rect = { x: 10, y: 6, w: 4, h: 4 }
const C4: Rect = { x: 8, y: 7, w: 2, h: 1 }
const C5: Rect = { x: 10, y: 5, w: 2, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...V, kind: 'boss' },
  { ...L, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...O, kind: 'treasure' }, { ...C2, kind: 'quiet' },
  { ...C, kind: 'combat' }, { ...C3, kind: 'quiet' },
  { ...H, kind: 'treasure' }, { ...C4, kind: 'quiet' },
  { ...C5, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[12, 13], [11, 13]], [[11, 13], [10, 13]],   // entrance -> the gate path -> the Lychgate
  [[7, 12], [6, 12]], [[6, 12], [5, 12]],       // Lychgate -> the stair -> the Ossuary
  [[3, 11], [3, 10]], [[3, 9], [3, 8]],         // Ossuary -> the passage -> the Catacombs
  [[7, 7], [8, 7]], [[9, 7], [10, 7]],          // Catacombs -> the passage -> the Chapel
  [[11, 6], [11, 5]], [[10, 5], [10, 4]]        // Chapel -> the stair -> the Vault
]

const LINKS: Array<[number, number]> = [
  [0, 3], [3, 2], [2, 5], [5, 4], [4, 7], [7, 6], [6, 9], [9, 8], [8, 10], [10, 1]
]

/** The Lich, by name: the HUD's notices and the lobby call him this. */
export const LICH_NAME = 'Morvane the Lich'

/**
 * The fights, in order. Room indices are into ROOMS above. Skeleton rangers
 * shoot from the back, witches mend their dead and hex the living, faster
 * while a bone ward of theirs stands; the Ossuary's warden is the heavy
 * skeleton grown, the Chapel's is the Gargoyle. The Lich's later waves are
 * not on the wave clock: he raises them as his health falls past each wave's
 * share (src/dungeonEnemies.ts tickSummons).
 */
export const CRYPT_STAGES: Stage[] = [
  { room: 2, rect: L, kind: 'combat', name: 'The Lychgate', entry: 'e', gate: [[7, 12], [6, 12]],
    waves: [['scout', 'scout', 'scout'], ['striker', 'scout', 'archer', 'scout'], ['guard', 'archer', 'striker']] },
  { room: 4, rect: O, kind: 'warden', name: 'The Ossuary', entry: 'e', gate: [[3, 11], [3, 10]],
    waves: [['guard', 'scout', 'archer'], ['warden', 'scout', 'scout']] },
  { room: 6, rect: C, kind: 'combat', name: 'The Catacombs', entry: 's', gate: [[7, 7], [8, 7]],
    waves: [['totem', 'shaman', 'scout', 'scout', 'archer'], ['striker', 'striker', 'shaman', 'totem', 'archer'], ['guard', 'shaman', 'striker', 'scout']] },
  { room: 8, rect: H, kind: 'warden', name: 'The Chapel', entry: 'w', gate: [[11, 6], [11, 5]],
    waves: [['archer', 'archer', 'scout', 'striker'], ['beast', 'shaman', 'guard']] },
  { room: 1, rect: V, kind: 'boss', name: 'The Lich\'s Vault', entry: 's',
    waves: [['boss', 'guard', 'archer'], ['scout', 'scout', 'scout', 'striker', 'archer'], ['guard', 'shaman', 'striker', 'scout', 'scout']] }
]

/** The Lich's ritual circle, in world metres: where he stands and where the dead rise from. */
export const CRYPT_CIRCLE = { x: 80, z: 30 }

/** Grid cell (fractional) under a point in metres. */
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: wx / TILE - 0.5, y: wz / TILE - 0.5 }
}

const FURNITURE: Furniture[] = [
  // --- the entrance: the graveyard's edge, a dead tree, the sexton's cart ---------------
  { id: 'crypt_tree_b', ...m(124, 146), yaw: 30 },
  { id: 'crypt_wagon', ...m(135, 146), yaw: 25 },
  { id: 'crypt_well', ...m(126, 135), yaw: 0 },
  { id: 'crypt_notice', ...m(133, 132), yaw: 180 },
  { id: 'crypt_stone_a', ...m(131, 141), yaw: 10 },
  { id: 'crypt_stone_d', ...m(133.5, 141.5), yaw: -15 },
  { id: 'crypt_stone_b', ...m(136, 140), yaw: 20 },
  { id: 'crypt_stone_c', ...m(128, 141), yaw: 5, collide: false },
  { id: 'crypt_lantern', ...m(128.6, 141), yaw: 0, lift: 0.3, collide: false },
  { id: 'crypt_barrel', ...m(137.5, 133), yaw: 0 },
  { id: 'crypt_crate', ...m(136, 132.5), yaw: 30 },
  { id: 'crypt_grass', ...m(123, 139), collide: false },
  { id: 'crypt_grass', ...m(138, 147), collide: false },
  { id: 'crypt_fern', ...m(122.5, 148), collide: false },
  { id: 'crypt_rocks', ...m(131, 148.5), collide: false },

  // --- the gate path: the lychgate's posts --------------------------------------------------
  { id: 'crypt_fence_post', ...m(112, 131.5), yaw: 0 },
  { id: 'crypt_fence_post', ...m(112, 138.5), yaw: 0 },
  { id: 'crypt_stone_d', ...m(118, 138.5), yaw: 80 },

  // --- the Lychgate: the graveyard proper, rows of stones, two mausoleums, the gallows ----
  { id: 'crypt_mausoleum_a', ...m(78, 145), yaw: 180 },
  { id: 'crypt_mausoleum_b', ...m(104, 124), yaw: 0 },
  { id: 'crypt_gallows', ...m(95, 146), yaw: 0 },
  { id: 'crypt_gibbet', ...m(106, 146), yaw: 150 },
  { id: 'crypt_tree_c', ...m(84, 128), yaw: 70 },
  { id: 'crypt_tree_a', ...m(74, 124), yaw: 200 },
  { id: 'crypt_tomb_b', ...m(97, 137), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(88, 141), yaw: 100 },
  { id: 'crypt_tomb_a', ...m(90, 125), yaw: 90 },
  { id: 'crypt_stone_a', ...m(76, 134), yaw: 5 }, { id: 'crypt_stone_b', ...m(79, 134), yaw: -8 }, { id: 'crypt_stone_d', ...m(82, 134.5), yaw: 12 },
  { id: 'crypt_stone_b', ...m(76, 138), yaw: -5 }, { id: 'crypt_stone_a', ...m(79, 138.5), yaw: 15 }, { id: 'crypt_stone_d', ...m(82, 138), yaw: -10 },
  { id: 'crypt_stone_a', ...m(100, 131), yaw: 0 }, { id: 'crypt_stone_d', ...m(103, 131.5), yaw: 10 }, { id: 'crypt_stone_b', ...m(106, 131), yaw: -12 },
  { id: 'crypt_stone_c', ...m(93, 133), yaw: 90, collide: false },
  { id: 'crypt_stone_c', ...m(101, 141), yaw: 80, collide: false },
  { id: 'crypt_fence_short', ...m(85, 143.5), yaw: 0 },
  { id: 'crypt_fence_short', ...m(85, 148.5), yaw: 0 },
  { id: 'crypt_fence_post', ...m(85, 146), yaw: 0 },
  { id: 'crypt_bone_pile', ...m(94, 128), yaw: 40, collide: false },
  { id: 'crypt_skull_pile', ...m(107, 139), yaw: 0, collide: false },
  { id: 'crypt_skeleton', ...m(80, 146), yaw: 60, collide: false },
  { id: 'crypt_dirt', ...m(88, 136), yaw: 20, collide: false },
  { id: 'crypt_dirt', ...m(102, 136), yaw: -70, collide: false },
  { id: 'crypt_grass', ...m(73, 147), collide: false },
  { id: 'crypt_grass', ...m(108, 123), collide: false },
  { id: 'crypt_grass', ...m(92, 148), collide: false },
  { id: 'crypt_fern', ...m(72, 129), collide: false },
  { id: 'crypt_lantern', ...m(97, 137), yaw: 0, lift: 1.16, collide: false },
  { id: 'crypt_candle_blob', ...m(90.6, 124.4), lift: 1.77, collide: false },

  // --- the stair down: the first candles ---------------------------------------------------
  { id: 'crypt_skull_pile', ...m(62, 122), yaw: 30, collide: false },
  { id: 'crypt_candle_blob', ...m(68, 128), collide: false },
  { id: 'crypt_candle_blob', ...m(62.5, 128.5), collide: false },
  { id: 'crypt_boards', x: 6, y: 12, side: 'n' },

  // --- the Ossuary: the bone hall, sarcophagi, cages and gibbets, the warden's table --------
  { id: 'crypt_tomb_a', ...m(30, 124), yaw: 0 },
  { id: 'crypt_tomb_a', ...m(50, 124), yaw: 0 },
  { id: 'crypt_table', ...m(40, 116), yaw: 0 },
  { id: 'crypt_skull', ...m(39.4, 116), lift: 0.78, collide: false },
  { id: 'crypt_candle', ...m(40.8, 116.3), lift: 0.78, collide: false },
  { id: 'crypt_cage_l', ...m(24, 134), yaw: 20 },
  { id: 'crypt_cage_l', ...m(56, 136), yaw: -30 },
  { id: 'crypt_gibbet', ...m(26, 116), yaw: 200 },
  { id: 'crypt_gibbet', ...m(54, 136), yaw: 20 },
  { id: 'crypt_candle_rack', x: 2, y: 11, side: 'n' },
  { id: 'crypt_candle_rack', x: 5, y: 11, side: 'n' },
  { id: 'crypt_candle_rack', x: 2, y: 13, side: 's' },
  { id: 'crypt_candle_rack', x: 5, y: 13, side: 's' },
  { id: 'crypt_head', x: 3, y: 11, side: 'n' },
  { id: 'crypt_head', x: 4, y: 11, side: 'n' },
  { id: 'crypt_candelabra', ...m(34, 120), yaw: 0 },
  { id: 'crypt_candelabra', ...m(46, 120), yaw: 0 },
  { id: 'crypt_candelabra', ...m(40, 134), yaw: 0 },
  { id: 'crypt_brazier', ...m(24, 124) },
  { id: 'crypt_brazier', ...m(56, 124) },
  { id: 'crypt_skull_pile', ...m(28, 130), yaw: 0, collide: false },
  { id: 'crypt_skull_pile', ...m(52, 118), yaw: 60, collide: false },
  { id: 'crypt_skull_pile', ...m(44, 136), yaw: 120, collide: false },
  { id: 'crypt_bone_pile', ...m(33, 131), yaw: 20, collide: false },
  { id: 'crypt_bone_pile', ...m(47, 131), yaw: -70, collide: false },
  { id: 'crypt_bone_pile', ...m(22.5, 118), yaw: 160, collide: false },
  { id: 'crypt_bone_pile', ...m(57, 118), yaw: 30, collide: false },
  { id: 'crypt_skeleton', ...m(36, 137), yaw: 110, collide: false },
  { id: 'crypt_skeleton_b', ...m(22.5, 128), yaw: 0, collide: false },
  { id: 'crypt_skeleton', ...m(57, 132), yaw: -40, collide: false },
  { id: 'crypt_rubble', ...m(30, 137), yaw: 0, collide: false },
  { id: 'crypt_crypt_door_chained', x: 2, y: 12, side: 'w' },

  // --- the passage north: a body in the niche ------------------------------------------------
  { id: 'crypt_skeleton_b', ...m(32, 100), yaw: 90, collide: false },
  { id: 'crypt_candle_rack', x: 3, y: 10, side: 'e' },
  { id: 'crypt_candle_rack', x: 3, y: 9, side: 'w' },
  { id: 'crypt_boards', x: 3, y: 9, side: 'e' },

  // --- the Catacombs: the witches' study at the west end, niches, the ritual circle ----------
  { id: 'crypt_ritual_circle', ...m(50, 80), collide: false },
  { id: 'crypt_tomb_b', x: 2, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 5, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 7, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 5, y: 8, side: 's' },
  { id: 'crypt_pillar', ...m(40, 75) }, { id: 'crypt_pillar', ...m(40, 85) },
  { id: 'crypt_pillar', ...m(60, 75) }, { id: 'crypt_pillar', ...m(60, 85) },
  { id: 'crypt_bookshelf_d', x: 2, y: 7, side: 'w' },
  { id: 'crypt_bookshelf', x: 2, y: 8, side: 'w' },
  { id: 'crypt_bookshelf', x: 2, y: 8, side: 's' },
  { id: 'crypt_desk', ...m(26, 84), yaw: 60 },
  { id: 'crypt_table', ...m(31, 76), yaw: 90 },
  { id: 'crypt_book', ...m(31, 75.4), lift: 0.78, yaw: 20, collide: false },
  { id: 'crypt_scroll', ...m(31.3, 76.8), lift: 0.78, yaw: -40, collide: false },
  { id: 'crypt_goblet', ...m(30.5, 76.2), lift: 0.78, collide: false },
  { id: 'crypt_chair', ...m(32.8, 76), yaw: -90 },
  { id: 'crypt_candelabra', ...m(36, 73), yaw: 0 },
  { id: 'crypt_candelabra', ...m(36, 87), yaw: 0 },
  { id: 'crypt_candelabra', ...m(64, 73), yaw: 0 },
  { id: 'crypt_candelabra', ...m(64, 87), yaw: 0 },
  { id: 'crypt_candle_rack', x: 4, y: 7, side: 'n' },
  { id: 'crypt_candle_rack', x: 6, y: 7, side: 'n' },
  { id: 'crypt_candle_rack', x: 3, y: 8, side: 's' },
  { id: 'crypt_candle_rack', x: 6, y: 8, side: 's' },
  { id: 'crypt_banner', x: 3, y: 7, side: 'n' },
  { id: 'crypt_banner', x: 7, y: 8, side: 's' },
  { id: 'crypt_banner', x: 4, y: 8, side: 's' },
  { id: 'crypt_brazier', ...m(44, 74) },
  { id: 'crypt_brazier', ...m(56, 86) },
  { id: 'crypt_statue_b', ...m(22.5, 72.5), yaw: 135 },
  { id: 'crypt_statue_b', ...m(77.5, 87.5), yaw: -45 },
  { id: 'crypt_candle_blob', ...m(46, 76.5), collide: false },
  { id: 'crypt_candle_blob', ...m(54, 76.5), collide: false },
  { id: 'crypt_candle_blob', ...m(46, 83.5), collide: false },
  { id: 'crypt_candle_blob', ...m(54, 83.5), collide: false },
  { id: 'crypt_candle_blob', ...m(42, 80), collide: false },
  { id: 'crypt_candle_blob', ...m(58, 80), collide: false },
  { id: 'crypt_skeleton_b', ...m(70, 73), yaw: 30, collide: false },
  { id: 'crypt_skeleton', ...m(60, 88), yaw: 170, collide: false },
  { id: 'crypt_skull_pile', ...m(74, 86), yaw: 0, collide: false },
  { id: 'crypt_bone_pile', ...m(40, 88), yaw: 50, collide: false },
  { id: 'crypt_chest', ...m(22.8, 80), yaw: 90 },

  // --- the passage east: the way to the Chapel ----------------------------------------------
  { id: 'crypt_candelabra', ...m(85, 72.5), yaw: 0 },
  { id: 'crypt_candelabra', ...m(95, 77.5), yaw: 0 },
  { id: 'crypt_bone_pile', ...m(90, 77), yaw: 80, collide: false },
  { id: 'crypt_banner', x: 8, y: 7, side: 'n' },
  { id: 'crypt_banner', x: 9, y: 7, side: 's' },

  // --- the Chapel: pews between the side aisles, the altar under the organ, gargoyles ---------
  { id: 'crypt_organ', ...m(120, 62), yaw: 180 },
  { id: 'crypt_tabernacle', ...m(120, 65.5), yaw: 180 },
  { id: 'crypt_altar', ...m(120, 70), yaw: 180 },
  { id: 'crypt_candle', ...m(119.4, 70), lift: 0.86, collide: false },
  { id: 'crypt_goblet', ...m(120.6, 70.2), lift: 0.86, collide: false },
  { id: 'crypt_book', ...m(120, 69.7), lift: 0.86, yaw: 180, collide: false },
  { id: 'crypt_lectern', ...m(115, 72), yaw: 160 },
  { id: 'crypt_candelabra', ...m(114, 68), yaw: 0 },
  { id: 'crypt_candelabra', ...m(126, 68), yaw: 0 },
  { id: 'crypt_gargoyle', ...m(109, 65), yaw: 150 },
  { id: 'crypt_gargoyle', ...m(131, 65), yaw: -150 },
  { id: 'crypt_gargoyle_b', ...m(104, 96), yaw: 45 },
  { id: 'crypt_gargoyle_b', ...m(136, 96), yaw: -45 },
  { id: 'crypt_statue', ...m(104, 72), yaw: 90 },
  { id: 'crypt_statue', ...m(136, 72), yaw: -90 },
  { id: 'crypt_pew_l', ...m(114, 78), yaw: 180 }, { id: 'crypt_pew_l', ...m(126, 78), yaw: 180 },
  { id: 'crypt_pew_l', ...m(114, 83), yaw: 180 }, { id: 'crypt_pew_l', ...m(126, 83), yaw: 180 },
  { id: 'crypt_pew_l', ...m(114, 88), yaw: 180 }, { id: 'crypt_pew_l', ...m(126, 88), yaw: 180 },
  { id: 'crypt_pew', ...m(114, 93), yaw: 175 }, { id: 'crypt_pew', ...m(126, 93), yaw: -175 },
  { id: 'crypt_pew_l', ...m(108, 83), yaw: 180 }, { id: 'crypt_pew_l', ...m(132, 83), yaw: 180 },
  { id: 'crypt_pew_l', ...m(108, 88), yaw: 180 }, { id: 'crypt_pew_l', ...m(132, 88), yaw: 180 },
  { id: 'crypt_pillar', ...m(106, 76) }, { id: 'crypt_pillar', ...m(134, 76) },
  { id: 'crypt_pillar', ...m(106, 86) }, { id: 'crypt_pillar', ...m(134, 86) },
  { id: 'crypt_pillar', ...m(106, 95) }, { id: 'crypt_pillar', ...m(134, 95) },
  { id: 'crypt_rose_window', x: 13, y: 7, side: 'e' },
  { id: 'crypt_rose_window', x: 13, y: 8, side: 'e' },
  { id: 'crypt_banner', x: 10, y: 6, side: 'n' },
  { id: 'crypt_banner', x: 13, y: 6, side: 'n' },
  { id: 'crypt_banner', x: 10, y: 9, side: 's' },
  { id: 'crypt_banner', x: 13, y: 9, side: 's' },
  { id: 'crypt_banner', x: 10, y: 8, side: 'w' },
  { id: 'crypt_candle_rack', x: 11, y: 9, side: 's' },
  { id: 'crypt_candle_rack', x: 12, y: 9, side: 's' },
  { id: 'crypt_crypt_door_chained', x: 13, y: 9, side: 'e' },
  { id: 'crypt_candle_blob', ...m(117, 73), collide: false },
  { id: 'crypt_candle_blob', ...m(123, 73), collide: false },
  { id: 'crypt_candle_blob', ...m(111, 70), collide: false },
  { id: 'crypt_candle_blob', ...m(129, 70), collide: false },
  { id: 'crypt_brazier', ...m(104, 80) },
  { id: 'crypt_brazier', ...m(136, 80) },
  { id: 'crypt_skeleton', ...m(108, 90), yaw: 20, collide: false },
  { id: 'crypt_bone_pile', ...m(132, 91), yaw: 0, collide: false },

  // --- the stair up: banners either side -----------------------------------------------------
  { id: 'crypt_banner', x: 11, y: 5, side: 'e' },
  { id: 'crypt_banner', x: 10, y: 5, side: 'w' },
  { id: 'crypt_candle_rack', x: 11, y: 5, side: 'n' },
  { id: 'crypt_candle_rack', x: 10, y: 5, side: 's' },
  { id: 'crypt_skull_pile', ...m(108, 57.5), yaw: 0, collide: false },

  // --- the Lich's Vault: the portal, the circle, the colonnade, the ranks of tombs, the wards --
  { id: 'crypt_portal', ...m(80, 11.4), yaw: 0 },
  { id: 'crypt_gargoyle', ...m(74, 12.5), yaw: 20 },
  { id: 'crypt_gargoyle', ...m(86, 12.5), yaw: -20 },
  { id: 'crypt_ritual_circle', ...m(CRYPT_CIRCLE.x, CRYPT_CIRCLE.z), collide: false, tag: 'circle' },
  { id: 'crypt_ward', ...m(55, 30), yaw: 90 },
  { id: 'crypt_ward', ...m(105, 30), yaw: -90 },
  { id: 'crypt_ward', ...m(68, 14), yaw: 0 },
  { id: 'crypt_ward', ...m(92, 14), yaw: 0 },
  { id: 'crypt_tomb_a', ...m(62, 20), yaw: 30 },
  { id: 'crypt_tomb_a', ...m(98, 20), yaw: -30 },
  { id: 'crypt_tomb_b', ...m(58, 40), yaw: 60 },
  { id: 'crypt_tomb_b', ...m(102, 40), yaw: -60 },
  { id: 'crypt_tomb_b', ...m(70, 44), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(90, 44), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(78, 47), yaw: 90 }, { id: 'crypt_tomb_b', ...m(82, 47), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(64, 13.5), yaw: 0 }, { id: 'crypt_tomb_b', ...m(96, 13.5), yaw: 0 },
  { id: 'crypt_pillar', ...m(64, 22) }, { id: 'crypt_pillar', ...m(96, 22) },
  { id: 'crypt_pillar', ...m(64, 38) }, { id: 'crypt_pillar', ...m(96, 38) },
  { id: 'crypt_pillar', ...m(52.5, 30) }, { id: 'crypt_pillar', ...m(107.5, 30) },
  { id: 'crypt_candle_blob', ...m(78, 45.5), collide: false }, { id: 'crypt_candle_blob', ...m(82, 45.5), collide: false },
  { id: 'crypt_candle_blob', ...m(62, 22.5), collide: false }, { id: 'crypt_candle_blob', ...m(98, 22.5), collide: false },
  { id: 'crypt_brazier', ...m(60, 16) },
  { id: 'crypt_brazier', ...m(100, 16) },
  { id: 'crypt_brazier', ...m(60, 46) },
  { id: 'crypt_brazier', ...m(100, 46) },
  { id: 'crypt_candelabra', ...m(72, 22), yaw: 0 },
  { id: 'crypt_candelabra', ...m(88, 22), yaw: 0 },
  { id: 'crypt_candelabra', ...m(72, 38), yaw: 0 },
  { id: 'crypt_candelabra', ...m(88, 38), yaw: 0 },
  { id: 'crypt_candelabra', ...m(53, 20), yaw: 0 },
  { id: 'crypt_candelabra', ...m(107, 20), yaw: 0 },
  { id: 'crypt_candle_rack', x: 6, y: 1, side: 'n' },
  { id: 'crypt_candle_rack', x: 9, y: 1, side: 'n' },
  { id: 'crypt_candle_rack', x: 5, y: 2, side: 'w' },
  { id: 'crypt_candle_rack', x: 10, y: 2, side: 'e' },
  { id: 'crypt_candle_rack', x: 6, y: 4, side: 's' },
  { id: 'crypt_candle_rack', x: 9, y: 4, side: 's' },
  { id: 'crypt_banner', x: 5, y: 1, side: 'n' },
  { id: 'crypt_banner', x: 10, y: 1, side: 'n' },
  { id: 'crypt_banner', x: 5, y: 3, side: 'w' },
  { id: 'crypt_banner', x: 10, y: 3, side: 'e' },
  { id: 'crypt_banner', x: 7, y: 4, side: 's' },
  { id: 'crypt_banner', x: 8, y: 4, side: 's' },
  { id: 'crypt_statue', ...m(53, 14), yaw: 135 },
  { id: 'crypt_statue', ...m(107, 14), yaw: -135 },
  { id: 'crypt_statue', ...m(53, 46), yaw: 45 },
  { id: 'crypt_statue', ...m(107, 46), yaw: -45 },
  { id: 'crypt_cage_l', ...m(63, 33), yaw: 70 },
  { id: 'crypt_cage_l', ...m(97, 27), yaw: -110 },
  { id: 'crypt_chest', ...m(56, 24), yaw: 110 },
  { id: 'crypt_chest', ...m(104, 36), yaw: -70 },
  { id: 'crypt_skull_pile', ...m(76, 36), yaw: 0, collide: false },
  { id: 'crypt_skull_pile', ...m(84, 24), yaw: 50, collide: false },
  { id: 'crypt_skull_pile', ...m(64, 42), yaw: 100, collide: false },
  { id: 'crypt_bone_pile', ...m(84, 36), yaw: 20, collide: false },
  { id: 'crypt_bone_pile', ...m(76, 24), yaw: -70, collide: false },
  { id: 'crypt_bone_pile', ...m(96, 42), yaw: 160, collide: false },
  { id: 'crypt_skeleton', ...m(70, 32), yaw: 30, collide: false },
  { id: 'crypt_skeleton_b', ...m(90, 36), yaw: -60, collide: false },
  { id: 'crypt_skeleton', ...m(58, 34), yaw: 100, collide: false },
  { id: 'crypt_skeleton_b', ...m(102, 26), yaw: 200, collide: false },
  { id: 'crypt_rubble', ...m(56, 44), yaw: 0, collide: false },
  { id: 'crypt_rubble', ...m(104, 16), yaw: 70, collide: false },
  { id: 'crypt_crypt_door_boarded', x: 5, y: 4, side: 'w' },
  { id: 'crypt_crypt_door_boarded', x: 10, y: 4, side: 'e' }
]

export function cryptDungeon(torchEvery = 2): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 6066, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE, links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 8 : 5, DOORWAYS)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by CRYPT_STAGES.
    const stage = CRYPT_STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}

/**
 * Where the crypt's fires burn (src/cryptFx.ts puts flames there): the braziers
 * and the tall candelabras. Lights on the Vault's braziers only; the rest glow
 * by their flames and the atlas's emissive wax.
 */
export function cryptFires(): Array<{ x: number; z: number; y: number; size: number; light: boolean }> {
  return FURNITURE.flatMap((f) => {
    const fire = f.id === 'crypt_brazier' ? { y: 0.8, size: 0.5 } : f.id === 'crypt_candelabra' ? { y: 1.72, size: 0.16 } : undefined
    if (!fire) return []
    const x = f.x * TILE + TILE / 2
    const z = f.y * TILE + TILE / 2
    return [{ x, z, ...fire, light: f.id === 'crypt_brazier' && z < 50 }]
  })
}

/** The rooms as metre boxes, for the fog and the bats (the entrance first, then the road to the Lich). */
export const CRYPT_ROOM_BOXES = [E, L, O, C, H, V].map((r) => ({ x: r.x * TILE, z: r.y * TILE, w: r.w * TILE, d: r.h * TILE }))

/** The open-air rooms (the graveyard), where the bats fly and the moon shows: the rest is under the hill. */
export const CRYPT_OPEN_BOXES = [E, L].map((r) => ({ x: r.x * TILE, z: r.y * TILE, w: r.w * TILE, d: r.h * TILE }))

/** Every kit piece the Crypt's furniture places (for the preload plan). */
export function cryptFurnitureIds(): KitId[] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}
