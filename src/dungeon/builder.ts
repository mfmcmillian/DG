import {
  CameraModeArea,
  CameraType,
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  LightSource,
  Material,
  MeshCollider,
  MeshRenderer,
  PBMaterial_PbrMaterial,
  TextureWrapMode,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { DungeonStyle, gridOrigin } from './config'
import { CAMERA_LAYER } from './shoulderCamera'
import { Dungeon } from './generator'
import { BRICK_TEXTURE, KIT, KitId } from './kit'
import { Layout, layoutDungeon, LayoutOptions, PieceMode, Placement, SpawnPoint } from './layout'

export interface DungeonInstance {
  style: DungeonStyle
  root: Entity
  entities: Entity[]
  torches: Array<{ entity: Entity; position: Vector3 }>
  spawns: SpawnPoint[]
  markers: Entity[]
  stats: Layout['stats']
  /** Camera-facing walls are low (overhead camera) rather than full height. */
  cutaway: boolean
  /** Camera-facing walls: the entity and its two models. */
  swapWalls: Array<{ entity: Entity; full: KitId; low: KitId }>
  /** Pieces that exist in one mode only, with what they are so they can be switched on and off. */
  modal: Array<{ entity: Entity; placement: Placement; only: PieceMode }>
}

function floorMaterial(style: DungeonStyle): PBMaterial_PbrMaterial {
  return {
    texture: Material.Texture.Common({ src: style.floorTexture, wrapMode: TextureWrapMode.TWM_REPEAT }),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0
  }
}
/** Near-black, matte: the negative space around the rooms swallows the sky's ambient tint. */
const VOID_MATERIAL: PBMaterial_PbrMaterial = {
  albedoColor: Color4.create(0.012, 0.01, 0.016, 1),
  roughness: 1,
  metallic: 0,
  specularIntensity: 0,
  castShadows: false
}
function ceilingMaterial(style: DungeonStyle): PBMaterial_PbrMaterial {
  return {
    texture: Material.Texture.Common({ src: style.ceilingTexture ?? BRICK_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
    albedoColor: Color4.create(0.28, 0.28, 0.32, 1),
    roughness: 1,
    metallic: 0,
    specularIntensity: 0
  }
}

/** Plane UVs (both faces) repeating the texture `r` times per side. */
function planeUvs(u: number, v = u): number[] {
  const face = [0, 0, 0, v, u, v, u, 0]
  return [...face, ...face]
}

export function buildDungeon(dungeon: Dungeon, style: DungeonStyle, options?: LayoutOptions): DungeonInstance {
  const T = style.tile
  const H = style.wallHeight
  const layout = layoutDungeon(dungeon, style, options)
  const root = engine.addEntity()
  Transform.create(root, {})
  const entities: Entity[] = []
  const torches: DungeonInstance['torches'] = []
  const swapWalls: DungeonInstance['swapWalls'] = []
  const modal: DungeonInstance['modal'] = []
  const cutaway = !!options?.cutaway && style.cutawayWall !== undefined
  const torchSet = new Set(layout.torchIndices)
  // Real geometry also sits on CAMERA_LAYER so the shoulder camera's boom ray can
  // see it; door jambs and lintels deliberately do not, so the boom glides through
  // doorways instead of pulling in at every threshold.
  const solid = ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER | CAMERA_LAYER
  // Texture repeats per cell; a rectangle plane repeats it per cell it covers.
  const floorRepeat = Math.max(1, Math.round(T / (style.floorMetres ?? 2.5)))
  const floorMat = floorMaterial(style)
  const ceilingMat = ceilingMaterial(style)

  layout.placements.forEach((p, index) => {
    const e = engine.addEntity()
    entities.push(e)
    switch (p.kind) {
      case 'ground':
        Transform.create(e, { position: Vector3.create(p.x, p.y, p.z), scale: Vector3.create(p.sx, p.sy, p.sz), parent: root })
        MeshCollider.setBox(e, solid)
        MeshRenderer.setBox(e)
        Material.setPbrMaterial(e, VOID_MATERIAL)
        break
      case 'floor':
      case 'ceiling':
        Transform.create(e, {
          position: Vector3.create(p.x, p.y, p.z),
          rotation: Quaternion.fromEulerDegrees(p.kind === 'floor' ? 90 : -90, 0, 0),
          scale: Vector3.create(T * p.w, T * p.d, 1),
          parent: root
        })
        MeshRenderer.setPlane(e, planeUvs(floorRepeat * p.w, floorRepeat * p.d))
        Material.setPbrMaterial(e, p.kind === 'floor' ? floorMat : ceilingMat)
        break
      case 'box':
        Transform.create(e, {
          position: Vector3.create(p.x, p.y, p.z),
          rotation: Quaternion.fromEulerDegrees(0, p.yaw, 0),
          scale: Vector3.create(p.sx, p.sy, p.sz),
          parent: root
        })
        MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
        if (p.only) modal.push({ entity: e, placement: p, only: p.only })
        break
      case 'kit': {
        Transform.create(e, { position: Vector3.create(p.x, p.y, p.z), rotation: Quaternion.fromEulerDegrees(0, p.yaw, 0), parent: root })
        const id = p.lowId && cutaway ? p.lowId : p.id
        GltfContainer.create(e, {
          src: KIT[id].src,
          visibleMeshesCollisionMask: p.collide ? solid : ColliderLayer.CL_NONE,
          invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
        })
        if (p.lowId) swapWalls.push({ entity: e, full: p.id, low: p.lowId })
        if (p.only) modal.push({ entity: e, placement: p, only: p.only })
        if (torchSet.has(index)) torches.push({ entity: e, position: Vector3.create(p.x, p.y + 0.5, p.z) })
        break
      }
    }
  })
  for (const m of modal) setPieceEnabled(m, (m.only === 'cutaway') === cutaway, solid)

  // Roofed styles have no room for the third-person boom, which the Explorer
  // does not collide with geometry, so the whole grid becomes a first-person zone.
  if (style.firstPerson) {
    const origin = gridOrigin(style)
    const span = style.size * T
    const zone = engine.addEntity()
    entities.push(zone)
    Transform.create(zone, { position: Vector3.create(origin.x + span / 2, H / 2, origin.z + span / 2), parent: root })
    CameraModeArea.create(zone, { area: Vector3.create(span + 4, H + 2, span + 4), mode: CameraType.CT_FIRST_PERSON })
  }

  return { style, root, entities, torches, spawns: layout.spawns, markers: [], stats: layout.stats, cutaway, swapWalls, modal }
}

/**
 * Switch the camera-facing edges between full walls with doorways (shoulder
 * camera) and low parapets with open gaps (overhead camera), in place. No
 * rebuild, so loot, enemies and the player stay exactly where they are.
 */
export function setDungeonCutaway(instance: DungeonInstance, cutaway: boolean) {
  if (instance.cutaway === cutaway || instance.style.cutawayWall === undefined) return
  instance.cutaway = cutaway
  const solid = ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER | CAMERA_LAYER
  for (const w of instance.swapWalls) {
    const gltf = GltfContainer.getMutableOrNull(w.entity)
    if (gltf) gltf.src = KIT[cutaway ? w.low : w.full].src
  }
  for (const m of instance.modal) setPieceEnabled(m, (m.only === 'cutaway') === cutaway, solid)
}

/** A mode-only piece is kept as an entity and toggled: colliders off and model hidden when out of mode. */
function setPieceEnabled(m: { entity: Entity; placement: Placement }, enabled: boolean, solid: number) {
  const p = m.placement
  if (p.kind === 'box') {
    if (enabled) MeshCollider.setBox(m.entity, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
    else if (MeshCollider.has(m.entity)) MeshCollider.deleteFrom(m.entity)
  } else if (p.kind === 'kit') {
    VisibilityComponent.createOrReplace(m.entity, { visible: enabled })
    const gltf = GltfContainer.getMutableOrNull(m.entity)
    if (gltf) gltf.visibleMeshesCollisionMask = enabled && p.collide ? solid : ColliderLayer.CL_NONE
  }
}

/** Debug visualisation of enemy spawn points: red discs, gold for the boss. */
export function setSpawnMarkers(instance: DungeonInstance, visible: boolean) {
  for (const m of instance.markers) engine.removeEntity(m)
  instance.markers.length = 0
  if (!visible) return
  for (const s of instance.spawns) {
    const e = engine.addEntity()
    instance.markers.push(e)
    Transform.create(e, {
      position: Vector3.create(s.x, s.boss ? 1.2 : 0.8, s.z),
      scale: s.boss ? Vector3.create(1.6, 1.6, 1.6) : Vector3.create(0.8, 0.8, 0.8),
      parent: instance.root
    })
    MeshRenderer.setSphere(e)
    Material.setPbrMaterial(e, {
      albedoColor: s.boss ? Color4.create(1, 0.75, 0.2, 1) : Color4.create(0.9, 0.15, 0.1, 1),
      emissiveColor: s.boss ? Color3.create(1, 0.6, 0.1) : Color3.create(0.8, 0.1, 0.05),
      emissiveIntensity: 2
    })
  }
}

export function destroyDungeon(instance: DungeonInstance) {
  for (const e of instance.markers) engine.removeEntity(e)
  for (const e of instance.entities) engine.removeEntity(e)
  engine.removeEntity(instance.root)
  instance.markers.length = 0
  instance.entities.length = 0
  instance.torches.length = 0
}

// --- Torch light culling -----------------------------------------------------
// Only the torches nearest the player are lit. The lights live on a fixed set of
// persistent entities that are moved between torches; LightSource is never
// added to or removed from an entity after creation, because the Explorer's
// LightSourceLifecycleSystem mishandles re-adding a light to an entity that
// previously had one (it keeps driving a released Light and then throws every
// frame, which stalls every other scene system including the SDK camera).

let activeInstance: DungeonInstance | undefined
let lightTimer = 0
let lightSystemAdded = false
const lightPool: Entity[] = []

export function setTorchLightTarget(instance: DungeonInstance | undefined) {
  activeInstance = instance
  lightTimer = 0
  lightQueue.length = 0
  lightTorch.fill(-1)
  if (!lightSystemAdded) {
    lightSystemAdded = true
    engine.addSystem(updateTorchLights)
  }
  if (!instance) {
    for (const e of lightPool) LightSource.getMutable(e).active = false
    return
  }
  const { torchLightCount, torchLightIntensity, torchLightRange } = instance.style
  const [r, g, b] = instance.style.torchLightColor ?? [1, 0.62, 0.3]
  while (lightPool.length < torchLightCount) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -50, 0) })
    LightSource.create(e, {
      type: LightSource.Type.Point({}),
      color: Color3.create(r, g, b),
      intensity: torchLightIntensity,
      range: torchLightRange,
      shadow: false,
      active: false
    })
    lightPool.push(e)
  }
  for (const e of lightPool) {
    const l = LightSource.getMutable(e)
    l.color = Color3.create(r, g, b)
    l.intensity = torchLightIntensity
    l.range = torchLightRange
  }
}

/** Pending light moves, applied one per tick so a torch swap never lands as a single frame spike. */
const lightQueue: Array<{ light: Entity; position?: Vector3 }> = []
/** Which torch each pooled light currently sits on (index into instance.torches), or -1. */
const lightTorch: number[] = []

function updateTorchLights(dt: number) {
  const instance = activeInstance
  if (!instance) return
  // Drain: one relocation or toggle per tick.
  const job = lightQueue.shift()
  if (job) {
    const light = LightSource.getMutable(job.light)
    if (job.position) {
      Transform.getMutable(job.light).position = Vector3.clone(job.position)
      light.active = true
    } else {
      light.active = false
    }
  }
  lightTimer -= dt
  if (lightTimer > 0 || lightQueue.length) return
  lightTimer = 0.4
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return
  const { torchLightCount, torchLightRange } = instance.style
  const limit = torchLightRange * torchLightRange * 6
  const wanted = instance.torches
    .map((t, index) => ({ index, d: Vector3.distanceSquared(t.position, player) }))
    .filter(({ d }) => d < limit)
    .sort((a, b) => a.d - b.d)
    .slice(0, torchLightCount)
    .map(({ index }) => index)
  while (lightTorch.length < lightPool.length) lightTorch.push(-1)
  // Stable assignment: lights already on a wanted torch stay put; only the
  // difference is queued. Re-ranking the same set of torches costs nothing.
  const keep = new Set(wanted)
  const free: number[] = []
  lightPool.forEach((_, i) => {
    if (lightTorch[i] >= 0 && keep.has(lightTorch[i])) keep.delete(lightTorch[i])
    else free.push(i)
  })
  const missing = Array.from(keep)
  for (const i of free) {
    const torch = missing.shift()
    if (torch !== undefined) {
      lightTorch[i] = torch
      lightQueue.push({ light: lightPool[i], position: instance.torches[torch].position })
    } else if (lightTorch[i] >= 0) {
      lightTorch[i] = -1
      lightQueue.push({ light: lightPool[i] })
    }
  }
}
