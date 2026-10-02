import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  Material,
  MeshRenderer,
  TextureWrapMode,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import alpine from './backdrop/alpine.json'
import { onDungeonLoaded } from './dungeon'
import { YARD_ROOM_BOXES } from './dungeon/barrowYard'
import { SCENE_SIZE } from './dungeon/config'
import { BOG_TEXTURES, CRYPT_TEXTURES, KIT, KitId } from './dungeon/kit'

/**
 * The world outside the hall: Synty's Alpine Mountain biome (scripts/export-alpine.py)
 * laid out in the unused band of the plot around the 60 m hall grid, which sits at
 * 18..78 on both axes. Sheer cliffs press against the short west and south margins,
 * pines and rock spill along the walls, and the wide north and east bands run out
 * through forest to snow peaks at the plot's edge. Nothing here has a collider:
 * the hall walls keep heroes in, and the backdrop is only ever seen over them.
 *
 * It only exists while the hall is loaded; dungeons stay in their black void,
 * except the Frozen Pass (src/dungeon/pass.ts), which is cut through these same
 * mountains: PASS_LAYOUT fills the plot's room-free pockets around its gorge, and
 * Bogmaw (src/dungeon/bogmaw.ts), whose swamp is drawn from its own kit
 * (BOG_LAYOUT: mud cliffs, marsh trees and low hills from the Goblin War Camp),
 * and the Crypt (src/dungeon/crypt.ts), whose hill is drawn from the Dark
 * Fantasy kit (CRYPT_LAYOUT: cliffs, barrows, dead trees, the old mausoleums).
 */

type PieceId = keyof typeof alpine.pieces

interface Piece {
  src: string
  size: number[]
  tris: number
}

interface Put<Id extends string = PieceId> {
  id: Id
  x: number
  z: number
  /** Degrees about Y. */
  yaw?: number
  /** Uniform, or [x, y, z]: the mountains are low and wide as authored and want stretching up. */
  s: number | [number, number, number]
  /** Metres to bury the base (hides a mountain's skirt in the ground). */
  sink?: number
}

const SNOW_TEXTURE = 'models/backdrop/alpine/alpine_snow.png'
const SNOW_METRES_PER_TILE = 6
const MARSH_METRES_PER_TILE = 5
const GRAVE_METRES_PER_TILE = 4

/** Pieces must stay this far inside the plot or the Explorer culls them. */
const INNER = 1

const HALL_LAYOUT: Put[] = [
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

/**
 * Around the Frozen Pass. The gorge uses cells 1..14 of a 16 x 16 grid of 10 m
 * (see the plan in src/dungeon/pass.ts); what is free is the 10 m north strip
 * widening to 30 m east of x = 50, the 10 m west strip, the 20 m east strip, the
 * two 70 x 40 m blocks either side of the entrance in the south, and a
 * 50 x 30 m pocket in the middle (x 70..120, z 70..100) the path bends around.
 */
const PASS_LAYOUT: Put[] = [
  // --- far peaks: north band, the two southern blocks -------------------------
  { id: 'mountain_02', x: 110, z: 14.5, s: [3.6, 8, 1.15], sink: 1.5 },
  { id: 'mountain_03', x: 67, z: 15, s: [2.2, 6, 1.4], sink: 1 },
  { id: 'mountain_01', x: 34, z: 140, s: [2.4, 7.5, 1.5], sink: 1.5 },
  { id: 'mountain_01', x: 124, z: 140, yaw: 180, s: [2.6, 8, 1.5], sink: 1.5 },
  { id: 'mountain_04', x: 152, z: 40, s: [1.2, 5, 2.2], sink: 1 },
  // --- ridges in the strips: north-west, west, east ----------------------------
  { id: 'cliff_07', x: 26, z: 5.2, s: [1.6, 2.4, 0.6] },
  { id: 'cliff_05', x: 5, z: 24, yaw: 90, s: [1.6, 2.6, 0.75] },
  { id: 'cliff_05', x: 5, z: 50, yaw: 90, s: [1.6, 2.6, 0.75] },
  { id: 'cliff_02', x: 5.2, z: 84, yaw: 90, s: [1.3, 2.4, 0.6] },
  { id: 'cliff_01', x: 26, z: 110, s: [1.6, 2.6, 1.2] },
  { id: 'cliff_01', x: 151, z: 62, yaw: 90, s: [1.5, 2.8, 1.5] },
  { id: 'cliff_07', x: 150.5, z: 104, yaw: 270, s: [1.2, 2.6, 1.1] },
  // --- the crag in the middle pocket, forest before it --------------------------
  { id: 'cliff_05', x: 96, z: 85, s: [1.8, 2.2, 1.4] },
  { id: 'trees_02', x: 84, z: 75, s: 1.5 },
  { id: 'trees_01', x: 100, z: 94, s: 1.4 },
  { id: 'trees_02', x: 110, z: 26.5, s: 1.6 },
  { id: 'trees_02', x: 66, z: 27, s: 1.4 },
  // --- pines ---------------------------------------------------------------------
  { id: 'pine_01', x: 74, z: 78, yaw: 20, s: 1.3 },
  { id: 'pine_02', x: 78, z: 96, yaw: 140, s: 1.2 },
  { id: 'pine_01', x: 114, z: 74, yaw: 200, s: 1.4 },
  { id: 'pine_dead', x: 116, z: 96, yaw: 70, s: 1.2 },
  { id: 'pine_01', x: 86, z: 62, yaw: 310, s: 1.3 },
  { id: 'pine_02', x: 75, z: 66, yaw: 95, s: 1.1 },
  { id: 'pine_01', x: 14, z: 74, yaw: 250, s: 1.3 },
  { id: 'pine_dead', x: 15, z: 96, yaw: 160, s: 1.2 },
  { id: 'pine_01', x: 54, z: 12, yaw: 40, s: 1.3 },
  { id: 'pine_01', x: 88, z: 27, yaw: 280, s: 1.2 },
  { id: 'pine_02', x: 130, z: 12, yaw: 10, s: 1.3 },
  { id: 'pine_01', x: 146, z: 28, yaw: 120, s: 1.2 },
  { id: 'pine_01', x: 10, z: 104, yaw: 330, s: 1.3 },
  { id: 'pine_02', x: 40, z: 117, yaw: 60, s: 1.2 },
  { id: 'pine_01', x: 64, z: 126, yaw: 190, s: 1.4 },
  { id: 'pine_dead', x: 8, z: 150, yaw: 240, s: 1.1 },
  { id: 'pine_01', x: 96, z: 126, yaw: 15, s: 1.3 },
  { id: 'pine_02', x: 140, z: 124, yaw: 100, s: 1.2 },
  { id: 'pine_01', x: 154, z: 126, yaw: 220, s: 1.2 },
  { id: 'pine_01', x: 144, z: 82, yaw: 80, s: 1.3 },
  { id: 'pine_02', x: 146, z: 132, yaw: 35, s: 1.1 },
  // --- boulders and drifts -------------------------------------------------------
  { id: 'rock_rough_01', x: 14, z: 86, yaw: 30, s: 1.6 },
  { id: 'rock_01', x: 150, z: 92, yaw: 0, s: 1.8 },
  { id: 'rock_05', x: 60, z: 124, yaw: 60, s: 2.2 },
  { id: 'rock_rough_02', x: 100, z: 124, yaw: 0, s: 2 },
  { id: 'rock_01', x: 82, z: 70.5, yaw: 90, s: 1.2 },
  { id: 'mound_01', x: 76, z: 74, s: 3 },
  { id: 'mound_03', x: 112, z: 98, s: 3.5 },
  { id: 'mound_01', x: 14, z: 78, s: 2.5 },
  { id: 'mound_03', x: 146, z: 90, s: 3 }
]

/**
 * Around Bogmaw. The camp uses cells 2..14 of the 16 x 16 grid (see the plan in
 * src/dungeon/bogmaw.ts); what is free is the 20 m west strip, the 10 m north
 * and south strips, the 60 x 90 m north-west block, the 40 x 70 m block east
 * of the King's Camp, the 10 m band across the plot at z 110..120 and the
 * pockets the path bends around (x 80..100 at z 100..120, x 0..30 at z 90..120,
 * x 140..160 at z 100..130). Mud cliffs close the horizon, marsh trees stand in
 * the pockets, hills and a low mountain sit behind them.
 */
const BOG_LAYOUT: Put<KitId>[] = [
  // --- the horizon: hills and the low mountain, stretched up -----------------------
  { id: 'bog_mountain', x: 30, z: 30, s: [1.6, 3.2, 1.5], sink: 1 },
  { id: 'bog_mountain', x: 140, z: 22, yaw: 120, s: [1.1, 2.8, 1.2], sink: 1 },
  { id: 'bog_hill', x: 20, z: 70, yaw: 20, s: [1.6, 1.6, 1.2], sink: 0.5 },
  { id: 'bog_hill', x: 145, z: 50, yaw: 100, s: [1.0, 1.4, 1.2], sink: 0.5 },
  { id: 'bog_hill', x: 150, z: 115, yaw: 60, s: [0.9, 1.3, 0.9], sink: 0.5 },
  { id: 'bog_hill', x: 12, z: 105, yaw: 200, s: [1.0, 1.4, 1.1], sink: 0.5 },
  // --- mud cliffs pressed against the outer walls -----------------------------------
  { id: 'bog_cliff_a', x: 52, z: 8, yaw: 180, s: [1.4, 1.1, 0.9] },
  { id: 'bog_cliff_b', x: 76, z: 5.5, yaw: 180, s: [1.2, 1.0, 0.6] },
  { id: 'bog_cliff_a', x: 104, z: 7.5, yaw: 180, s: [1.3, 1.0, 0.8] },
  { id: 'bog_cliff_c', x: 124, z: 12, yaw: 200, s: [1.2, 1.1, 1.0] },
  { id: 'bog_cliff_b', x: 55, z: 30, yaw: 90, s: [1.0, 1.0, 0.6] },
  { id: 'bog_cliff_a', x: 55, z: 50, yaw: 90, s: [1.0, 0.9, 0.7] },
  { id: 'bog_cliff_c', x: 125, z: 36, yaw: 270, s: [1.1, 1.0, 1.0] },
  { id: 'bog_cliff_b', x: 126, z: 56, yaw: 270, s: [1.0, 0.9, 0.7] },
  { id: 'bog_cliff_a', x: 145, z: 84, yaw: 270, s: [1.0, 0.9, 0.8] },
  { id: 'bog_cliff_c', x: 10, z: 130, yaw: 90, s: [1.2, 1.0, 1.0] },
  { id: 'bog_cliff_b', x: 10, z: 145, yaw: 90, s: [1.0, 0.9, 0.7] },
  { id: 'bog_cliff_a', x: 40, z: 155, yaw: 0, s: [1.2, 0.8, 0.6] },
  { id: 'bog_cliff_c', x: 105, z: 155, yaw: 0, s: [1.2, 0.8, 0.9] },
  { id: 'bog_cliff_b', x: 155, z: 140, yaw: 270, s: [1.0, 0.9, 0.6] },
  // --- the marsh in the pockets: trees, stumps, reeds ----------------------------------
  { id: 'bog_tree', x: 20, z: 96, yaw: 30, s: 1.3 },
  { id: 'bog_tree_b', x: 8, z: 118, yaw: 200, s: 1.2 },
  { id: 'bog_tree', x: 90, z: 110, yaw: 120, s: 1.2 },
  { id: 'bog_tree_b', x: 84, z: 116, yaw: 300, s: 1.1 },
  { id: 'bog_tree_d', x: 96, z: 104, yaw: 60, s: 1.4 },
  { id: 'bog_tree', x: 150, z: 104, yaw: 250, s: 1.2 },
  { id: 'bog_tree_c', x: 154, z: 126, yaw: 80, s: 1.5 },
  { id: 'bog_tree_b', x: 130, z: 114, yaw: 160, s: 1.2 },
  { id: 'bog_tree', x: 20, z: 115, yaw: 90, s: 1.1 },
  { id: 'bog_tree_d', x: 66, z: 115, yaw: 20, s: 1.3 },
  { id: 'bog_tree_b', x: 30, z: 80, yaw: 140, s: 1.3 },
  { id: 'bog_tree', x: 44, z: 76, yaw: 10, s: 1.4 },
  { id: 'bog_tree_c', x: 12, z: 84, yaw: 270, s: 1.4 },
  { id: 'bog_tree', x: 136, z: 64, yaw: 330, s: 1.3 },
  { id: 'bog_tree_b', x: 150, z: 70, yaw: 40, s: 1.2 },
  { id: 'bog_tree_d', x: 132, z: 8, yaw: 180, s: 1.2 },
  { id: 'bog_tree', x: 148, z: 8, yaw: 220, s: 1.1 },
  { id: 'bog_tree_c', x: 40, z: 60, yaw: 50, s: 1.6 },
  { id: 'bog_tree_b', x: 12, z: 40, yaw: 310, s: 1.3 },
  { id: 'bog_tree', x: 16, z: 14, yaw: 70, s: 1.2 },
  { id: 'bog_tree_d', x: 30, z: 6, yaw: 0, s: 1.3 },
  { id: 'bog_tree_c', x: 6, z: 152, yaw: 120, s: 1.4 },
  { id: 'bog_tree_b', x: 70, z: 155, yaw: 200, s: 1.1 },
  { id: 'bog_tree_d', x: 125, z: 155, yaw: 40, s: 1.2 },
  { id: 'bog_stump', x: 88, z: 105, yaw: 0, s: 1.4 },
  { id: 'bog_stump', x: 26, z: 108, yaw: 90, s: 1.2 },
  { id: 'bog_stump', x: 140, z: 108, yaw: 45, s: 1.5 },
  { id: 'bog_mushroom_big', x: 94, z: 114, yaw: 0, s: 1.4 },
  { id: 'bog_mushroom_big', x: 16, z: 92, yaw: 90, s: 1.8 },
  { id: 'bog_mushroom_big', x: 136, z: 72, yaw: 30, s: 1.5 },
  { id: 'bog_rock', x: 36, z: 68, yaw: 20, s: 1.4 },
  { id: 'bog_rock', x: 130, z: 106, yaw: 100, s: 1.2 },
  { id: 'bog_rock', x: 60, z: 114, yaw: 60, s: 1.0 },
  { id: 'bog_reeds', x: 84, z: 108, s: 2.2 },
  { id: 'bog_reeds', x: 98, z: 118, s: 2.0 },
  { id: 'bog_reeds', x: 22, z: 100, s: 2.4 },
  { id: 'bog_reeds', x: 146, z: 112, s: 2.2 },
  { id: 'bog_reeds', x: 8, z: 124, s: 2.0 },
  { id: 'bog_reeds', x: 132, z: 120, s: 2.0 },
  { id: 'bog_grass', x: 92, z: 118, s: 2.0 },
  { id: 'bog_grass', x: 26, z: 118, s: 2.2 },
  { id: 'bog_grass', x: 150, z: 96, s: 2.0 },
  { id: 'bog_grass', x: 64, z: 118, s: 1.8 },
  { id: 'bog_bush', x: 28, z: 92, s: 1.6 },
  { id: 'bog_bush', x: 86, z: 102, s: 1.4 },
  { id: 'bog_bush', x: 142, z: 76, s: 1.6 }
]

/**
 * Around the Crypt. Its rooms (see the plan in src/dungeon/crypt.ts) leave a
 * 50 x 70 m block in the south-west, a 50 x 50 m block in the south-east, the
 * 10 m strips along every edge, the 20 m west strip, and the pockets the path
 * bends around (x 40..100 at z 90..120, x 20..100 at z 50..70, x 110..160 at
 * z 100..130). Above the graveyard the hill rises in cliffs and barrows; dead
 * trees, spires and the older mausoleums of the hill stand in the pockets,
 * fenced yards run along the edges, and the dark stone closes the horizon.
 */
const CRYPT_LAYOUT: Put<KitId>[] = [
  // --- the hill: barrows and cliffs on the horizon, stretched up ----------------------
  { id: 'crypt_hill', x: 22, z: 30, yaw: 0, s: [1.4, 2.4, 1.2], sink: 1 },
  { id: 'crypt_hill', x: 30, z: 56, yaw: 180, s: [1.1, 1.6, 0.8], sink: 0.8 },
  { id: 'crypt_hill', x: 136, z: 24, yaw: 110, s: [1.2, 2.2, 1.1], sink: 1 },
  { id: 'crypt_hill', x: 144, z: 116, yaw: 60, s: [0.9, 1.4, 0.9], sink: 0.8 },
  { id: 'crypt_hill', x: 12, z: 100, yaw: 180, s: [0.7, 1.3, 0.8], sink: 0.8 },
  { id: 'crypt_cliff', x: 9.5, z: 12, yaw: 45, s: [1.3, 1.6, 1.0] },
  { id: 'crypt_cliff', x: 6.5, z: 60, yaw: 90, s: [1.1, 1.4, 0.9] },
  { id: 'crypt_cliff', x: 8.5, z: 140, yaw: 90, s: [1.2, 1.3, 1.0] },
  { id: 'crypt_cliff', x: 30, z: 5.5, yaw: 180, s: [1.4, 1.5, 0.9] },
  { id: 'crypt_cliff', x: 80, z: 5.5, yaw: 180, s: [1.5, 1.3, 0.9] },
  { id: 'crypt_cliff', x: 124, z: 5.5, yaw: 180, s: [1.3, 1.5, 0.9] },
  { id: 'crypt_cliff', x: 153.5, z: 40, yaw: 270, s: [1.2, 1.6, 0.9] },
  { id: 'crypt_cliff', x: 153.5, z: 80, yaw: 270, s: [1.1, 1.4, 0.9] },
  { id: 'crypt_cliff', x: 153.5, z: 150, yaw: 270, s: [1.0, 1.2, 0.9] },
  { id: 'crypt_cliff', x: 60, z: 154.5, yaw: 0, s: [1.3, 1.2, 0.9] },
  { id: 'crypt_cliff', x: 100, z: 154.5, yaw: 0, s: [1.2, 1.3, 0.9] },
  { id: 'crypt_cliff', x: 24, z: 154.5, yaw: 0, s: [1.1, 1.1, 0.9] },
  // --- the old mausoleums of the hill, with their spires ------------------------------
  { id: 'crypt_mausoleum_a', x: 36, z: 28, yaw: 160, s: 1.2 },
  { id: 'crypt_mausoleum_b', x: 24, z: 44, yaw: 110, s: 1.1 },
  { id: 'crypt_mausoleum_a', x: 128, z: 42, yaw: 250, s: 1.1 },
  { id: 'crypt_mausoleum_b', x: 70, z: 100, yaw: 20, s: 1.0 },
  { id: 'crypt_spire', x: 42, z: 20, s: 1.4 },
  { id: 'crypt_spire', x: 16, z: 52, s: 1.2 },
  { id: 'crypt_spire', x: 134, z: 50, s: 1.3 },
  { id: 'crypt_spire', x: 62, z: 106, s: 1.1 },
  { id: 'crypt_spire', x: 146, z: 108, s: 1.2 },
  { id: 'crypt_wall_round', x: 46, z: 8, s: [1.2, 1.3, 1.2] },
  { id: 'crypt_wall_round', x: 116, z: 14, s: [1.1, 1.2, 1.1] },
  { id: 'crypt_wall_round', x: 148, z: 130, s: [1.0, 1.1, 1.0] },
  // --- fenced yards in the strips and the pockets ---------------------------------------
  { id: 'crypt_fence', x: 70, z: 92, s: 1 },
  { id: 'crypt_fence', x: 80, z: 92, s: 1 },
  { id: 'crypt_fence', x: 90, z: 92, s: 1 },
  { id: 'crypt_yard_gate', x: 60, z: 92, s: 1 },
  { id: 'crypt_fence', x: 46, z: 92, s: 1 },
  { id: 'crypt_fence_short', x: 62, z: 60, yaw: 180, s: 1 },
  { id: 'crypt_fence_short', x: 98, z: 60, yaw: 180, s: 1 },
  { id: 'crypt_fence', x: 125, z: 104, s: 1 },
  { id: 'crypt_fence', x: 135, z: 104, s: 1 },
  { id: 'crypt_fence_post', x: 140.3, z: 104, s: 1 },
  { id: 'crypt_fence', x: 125, z: 152, yaw: 180, s: 1 },
  { id: 'crypt_fence', x: 135, z: 152, yaw: 180, s: 1 },
  { id: 'crypt_fence_post', x: 145.3, z: 152, s: 1 },
  { id: 'crypt_gallows', x: 94, z: 113, yaw: 210, s: 1.1 },
  { id: 'crypt_well', x: 50, z: 100, yaw: 30, s: 1 },
  { id: 'crypt_wagon', x: 118, z: 124, yaw: 300, s: 1 },
  // --- graves in the yards: two patches of Synty's own graveyard (scripts/realms/crypt-clusters.json)
  { id: 'crypt_graves_b', x: 82, z: 104, yaw: 0, s: 1 },
  { id: 'crypt_graves_a', x: 132, z: 112, yaw: 90, s: 1 },
  { id: 'crypt_lamp_post', x: 74, z: 96, yaw: 180, s: 1 },
  { id: 'crypt_stone_a', x: 120, z: 156, yaw: 15, s: 1 },
  { id: 'crypt_stone_a', x: 124, z: 155, yaw: 350, s: 1.1 },
  { id: 'crypt_tomb_a', x: 130, z: 156, yaw: 0, s: 1 },
  { id: 'crypt_stone_a', x: 136, z: 155, yaw: 5, s: 1 },
  { id: 'crypt_statue', x: 66, z: 64, yaw: 180, s: 1.2 },
  { id: 'crypt_statue', x: 94, z: 64, yaw: 180, s: 1.2 },
  // --- the dead wood in the pockets -------------------------------------------------------
  { id: 'crypt_tree_c', x: 46, z: 108, yaw: 30, s: 1.3 },
  { id: 'crypt_tree_b', x: 96, z: 100, yaw: 120, s: 1.3 },
  { id: 'crypt_tree_a', x: 66, z: 114, yaw: 300, s: 1.4 },
  { id: 'crypt_tree_b', x: 64, z: 134, yaw: 60, s: 1.2 },
  { id: 'crypt_tree_a', x: 64, z: 146, yaw: 250, s: 1.3 },
  { id: 'crypt_tree_c', x: 115, z: 110, yaw: 80, s: 1.2 },
  { id: 'crypt_tree_b', x: 148, z: 100, yaw: 160, s: 1.3 },
  { id: 'crypt_tree_c', x: 150, z: 60, yaw: 90, s: 1.4 },
  { id: 'crypt_tree_b', x: 146, z: 142, yaw: 10, s: 1.4 },
  { id: 'crypt_tree_a', x: 110, z: 154, yaw: 140, s: 1.2 },
  { id: 'crypt_tree_c', x: 84, z: 152.5, yaw: 200, s: 1.3 },
  { id: 'crypt_tree_b', x: 40, z: 150, yaw: 320, s: 1.3 },
  { id: 'crypt_tree_c', x: 14, z: 124, yaw: 40, s: 1.4 },
  { id: 'crypt_tree_b', x: 12, z: 80, yaw: 270, s: 1.3 },
  { id: 'crypt_tree_c', x: 44, z: 60, yaw: 50, s: 1.5 },
  { id: 'crypt_tree_b', x: 34, z: 66, yaw: 310, s: 1.2 },
  { id: 'crypt_tree_a', x: 76, z: 66, yaw: 70, s: 1.3 },
  { id: 'crypt_tree_c', x: 40, z: 40, yaw: 230, s: 1.4 },
  { id: 'crypt_tree_b', x: 12, z: 20, yaw: 100, s: 1.3 },
  { id: 'crypt_tree_c', x: 120, z: 30, yaw: 180, s: 1.5 },
  { id: 'crypt_tree_b', x: 146, z: 12, yaw: 220, s: 1.3 },
  { id: 'crypt_tree_a', x: 136, z: 8, yaw: 0, s: 1.2 },
  { id: 'crypt_tree_b', x: 60, z: 6, yaw: 40, s: 1.2 },
  { id: 'crypt_tree_a', x: 104, z: 6, yaw: 130, s: 1.1 },
  { id: 'crypt_rock', x: 54, z: 96, yaw: 20, s: 1.6 },
  { id: 'crypt_rock', x: 142, z: 108, yaw: 100, s: 1.4 },
  { id: 'crypt_rock', x: 24, z: 66, yaw: 60, s: 1.8 },
  { id: 'crypt_rock', x: 114, z: 44, yaw: 200, s: 1.6 },
  { id: 'crypt_rocks', x: 64, z: 112, s: 1.8 },
  { id: 'crypt_rocks', x: 130, z: 120, s: 1.6 },
  { id: 'crypt_rocks', x: 86, z: 56, s: 1.8 },
  { id: 'crypt_dirt', x: 80, z: 100, s: 1.4 },
  { id: 'crypt_dirt', x: 128, z: 112, s: 1.2 },
  { id: 'crypt_dirt', x: 128, z: 155, s: 0.7 },
  { id: 'crypt_grass', x: 50, z: 104, s: 2.0 },
  { id: 'crypt_grass', x: 92, z: 104, s: 1.8 },
  { id: 'crypt_grass', x: 120, z: 116, s: 2.0 },
  { id: 'crypt_grass', x: 64, z: 142, s: 1.8 },
  { id: 'crypt_grass', x: 70, z: 56, s: 2.0 },
  { id: 'crypt_fern', x: 58, z: 104, s: 1.8 },
  { id: 'crypt_fern', x: 138, z: 116, s: 1.6 },
  { id: 'crypt_fern', x: 98, z: 108, s: 1.8 }
]

let root: Entity | undefined

export function initializeBackdrop() {
  onDungeonLoaded((state) => {
    clear()
    if (state.style.id === 'hall') build(HALL_LAYOUT, 'hall')
    else if (state.style.id === 'pass') build(PASS_LAYOUT, 'pass')
    else if (state.style.id === 'bog') build(BOG_LAYOUT, 'bog', KIT, BOG_TEXTURES.grass, MARSH_METRES_PER_TILE)
    else if (state.style.id === 'crypt') build(CRYPT_LAYOUT, 'crypt', KIT, CRYPT_TEXTURES.dirt, GRAVE_METRES_PER_TILE)
    // The Barrow Yard shares the Crypt's hill; whatever stood where its rooms now are stays out.
    else if (state.style.id === 'yard') build(CRYPT_LAYOUT.filter((p) => !insideYard(p.x, p.z)), 'yard', KIT, CRYPT_TEXTURES.dirt, GRAVE_METRES_PER_TILE)
  })
}

const YARD_MARGIN = 6
function insideYard(x: number, z: number): boolean {
  return YARD_ROOM_BOXES.some((b) => x > b.x - YARD_MARGIN && x < b.x + b.w + YARD_MARGIN && z > b.z - YARD_MARGIN && z < b.z + b.d + YARD_MARGIN)
}

function build<Id extends string>(
  layout: Put<Id>[],
  label: string,
  pieces: Record<Id, Piece> = alpine.pieces as Record<Id, Piece>,
  texture = SNOW_TEXTURE,
  metresPerTile = SNOW_METRES_PER_TILE
) {
  if (root !== undefined) return
  root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  // Snow (or marsh grass) over the whole plot, a hair above the dungeon's black
  // slab and just under the room floors (0.005): everything that is not a floored
  // room, the gaps between the hall's buildings included, reads as open ground.
  ground(SCENE_SIZE / 2, SCENE_SIZE / 2, SCENE_SIZE, SCENE_SIZE, texture, metresPerTile)
  let tris = 0
  for (const put of layout) tris += place(put, pieces[put.id])
  console.log(`[backdrop] ${label}: ${layout.length + 1} entities, ${tris} tris`)
}

function clear() {
  if (root === undefined) return
  for (const [e] of engine.getEntitiesWith(Transform)) {
    if (Transform.get(e).parent === root) engine.removeEntity(e)
  }
  engine.removeEntity(root)
  root = undefined
}

function ground(x: number, z: number, w: number, d: number, texture: string, metresPerTile: number) {
  const e = engine.addEntity()
  Transform.create(e, {
    position: Vector3.create(x, 0.001, z),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(w, d, 1),
    parent: root
  })
  const u = w / metresPerTile
  const v = d / metresPerTile
  // Both faces of the plane, so the tile repeats per metresPerTile instead of stretching.
  MeshRenderer.setPlane(e, [0, 0, u, 0, u, v, 0, v, 0, 0, u, 0, u, v, 0, v])
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({ src: texture, wrapMode: TextureWrapMode.TWM_REPEAT }),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0
  })
}

function place(put: Put<string>, piece: Piece): number {
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
