// Hand-drawn layouts (the hall, the raid arena) in the generator's Dungeon
// shape. A spec is rooms as rectangles on the grid, named doorways and a
// furniture list; walls, pillars and torches are derived here the way the
// generator derives them, so the builder, camera, enemy sim and server take
// an authored layout exactly as they take a generated one.

import { Cell, Dungeon, Edge, Furniture, Room, Side } from './generator'

export type Rect = { x: number; y: number; w: number; h: number }

export type AuthoredSpec = {
  size: number
  seed: number
  /** Rooms in order; the first is the entrance, the second the "boss" room (the layout's centrepiece). */
  rooms: Array<Rect & { kind: Room['kind'] }>
  /** Doorways as the cell on each side; the arch stands on their shared edge. */
  doorways: Array<[[number, number], [number, number]]>
  furniture: Furniture[]
  /** Room graph edges, by room index. */
  links: Array<[number, number]>
  /** Kit ids of wall-hung pieces that take the torch's place on their edge. */
  hung: ReadonlySet<string>
}

export function authoredDungeon(spec: AuthoredSpec, torchEvery = 1): Dungeon {
  const SIZE = spec.size
  const cells: Cell[] = new Array(SIZE * SIZE).fill(0)
  const owner = new Int16Array(SIZE * SIZE).fill(-1)
  const idx = (x: number, y: number) => y * SIZE + x
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE
  const at = (x: number, y: number): Cell => (inb(x, y) ? cells[idx(x, y)] : 0)
  const own = (x: number, y: number) => (inb(x, y) ? owner[idx(x, y)] : -1)

  const rooms: Room[] = spec.rooms.map((r, id) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        cells[idx(x, y)] = 1
        owner[idx(x, y)] = id
      }
    }
    return { id, x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind, depth: id === 0 ? 0 : 1, enemies: [], props: [], traps: [] }
  })

  const doorway = new Set(spec.doorways.flatMap(([[ax, ay], [bx, by]]) => [`${ax},${ay}>${bx},${by}`, `${bx},${by}>${ax},${ay}`]))

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
        // parapet, so the camera sees over it into the next room.
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
  const hung = new Set(spec.furniture.filter((f) => f.side && spec.hung.has(f.id)).map((f) => `${f.x},${f.y},${f.side}`))
  const torches = walls.filter((w, i) => i % torchEvery === 0 && !hung.has(`${w.x},${w.y},${w.side}`))

  return {
    seed: spec.seed, size: SIZE, cells, rooms,
    links: spec.links,
    walls, doors, torches, pillars, arches: [],
    entrance: rooms[0], boss: rooms[1],
    furniture: spec.furniture
  }
}
