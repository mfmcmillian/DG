// The Hall of Antrom: the authored hub where champions gather between runs.
// Pure data in the generator's Dungeon shape, so the layout, builder, camera,
// enemy sim and server all take it as they would a generated level. Unlike a
// level it is drawn by hand: rooms are rectangles on the 12-cell hall grid,
// doorways are named, and every prop has a place.
//
// Plan (12 x 12 cells of 5 m; north is -Z, the crawler camera looks north):
//
//        x  0 1 2 3 4 5 6 7 8 9 10 11
//   y  4    . . . G G G G G . . .  .     G great hall, statue on the north wall
//      5    . S S G G G G G E E .  .     S smithy (west), E training yard (east)
//      6    . S S = G G G = E E .  .     = doorway
//      7    . S S G G G G G E E .  .
//      8    . . . G G G G G . . .  .
//      9    . . . . V = V . . . .  .     one arch on the axis, down to the vestibule
//     10    . . . . V V V . . . .  .     V vestibule: the spawn stands in its middle
//
// Odd widths put the entrance, the war table and the statue on one axis
// (cell 5, world x = 45.5), so the first thing a player sees is the hall.

import { authoredDungeon, Rect } from './authored'
import { Dungeon, Furniture, Room } from './generator'

const SIZE = 12

const GREAT_HALL: Rect = { x: 3, y: 4, w: 5, h: 5 }
const VESTIBULE: Rect = { x: 4, y: 9, w: 3, h: 2 }
const SMITHY: Rect = { x: 1, y: 5, w: 2, h: 3 }
const CHAMPIONS: Rect = { x: 8, y: 5, w: 2, h: 3 }

/** Doorways as the cell on each side; the arch stands on their shared edge. */
const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[5, 8], [5, 9]],
  [[2, 6], [3, 6]],
  [[7, 6], [8, 6]]
]

/** Rooms with no generated props: every piece in the hall is placed below. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...VESTIBULE, kind: 'entrance' },
  { ...GREAT_HALL, kind: 'quiet' },
  { ...SMITHY, kind: 'quiet' },
  { ...CHAMPIONS, kind: 'quiet' }
]

/** Named placement of the table that opens the dungeon lobby. */
export const WAR_TABLE_TAG = 'war-table'
/** The floor circle that leads to (and, in the arena, back from) the Pit of Chains. */
export const PIT_GATE_TAG = 'pit-gate'
/** How close to the circle's centre counts as standing on it. */
export const PIT_GATE_REACH = 2.4

/**
 * The training yard's targets by tag: each body's size relative to a hero (the
 * projectile hull and the point an arrow aims for) and what it is made of.
 * Dummies are hero sized; the round targets on the wall are hit at chest height.
 */
export const TRAINING_TARGETS: Record<string, { scale: number; material: 'wood' | 'straw' }> = {
  'dummy-0': { scale: 1, material: 'wood' },
  'dummy-1': { scale: 1, material: 'wood' },
  'dummy-2': { scale: 1, material: 'straw' },
  'dummy-3': { scale: 0.6, material: 'straw' },
  'dummy-4': { scale: 0.6, material: 'straw' }
}

/**
 * Free-standing pieces are easier to place in metres: world x / z to cell
 * coordinates. The hall grid starts at (18, 18): (96 - 12 * 5) / 2.
 */
const ORIGIN = 18
const TILE = 5
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: (wx - ORIGIN) / TILE - 0.5, y: (wz - ORIGIN) / TILE - 0.5 }
}

// World bounds, for reading the numbers below: great hall x 33..58, z 38..63
// (centre 45.5, 50.5); smithy x 23..33 and training yard x 58..68, both
// z 43..58; vestibule x 38..53, z 63..73 with the spawn at (45.5, 68).
// Yaw: a piece's front faces +Z (south) at 0, +X (east) at 90, -X (west) at -90.

/** A 2 m table with a chair at each end, long axis along z. */
function longTable(wx: number, wz: number): Furniture[] {
  return [
    { id: 'table', ...m(wx, wz), yaw: 90 },
    { id: 'chair', ...m(wx - 1.3, wz), yaw: 90 },
    { id: 'chair', ...m(wx + 1.3, wz), yaw: -90 }
  ]
}

const FURNITURE: Furniture[] = [
  // --- great hall ---------------------------------------------------------
  // The Warlord's likeness watches the hall from the north wall, braziers either side.
  { id: 'statue', ...m(45.5, 39.6), yaw: 180 },
  { id: 'brazier', ...m(41.7, 39.6) },
  { id: 'brazier', ...m(49.3, 39.6) },
  { id: 'banner', x: 3, y: 4, side: 'n' },
  { id: 'banner', x: 7, y: 4, side: 'n' },
  // The war table, centre of the hall, lit by two braziers: click it to choose a dungeon.
  { id: 'castle_table', ...m(45.5, 50.5), yaw: 0, tag: WAR_TABLE_TAG },
  { id: 'chair', ...m(44.7, 49.1), yaw: 0 },
  { id: 'chair', ...m(46.3, 49.1), yaw: 0 },
  { id: 'brazier', ...m(42.5, 50.5) },
  { id: 'brazier', ...m(48.5, 50.5) },
  // Two rows of long tables down each side, where a party sits down.
  ...longTable(37, 45.5), ...longTable(37, 47.7),
  ...longTable(37, 54.5), ...longTable(37, 56.7),
  ...longTable(54, 45.5), ...longTable(54, 47.7),
  ...longTable(54, 54.5), ...longTable(54, 56.7),
  // Banners and runes on the long walls, a torch stand in each corner.
  { id: 'banner', x: 3, y: 5, side: 'w' },
  { id: 'banner', x: 3, y: 7, side: 'w' },
  { id: 'banner', x: 7, y: 5, side: 'e' },
  { id: 'banner', x: 7, y: 7, side: 'e' },
  { id: 'rune', x: 3, y: 8, side: 'w' },
  { id: 'rune', x: 7, y: 8, side: 'e' },
  { id: 'torch_stand', ...m(34, 62) },
  { id: 'torch_stand', ...m(57, 62) },
  { id: 'torch_stand', ...m(34, 39) },
  { id: 'torch_stand', ...m(57, 39) },
  // Nothing hangs on south walls: under the crawler camera they drop to parapets.
  { id: 'urn', x: 4, y: 8, side: 's' },
  { id: 'urn', x: 6, y: 8, side: 's' },
  { id: 'chest', x: 3, y: 8, side: 's' },
  { id: 'chest', x: 7, y: 8, side: 's' },

  // --- smithy (west): the anvil the smith will work once he arrives ---------
  { id: 'forge_anvil_tools', ...m(27.5, 50.5), yaw: 90 },
  { id: 'forge_smelting_pot', x: 1, y: 5, side: 'n' },
  { id: 'forge_brazier', x: 2, y: 5, side: 'n' },
  { id: 'castle_weapon_rack', x: 1, y: 6, side: 'w' },
  { id: 'forge_weapon_barrel', x: 1, y: 7, side: 'w' },
  { id: 'forge_weapon_barrel', x: 1.2, y: 7, side: 's' },
  { id: 'forge_table_small', x: 2, y: 7, side: 's' },
  { id: 'forge_shelf', x: 2, y: 5, side: 'e' },
  { id: 'forge_cog_pile', ...m(25, 46) },
  { id: 'rune', x: 1, y: 5, side: 'w' },
  // The summoning circle the smiths cut into the floor: stand on it to descend to the Pit of Chains.
  { id: 'pit_symbol', ...m(28.5, 55), tag: PIT_GATE_TAG },
  { id: 'pit_hell_symbol', x: 2, y: 7, side: 's' },

  // --- training yard (east): dummies to swing at, targets to shoot -----------
  // Three dummies in a row across the north half, room to circle each; two
  // round targets on the east wall for the archers and casters at the door.
  { id: 'castle_armor', ...m(60.5, 47), yaw: 0, tag: 'dummy-0' },
  { id: 'castle_dummy', ...m(63, 47), yaw: 0, tag: 'dummy-1' },
  { id: 'castle_dummy_straw', ...m(65.5, 47), yaw: 0, tag: 'dummy-2' },
  { id: 'castle_target', x: 9, y: 6, side: 'e', tag: 'dummy-3' },
  { id: 'castle_target', x: 9, y: 7, side: 'e', tag: 'dummy-4' },
  { id: 'castle_weapon_rack', x: 8, y: 5, side: 'n' },
  { id: 'castle_weapon_rack', x: 9, y: 5, side: 'n' },
  { id: 'castle_barrel', x: 8, y: 7, side: 's' },
  { id: 'castle_barrel', x: 8.4, y: 7, side: 's' },
  { id: 'castle_banner', x: 8, y: 7, side: 'w' },
  { id: 'urn', x: 8, y: 5, side: 'w' },
  { id: 'castle_hay', x: 9, y: 7, side: 's' },

  // --- vestibule: the door in, lit either side ------------------------------
  { id: 'brazier', x: 4, y: 10, side: 's' },
  { id: 'brazier', x: 6, y: 10, side: 's' },
  { id: 'banner', x: 4, y: 9, side: 'w' },
  { id: 'banner', x: 6, y: 9, side: 'e' },
  { id: 'urn', x: 4, y: 10, side: 'w' },
  { id: 'urn', x: 6, y: 10, side: 'e' }
]

/** The hub as a Dungeon, `torchEvery` as the hall style asks. */
export function hubDungeon(torchEvery = 1): Dungeon {
  return authoredDungeon({
    size: SIZE, seed: 1, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE,
    links: [[0, 1], [1, 2], [1, 3]],
    hung: new Set(['banner', 'castle_banner', 'rune'])
  }, torchEvery)
}

/** Every kit piece the hub places, for the preloader. */
export function hubFurnitureIds(): Furniture['id'][] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}
