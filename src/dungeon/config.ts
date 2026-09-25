import { BRICK_TEXTURE, CASTLE_TEXTURES, FLOOR_TEXTURE, FORGE_TEXTURES, KIT, KitId, PASS_TEXTURES, PIT_TEXTURES } from './kit'
import { RoomKind } from './generator'

/** The plot is 10 x 10 parcels = 160 m, base at the south-west corner. */
export const SCENE_SIZE = 160
/**
 * The hall, the Pit and the generated styles were laid out when the scene was
 * 6 x 6 and are centred in that 96 m square still (their furniture, folk and
 * spawn are hand-placed in those metres); a style may name a wider span.
 */
export const LEGACY_SPAN = 96

/**
 * A style is a realm's look on the shared generator: which kit modules stand
 * on the grid, how big a cell is, how it is lit. `tight`, `open` and `hall`
 * are the Dark Fortress; every later realm (Synty pack exported through
 * scripts/realms/) is one more entry here.
 */
export type StyleId = 'tight' | 'open' | 'gauntlet' | 'hall' | 'castle' | 'forge' | 'pit' | 'pass'

export interface DungeonStyle {
  id: StyleId
  label: string
  /** One grid cell in metres; equals the width of the wall module. */
  tile: number
  /** Cells per side. */
  size: number
  /** Metres the grid is centred in (LEGACY_SPAN when unset). */
  span?: number
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
  /** Metres the torch stands in from the wall line (0.35 when unset: hugging a flat wall). */
  torchInset?: number
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
  /** RGB 0..1 of the torch lights; the Dark Fortress's orange flame when unset. */
  torchLightColor?: [number, number, number]
  /** Tiling floor texture (one repeat per `floorMetres`, default 2.5) and, for roofed styles, the ceiling texture. */
  floorTexture: string
  floorMetres?: number
  ceilingTexture?: string
  /** Combat-room floor trap mesh; the generator plants one cell per combat room. */
  trap?: KitId
  /**
   * Crawler camera boom for this style (metres up, degrees down) when it needs
   * to see more than a room: the raid arena pulls back to frame the Colossus.
   */
  camera?: { height: number; pitch: number }
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
   * The one dungeon: the Dark Fortress drawn by hand in ./gauntlet.ts as a
   * line of rooms (Dungeon Quest shape). Same kit and camera as `open`; the
   * generator settings below are never used for it.
   */
  gauntlet: {
    id: 'gauntlet',
    label: 'The Dark Fortress',
    tile: 5,
    size: 30,
    span: SCENE_SIZE,
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
      entrance: ['torch_stand', 'banner', 'torch_stand', 'banner'],
      boss: ['brazier', 'banner', 'cage', 'skulls', 'brazier', 'bones'],
      treasure: ['chest', 'crystal', 'rune', 'urn', 'crystal', 'rubble'],
      combat: ['cage', 'rubble', 'bones', 'skulls', 'urn', 'brazier'],
      quiet: ['torch_stand', 'rubble', 'bones', 'torch_stand']
    },
    bossCentrepiece: 'statue',
    cutawayWall: 'parapet',
    torchLightCount: 8,
    torchLightIntensity: 900,
    torchLightRange: 22,
    floorTexture: FLOOR_TEXTURE
  },
  /**
   * The hub between runs: the Hall of Antrom, drawn by hand in ./hub.ts on
   * this 60 m grid, nobody to fight. Same kit as `open` so it reads as the
   * same fortress, but lit like a home: windows on every wall, a torch on
   * every edge. The prop lists below are only a fallback should the hall ever
   * be generated; the hub places its own furniture.
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
      'castle_wall_c'
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
    torchLightColor: [1, 0.72, 0.42],
    floorTexture: CASTLE_TEXTURES.floor
  },
  /**
   * The dwarven forge from Synty's Dungeon Realms (scripts/realms/forge.json):
   * 5 m carved-stone modules on the castle's grid, lit red by the furnaces.
   * Balustrades stand in for the parapet under the crawler camera.
   */
  forge: {
    id: 'forge',
    label: 'Forge (3rd person)',
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
      'forge_wall_a',
      'forge_wall_b',
      'forge_wall_plain',
      'forge_wall_c',
      'forge_wall_d',
      'forge_wall_a',
      'forge_wall_dressed',
      'forge_wall_broken'
    ],
    door: 'forge_wall_arch',
    pillar: 'forge_pillar',
    torch: 'forge_torch',
    torchHeight: 2.8,
    torchEvery: 2,
    props: {
      entrance: ['forge_brazier', 'forge_totem', 'forge_brazier', 'forge_weapon_barrel'],
      boss: ['forge_brazier', 'forge_throne', 'forge_brazier', 'forge_totem', 'forge_trap_head', 'forge_smelting_pot'],
      treasure: ['forge_chest', 'forge_coins', 'forge_crystal', 'forge_chest', 'forge_shelf', 'forge_weapon_barrel'],
      combat: ['forge_trap_head', 'forge_weapon_barrel', 'forge_dead_dwarf', 'forge_cog_pile', 'forge_anvil_tools', 'forge_weapon_rack'],
      quiet: ['forge_table', 'forge_stool', 'forge_bench', 'forge_table_small', 'forge_shelf', 'forge_cog']
    },
    bossCentrepiece: 'forge_statue',
    cutawayWall: 'forge_balustrade',
    torchLightCount: 8,
    torchLightIntensity: 1000,
    torchLightRange: 22,
    torchLightColor: [1, 0.45, 0.18],
    floorTexture: FORGE_TEXTURES.floor,
    floorMetres: 5,
    trap: 'forge_saw'
  },
  /**
   * The Pit of Chains, the raid arena under the forge (src/dungeon/pit.ts,
   * scripts/realms/pit.json): the forge's carved walls around a 70 m ring of
   * cracked stone, hell braziers and lava, the Colossus in the middle. Lit red
   * from below; the crawler camera stands back far enough to frame a 13 m boss.
   */
  pit: {
    id: 'pit',
    label: 'Pit (raid)',
    tile: 5,
    size: 14,
    wallHeight: 5,
    entranceSize: 3,
    minLeaf: 4,
    maxLeaf: 6,
    minRoom: 2,
    ceiling: false,
    firstPerson: false,
    walls: ['forge_wall_plain', 'forge_wall_broken', 'forge_wall_a', 'forge_wall_plain', 'forge_wall_c', 'forge_wall_broken'],
    door: 'forge_wall_arch',
    pillar: 'forge_pillar',
    torch: 'forge_torch',
    torchHeight: 2.8,
    torchEvery: 2,
    props: {
      entrance: ['pit_brazier', 'pit_rubble_slab', 'pit_brazier'],
      boss: ['pit_brazier', 'pit_obelisk_a', 'pit_brazier', 'pit_spikes_a'],
      treasure: ['pit_crystals', 'pit_rubble_rocks', 'pit_crystals'],
      combat: ['pit_spikes_a', 'pit_rock_a', 'pit_rubble_slab', 'pit_brazier'],
      quiet: ['pit_rubble_slab', 'pit_rib', 'pit_rock_b', 'pit_rubble_rocks']
    },
    cutawayWall: 'forge_balustrade',
    torchLightCount: 8,
    torchLightIntensity: 1100,
    torchLightRange: 24,
    torchLightColor: [1, 0.36, 0.14],
    floorTexture: PIT_TEXTURES.floor,
    floorMetres: 5,
    camera: { height: 19, pitch: 52 }
  },
  /**
   * The Frozen Pass, drawn by hand in ./pass.ts: an open-air gorge through
   * Synty's Alpine Mountain biome (scripts/realms/pass.json) held by Vikings
   * (their camp props: scripts/realms/vik.json). Cliff modules are 10 m wide
   * and 7 m tall with their bulk shifted behind the wall line; rock arches
   * are the doorways, snow ledges the cutaway, pines stand on the corners and
   * a Viking torch stick burns at the foot of every second cliff.
   */
  pass: {
    id: 'pass',
    label: 'The Frozen Pass',
    tile: 10,
    size: 16,
    span: SCENE_SIZE,
    wallHeight: 7.2,
    entranceSize: 2,
    minLeaf: 3,
    maxLeaf: 5,
    minRoom: 2,
    ceiling: false,
    firstPerson: false,
    walls: ['pass_wall_a', 'pass_wall_b', 'pass_wall_c', 'pass_wall_d', 'pass_wall_e', 'pass_wall_c', 'pass_wall_b'],
    door: 'pass_arch',
    pillar: 'pass_pine',
    torch: 'vik_torch',
    torchHeight: 0,
    torchInset: 1.5,
    torchEvery: 2,
    props: {
      entrance: ['vik_flag', 'vik_skull_pole', 'vik_flag_b', 'vik_spikes'],
      boss: ['vik_flag', 'vik_totem', 'vik_fire_ring', 'vik_flag_b', 'vik_rack', 'vik_skull_pole', 'vik_barrel', 'vik_table'],
      treasure: ['vik_chest', 'vik_crate', 'vik_barrel', 'vik_chest', 'vik_wagon', 'vik_pot'],
      combat: ['vik_spikes_b', 'vik_skull_pole', 'pass_rock', 'vik_cow_skull', 'vik_fence', 'pass_boulder'],
      quiet: ['pass_rock_b', 'pass_mound', 'pass_pine_dead', 'pass_rock', 'pass_pebbles', 'vik_logs']
    },
    bossCentrepiece: 'vik_tower',
    cutawayWall: 'pass_ledge',
    torchLightCount: 8,
    torchLightIntensity: 800,
    torchLightRange: 20,
    torchLightColor: [1, 0.7, 0.42],
    floorTexture: PASS_TEXTURES.floor,
    floorMetres: 5
  }
}

/** Options the generator needs from a style, including whether it plants traps. */
export function styleGeneratorOptions(style: DungeonStyle) {
  return {
    size: style.size,
    entranceSize: style.entranceSize,
    minLeaf: style.minLeaf,
    maxLeaf: style.maxLeaf,
    minRoom: style.minRoom,
    torchEvery: style.torchEvery,
    cellsPerProp: style.cellsPerProp,
    traps: style.trap !== undefined
  }
}

/** Floor (and ceiling) textures one style actually draws. */
export function styleTexturesFor(style: DungeonStyle): string[] {
  const out = [style.floorTexture]
  if (style.ceilingTexture) out.push(style.ceilingTexture)
  return out
}

/**
 * Kit GLTFs a style can place — not every piece in every realm's zip. Pass
 * `furniture` for an authored layout (the hall), whose pieces replace the
 * style's generated prop lists.
 */
export function kitSrcsForStyle(style: DungeonStyle, furniture?: KitId[]): string[] {
  const ids = new Set<KitId>([
    ...style.walls,
    style.door,
    style.pillar,
    style.torch
  ])
  if (style.cutawayWall) ids.add(style.cutawayWall)
  if (style.trap) ids.add(style.trap)
  if (furniture) {
    for (const id of furniture) ids.add(id)
  } else {
    if (style.bossCentrepiece) ids.add(style.bossCentrepiece)
    for (const list of Object.values(style.props)) {
      for (const id of list) ids.add(id)
    }
  }
  return [...ids].map((id) => KIT[id].src)
}

export function gridOrigin(style: DungeonStyle): { x: number; z: number } {
  const margin = ((style.span ?? LEGACY_SPAN) - style.size * style.tile) / 2
  return { x: margin, z: margin }
}

/** World-space centre of a grid cell (fractional cells allowed). */
export function cellCenter(style: DungeonStyle, x: number, y: number): { x: number; z: number } {
  const o = gridOrigin(style)
  return { x: o.x + (x + 0.5) * style.tile, z: o.z + (y + 0.5) * style.tile }
}
