// The compact Dark Fortress: one combat room, the Vault Warden, then the
// Warlord. It remains a staged gauntlet, but its 20 x 20 grid and straight
// route make the first dungeon roughly half the old footprint and much faster
// to understand. The normal difficulty scaling still adds to each wave.

import { authoredDungeon, Rect } from './authored'
import { Dungeon, Room } from './generator'
import { propsFor, Stage } from './stages'

const SIZE = 20

// The party spawns in the entrance at the south (high y) and goes straight
// north (low y): entrance -> Outer Hall -> corridor -> Vault Warden -> corridor -> Warlord.
const E: Rect = { x: 9, y: 18, w: 2, h: 2 }
const R1: Rect = { x: 7, y: 14, w: 6, h: 4 }
const C1: Rect = { x: 9, y: 12, w: 1, h: 2 }
const R2: Rect = { x: 7, y: 8, w: 6, h: 4 }
const C2: Rect = { x: 9, y: 6, w: 1, h: 2 }
const W: Rect = { x: 5, y: 1, w: 10, h: 5 }

/** Rooms in the spec's order: the entrance first, the boss room second (authoredDungeon's rule), then the path. */
const ROOMS: Array<Rect & { kind: Room['kind'] }> = [
  { ...E, kind: 'entrance' },
  { ...W, kind: 'boss' },
  { ...R1, kind: 'combat' }, { ...C1, kind: 'quiet' },
  { ...R2, kind: 'treasure' }, { ...C2, kind: 'quiet' }
]

const DOORWAYS: Array<[[number, number], [number, number]]> = [
  [[9, 18], [9, 17]],                     // entrance -> Outer Hall
  [[9, 14], [9, 13]], [[9, 12], [9, 11]], // Outer Hall -> corridor -> Vault Warden
  [[9, 8], [9, 7]], [[9, 6], [9, 5]]      // Vault Warden -> corridor -> Warlord
]

const LINKS: Array<[number, number]> = [
  [0, 2], [2, 3], [3, 4], [4, 5], [5, 1]
]

/** The fights, in order. Room indices are into ROOMS above. A stage's gate is its way OUT, sealed until it is cleared. */
export const STAGES: Stage[] = [
  { room: 2, rect: R1, kind: 'combat', name: 'The Outer Hall', entry: 's', gate: [[9, 14], [9, 13]],
    waves: [['scout', 'striker'], ['striker', 'scout', 'scout']] },
  { room: 4, rect: R2, kind: 'warden', name: 'The Vault Warden', entry: 's', gate: [[9, 8], [9, 7]],
    waves: [['warden']] },
  { room: 1, rect: W, kind: 'boss', name: 'The Warlord', entry: 's',
    waves: [['boss']] }
]

export function gauntletDungeon(torchEvery = 1): Dungeon {
  const d = authoredDungeon({ size: SIZE, seed: 1337, rooms: ROOMS, doorways: DOORWAYS, furniture: [], links: LINKS, hung: new Set() }, torchEvery)
  for (const room of d.rooms) {
    if (room.kind === 'quiet') continue
    const rect = ROOMS[room.id]
    room.props = propsFor(rect, room.kind === 'entrance' ? 2 : room.kind === 'boss' ? 10 : 6, DOORWAYS)
    // The builder's spawn markers and the "total" the lobby shows come from these; the sim spawns by STAGES.
    const stage = STAGES.find((s) => s.room === room.id)
    if (stage) room.enemies = stage.waves.map((_, i) => [rect.x + Math.min(rect.w - 1, i), rect.y + Math.floor(rect.h / 2)])
  }
  return d
}
