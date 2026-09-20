// Seeded dungeon generator. Pure data, no engine calls, so the same seed
// produces the same layout on every client and on a server.

import type { KitId } from './kit'

export type Cell = 0 | 1 | 2 // 0 rock, 1 room floor, 2 corridor floor
export type RoomKind = 'entrance' | 'boss' | 'treasure' | 'combat' | 'quiet'
export type Side = 'n' | 's' | 'w' | 'e'

export interface Room {
  id: number
  x: number
  y: number
  w: number
  h: number
  kind: RoomKind
  depth: number
  enemies: Array<[number, number]>
  props: Array<[number, number, Side]>
  /** Combat-room floor traps (saw / spike); empty unless the style asked for them. */
  traps: Array<[number, number]>
}

export interface Edge {
  x: number
  y: number
  side: Side
}

export interface Dungeon {
  seed: number
  size: number
  cells: Cell[]
  rooms: Room[]
  links: Array<[number, number]>
  walls: Edge[]
  doors: Edge[]
  torches: Edge[]
  pillars: Array<[number, number]>
  /** Straight corridor cells suited to a spanning feature (hanging chains, a real arch); `along` is the corridor axis. Not built yet. */
  arches: Array<{ x: number; y: number; along: 'x' | 'z' }>
  entrance: Room
  boss: Room
  /** Hand-placed pieces (the authored hub); generated dungeons have none. */
  furniture?: Furniture[]
}

/**
 * One authored piece. `x`/`y` are cell coordinates (fractional allowed) of the
 * piece's centre; with `side` set it is pushed against that wall of the cell
 * (wall-hung pieces hang there) the way generated props are. `tag` names the
 * placement so the scene can find its entity (the war table).
 */
export interface Furniture {
  id: KitId
  x: number
  y: number
  side?: Side
  yaw?: number
  collide?: boolean
  tag?: string
  /** Metres above the floor (lava planes ride just over it). */
  lift?: number
}

export interface GeneratorOptions {
  size: number
  /** Width/height in cells of the fixed entrance room at the bottom centre. */
  entranceSize: number
  /** BSP leaves are split until no side exceeds maxLeaf; never below minLeaf. */
  minLeaf: number
  maxLeaf: number
  /** Smallest room side in cells. */
  minRoom: number
  /** Every n-th room wall edge gets a torch. */
  torchEvery: number
  /** Room floor cells per wall prop (default 6); lower is more furnished. */
  cellsPerProp?: number
  /** Place one trap cell in every combat room. */
  traps?: boolean
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Cheap deterministic hash for per-tile variation that must not consume RNG state. */
export function tileHash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

interface Leaf {
  x: number
  y: number
  w: number
  h: number
  a?: Leaf
  b?: Leaf
  room?: Room
}

export function generateDungeon(seed: number, options: GeneratorOptions): Dungeon {
  const { size, entranceSize, minLeaf, maxLeaf, minRoom } = options
  const cellsPerProp = options.cellsPerProp ?? 6
  const rnd = mulberry32(seed)
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const cells: Cell[] = new Array(size * size).fill(0)
  const idx = (x: number, y: number) => y * size + x
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size
  const at = (x: number, y: number): Cell => (inb(x, y) ? cells[idx(x, y)] : 0)

  // 1. Fixed entrance room at the bottom centre; the spawn point in scene.json sits here.
  const rooms: Room[] = []
  const ex = Math.floor((size - entranceSize) / 2)
  const ey = size - 1 - entranceSize
  const entrance: Room = { id: 0, x: ex, y: ey, w: entranceSize, h: entranceSize, kind: 'entrance', depth: 0, enemies: [], props: [], traps: [] }
  rooms.push(entrance)
  for (let yy = ey; yy < ey + entranceSize; yy++) for (let xx = ex; xx < ex + entranceSize; xx++) cells[idx(xx, yy)] = 1

  // 2. BSP partition of everything above the entrance band.
  const root: Leaf = { x: 1, y: 1, w: size - 2, h: ey - 3 }
  const leaves: Leaf[] = []
  const split = (leaf: Leaf, depth: number) => {
    const canH = leaf.h >= minLeaf * 2
    const canV = leaf.w >= minLeaf * 2
    const tooBig = leaf.w > maxLeaf || leaf.h > maxLeaf
    if ((!canH && !canV) || (!tooBig && rnd() < 0.25) || depth > 8) {
      leaves.push(leaf)
      return
    }
    const horizontal = canH && (!canV || (leaf.h > leaf.w ? rnd() < 0.75 : rnd() < 0.25))
    if (horizontal) {
      const cut = ri(minLeaf, leaf.h - minLeaf)
      leaf.a = { x: leaf.x, y: leaf.y, w: leaf.w, h: cut }
      leaf.b = { x: leaf.x, y: leaf.y + cut, w: leaf.w, h: leaf.h - cut }
    } else {
      const cut = ri(minLeaf, leaf.w - minLeaf)
      leaf.a = { x: leaf.x, y: leaf.y, w: cut, h: leaf.h }
      leaf.b = { x: leaf.x + cut, y: leaf.y, w: leaf.w - cut, h: leaf.h }
    }
    split(leaf.a, depth + 1)
    split(leaf.b, depth + 1)
  }
  split(root, 0)

  // 3. One room per leaf.
  for (const leaf of leaves) {
    const w = ri(minRoom, Math.max(minRoom, leaf.w - 2))
    const h = ri(minRoom, Math.max(minRoom, leaf.h - 2))
    const x = leaf.x + ri(1, Math.max(1, leaf.w - w - 1))
    const y = leaf.y + ri(1, Math.max(1, leaf.h - h - 1))
    const room: Room = { id: rooms.length, x, y, w, h, kind: 'quiet', depth: 0, enemies: [], props: [], traps: [] }
    leaf.room = room
    rooms.push(room)
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) cells[idx(xx, yy)] = 1
  }

  // 4. Corridors: siblings in the BSP tree, then the entrance to its nearest room.
  const links: Array<[number, number]> = []
  const center = (r: Room): [number, number] => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)]
  const carve = (x: number, y: number) => {
    if (inb(x, y) && cells[idx(x, y)] === 0) cells[idx(x, y)] = 2
  }
  const corridor = (ra: Room, rb: Room) => {
    const [ax, ay] = center(ra)
    const [bx, by] = center(rb)
    if (rnd() < 0.5) {
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, ay)
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(bx, y)
    } else {
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(ax, y)
      for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, by)
    }
    links.push([ra.id, rb.id])
  }
  const pickRoom = (leaf: Leaf): Room => (leaf.room ? leaf.room : rnd() < 0.5 ? pickRoom(leaf.a!) : pickRoom(leaf.b!))
  const connect = (leaf: Leaf) => {
    if (!leaf.a || !leaf.b) return
    connect(leaf.a)
    connect(leaf.b)
    corridor(pickRoom(leaf.a), pickRoom(leaf.b))
  }
  connect(root)
  let nearest = rooms[1]
  for (const r of rooms) {
    if (r.id === 0) continue
    const [cx, cy] = center(r)
    const [ncx, ncy] = center(nearest)
    const [ecx, ecy] = center(entrance)
    if (Math.abs(cx - ecx) + Math.abs(cy - ecy) < Math.abs(ncx - ecx) + Math.abs(ncy - ecy)) nearest = r
  }
  corridor(entrance, nearest)

  // 5. Walls, doors, pillars and arches from edge detection. Each edge is
  // visited once: rock edges from the floor cell, room/corridor edges from
  // the corridor cell.
  const walls: Edge[] = []
  const doors: Edge[] = []
  const arches: Dungeon['arches'] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = at(x, y)
      if (c === 0) continue
      const n: Array<[Side, number, number]> = [
        ['n', x, y - 1],
        ['s', x, y + 1],
        ['w', x - 1, y],
        ['e', x + 1, y]
      ]
      for (const [side, nx, ny] of n) {
        const o = at(nx, ny)
        if (o === 0) walls.push({ x, y, side })
        else if (c === 2 && o === 1) {
          // A corridor that ends here (or turns in) gets a doorway. One that
          // merely runs alongside the room has two other floor neighbours and
          // is walled off instead.
          const otherFloor = n.filter(([s2, x2, y2]) => s2 !== side && at(x2, y2) !== 0).length
          if (otherFloor > 1) walls.push({ x, y, side })
          else doors.push({ x, y, side })
        }
      }
      if (c === 2) {
        const ns = at(x, y - 1) === 2 && at(x, y + 1) === 2 && at(x - 1, y) === 0 && at(x + 1, y) === 0
        const we = at(x - 1, y) === 2 && at(x + 1, y) === 2 && at(x, y - 1) === 0 && at(x, y + 1) === 0
        if ((ns || we) && (x + y) % 3 === 0) arches.push({ x, y, along: ns ? 'z' : 'x' })
      }
    }
  }
  const pillars: Array<[number, number]> = []
  for (let vy = 0; vy <= size; vy++) {
    for (let vx = 0; vx <= size; vx++) {
      const a = at(vx - 1, vy - 1) !== 0
      const b = at(vx, vy - 1) !== 0
      const c = at(vx - 1, vy) !== 0
      const d = at(vx, vy) !== 0
      const count = [a, b, c, d].filter(Boolean).length
      if (count === 1 || count === 3 || (count === 2 && ((a && d) || (b && c)))) pillars.push([vx, vy])
    }
  }
  const torches: Edge[] = walls.filter((w, i) => at(w.x, w.y) === 1 && i % options.torchEvery === 0)

  // 6. Room roles by corridor distance from the entrance.
  const adj = new Map<number, number[]>()
  for (const [a, b] of links) {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  const depth = new Map<number, number>([[entrance.id, 0]])
  const queue = [entrance.id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (!depth.has(nb)) {
        depth.set(nb, depth.get(cur)! + 1)
        queue.push(nb)
      }
    }
  }
  let boss = rooms[1]
  for (const r of rooms) {
    r.depth = depth.get(r.id) ?? 0
    if (r.id !== 0 && (r.depth > boss.depth || (r.depth === boss.depth && r.w * r.h > boss.w * boss.h))) boss = r
  }
  boss.kind = 'boss'
  for (const r of rooms) {
    if (r.kind !== 'quiet') continue
    const degree = (adj.get(r.id) ?? []).length
    if (degree <= 1 && rnd() < 0.7) r.kind = 'treasure'
    else if (rnd() < 0.65) r.kind = 'combat'
  }

  // 7. Decorate: enemy spawns in the open, props against walls.
  for (const r of rooms) {
    const area = r.w * r.h
    if (r.kind === 'combat' || r.kind === 'boss') {
      const count = r.kind === 'boss' ? 1 : Math.min(5, Math.max(1, Math.floor(area / (size > 20 ? 10 : 4))))
      for (let i = 0; i < count; i++) r.enemies.push([r.x + ri(0, r.w - 1), r.y + ri(0, r.h - 1)])
    }
    if (options.traps && r.kind === 'combat') {
      const used = new Set(r.enemies.map(([x, y]) => `${x},${y}`))
      for (let tries = 0; tries < 16 && r.traps.length === 0; tries++) {
        const tx = r.x + ri(0, r.w - 1)
        const ty = r.y + ri(0, r.h - 1)
        if (!used.has(`${tx},${ty}`)) r.traps.push([tx, ty])
      }
    }
    const propCount = r.kind === 'entrance' ? 2 : Math.min(6, Math.floor(area / cellsPerProp))
    const used = new Set<string>()
    for (let i = 0; i < propCount * 3 && r.props.length < propCount; i++) {
      const alongTop = rnd() < 0.5
      const px = alongTop ? r.x + ri(0, r.w - 1) : rnd() < 0.5 ? r.x : r.x + r.w - 1
      const py = alongTop ? (rnd() < 0.5 ? r.y : r.y + r.h - 1) : r.y + ri(0, r.h - 1)
      const side: Side = alongTop ? (py === r.y ? 'n' : 's') : px === r.x ? 'w' : 'e'
      const key = `${px},${py}`
      // Keep props out of doorways and off the entrance's spawn tile.
      const blocked = doors.some((d) => {
        const [dx, dy] = d.side === 'n' ? [d.x, d.y - 1] : d.side === 's' ? [d.x, d.y + 1] : d.side === 'w' ? [d.x - 1, d.y] : [d.x + 1, d.y]
        return dx === px && dy === py
      })
      if (used.has(key) || blocked) continue
      used.add(key)
      r.props.push([px, py, side])
    }
  }

  return { seed, size, cells, rooms, links, walls, doors, torches, pillars, arches, entrance, boss }
}
