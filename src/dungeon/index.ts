import { executeTask } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { buildDungeon, destroyDungeon, DungeonInstance, setDungeonCutaway, setSpawnMarkers, setTorchLightTarget } from './builder'
import { cellCenter, DungeonStyle, gridOrigin, StyleId, STYLES } from './config'
import { setCrawlerCamera } from './crawlerCamera'
import { setShoulderCamera } from './shoulderCamera'

import { Dungeon, generateDungeon } from './generator'

export type CameraChoice = 'native' | 'shoulder' | 'crawler'

export interface DungeonState {
  seed: number
  style: DungeonStyle
  dungeon: Dungeon | undefined
  instance: DungeonInstance | undefined
  showSpawns: boolean
  /** native = Explorer camera, shoulder = fixed short boom, crawler = top-down follow (open style only). */
  camera: CameraChoice
}

const loadedListeners: Array<(state: Readonly<DungeonState>) => void> = []
let cameraSuspended = false

const state: DungeonState = {
  seed: 1337,
  style: STYLES.open,
  dungeon: undefined,
  instance: undefined,
  showSpawns: false,
  camera: 'crawler'
}

/** The crawler camera only makes sense with no ceiling and a low camera-facing wall. */
export function crawlerCameraAvailable(style: DungeonStyle = state.style): boolean {
  return !style.ceiling && !style.firstPerson && style.cutawayWall !== undefined
}

export function getDungeonState(): Readonly<DungeonState> {
  return state
}

/** Fires after every (re)build, with the new layout in place. Enemy population hangs off this. */
export function onDungeonLoaded(listener: (state: Readonly<DungeonState>) => void) {
  loadedListeners.push(listener)
  if (state.instance) listener(state)
}

/** World-space bounds of the tile grid for the current style. */
export function dungeonBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const o = gridOrigin(state.style)
  const span = state.style.size * state.style.tile
  return { minX: o.x, maxX: o.x + span, minZ: o.z, maxZ: o.z + span }
}

/** True when the point sits on room or corridor floor (not rock, not outside the grid). */
export function isDungeonFloor(x: number, z: number): boolean {
  const d = state.dungeon
  if (!d) return false
  const o = gridOrigin(state.style)
  const cx = Math.floor((x - o.x) / state.style.tile)
  const cy = Math.floor((z - o.z) / state.style.tile)
  if (cx < 0 || cy < 0 || cx >= d.size || cy >= d.size) return false
  return d.cells[cy * d.size + cx] !== 0
}

/** Cell coordinates of a world point (may be outside the grid). */
export function dungeonCell(x: number, z: number): { cx: number; cy: number } {
  const o = gridOrigin(state.style)
  return { cx: Math.floor((x - o.x) / state.style.tile), cy: Math.floor((z - o.z) / state.style.tile) }
}

/**
 * Menus own the camera while they are open. Suspending releases the dungeon
 * camera without forgetting the player's choice; resuming re-applies it.
 */
export function suspendDungeonCamera() {
  cameraSuspended = true
  setShoulderCamera(false)
  setCrawlerCamera(false)
}

export function resumeDungeonCamera() {
  cameraSuspended = false
  applyCamera()
}

export function entrancePosition(dungeon: Dungeon, style: DungeonStyle): Vector3 {
  const r = dungeon.entrance
  const c = cellCenter(style, r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2)
  return Vector3.create(c.x, 0.2, c.z)
}

export function loadDungeon(seed: number, styleId: StyleId = state.style.id) {
  if (state.instance) {
    setTorchLightTarget(undefined)
    destroyDungeon(state.instance)
    state.instance = undefined
  }
  state.seed = seed >>> 0
  state.style = STYLES[styleId]
  const s = state.style
  state.dungeon = generateDungeon(state.seed, {
    size: s.size,
    entranceSize: s.entranceSize,
    minLeaf: s.minLeaf,
    maxLeaf: s.maxLeaf,
    minRoom: s.minRoom,
    torchEvery: s.torchEvery,
    cellsPerProp: s.cellsPerProp
  })
  const crawler = state.camera === 'crawler' && crawlerCameraAvailable(s)
  state.instance = buildDungeon(state.dungeon, s, { cutaway: crawler })
  setTorchLightTarget(state.instance)
  setSpawnMarkers(state.instance, state.showSpawns)
  applyCamera()
  console.log(
    `Dungeon ${state.seed} [${s.id}]: ${state.dungeon.rooms.length} rooms, ${state.instance.stats.entities} entities, ~${state.instance.stats.triangles} tris, ${state.instance.spawns.length} spawns`
  )
  for (const listener of loadedListeners) listener(state)
}

/** Rebuild with a fresh seed (optionally a different style) and put the player on the entrance tile. */
export function regenerateDungeon(styleId: StyleId = state.style.id) {
  loadDungeon(Math.floor(Math.random() * 0xffffffff), styleId)
  returnToEntrance()
}

export function switchStyle(styleId: StyleId) {
  if (styleId === state.style.id) return
  loadDungeon(state.seed, styleId)
  returnToEntrance()
}

function applyCamera() {
  if (cameraSuspended) return
  const crawler = state.camera === 'crawler' && crawlerCameraAvailable()
  setShoulderCamera(state.camera === 'shoulder')
  setCrawlerCamera(crawler)
}

/**
 * Pick a camera. Entering or leaving the crawler camera swaps the camera-facing
 * walls between parapets and full walls in place; nothing is rebuilt, so it is
 * safe mid-fight and loot stays on the floor.
 */
export function setCameraChoice(choice: CameraChoice) {
  if (choice === state.camera) return
  state.camera = choice
  if (state.instance) setDungeonCutaway(state.instance, choice === 'crawler' && crawlerCameraAvailable())
  applyCamera()
}

export function toggleSpawnMarkers() {
  state.showSpawns = !state.showSpawns
  if (state.instance) setSpawnMarkers(state.instance, state.showSpawns)
}

export function returnToEntrance() {
  if (!state.dungeon) return
  const target = entrancePosition(state.dungeon, state.style)
  executeTask(async () => {
    try {
      await movePlayerTo({
        newRelativePosition: target,
        cameraTarget: Vector3.create(target.x, 1.5, target.z - 8),
        avatarTarget: Vector3.create(target.x, target.y, target.z - 8)
      })
    } catch (error) {
      console.log('Could not move the player to the entrance', error)
    }
  })
}
