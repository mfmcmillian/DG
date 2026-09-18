// Turns a generated Dungeon into concrete module placements in scene space for
// a given style. Pure data so it can be checked offline
// (scripts/render-layout.py) and reused by a server. The builder only
// instantiates what this returns.

import { cellCenter, DungeonStyle, gridOrigin } from './config'
import { Dungeon, Edge, Room, Side, tileHash } from './generator'
import { DOOR_OPENINGS, KIT, KitId, PRIMITIVE_TRIS } from './kit'

export type Placement =
  | { kind: 'ground'; x: number; y: number; z: number; sx: number; sy: number; sz: number }
  | { kind: 'floor' | 'ceiling'; x: number; y: number; z: number }
  | { kind: 'kit'; id: KitId; x: number; y: number; z: number; yaw: number; collide: boolean }
  /** Invisible box collider (door jambs and lintels). */
  | { kind: 'box'; x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number }

export interface LayoutOptions {
  /** Replace camera-facing (+Z side) walls with the style's low cutaway wall and leave +Z doorways open. */
  cutaway: boolean
}

export interface SpawnPoint {
  x: number
  z: number
  boss: boolean
  roomId: number
}

export interface Layout {
  placements: Placement[]
  stats: { entities: number; triangles: number; walls: number }
  /** Index into `placements` for every wall torch, in the same order as `dungeon.torches`. */
  torchIndices: number[]
  /** World-space enemy spawn points; the boss room contributes exactly one with `boss: true`. */
  spawns: SpawnPoint[]
}

/** Yaw that turns a module's +Z face towards the cell that owns the edge. */
export function sideYaw(side: Side): number {
  switch (side) {
    case 'n':
      return 0
    case 's':
      return 180
    case 'w':
      return 90
    default:
      return -90
  }
}

/** Unit vector pointing from the edge into the owning cell. */
export function sideInward(side: Side): { x: number; z: number } {
  switch (side) {
    case 'n':
      return { x: 0, z: 1 }
    case 's':
      return { x: 0, z: -1 }
    case 'w':
      return { x: 1, z: 0 }
    default:
      return { x: -1, z: 0 }
  }
}

export function edgeMidpoint(style: DungeonStyle, e: Edge): { x: number; z: number } {
  const c = cellCenter(style, e.x, e.y)
  const inward = sideInward(e.side)
  return { x: c.x - inward.x * (style.tile / 2), z: c.z - inward.z * (style.tile / 2) }
}

/** Side of the 6x6 parcel scene in metres. */
const SCENE_SPAN = 96

export function layoutDungeon(dungeon: Dungeon, style: DungeonStyle, options: LayoutOptions = { cutaway: false }): Layout {
  const T = style.tile
  const H = style.wallHeight
  const origin = gridOrigin(style)
  const placements: Placement[] = []
  const stats = { entities: 0, triangles: 0, walls: 0 }
  const torchIndices: number[] = []

  const push = (p: Placement, tris: number) => {
    placements.push(p)
    stats.entities++
    stats.triangles += tris
    return placements.length - 1
  }
  const kit = (id: KitId, x: number, y: number, z: number, yaw: number, collide = true) =>
    push({ kind: 'kit', id, x, y, z, yaw, collide }, KIT[id].tris)
  const cutaway = options.cutaway && style.cutawayWall !== undefined
  // Camera-facing edges: the crawler camera sits at +Z looking towards -Z, so
  // a wall on a cell's south side stands between the camera and that cell.
  const facesCamera = (side: Side) => side === 's'

  // The ground is one dark slab over the entire scene footprint, not just the
  // grid: the crawler camera looks down at 58 degrees, so anything not covered
  // shows the Explorer's own terrain and sky tint. This is the void between and
  // around the rooms, the way top-down dungeons fill their negative space black.
  push({ kind: 'ground', x: SCENE_SPAN / 2, y: -0.5, z: SCENE_SPAN / 2, sx: SCENE_SPAN, sy: 1, sz: SCENE_SPAN }, PRIMITIVE_TRIS.box)

  for (let y = 0; y < dungeon.size; y++) {
    for (let x = 0; x < dungeon.size; x++) {
      if (dungeon.cells[y * dungeon.size + x] === 0) continue
      const c = cellCenter(style, x, y)
      push({ kind: 'floor', x: c.x, y: 0.005, z: c.z }, PRIMITIVE_TRIS.plane)
      if (style.ceiling) push({ kind: 'ceiling', x: c.x, y: H, z: c.z }, PRIMITIVE_TRIS.plane)
    }
  }

  for (const w of dungeon.walls) {
    const m = edgeMidpoint(style, w)
    const roll = tileHash(w.x, w.y, w.side.charCodeAt(0))
    const lowered = cutaway && facesCamera(w.side)
    const id = lowered ? style.cutawayWall! : style.walls[Math.floor(roll * style.walls.length)]
    kit(id, m.x, 0, m.z, sideYaw(w.side))
    stats.walls++
    // The camera sees over the low wall, but the player must not: an invisible
    // full-height collider stands where the tall wall would have been.
    if (lowered) {
      push({ kind: 'box', x: m.x, y: H / 2, z: m.z, yaw: sideYaw(w.side), sx: T, sy: H, sz: Math.max(0.5, KIT[id].size[2]) }, 0)
    }
  }

  for (const d of dungeon.doors) {
    if (cutaway && facesCamera(d.side)) continue // open gap; the pillar rule still frames it
    const m = edgeMidpoint(style, d)
    const yaw = sideYaw(d.side)
    const opening = DOOR_OPENINGS[style.door]
    if (!opening) {
      kit(style.door, m.x, 0, m.z, yaw)
      continue
    }
    // Visual frame without a collider, plus tight boxes on the solid parts so
    // the camera de-occluder only reacts to the wall, not the trim.
    kit(style.door, m.x, 0, m.z, yaw, false)
    const piece = KIT[style.door]
    const thick = piece.size[2]
    const jamb = (T - opening.width) / 2
    const rad = (yaw * Math.PI) / 180
    const local = (lx: number) => ({ x: m.x + lx * Math.cos(rad), z: m.z - lx * Math.sin(rad) })
    for (const sign of [-1, 1]) {
      const p = local(sign * (T / 2 - jamb / 2))
      push({ kind: 'box', x: p.x, y: H / 2, z: p.z, yaw, sx: jamb, sy: H, sz: thick }, 0)
    }
    if (opening.height < H) {
      push({ kind: 'box', x: m.x, y: (H + opening.height) / 2, z: m.z, yaw, sx: opening.width, sy: H - opening.height, sz: thick }, 0)
    }
  }

  for (const [vx, vy] of dungeon.pillars) kit(style.pillar, origin.x + vx * T, 0, origin.z + vy * T, 0)

  for (const t of dungeon.torches) {
    const m = edgeMidpoint(style, t)
    const inward = sideInward(t.side)
    torchIndices.push(kit(style.torch, m.x + inward.x * 0.35, style.torchHeight, m.z + inward.z * 0.35, sideYaw(t.side), false))
  }

  const spawns: SpawnPoint[] = []
  for (const room of dungeon.rooms) {
    decorateRoom(style, room, kit)
    if (room.kind === 'boss' && style.bossCentrepiece) {
      const c = cellCenter(style, room.x + (room.w - 1) / 2, room.y + (room.h - 1) / 2)
      kit(style.bossCentrepiece, c.x, 0, c.z, 180)
    }
    for (const [ex, ey] of room.enemies) {
      const c = cellCenter(style, ex, ey)
      spawns.push({ x: c.x, z: c.z, boss: room.kind === 'boss', roomId: room.id })
    }
  }

  return { placements, stats, torchIndices, spawns }
}

function decorateRoom(
  style: DungeonStyle,
  room: Room,
  kit: (id: KitId, x: number, y: number, z: number, yaw: number, collide?: boolean) => number
) {
  const T = style.tile
  const H = style.wallHeight
  const list = style.props[room.kind]
  room.props.forEach(([px, py, side], i) => {
    const id = list[(i + Math.floor(tileHash(px, py, 7) * list.length)) % list.length]
    const piece = KIT[id]
    const c = cellCenter(style, px, py)
    const inward = sideInward(side)
    const wallMounted = id === 'banner' || id === 'rune'
    const yaw = sideYaw(side) + (wallMounted ? 0 : (tileHash(px, py, 11) - 0.5) * 20)
    if (id === 'banner') {
      kit(id, c.x - inward.x * (T / 2 - 0.3), Math.min(H, 3.5) - 0.15, c.z - inward.z * (T / 2 - 0.3), yaw, false)
    } else if (id === 'rune') {
      kit(id, c.x - inward.x * (T / 2 - 0.2), 1.4, c.z - inward.z * (T / 2 - 0.2), yaw, false)
    } else {
      // Push the prop back against the wall it was assigned to.
      const gap = T / 2 - piece.size[2] / 2 - 0.12
      kit(id, c.x - inward.x * gap, 0, c.z - inward.z * gap, yaw, id !== 'skulls' && id !== 'bones' && id !== 'rubble')
    }
  })
}
