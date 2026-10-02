// The Crypt: barrows under the hill, drawn by hand in the gauntlet's terms
// (rooms sealed until cleared, enemies in waves, two wardens, the Lich in his
// vault at the top). Synty's Dark Fantasy pack (scripts/realms/crypt.json):
// 10 m stone-block walls welded from 2.5 m pieces, 6 m tall under a roof the
// third-person camera sees; a gothic archway between pillars for doorways; a
// half wall for the camera's cutaway; candle sconces on the walls. The same
// every run, so it can be learned. The dressing leans on Synty's own
// compositions: bays of their crypt nave, their altar end, study, cellar,
// candle clusters and skull heaps, and patches of their graveyard, lifted
// whole out of the pack's demo scenes (scripts/realms/crypt-clusters.json)
// as single welded pieces, with vines, moss and grime on the walls between.
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
  // --- the entrance: the graveyard's edge, where the party spawns ------------------------------
  // A patch of Synty's own graveyard (stones, dirt, grass, a lamp post, a statue) lifted whole
  // from their Demo_Cathedral scene; the well, the sexton's cart and the notice around it.
  { id: 'crypt_graves_c', ...m(131, 141), yaw: 0 },
  { id: 'crypt_tree_b', ...m(123, 147.5), yaw: 30 },
  { id: 'crypt_wagon', ...m(137, 133), yaw: 25 },
  { id: 'crypt_well', ...m(124, 133), yaw: 0 },
  { id: 'crypt_notice', ...m(133, 132), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(121.5, 142.5), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(138.5, 147.5), yaw: 180 },
  { id: 'crypt_barrel', ...m(138.5, 131.5), yaw: 0 },
  { id: 'crypt_crate', ...m(136.5, 131), yaw: 30 },
  { id: 'crypt_rock_b', ...m(121.5, 131.5), yaw: 40 },
  { id: 'crypt_plant_b', ...m(123, 143), collide: false },
  { id: 'crypt_plant_a', ...m(138, 136), collide: false },
  { id: 'crypt_grass_patch', ...m(124, 138), collide: false },
  { id: 'crypt_vine_b', x: 12, y: 13, side: 'n' },
  { id: 'crypt_vine_drape', x: 13, y: 13, side: 'e' },
  { id: 'crypt_vine_a', x: 13, y: 14, side: 'e' },
  { id: 'crypt_moss_c', x: 12, y: 14, side: 's' },
  { id: 'crypt_grunge_w', x: 13, y: 13, side: 'n' },

  // --- the gate path: the lychgate's posts, a trodden floor ------------------------------------
  { id: 'crypt_fence_post', ...m(112, 131.5), yaw: 0 },
  { id: 'crypt_fence_post', ...m(112, 138.5), yaw: 0 },
  { id: 'crypt_dirt_flat', ...m(115, 135), yaw: 20, collide: false },
  { id: 'crypt_pebbles', ...m(117.5, 138.5), yaw: 0, collide: false },
  { id: 'crypt_stone_d', ...m(118, 131.8), yaw: 80 },
  { id: 'crypt_moss_b', x: 11, y: 13, side: 'n' },
  { id: 'crypt_vine_a', x: 11, y: 13, side: 's' },

  // --- the Lychgate: the graveyard proper -------------------------------------------------------
  // Two more of Synty's graveyard patches, the mausoleums along the north wall, the gallows and
  // the gibbet by the south wall, dead trees in the corners, lamp posts by the ways in and out.
  { id: 'crypt_graves_a', ...m(80, 136), yaw: 0 },
  { id: 'crypt_graves_b', ...m(99, 137), yaw: 180 },
  { id: 'crypt_mausoleum_a', ...m(77, 125), yaw: 0 },
  { id: 'crypt_mausoleum_b', ...m(104, 124.5), yaw: 0 },
  { id: 'crypt_tomb_a', ...m(90.5, 125.5), yaw: 90 },
  { id: 'crypt_tree_c', ...m(85.5, 123.5), yaw: 70 },
  { id: 'crypt_tree_a', ...m(73.5, 147), yaw: 200 },
  { id: 'crypt_gallows', ...m(88, 147.5), yaw: 0 },
  { id: 'crypt_gibbet', ...m(107, 147.5), yaw: 150 },
  { id: 'crypt_lamp_post', ...m(108, 128), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(72, 128), yaw: 0 },
  { id: 'crypt_lamp_post', ...m(96, 148), yaw: 180 },
  { id: 'crypt_rock_b', ...m(72.5, 121.8), yaw: 10 },
  { id: 'crypt_rocks', ...m(97, 123), collide: false },
  { id: 'crypt_bone_pile', ...m(95, 127), yaw: 40, collide: false },
  { id: 'crypt_skeleton', ...m(80.5, 147), yaw: 60, collide: false },
  { id: 'crypt_dirt', ...m(93, 127), yaw: 20, collide: false },
  { id: 'crypt_dirt_flat', ...m(89, 145), yaw: -70, collide: false },
  { id: 'crypt_grass_patch', ...m(74, 141), collide: false },
  { id: 'crypt_grass_patch', ...m(108.5, 143), collide: false },
  { id: 'crypt_grass', ...m(99, 126), collide: false },
  { id: 'crypt_plant_a', ...m(76, 148), collide: false },
  { id: 'crypt_plant_b', ...m(102, 148.5), collide: false },
  { id: 'crypt_fern', ...m(71.5, 133), collide: false },
  { id: 'crypt_fern', ...m(108.5, 121.8), collide: false },
  { id: 'crypt_vine_b', x: 7, y: 12, side: 'n' },
  { id: 'crypt_vine_drape', x: 9, y: 12, side: 'n' },
  { id: 'crypt_vine_drape', x: 8, y: 14, side: 's' },
  { id: 'crypt_vine_a', x: 10, y: 14, side: 'e' },
  { id: 'crypt_vine_b', x: 10, y: 12, side: 'e' },
  { id: 'crypt_moss_b', x: 7, y: 14, side: 'w' },
  { id: 'crypt_moss_c', x: 9, y: 14, side: 's' },
  { id: 'crypt_grunge_w', x: 7, y: 13, side: 'w' },
  { id: 'crypt_grunge_w', x: 8, y: 12, side: 'n' },

  // --- the stair down: the first candles, the first stains -------------------------------------
  { id: 'crypt_skull_pile', ...m(62, 122), yaw: 30, collide: false },
  { id: 'crypt_candles_b', ...m(62.5, 128.5), yaw: 0 },
  { id: 'crypt_candle_blob', ...m(68, 128), collide: false },
  { id: 'crypt_boards', x: 6, y: 12, side: 'n' },
  { id: 'crypt_grunge_a', ...m(65, 125), lift: 0.02, collide: false },
  { id: 'crypt_moss_c', x: 6, y: 12, side: 's' },
  { id: 'crypt_vine_a', x: 6, y: 12, side: 'n' },

  // --- the Ossuary: the bone hall ----------------------------------------------------------------
  // A bay of Synty's crypt nave down the middle (two pillar rows, tombs between, skulls and
  // candles on a dirt floor), the colonnade carried on with their pillar, heaps of skulls against
  // the walls, bodies, a landslide through the corner; the warden's table at the far end.
  { id: 'crypt_nave_bay_lite', ...m(40, 125), yaw: 0 },
  { id: 'crypt_pillar_b', ...m(28, 122.5) }, { id: 'crypt_pillar_b', ...m(28, 127.5) },
  { id: 'crypt_pillar_b', ...m(52, 122.5) }, { id: 'crypt_pillar_b', ...m(52, 127.5) },
  { id: 'crypt_vine_pillar', ...m(28, 127.5), collide: false },
  { id: 'crypt_vine_pillar', ...m(52, 122.5), yaw: 140, collide: false },
  { id: 'crypt_tomb_b', ...m(30, 136.5), yaw: 0 },
  { id: 'crypt_tomb_b', ...m(50, 136.5), yaw: 0 },
  { id: 'crypt_table', ...m(50, 113.5), yaw: 0 },
  { id: 'crypt_candles_a', ...m(50.6, 113.5), yaw: 0, lift: 0.78 },
  { id: 'crypt_skull', ...m(49.2, 113.3), lift: 0.78, collide: false },
  { id: 'crypt_cage_l', ...m(25, 133), yaw: 20 },
  { id: 'crypt_gibbet', ...m(26, 117), yaw: 200 },
  { id: 'crypt_skull_heap_a', ...m(23, 111.6), yaw: 0 },
  { id: 'crypt_skull_heap_b', ...m(57, 111.6), yaw: 0 },
  { id: 'crypt_skull_heap_a', ...m(36, 138.4), yaw: 180 },
  { id: 'crypt_body_a', ...m(24, 137), yaw: 30 },
  { id: 'crypt_body_a', ...m(50, 131), yaw: 110 },
  { id: 'crypt_body_b', ...m(23, 126), yaw: 0 },
  { id: 'crypt_landslide', ...m(22, 112.5), yaw: 45 },
  { id: 'crypt_rubble_b', ...m(53, 138), yaw: 40 },
  { id: 'crypt_rubble', ...m(30, 118), yaw: 0, collide: false },
  { id: 'crypt_candle_rack', x: 2, y: 11, side: 'n' },
  { id: 'crypt_candle_rack', x: 5, y: 13, side: 's' },
  { id: 'crypt_head', x: 4, y: 11, side: 'n' },
  { id: 'crypt_head', x: 2, y: 13, side: 'w' },
  { id: 'crypt_candelabra', ...m(30, 133), yaw: 0 },
  { id: 'crypt_candelabra', ...m(50, 133), yaw: 0 },
  { id: 'crypt_brazier', ...m(24, 124) },
  { id: 'crypt_brazier', ...m(56, 116) },
  { id: 'crypt_skull_pile', ...m(28, 130), yaw: 0, collide: false },
  { id: 'crypt_skull_pile', ...m(52, 118), yaw: 60, collide: false },
  { id: 'crypt_rug_b', ...m(35, 114), yaw: 0 },
  { id: 'crypt_grunge_a', ...m(32, 118), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(48, 132), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(44, 116), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(26, 130), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(28, 128), yaw: 30, lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(52, 122), yaw: -50, lift: 0.02, collide: false },
  { id: 'crypt_crypt_door_chained', x: 2, y: 12, side: 'w' },
  { id: 'crypt_flag_torn', x: 3, y: 13, side: 's' },
  { id: 'crypt_flag_torn', x: 4, y: 11, side: 'n' },
  { id: 'crypt_grunge_w', x: 2, y: 12, side: 'w' },
  { id: 'crypt_grunge_w', x: 4, y: 13, side: 's' },
  { id: 'crypt_moss_b', x: 3, y: 13, side: 's' },
  { id: 'crypt_moss_c', x: 5, y: 11, side: 'n' },
  { id: 'crypt_moss_b', x: 5, y: 13, side: 'e' },
  { id: 'crypt_vine_a', x: 2, y: 11, side: 'w' },
  { id: 'crypt_vine_b', x: 3, y: 11, side: 'n' },
  { id: 'crypt_moss_c', x: 2, y: 12, side: 'w' },
  { id: 'crypt_vine_a', x: 2, y: 13, side: 's' },
  { id: 'crypt_vine_drape', x: 5, y: 13, side: 's' },
  { id: 'crypt_moss_b', x: 4, y: 13, side: 's' },
  { id: 'crypt_vine_b', x: 5, y: 11, side: 'e' },

  // --- the passage north: a body in the niche ------------------------------------------------
  { id: 'crypt_skeleton_b', ...m(32, 100), yaw: 90, collide: false },
  { id: 'crypt_candle_rack', x: 3, y: 10, side: 'e' },
  { id: 'crypt_candle_rack', x: 3, y: 9, side: 'w' },
  { id: 'crypt_boards', x: 3, y: 9, side: 'e' },
  { id: 'crypt_vine_a', x: 3, y: 10, side: 'w' },
  { id: 'crypt_grunge_a', ...m(35, 95), lift: 0.02, collide: false },
  { id: 'crypt_pebbles', ...m(37, 104), collide: false },

  // --- the Catacombs: the witches' study at the west end, the cellar at the east, the circle ---
  // Synty's study corner (shelves, desk, books, bottles, candles) against the west wall, their
  // cellar (barrels, rug, papers) along the north wall at the east end, two rows of pillars
  // down the hall around the ritual circle, niche tombs in the walls.
  { id: 'crypt_ritual_circle', ...m(50, 80), collide: false },
  { id: 'crypt_study', ...m(22.4, 80), yaw: 0 },
  { id: 'crypt_shelf', x: 2, y: 8, side: 's', yaw: 90 },
  { id: 'crypt_bookshelf', x: 4, y: 8, side: 's' },
  { id: 'crypt_cellar', ...m(70, 72.6), yaw: -90 },
  { id: 'crypt_tomb_b', x: 2, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 5, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 7, y: 7, side: 'n' },
  { id: 'crypt_tomb_b', x: 5, y: 8, side: 's' },
  { id: 'crypt_pillar_b', ...m(36, 74) }, { id: 'crypt_pillar_b', ...m(36, 86) },
  { id: 'crypt_pillar_b', ...m(44, 74) }, { id: 'crypt_pillar_b', ...m(44, 86) },
  { id: 'crypt_pillar_b', ...m(56, 74) }, { id: 'crypt_pillar_b', ...m(56, 86) },
  { id: 'crypt_pillar_b', ...m(64, 74) }, { id: 'crypt_pillar_b', ...m(64, 86) },
  { id: 'crypt_vine_pillar', ...m(36, 86), yaw: 60, collide: false },
  { id: 'crypt_vine_pillar', ...m(64, 74), yaw: -120, collide: false },
  { id: 'crypt_candles_c', ...m(50, 76.4), yaw: 0 },
  { id: 'crypt_candles_c', ...m(50, 83.6), yaw: 180 },
  { id: 'crypt_candle_blob', ...m(42, 80), collide: false },
  { id: 'crypt_candle_blob', ...m(58, 80), collide: false },
  { id: 'crypt_candelabra', ...m(30, 73), yaw: 0 },
  { id: 'crypt_candelabra', ...m(30, 87), yaw: 0 },
  { id: 'crypt_candle_rack', x: 4, y: 7, side: 'n' },
  { id: 'crypt_candle_rack', x: 6, y: 8, side: 's' },
  { id: 'crypt_banner', x: 3, y: 7, side: 'n' },
  { id: 'crypt_banner', x: 7, y: 8, side: 's' },
  { id: 'crypt_flag_torn', x: 5, y: 8, side: 's' },
  { id: 'crypt_brazier', ...m(44, 80) },
  { id: 'crypt_brazier', ...m(56, 80) },
  { id: 'crypt_statue_b', ...m(22.5, 72.5), yaw: 135 },
  { id: 'crypt_statue_b', ...m(77.5, 87.5), yaw: -45 },
  { id: 'crypt_body_a', ...m(60, 88), yaw: 170 },
  { id: 'crypt_skeleton_b', ...m(76, 82), yaw: 30, collide: false },
  { id: 'crypt_skull_heap_a', ...m(30, 88.4), yaw: 180 },
  { id: 'crypt_skull_pile', ...m(74, 78), yaw: 0, collide: false },
  { id: 'crypt_chest', ...m(78, 85), yaw: -135 },
  { id: 'crypt_rug_c', ...m(30, 80), yaw: 90 },
  { id: 'crypt_grunge_a', ...m(40, 80), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(60, 80), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(66, 84), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(28, 72), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(70, 83), yaw: 0, lift: 0.02, collide: false },
  { id: 'crypt_vine_b', x: 3, y: 7, side: 'n' },
  { id: 'crypt_vine_drape', x: 6, y: 8, side: 's' },
  { id: 'crypt_vine_b', x: 7, y: 8, side: 'e' },
  { id: 'crypt_moss_c', x: 7, y: 8, side: 's' },
  { id: 'crypt_moss_b', x: 2, y: 7, side: 'w' },
  { id: 'crypt_grunge_w', x: 4, y: 8, side: 's' },
  { id: 'crypt_grunge_w', x: 6, y: 7, side: 'n' },
  { id: 'crypt_vine_a', x: 2, y: 7, side: 'n' },
  { id: 'crypt_moss_c', x: 3, y: 8, side: 's' },
  { id: 'crypt_vine_b', x: 5, y: 7, side: 'n' },
  { id: 'crypt_vine_drape', x: 7, y: 7, side: 'n' },
  { id: 'crypt_moss_b', x: 6, y: 8, side: 's' },
  { id: 'crypt_vine_a', x: 7, y: 8, side: 'e' },
  { id: 'crypt_vine_drape', x: 4, y: 7, side: 'n' },

  // --- the passage east: the way to the Chapel ----------------------------------------------
  { id: 'crypt_candelabra', ...m(85, 72.5), yaw: 0 },
  { id: 'crypt_candelabra', ...m(95, 77.5), yaw: 0 },
  { id: 'crypt_bone_pile', ...m(90, 77), yaw: 80, collide: false },
  { id: 'crypt_banner', x: 8, y: 7, side: 'n' },
  { id: 'crypt_banner', x: 9, y: 7, side: 's' },
  { id: 'crypt_grunge_a', ...m(90, 75), lift: 0.02, collide: false },
  { id: 'crypt_vine_a', x: 8, y: 7, side: 's' },
  { id: 'crypt_boards_b', x: 9, y: 7, side: 'n' },

  // --- the Chapel: the altar end, a bay of the nave, pews behind it, tombs in the aisles ------
  // Synty's altar end (pillars, candle racks, a tomb, broken saints) under the organ, a full bay
  // of their nave (pillars, tombs, gargoyles' perches, skulls, candles) in the middle, the pews
  // behind, tombs and candle clusters in the side aisles, the gargoyles on their corners.
  { id: 'crypt_organ', ...m(120, 62), yaw: 180 },
  { id: 'crypt_tabernacle', ...m(120, 65.5), yaw: 180 },
  { id: 'crypt_altar_end', ...m(120, 72), yaw: -90 },
  { id: 'crypt_nave_bay', ...m(120, 86), yaw: -90 },
  { id: 'crypt_rug_b', ...m(120, 77.3), yaw: 0 },
  { id: 'crypt_pew_l', ...m(116, 94.5), yaw: 180 }, { id: 'crypt_pew_l', ...m(124, 94.5), yaw: 180 },
  { id: 'crypt_pew_l', ...m(116, 97.5), yaw: 180 }, { id: 'crypt_pew_l', ...m(124, 97.5), yaw: 180 },
  { id: 'crypt_pew', ...m(108, 96), yaw: 175 }, { id: 'crypt_pew', ...m(132, 96), yaw: -175 },
  { id: 'crypt_candelabra', ...m(112, 70), yaw: 0 },
  { id: 'crypt_candelabra', ...m(128, 70), yaw: 0 },
  { id: 'crypt_gargoyle', ...m(109, 65), yaw: 150 },
  { id: 'crypt_gargoyle', ...m(131, 65), yaw: -150 },
  { id: 'crypt_gargoyle_b', ...m(104, 96), yaw: 45 },
  { id: 'crypt_gargoyle_b', ...m(136, 96), yaw: -45 },
  { id: 'crypt_statue', ...m(104, 72), yaw: 90 },
  { id: 'crypt_statue', ...m(136, 72), yaw: -90 },
  { id: 'crypt_tomb_a', ...m(106, 82), yaw: 90 },
  { id: 'crypt_tomb_a', ...m(134, 82), yaw: -90 },
  { id: 'crypt_tomb_b', ...m(106, 90), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(134, 90), yaw: -90 },
  { id: 'crypt_candles_a', ...m(106, 86), yaw: 90 },
  { id: 'crypt_candles_c', ...m(134, 86), yaw: -90 },
  { id: 'crypt_skull_heap_a', ...m(110, 98.4), yaw: 180 },
  { id: 'crypt_skull_heap_b', ...m(138.4, 76), yaw: -90 },
  { id: 'crypt_body_pile', ...m(104, 66), yaw: 20 },
  { id: 'crypt_body_b', ...m(133, 98), yaw: -60 },
  { id: 'crypt_landslide', ...m(102, 62), yaw: 120 },
  { id: 'crypt_rose_window', x: 13, y: 7, side: 'e' },
  { id: 'crypt_rose_window', x: 13, y: 8, side: 'e' },
  { id: 'crypt_relief', x: 10, y: 6, side: 'n' },
  { id: 'crypt_banner', x: 13, y: 6, side: 'n' },
  { id: 'crypt_banner', x: 10, y: 9, side: 's' },
  { id: 'crypt_banner', x: 13, y: 9, side: 's' },
  { id: 'crypt_flag_torn', x: 10, y: 8, side: 'w' },
  { id: 'crypt_candle_rack', x: 11, y: 9, side: 's' },
  { id: 'crypt_crypt_door_chained', x: 13, y: 9, side: 'e' },
  { id: 'crypt_boards_b', x: 12, y: 9, side: 's' },
  { id: 'crypt_candle_blob', ...m(111, 74), collide: false },
  { id: 'crypt_candle_blob', ...m(129, 74), collide: false },
  { id: 'crypt_brazier', ...m(104, 80) },
  { id: 'crypt_brazier', ...m(136, 80) },
  { id: 'crypt_skeleton', ...m(108, 90), yaw: 20, collide: false },
  { id: 'crypt_bone_pile', ...m(132, 93), yaw: 0, collide: false },
  { id: 'crypt_grunge_a', ...m(108, 76), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(132, 88), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(112, 98), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(128, 64), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(106, 68), yaw: 0, lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(134, 94), yaw: 90, lift: 0.02, collide: false },
  { id: 'crypt_vine_drape', x: 12, y: 6, side: 'n' },
  { id: 'crypt_vine_b', x: 10, y: 9, side: 's' },
  { id: 'crypt_vine_b', x: 13, y: 6, side: 'e' },
  { id: 'crypt_vine_a', x: 10, y: 9, side: 'w' },
  { id: 'crypt_moss_c', x: 13, y: 6, side: 'n' },
  { id: 'crypt_moss_b', x: 11, y: 9, side: 's' },
  { id: 'crypt_moss_c', x: 10, y: 6, side: 'w' },
  { id: 'crypt_grunge_w', x: 12, y: 9, side: 's' },
  { id: 'crypt_grunge_w', x: 10, y: 8, side: 'w' },
  { id: 'crypt_vine_b', x: 11, y: 6, side: 'n' },
  { id: 'crypt_moss_c', x: 13, y: 7, side: 'e' },
  { id: 'crypt_vine_a', x: 13, y: 8, side: 'e' },
  { id: 'crypt_vine_drape', x: 11, y: 9, side: 's' },
  { id: 'crypt_vine_b', x: 10, y: 8, side: 'w' },
  { id: 'crypt_moss_b', x: 13, y: 9, side: 's' },
  { id: 'crypt_vine_a', x: 12, y: 6, side: 'n' },

  // --- the stair up: banners either side -----------------------------------------------------
  { id: 'crypt_banner', x: 11, y: 5, side: 'e' },
  { id: 'crypt_banner', x: 10, y: 5, side: 'w' },
  { id: 'crypt_candle_rack', x: 11, y: 5, side: 'n' },
  { id: 'crypt_candle_rack', x: 10, y: 5, side: 's' },
  { id: 'crypt_skull_pile', ...m(108, 57.5), yaw: 0, collide: false },
  { id: 'crypt_grunge_a', ...m(110, 55), lift: 0.02, collide: false },
  { id: 'crypt_moss_b', x: 11, y: 5, side: 'n' },

  // --- the Lich's Vault: the portal, the circle between two bays of the nave, the wards -------
  // Two bays of Synty's nave either side of the ritual circle make the hall a colonnade (sixteen
  // pillars, tombs between them); the ranks of tombs beyond, the wards, braziers in the corners,
  // bodies and heaps of skulls, a landslide through the north-east corner.
  { id: 'crypt_portal', ...m(80, 11.4), yaw: 0 },
  { id: 'crypt_gargoyle', ...m(74, 12.5), yaw: 20 },
  { id: 'crypt_gargoyle', ...m(86, 12.5), yaw: -20 },
  { id: 'crypt_ritual_circle', ...m(CRYPT_CIRCLE.x, CRYPT_CIRCLE.z), collide: false, tag: 'circle' },
  { id: 'crypt_nave_bay_lite', ...m(66, 30), yaw: 0 },
  { id: 'crypt_nave_bay_lite', ...m(94, 30), yaw: 180 },
  { id: 'crypt_pillar_b', ...m(74, 23.5) }, { id: 'crypt_pillar_b', ...m(86, 23.5) },
  { id: 'crypt_pillar_b', ...m(74, 36.5) }, { id: 'crypt_pillar_b', ...m(86, 36.5) },
  { id: 'crypt_vine_pillar', ...m(74, 23.5), yaw: 80, collide: false },
  { id: 'crypt_vine_pillar', ...m(86, 36.5), yaw: -100, collide: false },
  { id: 'crypt_ward', ...m(55, 30), yaw: 90 },
  { id: 'crypt_ward', ...m(105, 30), yaw: -90 },
  { id: 'crypt_ward', ...m(68, 14), yaw: 0 },
  { id: 'crypt_ward', ...m(92, 14), yaw: 0 },
  { id: 'crypt_tomb_a', ...m(62, 20), yaw: 30 },
  { id: 'crypt_tomb_a', ...m(98, 20), yaw: -30 },
  { id: 'crypt_tomb_b', ...m(58, 40), yaw: 60 },
  { id: 'crypt_tomb_b', ...m(102, 40), yaw: -60 },
  { id: 'crypt_tomb_b', ...m(72, 44), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(88, 44), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(78, 47), yaw: 90 }, { id: 'crypt_tomb_b', ...m(82, 47), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(64, 13.5), yaw: 0 }, { id: 'crypt_tomb_b', ...m(96, 13.5), yaw: 0 },
  { id: 'crypt_pillar_b', ...m(56, 18) }, { id: 'crypt_pillar_b', ...m(104, 18) },
  { id: 'crypt_pillar_b', ...m(56, 42) }, { id: 'crypt_pillar_b', ...m(104, 42) },
  { id: 'crypt_vine_pillar', ...m(56, 42), yaw: 30, collide: false },
  { id: 'crypt_vine_pillar', ...m(104, 18), yaw: -150, collide: false },
  { id: 'crypt_candles_a', ...m(77, 37), yaw: 0 },
  { id: 'crypt_candles_a', ...m(83, 23), yaw: 180 },
  { id: 'crypt_candle_blob', ...m(78, 45.5), collide: false }, { id: 'crypt_candle_blob', ...m(82, 45.5), collide: false },
  { id: 'crypt_candle_blob', ...m(62, 22.5), collide: false }, { id: 'crypt_candle_blob', ...m(98, 22.5), collide: false },
  { id: 'crypt_brazier', ...m(60, 16) },
  { id: 'crypt_brazier', ...m(100, 16) },
  { id: 'crypt_brazier', ...m(60, 46) },
  { id: 'crypt_brazier', ...m(100, 46) },
  { id: 'crypt_candelabra', ...m(72, 22), yaw: 0 },
  { id: 'crypt_candelabra', ...m(88, 22), yaw: 0 },
  { id: 'crypt_candle_rack', x: 6, y: 1, side: 'n' },
  { id: 'crypt_candle_rack', x: 9, y: 1, side: 'n' },
  { id: 'crypt_candle_rack', x: 6, y: 4, side: 's' },
  { id: 'crypt_candle_rack', x: 9, y: 4, side: 's' },
  { id: 'crypt_banner', x: 5, y: 1, side: 'n' },
  { id: 'crypt_banner', x: 10, y: 1, side: 'n' },
  { id: 'crypt_banner', x: 5, y: 3, side: 'w' },
  { id: 'crypt_relief', x: 10, y: 3, side: 'e' },
  { id: 'crypt_banner', x: 7, y: 4, side: 's' },
  { id: 'crypt_banner', x: 8, y: 4, side: 's' },
  { id: 'crypt_flag_torn', x: 6, y: 4, side: 's' },
  { id: 'crypt_flag_torn', x: 9, y: 1, side: 'n' },
  { id: 'crypt_statue', ...m(53, 14), yaw: 135 },
  { id: 'crypt_statue', ...m(107, 14), yaw: -135 },
  { id: 'crypt_statue', ...m(53, 46), yaw: 45 },
  { id: 'crypt_statue', ...m(107, 46), yaw: -45 },
  { id: 'crypt_cage_l', ...m(62, 46), yaw: 70 },
  { id: 'crypt_chest', ...m(56, 24), yaw: 110 },
  { id: 'crypt_chest', ...m(104, 36), yaw: -70 },
  { id: 'crypt_skull_heap_a', ...m(80, 48.4), yaw: 180 },
  { id: 'crypt_skull_heap_b', ...m(51.6, 40), yaw: 90 },
  { id: 'crypt_skull_heap_b', ...m(108.4, 36), yaw: -90 },
  { id: 'crypt_skull_pile', ...m(76, 36), yaw: 0, collide: false },
  { id: 'crypt_skull_pile', ...m(84, 24), yaw: 50, collide: false },
  { id: 'crypt_bone_pile', ...m(76, 24), yaw: -70, collide: false },
  { id: 'crypt_body_a', ...m(76, 40), yaw: 60 },
  { id: 'crypt_body_b', ...m(84, 20), yaw: -120 },
  { id: 'crypt_body_pile', ...m(56, 46), yaw: 20 },
  { id: 'crypt_skeleton', ...m(58, 34), yaw: 100, collide: false },
  { id: 'crypt_skeleton_b', ...m(102, 26), yaw: 200, collide: false },
  { id: 'crypt_landslide', ...m(106.5, 12), yaw: 200 },
  { id: 'crypt_rubble_b', ...m(100, 12.5), yaw: 70 },
  { id: 'crypt_grunge_a', ...m(80, 22), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(80, 38), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(66, 46), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(100, 14), lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(80, 42), yaw: 0, lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(58, 20), yaw: 60, lift: 0.02, collide: false },
  { id: 'crypt_vine_drape', x: 7, y: 1, side: 'n' },
  { id: 'crypt_vine_drape', x: 9, y: 4, side: 's' },
  { id: 'crypt_vine_b', x: 5, y: 2, side: 'w' },
  { id: 'crypt_vine_b', x: 10, y: 4, side: 'e' },
  { id: 'crypt_vine_a', x: 8, y: 1, side: 'n' },
  { id: 'crypt_moss_c', x: 8, y: 1, side: 'n' },
  { id: 'crypt_moss_b', x: 5, y: 4, side: 'w' },
  { id: 'crypt_moss_c', x: 10, y: 1, side: 'e' },
  { id: 'crypt_grunge_w', x: 5, y: 3, side: 'w' },
  { id: 'crypt_grunge_w', x: 7, y: 4, side: 's' },
  { id: 'crypt_vine_b', x: 6, y: 1, side: 'n' },
  { id: 'crypt_moss_c', x: 5, y: 1, side: 'w' },
  { id: 'crypt_vine_a', x: 5, y: 3, side: 'w' },
  { id: 'crypt_vine_drape', x: 8, y: 4, side: 's' },
  { id: 'crypt_vine_b', x: 10, y: 3, side: 'e' },
  { id: 'crypt_moss_b', x: 10, y: 2, side: 'e' },
  { id: 'crypt_vine_a', x: 6, y: 4, side: 's' },
  { id: 'crypt_vine_drape', x: 10, y: 1, side: 'n' },
  { id: 'crypt_moss_c', x: 7, y: 4, side: 's' },
  { id: 'crypt_vine_b', x: 5, y: 4, side: 'w' },
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
    // The lamp post's lantern hangs 1.1 m out along the post's +Z, so it swings with the yaw.
    const fire = f.id === 'crypt_brazier' ? { y: 0.8, size: 0.5, dz: 0 }
      : f.id === 'crypt_candelabra' ? { y: 1.72, size: 0.16, dz: 0 }
      : f.id === 'crypt_lamp_post' ? { y: 4.0, size: 0.14, dz: 1.1 }
      : undefined
    if (!fire) return []
    const yaw = ((f.yaw ?? 0) * Math.PI) / 180
    const x = f.x * TILE + TILE / 2 + Math.sin(yaw) * fire.dz
    const z = f.y * TILE + TILE / 2 + Math.cos(yaw) * fire.dz
    return [{ x, z, y: fire.y, size: fire.size, light: f.id === 'crypt_brazier' && z < 50 }]
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
