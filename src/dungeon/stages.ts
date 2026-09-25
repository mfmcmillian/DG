// What a hand-drawn dungeon's fights look like to the enemy sim: rooms in
// order, each sealed until it is cleared, enemies arriving in waves. The
// Dark Fortress (./gauntlet.ts) and the Frozen Pass (./pass.ts) are both
// written in these terms; src/dungeonEnemies.ts runs whichever the style names
// (see stagesFor in ./layouts.ts).

import { Rect } from './authored'
import { Side } from './generator'

/** Roster keys a wave is written in; `warden` is the mini-boss, the roster's guard grown. */
export type WaveUnit = 'striker' | 'scout' | 'guard' | 'warden' | 'boss'

export type Stage = {
  /** Index into the dungeon's rooms. */
  room: number
  /** The room's cells on the grid. */
  rect: Rect
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

/** Seconds between a wave falling and the next arriving. */
export const WAVE_GAP_SECONDS = 1.6

/** A small deterministic hash so the props fall the same on every client. */
export function stageHash(a: number, b: number, salt: number): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) >>> 0
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0
  return (h >>> 8) / 0x00ffffff
}

/** Wall props for a room: on edge cells that are not a doorway, up to `count`. */
export function propsFor(room: Rect, count: number, doorways: Array<[[number, number], [number, number]]>): Array<[number, number, Side]> {
  const doorCells = new Set(doorways.flatMap(([a, b]) => [`${a[0]},${a[1]}`, `${b[0]},${b[1]}`]))
  const candidates: Array<[number, number, Side]> = []
  for (let x = room.x; x < room.x + room.w; x++) {
    candidates.push([x, room.y, 'n'], [x, room.y + room.h - 1, 's'])
  }
  for (let y = room.y; y < room.y + room.h; y++) {
    candidates.push([room.x, y, 'w'], [room.x + room.w - 1, y, 'e'])
  }
  const open = candidates.filter(([x, y]) => !doorCells.has(`${x},${y}`))
  // Shuffle by hash, then take the first few distinct cells.
  open.sort((a, b) => stageHash(a[0], a[1], 3) - stageHash(b[0], b[1], 3))
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

/** Which stage, if any, a cell belongs to: the stage index, or -1. */
export function stageAtCell(stages: readonly Stage[], cx: number, cy: number): number {
  for (let i = 0; i < stages.length; i++) {
    const r = stages[i].rect
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
  const r = stage.rect
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
