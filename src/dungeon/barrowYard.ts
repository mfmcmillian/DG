// The Barrow Yard: Gravewatch's graveyard under the hill, drawn by hand in the
// gauntlet's terms with the Crypt's kit (src/dungeon/config.ts `yard`). One
// map, two jobs. For the daily Rounds it is a four-minute, two-stage run: the
// dead claw out of the graves at the Lychgate, then the Barrow Warden holds
// the barrow with two witches raising. On Saturday nights it is the Rising's
// arena: no gates, the whole server in one party, and the Demon rising out
// of the ritual circle in the middle of the barrow (src/raid/risingServer.ts).
// Open to the night like the Crypt's own graveyard; the same every run.
//
// Plan (16 x 16 cells of 10 m on the 160 m plot; north is -Z; the party spawns
// at the bottom right outside the gate, goes west through the Lychgate and
// north up the stair into the Barrow):
//
//        x  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   y  7    .  .  .  .  .  B  B  B  B  B  B  B  .  .  .  .     B the Barrow, 70 x 40 m (the Rising's arena)
//      8    .  .  .  .  .  B  B  B  B  B  B  B  .  .  .  .
//      9    .  .  .  .  .  B  B  B  B  B  B  B  .  .  .  .
//     10    .  .  .  .  .  B  B  B  B  B  B  B  .  .  .  .
//     11    .  .  .  .  .  .  .  .  c  .  .  .  .  .  .  .
//     12    .  .  .  .  .  .  .  L  L  L  L  .  .  .  .  .     L the Lychgate (the graveyard), 40 x 30 m
//     13    .  .  .  .  .  .  .  L  L  L  L  c  E  E  .  .     E the entrance: the spawn, outside the gate
//     14    .  .  .  .  .  .  .  L  L  L  L  .  E  E  .  .
//
// The grid starts at (0, 0): cell (x, y) covers metres x*10..x*10+10.

import { authoredDungeon, Rect } from './authored'
import { KitId } from './kit'
import { Dungeon, Furniture, Room } from './generator'
import { propsFor, Stage, WaveUnit } from './stages'

const SIZE = 16
const TILE = 10

const E: Rect = { x: 12, y: 13, w: 2, h: 2 }
const B: Rect = { x: 5, y: 7, w: 7, h: 4 }
const L: Rect = { x: 7, y: 12, w: 4, h: 3 }
const C1: Rect = { x: 11, y: 13, w: 1, h: 1 }
const C2: Rect = { x: 8, y: 11, w: 1, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...B, kind: 'boss' },
  { ...L, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...C2, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[12, 13], [11, 13]], [[11, 13], [10, 13]],   // entrance -> the gate path -> the Lychgate
  [[8, 12], [8, 11]], [[8, 11], [8, 10]]        // Lychgate -> the stair -> the Barrow
]

const LINKS: Array<[number, number]> = [
  [0, 3], [3, 2], [2, 4], [4, 1]
]

/** The ritual circle in the middle of the barrow, in world metres: the Demon rises here; the witches' dead too. */
export const YARD_CIRCLE = { x: 85, z: 90 }

/**
 * The Rounds, in order. The Lychgate's two waves are skeletons out of the
 * graves; the Barrow's "boss" is the roster's Barrow Warden (src/dungeon/rosters.ts
 * YARD), who calls his second wave as his health falls (dungeonEnemies tickGong).
 */
export const YARD_STAGES: Stage[] = [
  { room: 2, rect: L, kind: 'combat', name: 'The Lychgate', entry: 'e', gate: [[8, 12], [8, 11]],
    waves: [['scout', 'scout', 'scout', 'striker', 'scout'], ['striker', 'scout', 'archer', 'scout', 'archer', 'striker'], ['guard', 'archer', 'striker', 'scout', 'scout', 'archer']] },
  { room: 1, rect: B, kind: 'boss', name: 'The Barrow', entry: 's',
    waves: [['boss', 'shaman', 'shaman', 'guard', 'guard'], ['scout', 'scout', 'striker', 'archer', 'scout', 'striker'], ['guard', 'shaman', 'striker', 'archer', 'scout', 'scout']] }
]

/**
 * The Rising: one stage over the whole barrow, no gate, the Demon at the
 * circle and three waves of the dead he raises as he is worn down, each sized
 * to the crowd (src/shared/gravewatch.ts risingAddsPerRaise).
 */
export function risingStages(addsPerRaise: number): Stage[] {
  const adds = (salt: number): WaveUnit[] => {
    const out: WaveUnit[] = []
    for (let i = 0; i < addsPerRaise; i++) out.push((i + salt) % 3 === 0 ? 'striker' : (i + salt) % 3 === 1 ? 'scout' : 'archer')
    return out
  }
  return [{
    room: 1, rect: B, kind: 'boss', name: 'The Rising', entry: 's',
    bossAt: [YARD_CIRCLE.x / TILE - 0.5, YARD_CIRCLE.z / TILE - 0.5],
    waves: [['boss'], adds(0), adds(1), adds(2)]
  }]
}

/** Grid cell (fractional) under a point in metres. */
function m(wx: number, wz: number): { x: number; y: number } {
  return { x: wx / TILE - 0.5, y: wz / TILE - 0.5 }
}

const FURNITURE: Furniture[] = [
  // --- the entrance: outside the gate, the sexton's corner -------------------------------
  { id: 'crypt_graves_c', ...m(131, 141), yaw: 0 },
  { id: 'crypt_tree_b', ...m(123, 147.5), yaw: 30 },
  { id: 'crypt_wagon', ...m(137, 133), yaw: 25 },
  { id: 'crypt_well', ...m(124, 133), yaw: 0 },
  { id: 'crypt_notice', ...m(133, 132), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(121.5, 142.5), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(138.5, 147.5), yaw: 180 },
  { id: 'crypt_barrel', ...m(138.5, 131.5), yaw: 0 },
  { id: 'crypt_plant_b', ...m(123, 143), collide: false },
  { id: 'crypt_grass_patch', ...m(124, 138), collide: false },
  { id: 'crypt_vine_b', x: 12, y: 13, side: 'n' },
  { id: 'crypt_vine_drape', x: 13, y: 13, side: 'e' },

  // --- the gate path -----------------------------------------------------------------------
  { id: 'crypt_fence_post', ...m(115, 132.5), yaw: 0 },
  { id: 'crypt_fence_post', ...m(115, 147.5), yaw: 0 },
  { id: 'crypt_skull_pile', ...m(113, 146), yaw: 40, collide: false },

  // --- the Lychgate: the graveyard the dead claw out of ---------------------------------------
  { id: 'crypt_graves_a', ...m(80, 136), yaw: 0 },
  { id: 'crypt_graves_b', ...m(99, 137), yaw: 180 },
  { id: 'crypt_tomb_a', ...m(74, 126), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(104, 146), yaw: -90 },
  { id: 'crypt_stone_a', ...m(90, 124), yaw: 0 },
  { id: 'crypt_stone_b', ...m(96, 124.5), yaw: 10 },
  { id: 'crypt_stone_c', ...m(76, 146), yaw: 190 },
  { id: 'crypt_stone_d', ...m(84, 147), yaw: 170 },
  { id: 'crypt_dirt_flat', ...m(90, 130), lift: 0.02, collide: false },
  { id: 'crypt_dirt_flat', ...m(78, 142), yaw: 60, lift: 0.02, collide: false },
  { id: 'crypt_mausoleum_a', ...m(73, 123.5), yaw: 180 },
  { id: 'crypt_gallows', ...m(88, 147.5), yaw: 0 },
  { id: 'crypt_gibbet', ...m(107, 128), yaw: -60 },
  { id: 'crypt_lamp_post', ...m(72, 138), yaw: 90 },
  { id: 'crypt_lamp_post', ...m(108, 140), yaw: -90 },
  { id: 'crypt_tree_a', ...m(72, 147), yaw: 120 },
  { id: 'crypt_tree_c', ...m(108, 122.5), yaw: 300 },
  { id: 'crypt_bone_pile', ...m(94, 141), yaw: 30, collide: false },
  { id: 'crypt_skull_pile', ...m(83, 128), yaw: -40, collide: false },
  { id: 'crypt_plant_a', ...m(100, 147), collide: false },
  { id: 'crypt_fern', ...m(72, 131), collide: false },
  { id: 'crypt_grass_patch', ...m(102, 130), collide: false },
  { id: 'crypt_vine_a', x: 7, y: 13, side: 'w' },
  { id: 'crypt_vine_drape', x: 9, y: 14, side: 's' },
  { id: 'crypt_moss_b', x: 7, y: 14, side: 'w' },
  { id: 'crypt_vine_b', x: 10, y: 12, side: 'e' },

  // --- the stair up to the barrow ------------------------------------------------------------
  { id: 'crypt_fence_post', ...m(82.5, 112), yaw: 0 },
  { id: 'crypt_fence_post', ...m(87.5, 112), yaw: 0 },
  { id: 'crypt_candle_blob', ...m(82.8, 117), collide: false },
  { id: 'crypt_candle_blob', ...m(87.2, 113), collide: false },

  // --- the Barrow: the ritual circle, the warden's ground, the Rising's arena -----------------
  { id: 'crypt_ritual_circle', ...m(85, 90), lift: 0.03, collide: false },
  { id: 'crypt_brazier', ...m(76, 81) },
  { id: 'crypt_brazier', ...m(94, 81) },
  { id: 'crypt_brazier', ...m(76, 99) },
  { id: 'crypt_brazier', ...m(94, 99) },
  { id: 'crypt_ward', ...m(85, 78), yaw: 180 },
  { id: 'crypt_ward', ...m(85, 102), yaw: 0 },
  { id: 'crypt_mausoleum_a', ...m(59, 75), yaw: 180 },
  { id: 'crypt_mausoleum_b', ...m(111, 75), yaw: 180 },
  { id: 'crypt_statue', ...m(70, 73.5), yaw: 180 },
  { id: 'crypt_statue_b', ...m(100, 73.5), yaw: 180 },
  { id: 'crypt_tomb_a', ...m(56, 86), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(56, 94), yaw: 90 },
  { id: 'crypt_tomb_b', ...m(114, 86), yaw: -90 },
  { id: 'crypt_tomb_a', ...m(114, 94), yaw: -90 },
  { id: 'crypt_stone_a', ...m(62, 82), yaw: 90 },
  { id: 'crypt_stone_b', ...m(62, 98), yaw: 80 },
  { id: 'crypt_stone_c', ...m(108, 82), yaw: -90 },
  { id: 'crypt_stone_d', ...m(108, 98), yaw: -100 },
  { id: 'crypt_gallows', ...m(104, 106), yaw: 0 },
  { id: 'crypt_gibbet', ...m(66, 106), yaw: 20 },
  { id: 'crypt_lamp_post', ...m(68, 78), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(102, 78), yaw: 180 },
  { id: 'crypt_lamp_post', ...m(68, 102), yaw: 0 },
  { id: 'crypt_lamp_post', ...m(102, 102), yaw: 0 },
  { id: 'crypt_tree_a', ...m(53, 73), yaw: 40 },
  { id: 'crypt_tree_c', ...m(117, 73), yaw: 220 },
  { id: 'crypt_tree_b', ...m(53, 107), yaw: 300 },
  { id: 'crypt_skull_heap_a', ...m(78, 90), yaw: 30 },
  { id: 'crypt_skull_heap_b', ...m(92, 90), yaw: -150 },
  { id: 'crypt_bone_pile', ...m(85, 84), yaw: 10, collide: false },
  { id: 'crypt_bone_pile', ...m(85, 96), yaw: 190, collide: false },
  { id: 'crypt_skeleton', ...m(72, 92), yaw: 100, collide: false },
  { id: 'crypt_skeleton_b', ...m(98, 88), yaw: 250, collide: false },
  { id: 'crypt_body_pile', ...m(110, 104), yaw: 20 },
  { id: 'crypt_dirt_flat', ...m(62, 90), lift: 0.02, collide: false },
  { id: 'crypt_dirt_flat', ...m(108, 90), yaw: 90, lift: 0.02, collide: false },
  { id: 'crypt_grunge_a', ...m(85, 80), lift: 0.02, collide: false },
  { id: 'crypt_grunge_b', ...m(85, 100), lift: 0.02, collide: false },
  { id: 'crypt_grass_patch', ...m(58, 104), collide: false },
  { id: 'crypt_plant_a', ...m(116, 80), collide: false },
  { id: 'crypt_fern', ...m(54, 80), collide: false },
  { id: 'crypt_vine_drape', x: 5, y: 7, side: 'n' },
  { id: 'crypt_vine_b', x: 8, y: 7, side: 'n' },
  { id: 'crypt_vine_a', x: 11, y: 7, side: 'n' },
  { id: 'crypt_moss_c', x: 5, y: 9, side: 'w' },
  { id: 'crypt_vine_drape', x: 11, y: 9, side: 'e' },
  { id: 'crypt_moss_b', x: 6, y: 10, side: 's' },
  { id: 'crypt_vine_b', x: 10, y: 10, side: 's' },
  { id: 'crypt_grunge_w', x: 5, y: 8, side: 'w' },
  { id: 'crypt_grunge_w', x: 11, y: 8, side: 'e' },
  { id: 'crypt_banner', x: 7, y: 7, side: 'n' },
  { id: 'crypt_banner', x: 9, y: 7, side: 'n' }
]

export function barrowYardDungeon(torchEvery = 4): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 3131, rooms: ROOMS, doorways: DOORWAYS, furniture: FURNITURE, links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 6 : 4, DOORWAYS)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by YARD_STAGES.
    const stage = YARD_STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}

/** Where the yard's fires burn (src/cryptFx.ts puts flames there): the braziers round the circle and the lamp posts. */
export function yardFires(): Array<{ x: number; z: number; y: number; size: number; light: boolean }> {
  return FURNITURE.flatMap((f) => {
    const fire = f.id === 'crypt_brazier' ? { y: 0.8, size: 0.5, dz: 0 }
      : f.id === 'crypt_lamp_post' ? { y: 4.0, size: 0.14, dz: 1.1 }
      : undefined
    if (!fire) return []
    const yaw = ((f.yaw ?? 0) * Math.PI) / 180
    const x = f.x * TILE + TILE / 2 + Math.sin(yaw) * fire.dz
    const z = f.y * TILE + TILE / 2 + Math.cos(yaw) * fire.dz
    return [{ x, z, y: fire.y, size: fire.size, light: f.id === 'crypt_brazier' }]
  })
}

/** The rooms as metre boxes (all open to the sky): the fog, the bats and the backdrop's gaps. */
export const YARD_ROOM_BOXES = [E, L, B].map((r) => ({ x: r.x * TILE, z: r.y * TILE, w: r.w * TILE, d: r.h * TILE }))

/** Every kit piece the yard's furniture places (for the preload plan). */
export function yardFurnitureIds(): KitId[] {
  return [...new Set(FURNITURE.map((f) => f.id))]
}
