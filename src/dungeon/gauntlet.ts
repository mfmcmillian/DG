// The Dark Fortress as one gauntlet, drawn by hand in the shape a Dungeon
// Quest map has: a line of rooms, each sealed until it is cleared, enemies
// arriving in waves as the party steps in, a warden alone in two of the
// rooms, and the Warlord in the last. The same every run, so it can be
// learned; the difficulty scales the numbers and adds to every wave.
//
// Plan (30 x 30 cells of 5 m on the 160 m plot; north is -Z, the crawler
// camera looks north; the party spawns at the bottom and snakes up). Rooms
// are 30 x 20 m, the Warlord's hall 45 x 35 m, corridors 20-25 m long:
//
//        x  0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29
//   y  1    . . . . . . . . . . .  .  .  .  .  .  .  .  .  .  W  W  W  W  W  W  W  W  W  .    W the Warlord's hall
//      2    . . 6 6 6 6 6 6 . . .  .  7  7  7  7  7  7  .  .  W  W  W  W  W  W  W  W  W  .
//      3    . . 6 6 6 6 6 6 c c c  c  7  7  7  7  7  7  c  c  W  W  W  W  W  W  W  W  W  .
//      4    . . 6 6 6 6 6 6 . . .  .  7  7  7  7  7  7  .  .  W  W  W  W  W  W  W  W  W  .
//      5    . . 6 6 6 6 6 6 . . .  .  7  7  7  7  7  7  .  .  W  W  W  W  W  W  W  W  W  .
//      6    . . . . c . . . . . .  .  .  .  .  .  .  .  .  .  W  W  W  W  W  W  W  W  W  .
//      7    . . . . c . . . . . .  .  .  .  .  .  .  .  .  .  W  W  W  W  W  W  W  W  W  .
//      8    . . . . c . . . . . .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//      9    . . . . c . . . . . .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//     10    . . . . c . . . . . .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//     11    . . 5 5 5 5 5 5 . . .  .  4  4  4  4  4  4  .  .  .  .  3  3  3  3  3  3  .  .    5 the Iron Warden
//     12    . . 5 5 5 5 5 5 c c c  c  4  4  4  4  4  4  c  c  c  c  3  3  3  3  3  3  .  .    4 room four (three waves)
//     13    . . 5 5 5 5 5 5 . . .  .  4  4  4  4  4  4  .  .  .  .  3  3  3  3  3  3  .  .    3 room three
//     14    . . 5 5 5 5 5 5 . . .  .  4  4  4  4  4  4  .  .  .  .  3  3  3  3  3  3  .  .
//     15    . . . . . . . . . . .  .  .  .  .  .  .  .  .  .  .  .  .  .  c  .  .  .  .  .
//     ...                                                                   c
//     19    . . . . . . . . . . .  .  .  .  .  .  .  .  .  .  .  .  .  .  c  .  .  .  .  .
//     20    . . . . . . . . . . .  .  1  1  1  1  1  1  .  .  .  .  2  2  2  2  2  2  .  .    2 the Vault Warden
//     21    . . . . . . . . . . .  .  1  1  1  1  1  1  c  c  c  c  2  2  2  2  2  2  .  .    1 room one
//     22    . . . . . . . . . . .  .  1  1  1  1  1  1  .  .  .  .  2  2  2  2  2  2  .  .
//     23    . . . . . . . . . . .  .  1  1  1  1  1  1  .  .  .  .  2  2  2  2  2  2  .  .
//     24    . . . . . . . . . . .  .  .  .  .  c  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//     25    . . . . . . . . . . .  .  .  .  .  c  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//     26    . . . . . . . . . . .  .  .  .  E  E  .  .  .  .  .  .  .  .  .  .  .  .  .  .    E the entrance: the spawn
//     27    . . . . . . . . . . .  .  .  .  E  E  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//     28    . . . . . . . . . . .  .  .  .  E  E  .  .  .  .  .  .  .  .  .  .  .  .  .  .
//
// The grid starts at (5, 5): (160 - 30 * 5) / 2.

import { authoredDungeon, Rect } from './authored'
import { Dungeon, Room, Side } from './generator'

const SIZE = 30

/** Roster keys a wave is written in; `warden` is the mini-boss, the roster's guard grown. */
export type WaveUnit = 'striker' | 'scout' | 'guard' | 'warden' | 'boss'

export type Stage = {
  /** Index into the dungeon's rooms. */
  room: number
  kind: 'combat' | 'warden' | 'boss'
  /** What the HUD calls it. */
  name: string
  /** Enemies arrive wave by wave; the next comes when the last is down. */
  waves: WaveUnit[][]
  /** The side of the room the party comes in by. */
  entry: Side
  /** The doorway out, sealed until the stage is cleared: the cell in this room and the cell beyond. The boss room has none. */
  gate?: [[number, number], [number, number]]
}

const E: Rect = { x: 14, y: 26, w: 2, h: 3 }
const C0: Rect = { x: 15, y: 24, w: 1, h: 2 }
const W: Rect = { x: 20, y: 1, w: 9, h: 7 }
const R1: Rect = { x: 12, y: 20, w: 6, h: 4 }
const C1: Rect = { x: 18, y: 21, w: 4, h: 1 }
const R2: Rect = { x: 22, y: 20, w: 6, h: 4 }
const C2: Rect = { x: 24, y: 15, w: 1, h: 5 }
const R3: Rect = { x: 22, y: 11, w: 6, h: 4 }
const C3: Rect = { x: 18, y: 12, w: 4, h: 1 }
const R4: Rect = { x: 12, y: 11, w: 6, h: 4 }
const C4: Rect = { x: 8, y: 12, w: 4, h: 1 }
const R5: Rect = { x: 2, y: 11, w: 6, h: 4 }
const C5: Rect = { x: 4, y: 6, w: 1, h: 5 }
const R6: Rect = { x: 2, y: 2, w: 6, h: 4 }
const C6: Rect = { x: 8, y: 3, w: 4, h: 1 }
const R7: Rect = { x: 12, y: 2, w: 6, h: 4 }
const C7: Rect = { x: 18, y: 3, w: 2, h: 1 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...W, kind: 'boss' },
  { ...C0, kind: 'quiet' },
  { ...R1, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...R2, kind: 'treasure' }, { ...C2, kind: 'quiet' },
  { ...R3, kind: 'combat' }, { ...C3, kind: 'quiet' },
  { ...R4, kind: 'combat' }, { ...C4, kind: 'quiet' },
  { ...R5, kind: 'treasure' }, { ...C5, kind: 'quiet' },
  { ...R6, kind: 'combat' }, { ...C6, kind: 'quiet' },
  { ...R7, kind: 'combat' }, { ...C7, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[15, 26], [15, 25]], [[15, 24], [15, 23]],   // entrance -> corridor -> room one
  [[17, 21], [18, 21]], [[21, 21], [22, 21]],   // one -> corridor -> the first warden
  [[24, 20], [24, 19]], [[24, 15], [24, 14]],   // warden -> corridor -> three
  [[22, 12], [21, 12]], [[18, 12], [17, 12]],   // three -> corridor -> four
  [[12, 12], [11, 12]], [[8, 12], [7, 12]],     // four -> corridor -> the second warden
  [[4, 11], [4, 10]], [[4, 6], [4, 5]],         // warden -> corridor -> six
  [[7, 3], [8, 3]], [[11, 3], [12, 3]],         // six -> corridor -> seven
  [[17, 3], [18, 3]], [[19, 3], [20, 3]]        // seven -> corridor -> the Warlord
]

const LINKS: Array<[number, number]> = [
  [0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 1]
]

/** The fights, in order. Room indices are into ROOMS above. */
export const STAGES: Stage[] = [
  { room: 3, kind: 'combat', name: 'Room 1', entry: 's', gate: [[17, 21], [18, 21]],
    waves: [['scout', 'striker'], ['striker', 'scout', 'scout']] },
  { room: 5, kind: 'warden', name: 'The Vault Warden', entry: 'w', gate: [[24, 20], [24, 19]],
    waves: [['warden']] },
  { room: 7, kind: 'combat', name: 'Room 3', entry: 's', gate: [[22, 12], [21, 12]],
    waves: [['striker', 'striker', 'scout'], ['guard', 'scout', 'scout']] },
  { room: 9, kind: 'combat', name: 'Room 4', entry: 'e', gate: [[12, 12], [11, 12]],
    waves: [['scout', 'scout', 'striker'], ['striker', 'striker', 'scout'], ['guard', 'striker', 'scout', 'scout']] },
  { room: 11, kind: 'warden', name: 'The Iron Warden', entry: 'e', gate: [[4, 11], [4, 10]],
    waves: [['warden']] },
  { room: 13, kind: 'combat', name: 'Room 6', entry: 's', gate: [[7, 3], [8, 3]],
    waves: [['striker', 'scout', 'scout'], ['guard', 'guard', 'scout']] },
  { room: 15, kind: 'combat', name: 'Room 7', entry: 'w', gate: [[17, 3], [18, 3]],
    waves: [['scout', 'scout', 'striker', 'striker'], ['guard', 'striker', 'scout'], ['guard', 'guard', 'striker', 'scout']] },
  { room: 1, kind: 'boss', name: 'The Warlord', entry: 'w',
    waves: [['boss']] }
]

/** Seconds between a wave falling and the next arriving. */
export const WAVE_GAP_SECONDS = 1.6

/** A small deterministic hash so the props fall the same on every client. */
function hash(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) >>> 0
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0
  return (h >>> 8) / 0x00ffffff
}

/** Wall props for a room: on edge cells that are not a doorway, up to `count`. */
function propsFor(room: Rect, count: number): Array<[number, number, Side]> {
  const doorCells = new Set(DOORWAYS.flatMap(([a, b]) => [`${a[0]},${a[1]}`, `${b[0]},${b[1]}`]))
  const candidates: Array<[number, number, Side]> = []
  for (let x = room.x; x < room.x + room.w; x++) {
    candidates.push([x, room.y, 'n'], [x, room.y + room.h - 1, 's'])
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    candidates.push([room.x, y, 'w'], [room.x + room.w - 1, y, 'e'])
  }
  const open = candidates.filter(([x, y]) => !doorCells.has(`${x},${y}`))
  // Shuffle by hash, then take the first few distinct cells.
  open.sort((a, b) => hash(a[0], a[1], 3) - hash(b[0], b[1], 3))
  const used = new Set<string>()
  const out: Array<[number, number, Side]> = []
  for (const c of open) {
    const key = `${c[0]},${c[1]}`
    if (used.has(key)) continue
    used.add(key)
    out.push(c)
    if (out.length >= count) break
  }
  return out
}

export function gauntletDungeon(torchEvery = 1): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 1337, rooms: ROOMS, doorways: DOORWAYS, furniture: [], links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 10 : 6)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by STAGES.
    const stage = STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}

/** Which room, if any, a cell belongs to among the stages: the stage index, or -1. */
export function stageAtCell(cx: number, cy: number): number {
  for (let i = 0; i < STAGES.length; i++) {
    const r = ROOMS[STAGES[i].room]
    if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) return i
  }
  return -1
}

/**
 * Where a wave stands when it arrives: a line across the room on the far side
 * from the door the party comes in by, a stride apart, a second line behind it
 * for a big wave. In cell units (fractional), for cellCenter.
 */
export function wavePlaces(stage: Stage, count: number): Array<[number, number]> {
  const r = ROOMS[stage.room]
  const cx = r.x + (r.w - 1) / 2
  const cy = r.y + (r.h - 1) / 2
  // Inward from the entry side: the way into the room.
  const inward = stage.entry === 's' ? [0, -1] : stage.entry === 'n' ? [0, 1] : stage.entry === 'w' ? [1, 0] : [-1, 0]
  const across = [inward[1], inward[0]]
  const depth = stage.kind === 'combat' ? 0.55 : 0.3
  const halfSpan = (stage.entry === 's' || stage.entry === 'n' ? r.w : r.h) / 2 - 0.8
  const out: Array<[number, number]> = []
  const perRow = Math.min(count, 5)
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, count - row * perRow)
    const k = i - row * perRow
    const t = inRow === 1 ? 0 : (k / (inRow - 1)) * 2 - 1
    const along = depth * ((stage.entry === 's' || stage.entry === 'n' ? r.h : r.w) / 2) - row * 0.7
    out.push([cx + inward[0] * along + across[0] * t * halfSpan, cy + inward[1] * along + across[1] * t * halfSpan])
  }
  return out
}
