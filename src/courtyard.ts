import { Vector3 } from '@dcl/sdk/math'
import scene from '../scene.json'
import { dungeonBounds, entrancePosition, getDungeonState, isDungeonFloor } from './dungeon'

const SPAWN = scene.spawnPoints.find((point) => point.default) ?? scene.spawnPoints[0]

// The playable area is the dungeon grid. The name is historical: the rest of
// the scene (placement, menus, combat) reads its measurements from here and
// character identity never changes placement.
const bounds = dungeonBounds()
export const COURTYARD = {
  minX: bounds.minX, maxX: bounds.maxX,
  minZ: bounds.minZ, maxZ: bounds.maxZ,
  wallHeight: 6,
  characterFloorY: 0.05,
  supportTopY: 0,
  supportDepth: 1,
  sceneSize: 96
} as const

/** Entrance tile of the current dungeon; falls back to the static spawn before generation. */
export function courtyardSpawnPosition(): Vector3 {
  const { dungeon, style } = getDungeonState()
  if (dungeon) {
    const p = entrancePosition(dungeon, style)
    return Vector3.create(p.x, 0.3, p.z)
  }
  const { x, y, z } = SPAWN.position
  return Vector3.create(x, y, z)
}

/** Face into the dungeon (towards -Z) from the entrance. */
export function courtyardSpawnCameraTarget(): Vector3 {
  const spawn = courtyardSpawnPosition()
  return Vector3.create(spawn.x, 1.5, spawn.z - 8)
}

export function characterPreviewPosition(): Vector3 {
  const spawn = courtyardSpawnPosition()
  return Vector3.create(spawn.x, 0.22, spawn.z - 3)
}

/** Standing on dungeon floor, as opposed to rock, wall tops or outside the grid. */
export function isInCourtyard(position: Vector3): boolean {
  return isDungeonFloor(position.x, position.z)
}
