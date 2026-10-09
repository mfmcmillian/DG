// The Skyhold: the Warlord's eyrie, drawn by hand in the gauntlet's terms
// (platforms sealed until cleared, enemies in waves, a warden, the Warlord at
// the keep gate). The Dark Fortress's own kit, but there are no walls: every
// edge is a 2 m parapet over a drop, the platforms are blocks of rock in the
// sky, and bridges (one-cell-wide corridors with their own rock under them)
// span the gaps between. Synty's Dark Fortress demo lends the backdrop
// (src/backdrop.ts ISLE_LAYOUT): the gatehouse and towers behind the boss
// platform, ruined spires on the far rocks, cliffs under the edges, the cloud
// ring and the mountain range below.
//
// Plan (32 x 32 cells of 5 m on the 160 m plot, cells 1..30 in use; north is
// -Z, the crawler camera looks north; the party spawns at the bottom and goes
// north over the first bridge into the Lower Ward, west over the second into
// the Prison Yard, north along the Rampart to the Upper Court, and east over
// the last bridge to the Keep Gate):
//
//        x  0  2  4  6  8 10 12 14 16 18 20 22 24 26 28 30
//   y  8          U  U  U  U  b  b  K  K  K  K              U the Upper Court (combat), 40 x 25 m; K the Keep Gate (boss), 40 x 25 m
//     12          U  U  U  U        K  K  K  K
//     13                R  R                                 R the Rampart (quiet), 10 x 30 m
//     18                R  R
//     19             P  P  P                                 P the Prison Yard (warden), 30 x 30 m
//     20             P  P  P     L  L  L  L                  L the Lower Ward (combat), 40 x 25 m
//     22             P  P  P  b  L  L  L  L                  b bridges, 5 m wide
//     24             P  P  P     L  L  L  L
//     25                               b
//     27                            E  E                     E the entrance: the landing, 15 x 15 m
//     29                            E  E
//
// The grid starts at (0, 0): cell (x, y) covers metres x*5..x*5+5.

import { authoredDungeon, Rect } from './authored'
import { Dungeon, Furniture, Room } from './generator'
import { KitId } from './kit'
import { Stage } from './stages'

const SIZE = 32

const E: Rect = { x: 20, y: 27, w: 3, h: 3 }
const K: Rect = { x: 17, y: 8, w: 8, h: 5 }
const B1: Rect = { x: 21, y: 25, w: 1, h: 2 }
const L: Rect = { x: 17, y: 20, w: 8, h: 5 }
const B2: Rect = { x: 14, y: 22, w: 3, h: 1 }
const P: Rect = { x: 8, y: 19, w: 6, h: 6 }
const R: Rect = { x: 9, y: 13, w: 2, h: 6 }
const U: Rect = { x: 6, y: 8, w: 8, h: 5 }
const B3: Rect = { x: 14, y: 10, w: 3, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...K, kind: 'boss' },
  { ...B1, kind: 'quiet' },
  { ...L, kind: 'combat' },
  { ...B2, kind: 'quiet' },
  { ...P, kind: 'treasure' },
  { ...R, kind: 'quiet' },
  { ...U, kind: 'combat' },
  { ...B3, kind: 'quiet' }
]

/** Every platform and bridge, in metres, for the backdrop's cliffs. */
export const ISLE_ROOM_BOXES = ROOMS.map((r) => ({ x: r.x * 5, z: r.y * 5, w: r.w * 5, d: r.h * 5 }))

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[21, 27], [21, 26]], [[21, 25], [21, 24]],   // landing -> first bridge -> the Lower Ward
  [[17, 22], [16, 22]], [[14, 22], [13, 22]],   // Lower Ward -> second bridge -> the Prison Yard
  [[9, 19], [9, 18]],                           // Prison Yard -> the Rampart
  [[9, 13], [9, 12]],                           // Rampart -> the Upper Court
  [[13, 10], [14, 10]], [[16, 10], [17, 10]]    // Upper Court -> last bridge -> the Keep Gate
]

const LINKS: Array<[number, number]> = [
  [0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 1]
]

/**
 * The fights, in order. Room indices are into ROOMS above; the roster is the
 * Dark Fortress's (src/dungeon/rosters.ts FORTRESS), the Warlord at the gate.
 */
export const ISLE_STAGES: Stage[] = [
  { room: 3, rect: L, kind: 'combat', name: 'The Lower Ward', entry: 's', gate: [[17, 22], [16, 22]],
    waves: [['scout', 'scout', 'striker'], ['striker', 'striker', 'scout'], ['guard', 'scout', 'scout', 'striker']] },
  { room: 5, rect: P, kind: 'warden', name: 'The Prison Yard', entry: 'e', gate: [[9, 19], [9, 18]],
    waves: [['guard', 'scout', 'scout'], ['warden', 'striker']] },
  { room: 7, rect: U, kind: 'combat', name: 'The Upper Court', entry: 's', gate: [[13, 10], [14, 10]],
    waves: [['striker', 'striker', 'scout', 'scout'], ['guard', 'striker', 'scout'], ['guard', 'guard', 'striker', 'scout']] },
  { room: 1, rect: K, kind: 'boss', name: 'The Keep Gate', entry: 'w',
    waves: [['boss'], ['guard', 'striker', 'scout', 'scout']] }
]

/** Set while the look is being judged: no enemies, no gates, every platform open. Turn off before shipping. */
export const ISLE_OPEN_FOR_TESTING = true

const TILE = 5
/** World metres to a cell position (cells are TILE m; a cell's centre is x + 0.5). */
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: wx / TILE - 0.5, y: wz / TILE - 0.5 }
}

const FURNITURE: Furniture[] = [
  // --- the landing (x 100..115, z 135..150): the party arrives between two watch statues --------
  { id: 'statue', ...m(102, 137.5), yaw: 180 },
  { id: 'statue', ...m(113, 137.5), yaw: 180 },
  { id: 'brazier', ...m(102.5, 147.5) },
  { id: 'brazier', ...m(112.5, 147.5) },
  { id: 'rubble', ...m(112, 142), yaw: 40, collide: false },
  { id: 'banner', ...m(107.5, 149.3), yaw: 0 },
  // --- the Lower Ward (x 85..125, z 100..125): a mustering yard around a great pillar --------------
  { id: 'pillar_l', ...m(105, 112.5) },
  { id: 'brazier', ...m(87.5, 102.5) },
  { id: 'brazier', ...m(122.5, 102.5) },
  { id: 'brazier', ...m(87.5, 122.5) },
  { id: 'brazier', ...m(122.5, 122.5) },
  { id: 'cage', ...m(90, 112), yaw: 90 },
  { id: 'cage', ...m(120, 112), yaw: 270 },
  { id: 'bones', ...m(95, 105), yaw: 20, collide: false },
  { id: 'skulls', ...m(116, 121), yaw: 200, collide: false },
  { id: 'rubble', ...m(99, 121), yaw: 70, collide: false },
  { id: 'banner', ...m(95, 100.7), yaw: 0 },
  { id: 'banner', ...m(115, 100.7), yaw: 0 },
  // --- the Prison Yard (x 40..70, z 95..125): cages and what was left in them -----------------------
  { id: 'cage', ...m(43, 98) },
  { id: 'cage', ...m(67, 98), yaw: 180 },
  { id: 'cage', ...m(43, 122), yaw: 90 },
  { id: 'cage', ...m(67, 122), yaw: 270 },
  { id: 'cage', ...m(55, 110), yaw: 45 },
  { id: 'bones', ...m(48, 105), yaw: 120, collide: false },
  { id: 'skulls', ...m(62, 116), yaw: 300, collide: false },
  { id: 'bones', ...m(61, 103), yaw: 250, collide: false },
  { id: 'brazier', ...m(55, 97.5) },
  { id: 'brazier', ...m(55, 122.5) },
  { id: 'urn', ...m(42, 110), collide: false },
  // --- the Rampart (x 45..55, z 65..95) --------------------------------------------------------------
  { id: 'skulls', ...m(53, 70), yaw: 10, collide: false },
  { id: 'rubble', ...m(47, 90), yaw: 160, collide: false },
  { id: 'banner', ...m(50, 65.7), yaw: 0 },
  // --- the Upper Court (x 30..70, z 40..65): the Warlord's own court, a statue of him at its head --
  { id: 'statue', ...m(50, 42.5), yaw: 0 },
  { id: 'brazier', ...m(32.5, 42.5) },
  { id: 'brazier', ...m(67.5, 42.5) },
  { id: 'brazier', ...m(32.5, 62.5) },
  { id: 'brazier', ...m(67.5, 62.5) },
  { id: 'cage', ...m(33, 52), yaw: 90 },
  { id: 'cage', ...m(67, 52), yaw: 270 },
  { id: 'crystal', ...m(42, 44), collide: false },
  { id: 'crystal', ...m(58, 44), collide: false },
  { id: 'urn', ...m(36, 60), collide: false },
  { id: 'rubble', ...m(63, 58), yaw: 220, collide: false },
  { id: 'banner', ...m(40, 40.7), yaw: 0 },
  { id: 'banner', ...m(60, 40.7), yaw: 0 },
  // --- the Keep Gate (x 85..125, z 40..65): before the gatehouse ----------------------------------
  { id: 'statue', ...m(95, 42.5), yaw: 0 },
  { id: 'statue', ...m(115, 42.5), yaw: 0 },
  { id: 'brazier', ...m(87.5, 42.5) },
  { id: 'brazier', ...m(122.5, 42.5) },
  { id: 'brazier', ...m(87.5, 62.5) },
  { id: 'brazier', ...m(122.5, 62.5) },
  { id: 'crystal', ...m(88, 52), collide: false },
  { id: 'crystal', ...m(122, 52), collide: false },
  { id: 'bones', ...m(100, 60), yaw: 80, collide: false },
  { id: 'skulls', ...m(112, 47), yaw: 330, collide: false },
  { id: 'banner', ...m(100, 40.7), yaw: 0 },
  { id: 'banner', ...m(110, 40.7), yaw: 0 }
]

export function isleDungeon(torchEvery = 1): Dungeon {
  return authoredDungeon({ size: SIZE, seed: 7077, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE, links: LINKS, hung: new Set() }, torchEvery)
}

/** Kit ids the Skyhold's furniture uses, for the preloader. */
export function isleFurnitureIds(): KitId[] {
  return [...new Set(FURNITURE.map((f) => f.id as KitId))]
}
