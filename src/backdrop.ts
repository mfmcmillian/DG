import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  Material,
  MeshRenderer,
  SkyboxTime,
  TextureWrapMode,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import alpine from './backdrop/alpine.json'
import { onDungeonLoaded } from './dungeon'
import { SCENE_SIZE } from './dungeon/config'

/**
 * The world outside the hall: Synty's Alpine Mountain biome (scripts/export-alpine.py)
 * laid out in the unused band of the plot around the 60 m hall grid, which sits at
 * 18..78 on both axes. Sheer cliffs press against the short west and south margins,
 * pines and rock spill along the walls, and the wide north and east bands run out
 * through forest to snow peaks against the black rim. Nothing here has a collider:
 * the rim keeps heroes in, and the backdrop is only ever seen over the hall walls.
 *
 * It only exists while the hall is loaded; dungeons stay in their black void.
 */

type PieceId = keyof typeof alpine.pieces

interface Put {
  id: PieceId
  x: number
  z: number
  /** Degrees about Y. */
  yaw?: number
  /** Uniform, or [x, y, z]: the mountains are low and wide as authored and want stretching up. */
  s: number | [number, number, number]
  /** Metres to bury the base (hides a mountain's skirt in the ground). */
  sink?: number
}

/** Snow planes under everything, one per band: centre x/z and size w/d. */
const GROUND: Array<{ x: number; z: number; w: number; d: number }> = [
  { x: 80, z: 119, w: 158, d: 78 }, // north band
  { x: 119, z: 40, w: 78, d: 78 }, // east band
  { x: 9, z: 40, w: 16, d: 78 }, // west strip
  { x: 49, z: 9, w: 62, d: 16 } // south strip
]
const SNOW_TEXTURE = 'models/backdrop/alpine/alpine_snow.png'
const SNOW_METRES_PER_TILE = 6

/** Rim thickness (src/dungeon/layout.ts): pieces must stay inside the plot or the Explorer culls them. */
const INNER = 1
/** Seconds since midnight the sky is pinned to: full night, moon up, so the peaks stay silhouettes and torchlight owns the hall. */
const NIGHT = 75600

const LAYOUT: Put[] = [
  // --- far peaks, north ------------------------------------------------------
  { id: 'mountain_01', x: 44, z: 132, s: [3.4, 8.5, 2.0], sink: 1.5 },
  { id: 'mountain_02', x: 118, z: 134, s: [3.9, 9.5, 2.1], sink: 1.5 },
  { id: 'mountain_03', x: 82, z: 116, s: [2.8, 6.5, 1.6], sink: 1 },
  { id: 'mountain_04', x: 14, z: 110, s: [3.2, 6, 2.6], sink: 1 },
  // --- far peaks, east -------------------------------------------------------
  { id: 'mountain_01', x: 134, z: 46, yaw: 180, s: [2.0, 8, 3.4], sink: 1.5 },
  { id: 'mountain_03', x: 112, z: 20, yaw: 180, s: [1.7, 5.5, 2.2], sink: 1 },
  { id: 'mountain_04', x: 100, z: 96, s: [2.6, 5, 2.6], sink: 1 },
  { id: 'mountain_03', x: 140, z: 100, yaw: 90, s: [1.9, 5, 1.9], sink: 1 },
  // --- west ridge: cliffs turned long-side north-south in the 17 m strip -----
  { id: 'cliff_01', x: 8.5, z: 30, yaw: 90, s: [1.6, 2.8, 1.4] },
  { id: 'cliff_02', x: 8.5, z: 62, yaw: 270, s: [1.4, 2.6, 1.05] },
  { id: 'cliff_07', x: 9, z: 92, yaw: 90, s: [1.2, 2.4, 1.0] },
  { id: 'cliff_05', x: 8.5, z: 8.5, s: [0.9, 2.2, 1.2] },
  // --- south ridge -----------------------------------------------------------
  { id: 'cliff_07', x: 32, z: 8.5, s: [1.5, 2.6, 1.0] },
  { id: 'cliff_05', x: 64, z: 8.5, yaw: 180, s: [1.7, 2.8, 1.3] },
  { id: 'cliff_02', x: 92, z: 9, s: [1.3, 2.5, 1.2] },
  // --- mid-ground crags past the north and east walls ------------------------
  { id: 'cliff_05', x: 30, z: 90, s: [2.0, 2.0, 1.6] },
  { id: 'cliff_01', x: 60, z: 88, yaw: 180, s: [1.6, 1.8, 1.4] },
  { id: 'cliff_02', x: 92, z: 60, yaw: 90, s: [1.4, 1.8, 1.6] },
  { id: 'cliff_07', x: 94, z: 28, yaw: 270, s: [1.1, 2.0, 1.2] },
  // --- forest mass (tree cards) in front of the peaks ------------------------
  { id: 'trees_01', x: 24, z: 104, s: 1.6 },
  { id: 'trees_02', x: 60, z: 103, s: 1.7 },
  { id: 'trees_01', x: 100, z: 105, s: 1.6 },
  { id: 'trees_02', x: 140, z: 106, s: 1.7 },
  { id: 'trees_01', x: 108, z: 70, yaw: 90, s: 1.6 },
  { id: 'trees_02', x: 110, z: 36, yaw: 90, s: 1.7 },
  { id: 'trees_02', x: 112, z: 16, yaw: 90, s: 1.5 },
  // --- pines along the walls ---------------------------------------------------
  { id: 'pine_01', x: 20, z: 84, yaw: 20, s: 1.4 },
  { id: 'pine_02', x: 26, z: 86, yaw: 140, s: 1.1 },
  { id: 'pine_01', x: 40, z: 83, yaw: 200, s: 1.3 },
  { id: 'pine_02', x: 47, z: 85, yaw: 70, s: 1.2 },
  { id: 'pine_01', x: 52, z: 82, yaw: 310, s: 1.5 },
  { id: 'pine_01', x: 70, z: 84, yaw: 95, s: 1.2 },
  { id: 'pine_02', x: 76, z: 86, yaw: 250, s: 1.3 },
  { id: 'pine_01', x: 84, z: 84, yaw: 160, s: 1.4 },
  { id: 'pine_dead', x: 36, z: 96, yaw: 40, s: 1.2 },
  { id: 'pine_01', x: 66, z: 95, yaw: 280, s: 1.6 },
  { id: 'pine_01', x: 12, z: 88, yaw: 10, s: 1.3 },
  { id: 'pine_01', x: 82, z: 20, yaw: 120, s: 1.3 },
  { id: 'pine_02', x: 84, z: 30, yaw: 330, s: 1.2 },
  { id: 'pine_01', x: 83, z: 44, yaw: 60, s: 1.5 },
  { id: 'pine_dead', x: 85, z: 52, yaw: 190, s: 1.3 },
  { id: 'pine_01', x: 82, z: 66, yaw: 240, s: 1.2 },
  { id: 'pine_01', x: 86, z: 74, yaw: 15, s: 1.4 },
  { id: 'pine_02', x: 96, z: 80, yaw: 100, s: 1.3 },
  { id: 'pine_01', x: 104, z: 86, yaw: 220, s: 1.5 },
  { id: 'pine_01', x: 100, z: 50, yaw: 80, s: 1.6 },
  { id: 'pine_01', x: 6, z: 20, yaw: 35, s: 1.2 },
  { id: 'pine_02', x: 12, z: 50, yaw: 170, s: 1.3 },
  { id: 'pine_01', x: 7, z: 72, yaw: 290, s: 1.1 },
  { id: 'pine_dead', x: 12, z: 12, yaw: 5, s: 1.1 },
  { id: 'pine_02', x: 24, z: 12, yaw: 130, s: 1.2 },
  { id: 'pine_01', x: 44, z: 6, yaw: 45, s: 1.2 },
  { id: 'pine_01', x: 58, z: 13, yaw: 260, s: 1.1 },
  { id: 'pine_dead', x: 78, z: 6, yaw: 90, s: 1.2 },
  // --- boulders and drifts at the foot of the walls ---------------------------
  { id: 'rock_rough_01', x: 84, z: 84, yaw: 30, s: 2 },
  { id: 'rock_01', x: 22, z: 82, yaw: 0, s: 1.8 },
  { id: 'rock_05', x: 60, z: 81, yaw: 60, s: 2.2 },
  { id: 'rock_rough_02', x: 82, z: 10, yaw: 0, s: 2 },
  { id: 'rock_01', x: 10, z: 60, yaw: 90, s: 1.5 },
  { id: 'rock_rough_01', x: 96, z: 100, yaw: 0, s: 2.5 },
  { id: 'rock_05', x: 4.5, z: 44, yaw: 0, s: 1.4 },
  { id: 'rock_rough_02', x: 30, z: 6.5, yaw: 90, s: 1.6 },
  { id: 'mound_01', x: 30, z: 82, s: 3 },
  { id: 'mound_03', x: 84, z: 60, s: 3.5 },
  { id: 'mound_01', x: 70, z: 82, s: 2.5 },
  { id: 'mound_03', x: 12, z: 30, s: 3 },
  { id: 'mound_01', x: 90, z: 16, s: 3 }
]

let root: Entity | undefined

export function initializeBackdrop() {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: NIGHT })
  onDungeonLoaded((state) => {
    if (state.style.id === 'hall') build()
    else clear()
  })
}

function build() {
  if (root !== undefined) return
  root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  for (const g of GROUND) ground(g.x, g.z, g.w, g.d)
  let tris = 0
  for (const put of LAYOUT) tris += place(put)
  console.log(`[backdrop] alpine: ${LAYOUT.length + GROUND.length} entities, ${tris} tris`)
}

function clear() {
  if (root === undefined) return
  for (const [e] of engine.getEntitiesWith(Transform)) {
    if (Transform.get(e).parent === root) engine.removeEntity(e)
  }
  engine.removeEntity(root)
  root = undefined
}

function ground(x: number, z: number, w: number, d: number) {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(x, 0.02, z),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(w, d, 1),
    parent: root
  })
  const u = w / SNOW_METRES_PER_TILE
  const v = d / SNOW_METRES_PER_TILE
  // Both faces of the plane, so the tile repeats per SNOW_METRES_PER_TILE instead of stretching.
  MeshRenderer.setPlane(e, [0, 0, u, 0, u, v, 0, v, 0, 0, u, 0, u, v, 0, v])
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({ src: SNOW_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0
  })
}

function place(put: Put): number {
  const piece = alpine.pieces[put.id]
  const [sx, sy, sz] = typeof put.s === 'number' ? [put.s, put.s, put.s] : put.s
  const yaw = put.yaw ?? 0
  const y = -(put.sink ?? 0)
  // Footprint check: a quarter turn swaps the axes; anything else takes the bounding circle.
  const w = piece.size[0] * sx
  const d = piece.size[2] * sz
  const quarter = Math.abs(((yaw % 180) + 180) % 180 - 90) < 0.01
  const flat = yaw % 90 === 0
  const halfX = flat ? (quarter ? d : w) / 2 : Math.hypot(w, d) / 2
  const halfZ = flat ? (quarter ? w : d) / 2 : Math.hypot(w, d) / 2
  if (put.x - halfX < INNER || put.x + halfX > SCENE_SIZE - INNER || put.z - halfZ < INNER || put.z + halfZ > SCENE_SIZE - INNER) {
    console.log(`[backdrop] ${put.id} at ${put.x},${put.z} leaves the plot (${(put.x - halfX).toFixed(1)}..${(put.x + halfX).toFixed(1)} x ${(put.z - halfZ).toFixed(1)}..${(put.z + halfZ).toFixed(1)})`)
  }
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(put.x, y, put.z),
    rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
    scale: Vector3.create(sx, sy, sz),
    parent: root
  })
  GltfContainer.create(e, {
    src: piece.src,
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return piece.tris
}
