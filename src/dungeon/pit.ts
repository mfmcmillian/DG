// The Pit of Chains: the raid arena, drawn by hand like the hall. One 60 m
// ring of cracked dwarven stone under the forge, the Chained Colossus on a
// ritual disc in the middle, lava seeping in at the corners, the bones of
// something larger still half buried along the walls. A two-cell gate room
// to the south holds the spawn and the circle back to the hall.
//
// Plan (14 x 14 cells of 5 m; north is -Z, the crawler camera looks north):
//
//        x  0 1 2 3 4 5 6 7 8 9 10 11 12 13
//   y  0    . A A A A A A A A A A  A  A  .     A arena, the Colossus on cells 6..7 x 5..6
//     ...   . A A A A A A A A A A  A  A  .
//     11    . A A A A A A A A A A  A  A  .
//     12    . . . . . . G G . . .  .  .  .     G gate: spawn and the circle home
//     13    . . . . . . G G . . .  .  .  .
//
// The grid starts at (13, 13): (96 - 14 * 5) / 2. Arena x 18..78, z 13..73,
// centre (48, 43); gate x 43..53, z 73..83 with the spawn at (48, 78).

import { authoredDungeon, Rect } from './authored'
import { Dungeon, Furniture, Room } from './generator'
import { PIT_GATE_TAG } from './hub'

const SIZE = 14
const ORIGIN = 13
const TILE = 5

/** Where the Colossus stands, and how far its stone disc reaches. */
export const PIT_CENTER = { x: 48, z: 43 }
export const PIT_DISC_RADIUS = 7.6
/** Floor the fight happens on (inside the walls). */
export const PIT_ARENA = { minX: 18, maxX: 78, minZ: 13, maxZ: 73 }
/** Where the gate circle stands: revive point, way home. */
export const PIT_GATE = { x: 48, z: 80 }

const ARENA: Rect = { x: 1, y: 0, w: 12, h: 12 }
const GATE: Rect = { x: 6, y: 12, w: 2, h: 2 }

const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...GATE, kind: 'entrance' },
  { ...ARENA, kind: 'boss' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[6, 11], [6, 12]],
  [[7, 11], [7, 12]]
]

function m(wx: number, wz: number): { x: number; y: number } {
  return { x: (wx - ORIGIN) / TILE - 0.5, y: (wz - ORIGIN) / TILE - 0.5 }
}

/** A point on the ring around the Colossus: `angle` in degrees from north (-Z), clockwise seen from above. */
function ring(radius: number, angle: number, wz = PIT_CENTER.z, wx = PIT_CENTER.x): { x: number; y: number } {
  const a = (angle * Math.PI) / 180
  return m(wx + Math.sin(a) * radius, wz - Math.cos(a) * radius)
}

/** A 2 x 2 patch of lava planes, `wx`/`wz` its centre. */
function lavaPool(wx: number, wz: number): Furniture[] {
  return [
    { id: 'pit_lava_plane', ...m(wx - 2.5, wz - 2.5), lift: 0.04 },
    { id: 'pit_lava_plane', ...m(wx + 2.5, wz - 2.5), lift: 0.04 },
    { id: 'pit_lava_plane', ...m(wx - 2.5, wz + 2.5), lift: 0.04 },
    { id: 'pit_lava_plane', ...m(wx + 2.5, wz + 2.5), lift: 0.04 }
  ]
}

const FURNITURE: Furniture[] = [
  // --- the disc, the braziers that ring it ------------------------------------
  { id: 'pit_circle', ...m(PIT_CENTER.x, PIT_CENTER.z), lift: 0.05 },
  ...[22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a): Furniture => ({ id: 'pit_brazier', ...ring(12.5, a), yaw: a + 180 })),

  // --- the four corners: lava, and the pillars that hold the roof of the world up --
  ...lavaPool(23, 18), ...lavaPool(73, 18), ...lavaPool(23, 68), ...lavaPool(73, 68),
  { id: 'pit_pillar_a', ...m(21.5, 17), yaw: 45 },
  { id: 'pit_pillar_a', ...m(74.5, 17), yaw: -45 },
  { id: 'pit_pillar_a', ...m(21.5, 69), yaw: 135 },
  { id: 'pit_pillar_a', ...m(74.5, 69), yaw: -135 },
  { id: 'pit_crystals', ...m(26, 22), yaw: 20 },
  { id: 'pit_crystals', ...m(71, 65), yaw: 200 },
  { id: 'pit_spikes_b', ...m(70, 22), yaw: -30 },
  { id: 'pit_spikes_b', ...m(26, 64), yaw: 140 },

  // --- the north wall: the rib of something dead, lava running down the stone --
  { id: 'pit_rib', ...m(48, 15.5), yaw: 0, collide: false },
  { id: 'pit_obelisk_b', ...m(33, 17.5), yaw: 20 },
  { id: 'pit_obelisk_b', ...m(63, 17.5), yaw: -20 },
  { id: 'pit_lava_flow', x: 4, y: 0, side: 'n' },
  { id: 'pit_lava_flow', x: 9, y: 0, side: 'n' },
  { id: 'pit_hell_symbol', x: 6, y: 0, side: 'n' },
  { id: 'pit_hell_symbol', x: 7, y: 0, side: 'n' },

  // --- east and west: obelisks on the axis, ruined arches, lava in the walls -----
  { id: 'pit_obelisk_a', ...m(21.5, 43), yaw: 90 },
  { id: 'pit_obelisk_a', ...m(74.5, 43), yaw: -90 },
  { id: 'pit_ruin_arch', ...m(20.5, 31), yaw: 90 },
  { id: 'pit_ruin_arch', ...m(20.5, 55), yaw: 90 },
  { id: 'pit_ruin_arch', ...m(75.5, 31), yaw: -90 },
  { id: 'pit_ruin_arch', ...m(75.5, 55), yaw: -90 },
  { id: 'pit_lava_line', x: 1, y: 3, side: 'w' },
  { id: 'pit_lava_line', x: 1, y: 8, side: 'w' },
  { id: 'pit_lava_line', x: 12, y: 3, side: 'e' },
  { id: 'pit_lava_line', x: 12, y: 8, side: 'e' },
  { id: 'pit_hell_symbol', x: 1, y: 5, side: 'w' },
  { id: 'pit_hell_symbol', x: 12, y: 6, side: 'e' },

  // --- the south: bones half out of the floor either side of the gate ------------
  { id: 'pit_bone_hand_l', ...m(31, 61), yaw: 35 },
  { id: 'pit_bone_hand_r', ...m(66, 62), yaw: -50 },
  { id: 'pit_skull_huge', ...m(38.5, 68.5), yaw: 150 },
  { id: 'pit_ruin_pillar', ...m(41.5, 71), yaw: 0 },
  { id: 'pit_ruin_pillar_broken', ...m(54.5, 71), yaw: 0 },
  { id: 'pit_statue_broken', ...m(57.5, 69.5), yaw: -140 },

  // --- rubble across the ring, nothing a hero trips on ---------------------------
  { id: 'pit_rubble_slab', ...ring(17, 40), yaw: 30 },
  { id: 'pit_rubble_rocks', ...ring(19, 95), yaw: 0 },
  { id: 'pit_rubble_slab', ...ring(18, 150), yaw: 80 },
  { id: 'pit_rubble_rocks', ...ring(16.5, 215), yaw: 45 },
  { id: 'pit_rubble_slab', ...ring(19, 265), yaw: 120 },
  { id: 'pit_rubble_rocks', ...ring(17.5, 320), yaw: 10 },
  { id: 'pit_rubble_pillar', ...ring(21, 120), yaw: 60 },
  { id: 'pit_rubble_pillar', ...ring(21, 300), yaw: -30 },
  { id: 'pit_rock_b', ...ring(23, 60), yaw: 0 },
  { id: 'pit_rock_b', ...ring(23, 240), yaw: 90 },
  { id: 'pit_rock_a', ...ring(20, 10), yaw: 0 },
  { id: 'pit_rock_a', ...ring(20, 190), yaw: 0 },

  // --- the gate: the circle home between two braziers ------------------------------
  { id: 'pit_symbol', ...m(PIT_GATE.x, PIT_GATE.z), lift: 0.03, tag: PIT_GATE_TAG },
  { id: 'pit_brazier_b', ...m(44.2, 81), yaw: 90 },
  { id: 'pit_brazier_b', ...m(51.8, 81), yaw: -90 },
  { id: 'pit_hell_symbol', x: 6, y: 13, side: 's' },
  { id: 'pit_hell_symbol', x: 7, y: 13, side: 's' }
]

/** The arena as a Dungeon, `torchEvery` as the pit style asks. */
export function pitDungeon(torchEvery = 2): Dungeon {
  return authoredDungeon({
    size: SIZE, seed: 2, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE,
    links: [[0, 1]],
    hung: new Set(['pit_hell_symbol', 'pit_lava_flow', 'pit_lava_line'])
  }, torchEvery)
}

/** Every kit piece the arena places, for the preloader. */
export function pitFurnitureIds(): Furniture['id'][] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}

/** Inside the arena's walls, a step in from them. */
export function inPitArena(x: number, z: number, margin = 0.6): boolean {
  return x > PIT_ARENA.minX + margin && x < PIT_ARENA.maxX - margin && z > PIT_ARENA.minZ + margin && z < PIT_ARENA.maxZ - margin
}
