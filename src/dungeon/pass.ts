// The Frozen Pass: a Viking-held gorge through the Alpine mountains, drawn by
// hand in the gauntlet's terms (rooms sealed until cleared, enemies in waves,
// two wardens, the Jarl in his camp at the top). Open air: 7 m cliff modules
// for walls, rock arches for doorways, snow underfoot, peaks all round
// (src/backdrop.ts). The same every run, so it can be learned.
//
// Plan (16 x 16 cells of 10 m on the 160 m plot, cells 1..14 in use so every
// piece stays inside the parcels; north is -Z, the crawler camera looks north;
// the party spawns at the bottom and climbs):
//
//        x  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   y  1    .  J  J  J  J  .  .  .  .  .  .  .  .  .  .  .     J the Jarl's camp, 40 x 60 m
//      2    .  J  J  J  J  .  .  .  .  .  .  .  .  .  .  .
//      3    .  J  J  J  J  4  4  4  c  L  L  L  L  L  .  .     4 the Bone Field    L the Frozen Lake, 50 x 40 m
//      4    .  J  J  J  J  4  4  4  c  L  L  L  L  L  .  .
//      5    .  J  J  J  J  4  4  4  .  L  L  L  L  L  .  .
//      6    .  J  J  J  J  .  c  .  .  L  L  L  L  L  .  .
//      7    .  .  c  .  .  .  c  .  .  .  .  .  c  .  .  .
//      8    .  .  5  5  5  5  5  .  .  .  .  .  c  .  .  .     5 the Huskarl's Watch (warden)
//      9    .  .  5  5  5  5  5  .  .  .  .  2  2  2  .  .     2 the Shield Wall (warden)
//     10    .  .  .  .  .  1  1  1  1  c  c  2  2  2  .  .     1 the Narrows
//     11    .  .  .  .  .  1  1  1  1  .  .  2  2  2  .  .
//     12    .  .  .  .  .  .  .  c  .  .  .  .  .  .  .  .
//     13    .  .  .  .  .  .  .  E  E  .  .  .  .  .  .  .     E the entrance: the spawn
//     14    .  .  .  .  .  .  .  E  E  .  .  .  .  .  .  .
//
// The grid starts at (0, 0): cell (x, y) covers metres x*10..x*10+10.

import { authoredDungeon, Rect } from './authored'
import { KitId } from './kit'
import { Dungeon, Furniture, Room } from './generator'
import { propsFor, Stage } from './stages'

const SIZE = 16
const TILE = 10

const E: Rect = { x: 7, y: 13, w: 2, h: 2 }
const C0: Rect = { x: 7, y: 12, w: 1, h: 1 }
const J: Rect = { x: 1, y: 1, w: 4, h: 6 }
const R1: Rect = { x: 5, y: 10, w: 4, h: 2 }
const C1: Rect = { x: 9, y: 10, w: 2, h: 1 }
const R2: Rect = { x: 11, y: 9, w: 3, h: 3 }
const C2: Rect = { x: 12, y: 7, w: 1, h: 2 }
const L: Rect = { x: 9, y: 3, w: 5, h: 4 }
const C3: Rect = { x: 8, y: 3, w: 1, h: 2 }
const R4: Rect = { x: 5, y: 3, w: 3, h: 3 }
const C4: Rect = { x: 6, y: 6, w: 1, h: 2 }
const R5: Rect = { x: 2, y: 8, w: 5, h: 2 }
const C5: Rect = { x: 3, y: 7, w: 1, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...J, kind: 'boss' },
  { ...C0, kind: 'quiet' },
  { ...R1, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...R2, kind: 'treasure' }, { ...C2, kind: 'quiet' },
  { ...L, kind: 'combat' }, { ...C3, kind: 'quiet' },
  { ...R4, kind: 'combat' }, { ...C4, kind: 'quiet' },
  { ...R5, kind: 'treasure' }, { ...C5, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[7, 13], [7, 12]], [[7, 12], [7, 11]],       // entrance -> gorge -> the Narrows
  [[8, 10], [9, 10]], [[10, 10], [11, 10]],     // Narrows -> gorge -> the Shield Wall
  [[12, 9], [12, 8]], [[12, 7], [12, 6]],       // Shield Wall -> gorge -> the Frozen Lake
  [[9, 4], [8, 4]], [[8, 4], [7, 4]],           // lake -> gorge -> the Bone Field
  [[6, 5], [6, 6]], [[6, 7], [6, 8]],           // Bone Field -> gorge -> the Huskarl's Watch
  [[3, 8], [3, 7]], [[3, 7], [3, 6]]            // watch -> gorge -> the Jarl's camp
]

const LINKS: Array<[number, number]> = [
  [0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 1]
]

/** The fights, in order. Room indices are into ROOMS above. */
export const PASS_STAGES: Stage[] = [
  { room: 3, rect: R1, kind: 'combat', name: 'The Narrows', entry: 's', gate: [[8, 10], [9, 10]],
    waves: [['scout', 'striker'], ['striker', 'scout', 'scout']] },
  { room: 5, rect: R2, kind: 'warden', name: 'The Shield-Bearer', entry: 'w', gate: [[12, 9], [12, 8]],
    waves: [['warden']] },
  { room: 7, rect: L, kind: 'combat', name: 'The Frozen Lake', entry: 's', gate: [[9, 4], [8, 4]],
    waves: [['striker', 'striker', 'scout'], ['scout', 'scout', 'striker', 'striker'], ['guard', 'striker', 'scout']] },
  { room: 9, rect: R4, kind: 'combat', name: 'The Bone Field', entry: 'e', gate: [[6, 5], [6, 6]],
    waves: [['scout', 'scout', 'striker'], ['guard', 'guard', 'scout']] },
  { room: 11, rect: R5, kind: 'warden', name: 'The Old Huskarl', entry: 'n', gate: [[3, 8], [3, 7]],
    waves: [['warden']] },
  { room: 1, rect: J, kind: 'boss', name: 'The Jarl', entry: 's',
    waves: [['boss', 'guard', 'guard']] }
]

/** Grid cell (fractional) under a point in metres. */
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: wx / TILE - 0.5, y: wz / TILE - 0.5 }
}

const FURNITURE: Furniture[] = [
  // --- the entrance: the party's own fire, packs dropped by it -------------------
  { id: 'pass_campfire', ...m(74, 146) },
  { id: 'vik_fur_roll', ...m(71.5, 143.5), yaw: 30, collide: false },
  { id: 'vik_fur_roll', ...m(77, 148), yaw: -70, collide: false },
  { id: 'pass_woodpile', ...m(86, 147), yaw: 20 },

  // --- the Frozen Lake: ice floes, a glacier tongue, a longship the ice took ------
  { id: 'vik_glacier_a', ...m(134, 65), yaw: 200 },
  { id: 'vik_glacier_b', ...m(95, 64), yaw: 120 },
  { id: 'vik_glacier_c', ...m(137, 34), yaw: -60 },
  { id: 'vik_glacier_c', ...m(93, 33), yaw: 40 },
  { id: 'vik_ice_a', ...m(108, 52), yaw: 15, collide: false },
  { id: 'vik_ice_a', ...m(122, 44), yaw: 80, collide: false },
  { id: 'vik_ice_a', ...m(116, 63), yaw: -40, collide: false },
  { id: 'vik_ice_b', ...m(101, 58), yaw: 0, collide: false },
  { id: 'vik_ice_b', ...m(128, 56), yaw: 140, collide: false },
  { id: 'vik_ice_b', ...m(112, 36), yaw: 60, collide: false },
  { id: 'vik_boat', ...m(126, 60), yaw: 35 },
  { id: 'vik_boat_head', ...m(133, 57), yaw: 35 },
  { id: 'vik_dock', ...m(92.5, 52), yaw: 90 },

  // --- the Bone Field: what the wolves and the winter left ------------------------
  { id: 'vik_cow_skull', ...m(56, 36), yaw: 40, collide: false },
  { id: 'vik_cow_skull', ...m(72, 54), yaw: -100, collide: false },
  { id: 'vik_cow_skull', ...m(66, 45), yaw: 170, collide: false },
  { id: 'vik_skull_pole', ...m(53, 55), yaw: 10 },
  { id: 'vik_skull_pole', ...m(77, 34), yaw: -30 },
  { id: 'pass_pine_dead', ...m(54, 33), yaw: 70 },
  { id: 'pass_pine_dead', ...m(76, 57), yaw: 200 },

  // --- the Shield Wall: stakes flank the way in, the clan's flags on the far side --
  { id: 'vik_spikes_b', ...m(116, 94), yaw: 20 },
  { id: 'vik_spikes_b', ...m(116, 116), yaw: -20 },
  { id: 'vik_flag', ...m(136, 95), yaw: -90 },
  { id: 'vik_flag_b', ...m(136, 115), yaw: -90 },

  // --- the Huskarl's Watch: a fire kept, fish drying, weapons racked --------------
  { id: 'vik_fire_ring', ...m(30, 92) },
  { id: 'pass_fishrack', ...m(24, 84), yaw: 10 },
  { id: 'vik_rack', ...m(64, 97), yaw: 180 },
  { id: 'vik_seat', ...m(27, 96), yaw: -30 },

  // --- the Jarl's camp: the watchtower, the fires, the stone their fathers raised --
  { id: 'vik_tower', ...m(17, 20), yaw: 0 },
  { id: 'vik_statue', ...m(30, 14), yaw: 0 },
  { id: 'vik_flag', ...m(22, 14), yaw: 0 },
  { id: 'vik_flag_b', ...m(38, 14), yaw: 0 },
  { id: 'vik_fire_ring', ...m(22, 44) },
  { id: 'vik_fire_ring', ...m(41, 52) },
  { id: 'vik_table', ...m(43, 26), yaw: 90 },
  { id: 'vik_bench', ...m(43, 23.8), yaw: 0 },
  { id: 'vik_bench', ...m(43, 28.2), yaw: 180 },
  { id: 'vik_barrel', ...m(46, 20), yaw: 0 },
  { id: 'vik_barrel', ...m(47.5, 21.5), yaw: 40 },
  { id: 'vik_crate', ...m(45.5, 17.5), yaw: 15 },
  { id: 'vik_fur_roll', ...m(18, 40), yaw: 60, collide: false },
  { id: 'vik_fur_roll', ...m(24, 30), yaw: -20, collide: false },
  { id: 'vik_wagon', ...m(15, 58), yaw: 70 },
  { id: 'vik_totem', ...m(24, 62), yaw: 0 },
  { id: 'vik_spikes_b', ...m(14, 64), yaw: 30 },
  { id: 'vik_spikes_b', ...m(46, 64), yaw: -30 },
  { id: 'vik_anvil', ...m(45, 40), yaw: 0 },
  { id: 'vik_logs', ...m(47, 44), yaw: 20 }
]

export function passDungeon(torchEvery = 1): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 2026, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE, links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 8 : 5, DOORWAYS)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by PASS_STAGES.
    const stage = PASS_STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}

/** Every kit piece the pass's furniture places (for the preload plan). */
export function passFurnitureIds(): KitId[] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}
