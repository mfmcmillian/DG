import { KitId } from './kit'
import { RoomKind } from './generator'

/** Scene is 6 x 6 parcels = 96 m. Every style's grid is centred inside it. */
export const SCENE_SIZE = 96

export type StyleId = 'tight' | 'open'

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
    torchLightRange: 12
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
    torchLightRange: 22
  }
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
