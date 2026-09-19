import { BRICK_TEXTURE, CASTLE_TEXTURES, FLOOR_TEXTURE, KitId } from './kit'
import { RoomKind } from './generator'

/** Scene is 6 x 6 parcels = 96 m. Every style's grid is centred inside it. */
export const SCENE_SIZE = 96

/**
 * A style is a realm's look on the shared generator: which kit modules stand
 * on the grid, how big a cell is, how it is lit. `tight`, `open` and `hall`
 * are the Dark Fortress; every later realm (Synty pack exported through
 * scripts/realms/) is one more entry here.
 */
export type StyleId = 'tight' | 'open' | 'hall' | 'castle'

export interface DungeonStyle {
  id: StyleId
  label: string
  /** One grid cell in metres; equals the width of the wall module. */
  tile: number
  /** Cells per side. */
  size: number
  wallHeight: number
  entranceSize: number
  /** BSP leaf bounds and smallest room side, in cells. */
  minLeaf: number
  maxLeaf: number
  minRoom: number
  /** Roofed dungeons get ceiling planes and force first person (no room for the camera boom). */
  ceiling: boolean
  firstPerson: boolean
  /** Weighted pick list for plain wall edges. */
  walls: KitId[]
  door: KitId
  pillar: KitId
  torch: KitId
  torchHeight: number
  /** Every n-th room wall edge carries a torch. */
  torchEvery: number
  /** Room floor cells per wall prop; the generator's default is 6. */
  cellsPerProp?: number
  props: Record<RoomKind, KitId[]>
  /** Optional centrepiece placed in the middle of the boss room. */
  bossCentrepiece?: KitId
  /**
   * Low wall used for camera-facing (+Z) edges when the crawler camera is on,
   * so the player is never hidden behind their own room's near wall.
   */
  cutawayWall?: KitId
  /** How many torches carry a real LightSource at once (nearest to the player). */
  torchLightCount: number
  torchLightIntensity: number
  torchLightRange: number
  /** Tiling floor texture (one repeat per 2.5 m) and, for roofed styles, the ceiling texture. */
  floorTexture: string
  ceilingTexture?: string
}

export const STYLES: Record<StyleId, DungeonStyle> = {
  tight: {
    id: 'tight',
    label: 'Tight (1st person)',
    tile: 2.5,
    size: 28,
    wallHeight: 3,
    entranceSize: 3,
    minLeaf: 5,
    maxLeaf: 9,
    minRoom: 3,
    ceiling: true,
    firstPerson: true,
    walls: ['wall_a', 'wall_a', 'wall_a', 'wall_a', 'wall_b'],
    door: 'wall_door',
    pillar: 'pillar',
    torch: 'torch_wall',
    torchHeight: 1.9,
    torchEvery: 3,
    props: {
      entrance: ['torch_stand', 'banner', 'torch_stand'],
      boss: ['brazier', 'banner', 'skulls', 'cage', 'brazier', 'banner'],
      treasure: ['chest', 'crystal', 'rune', 'urn', 'crystal'],
      combat: ['cage', 'skulls', 'urn', 'skulls', 'rune'],
      quiet: ['table', 'chair', 'urn', 'rune', 'urn']
    },
    torchLightCount: 6,
    torchLightIntensity: 260,
    torchLightRange: 12,
    floorTexture: FLOOR_TEXTURE,
    ceilingTexture: BRICK_TEXTURE
  },
  open: {
    id: 'open',
    label: 'Open (3rd person)',
    tile: 5,
    size: 18,
    wallHeight: 6,
    entranceSize: 2,
    minLeaf: 4,
    maxLeaf: 6,
    minRoom: 2,
    ceiling: false,
    firstPerson: false,
    walls: ['wall_l_a', 'wall_l_a', 'wall_l_a', 'wall_l_b', 'wall_l_window'],
    door: 'wall_l_arch',
    pillar: 'pillar_l',
    torch: 'torch_wall',
    torchHeight: 3.2,
    torchEvery: 2,
    props: {
      entrance: ['brazier', 'banner', 'brazier', 'torch_stand'],
      boss: ['brazier', 'banner', 'cage', 'skulls', 'brazier', 'bones'],
      treasure: ['chest', 'crystal', 'rune', 'urn', 'crystal', 'rubble'],
      combat: ['cage', 'rubble', 'bones', 'skulls', 'urn', 'brazier'],
      quiet: ['table', 'chair', 'urn', 'rubble', 'rune', 'bones']
    },
    bossCentrepiece: 'statue',
    cutawayWall: 'parapet',
    torchLightCount: 8,
    torchLightIntensity: 900,
    torchLightRange: 22,
    floorTexture: FLOOR_TEXTURE
  },
  /**
   * The hub between runs: a 60 m keep of three rooms, nobody to fight. Same
   * kit as `open` so it reads as the same fortress, but lit like a home:
   * windows on every wall, a torch on every edge, tables where the dungeons
   * have cages and bones. The generator's room roles still come through; the
   * "boss" room is the throne hall with the statue, "combat" the mess hall.
   */
  hall: {
    id: 'hall',
    label: 'Hall (hub)',
    tile: 5,
    size: 12,
    wallHeight: 6,
    entranceSize: 2,
    minLeaf: 4,
    maxLeaf: 7,
    minRoom: 3,
    ceiling: false,
    firstPerson: false,
    walls: ['wall_l_a', 'wall_l_window', 'wall_l_b', 'wall_l_window'],
    door: 'wall_l_arch',
    pillar: 'pillar_l',
    torch: 'torch_wall',
    torchHeight: 3.2,
    torchEvery: 1,
    cellsPerProp: 3,
    props: {
      entrance: ['brazier', 'banner', 'brazier', 'banner'],
      boss: ['banner', 'brazier', 'banner', 'brazier', 'table', 'chair'],
      treasure: ['chest', 'crystal', 'chest', 'rune', 'urn', 'crystal'],
      combat: ['table', 'chair', 'chair', 'table', 'urn', 'banner'],
      quiet: ['table', 'chair', 'rune', 'urn', 'torch_stand', 'chair']
    },
    bossCentrepiece: 'statue',
    cutawayWall: 'parapet',
    torchLightCount: 8,
    torchLightIntensity: 900,
    torchLightRange: 22,
    floorTexture: FLOOR_TEXTURE
  },
  /**
   * First realm off the Dark Fortress: a king's castle from Synty's Fantasy
   * Kingdom (scripts/realms/castle.json). Its wall modules are 5 m x 5 m, so it
   * runs on the same 18-cell grid as `open` with a lower wall; battlements
   * stand in for the parapet when the crawler camera is on.
   */
  castle: {
    id: 'castle',
    label: 'Castle (3rd person)',
    tile: 5,
    size: 18,
    wallHeight: 5,
    entranceSize: 2,
    minLeaf: 4,
    maxLeaf: 6,
    minRoom: 2,
    ceiling: false,
    firstPerson: false,
    walls: [
      'castle_wall_a',
      'castle_wall_a',
      'castle_wall_b',
      'castle_wall_c',
      'castle_wall_window',
      'castle_wall_arrowslit',
      'castle_wall_a',
      'castle_wall_door'
    ],
    door: 'castle_wall_arch',
    pillar: 'castle_pillar',
    torch: 'castle_torch',
    torchHeight: 2.6,
    torchEvery: 2,
    props: {
      entrance: ['castle_brazier', 'castle_banner', 'castle_brazier', 'castle_weapon_rack'],
      boss: ['castle_brazier', 'castle_banner', 'castle_throne', 'castle_banner', 'castle_brazier', 'castle_armor'],
      treasure: ['castle_chest', 'castle_crate', 'castle_barrel', 'castle_chest', 'castle_sacks', 'castle_shelf'],
      combat: ['castle_cage', 'castle_weapon_rack', 'castle_dead_knight', 'castle_barrel', 'castle_hay', 'castle_armor'],
      quiet: ['castle_table', 'castle_chair', 'castle_bench', 'castle_barrel', 'castle_shelf', 'castle_cauldron']
    },
    bossCentrepiece: 'castle_statue',
    cutawayWall: 'castle_battlements',
    torchLightCount: 8,
    torchLightIntensity: 900,
    torchLightRange: 22,
    floorTexture: CASTLE_TEXTURES.floor
  }
}

/** Every texture any style may ask the builder for, for preloading. */
export function styleTextures(): string[] {
  const out = new Set<string>()
  for (const s of Object.values(STYLES)) {
    out.add(s.floorTexture)
    if (s.ceilingTexture) out.add(s.ceilingTexture)
  }
  return Array.from(out)
}

export function gridOrigin(style: DungeonStyle): { x: number; z: number } {
  const margin = (SCENE_SIZE - style.size * style.tile) / 2
  return { x: margin, z: margin }
}

/** World-space centre of a grid cell (fractional cells allowed). */
export function cellCenter(style: DungeonStyle, x: number, y: number): { x: number; z: number } {
  const o = gridOrigin(style)
  return { x: o.x + (x + 0.5) * style.tile, z: o.z + (y + 0.5) * style.tile }
}
