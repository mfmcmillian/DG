// Kit modules the builder places. Every piece is recentred on its footprint
// with its base at y = 0 (wall-hung pieces: top at y = 0) and its detailed
// face towards +Z. Sizes are glTF x / y / z in metres.
//
// The Dark Fortress set below was exported by scripts/export-kit.py. Every
// other realm is exported by scripts/export-realm-kit.py from a manifest in
// scripts/realms/, which writes the kit JSON merged here from src/dungeon/kits/.
import castleKit from './kits/castle.json'
import forgeKit from './kits/forge.json'
import pitKit from './kits/pit.json'

export interface KitPiece {
  src: string
  size: [number, number, number]
  tris: number
  /**
   * Wall-mounted prop: hung with its anchor at `height` metres (clamped under
   * the wall top), `inset` metres in from the wall edge, never a collider.
   */
  wall?: { height: number; inset: number }
  /** false: walk-through decoration (bones, rubble, sacks). Default true. */
  collide?: boolean
  /**
   * Wall variant with a see-through breach or doorway in its mesh. The layout
   * backs it with an invisible full-tile collider so the room stays closed.
   */
  sealed?: boolean
}

const DARK_FORTRESS = {
  wall_a: { src: 'models/dungeon/wall_a.gltf', size: [2.5, 3.01, 0.36], tris: 586 },
  wall_b: { src: 'models/dungeon/wall_b.gltf', size: [2.5, 3.01, 0.39], tris: 596 },
  wall_door: { src: 'models/dungeon/wall_door.gltf', size: [2.5, 3.01, 0.35], tris: 1006 },
  pillar: { src: 'models/dungeon/pillar.gltf', size: [0.72, 3.0, 1.07], tris: 84 },
  torch_wall: { src: 'models/dungeon/torch_wall.gltf', size: [0.6, 0.6, 0.66], tris: 522 },
  torch_stand: { src: 'models/dungeon/torch_stand.gltf', size: [0.25, 1.23, 0.29], tris: 662 },
  urn: { src: 'models/dungeon/urn.gltf', size: [0.77, 1.04, 0.77], tris: 380 },
  skulls: { src: 'models/dungeon/skulls.gltf', size: [0.65, 0.39, 0.41], tris: 400, collide: false },
  table: { src: 'models/dungeon/table.gltf', size: [2.02, 0.95, 1.02], tris: 894 },
  chair: { src: 'models/dungeon/chair.gltf', size: [0.52, 1.0, 0.45], tris: 968 },
  crystal: { src: 'models/dungeon/crystal.gltf', size: [0.87, 1.99, 0.86], tris: 110 },
  rune: { src: 'models/dungeon/rune.gltf', size: [0.8, 0.6, 0.06], tris: 96, wall: { height: 1.4, inset: 0.2 } },
  cage: { src: 'models/dungeon/cage.gltf', size: [1.5, 2.35, 1.44], tris: 1416 },
  brazier: { src: 'models/dungeon/brazier.gltf', size: [1.16, 1.23, 1.17], tris: 728 },
  banner: { src: 'models/dungeon/banner.gltf', size: [1.24, 3.86, 0.52], tris: 1442, wall: { height: 3.35, inset: 0.3 } },
  chest: { src: 'models/dungeon/chest.gltf', size: [1.26, 0.91, 0.7], tris: 4979 },
  // 5 m x 6 m "L" series for the open style
  wall_l_a: { src: 'models/dungeon/wall_l_a.gltf', size: [5, 6.01, 0.45], tris: 196 },
  wall_l_b: { src: 'models/dungeon/wall_l_b.gltf', size: [5, 6.01, 0.61], tris: 500 },
  wall_l_window: { src: 'models/dungeon/wall_l_window.gltf', size: [5, 6.01, 0.65], tris: 404 },
  wall_l_door: { src: 'models/dungeon/wall_l_door.gltf', size: [5, 6.04, 0.73], tris: 702 },
  pillar_l: { src: 'models/dungeon/pillar_l.gltf', size: [0.72, 6, 1.07], tris: 92 },
  statue: { src: 'models/dungeon/statue.gltf', size: [2.25, 5.7, 2.28], tris: 1654 },
  rubble: { src: 'models/dungeon/rubble.gltf', size: [2.38, 0.32, 1.59], tris: 470, collide: false },
  bones: { src: 'models/dungeon/bones.gltf', size: [0.67, 1.2, 0.84], tris: 246, collide: false },
  wall_l_arch: { src: 'models/dungeon/wall_l_arch.gltf', size: [5, 6.02, 0.41], tris: 526 },
  parapet: { src: 'models/dungeon/parapet.gltf', size: [5, 1.99, 0.92], tris: 346 }
} satisfies Record<string, KitPiece>

/** A generated kit JSON's pieces, typed as KitPiece while keeping its literal ids. */
function realmPieces<T extends Record<string, unknown>>(kit: { pieces: T }): { [K in keyof T]: KitPiece } {
  return kit.pieces as unknown as { [K in keyof T]: KitPiece }
}

export const KIT = {
  ...DARK_FORTRESS,
  ...realmPieces(castleKit),
  ...realmPieces(forgeKit),
  ...realmPieces(pitKit)
} satisfies Record<string, KitPiece>

export type KitId = keyof typeof KIT

/**
 * Clear opening of each doorway module (measured by raycasting the mesh), so
 * the builder can give doors camera-friendly box colliders on the solid parts
 * only instead of a collider over the whole frame.
 */
export const DOOR_OPENINGS: Partial<Record<KitId, { width: number; height: number }>> = {
  wall_door: { width: 2.0, height: 2.1 },
  wall_l_arch: { width: 3.8, height: 4.5 },
  castle_wall_arch: { width: 3.4, height: 3.5 },
  forge_wall_arch: { width: 3.7, height: 3.55 }
}

/** Dark Fortress floor and brick; other realms carry their own in their kit JSON (see DungeonStyle). */
export const FLOOR_TEXTURE = 'models/dungeon/floor_tiles.png'
export const BRICK_TEXTURE = 'models/dungeon/Brick_Large_Texture_01.png'

export const CASTLE_TEXTURES = castleKit.textures
export const FORGE_TEXTURES = forgeKit.textures
export const PIT_TEXTURES = pitKit.textures

/** Triangle cost of the primitive pieces the builder makes itself. */
export const PRIMITIVE_TRIS = { plane: 4, box: 12 }
