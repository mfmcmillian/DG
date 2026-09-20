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

import { Cell, Dungeon, Edge, Furniture, Room, Side } from './generator'

const SIZE = 12

type Rect = { x: number; y: number; w: number; h: number }

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
  const cells: Cell[] = new Array(SIZE * SIZE).fill(0)
  const owner = new Int16Array(SIZE * SIZE).fill(-1)
  const idx = (x: number, y: number) => y * SIZE + x
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE
  const at = (x: number, y: number): Cell => (inb(x, y) ? cells[idx(x, y)] : 0)
  const own = (x: number, y: number) => (inb(x, y) ? owner[idx(x, y)] : -1)

  const rooms: Room[] = ROOMS.map((r, id) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        cells[idx(x, y)] = 1
        owner[idx(x, y)] = id
      }
    }
    return { id, x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind, depth: id === 0 ? 0 : 1, enemies: [], props: [], traps: [] }
  })

  const doorway = new Set(DOORWAYS.flatMap(([[ax, ay], [bx, by]]) => [`${ax},${ay}>${bx},${by}`, `${bx},${by}>${ax},${ay}`]))

  // Walls stand between floor and rock and between two rooms, except where a
  // doorway is named; each edge is visited once, from the cell that owns it.
  const walls: Edge[] = []
  const doors: Edge[] = []
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (at(x, y) === 0) continue
      const n: Array<[Side, number, number]> = [['n', x, y - 1], ['s', x, y + 1], ['w', x - 1, y], ['e', x + 1, y]]
      for (const [side, nx, ny] of n) {
        if (at(nx, ny) === 0) {
          walls.push({ x, y, side })
          continue
        }
        if (own(nx, ny) === own(x, y)) continue
        // The edge between two rooms is built once, from the north / west cell:
        // as that cell's south wall it faces the crawler camera and drops to a
        // parapet, so the camera sees over it into the hall.
        if (side === 'n' || side === 'w') continue
        if (doorway.has(`${x},${y}>${nx},${ny}`)) doors.push({ x, y, side })
        else walls.push({ x, y, side })
      }
    }
  }

  // Pillars on every corner of the floor plan, as the generator places them.
  const pillars: Array<[number, number]> = []
  for (let vy = 0; vy <= SIZE; vy++) {
    for (let vx = 0; vx <= SIZE; vx++) {
      const a = at(vx - 1, vy - 1) !== 0
      const b = at(vx, vy - 1) !== 0
      const c = at(vx - 1, vy) !== 0
      const d = at(vx, vy) !== 0
      const count = [a, b, c, d].filter(Boolean).length
      if (count === 1 || count === 3 || (count === 2 && ((a && d) || (b && c)))) pillars.push([vx, vy])
    }
  }
  // Wall-hung pieces take the torch's place on their edge; a torch next to a banner is a fire hazard.
  const hung = new Set(FURNITURE.filter((f) => f.side && (f.id === 'banner' || f.id === 'castle_banner' || f.id === 'rune')).map((f) => `${f.x},${f.y},${f.side}`))
  const torches = walls.filter((w, i) => i % torchEvery === 0 && !hung.has(`${w.x},${w.y},${w.side}`))

  const entrance = rooms[0]
  const boss = rooms[1]
  return {
    seed: 1, size: SIZE, cells, rooms,
    links: [[0, 1], [1, 2], [1, 3]],
    walls, doors, torches, pillars, arches: [],
    entrance, boss,
    furniture: FURNITURE
  }
}

/** Every kit piece the hub places, for the preloader. */
export function hubFurnitureIds(): Furniture['id'][] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}
