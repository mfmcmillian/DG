// The Crypt's air: a cold mist on every floor, grave-motes drifting in the
// dark, the candles and braziers burning, bats over the graveyard, the moon
// over the hill, the wind that loops under it, and the Lich's circle glowing
// in the Vault. All of it is presentation on the client; nothing here is
// gameplay. Built with the crypt (buildCryptFx) and torn down with it
// (clearCryptFx). The witches' bone wards reuse Bogmaw's totem aura.

import {
  AudioSource, Billboard, BillboardMode, engine, Entity, LightSource, Material, MaterialTransparencyMode, MeshRenderer, ParticleSystem,
  PBParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, PBParticleSystem_SimulationSpace, Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { CRYPT_CIRCLE, CRYPT_OPEN_BOXES, CRYPT_ROOM_BOXES, cryptFires } from './dungeon/crypt'
import { YARD_CIRCLE, YARD_ROOM_BOXES, yardFires } from './dungeon/barrowYard'
import { CRYPT_TEXTURES } from './dungeon/kit'

// The protocol enums are const enums in the SDK typings: no runtime export.
const BLEND_ALPHA = 0 as PBParticleSystem_BlendMode
const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState
const WORLD_SPACE = 1 as PBParticleSystem_SimulationSpace

const FLOOR_Y = COURTYARD.characterFloorY
const TEX_SPARK = 'images/fx/sparkle.png'
const TEX_SMOKE = 'images/fx/smoke_01.png'
const TEX_RITUAL = 'images/fx/ritualcircle_01.png'
const TEX_FIRE_SHEET = 'images/fx/fire_sheet.png'
const SHEET_TILES = 8
const WIND_LOOP = 'sounds/crypt_loop.wav'

const GRAVE_GREEN = Color4.create(0.35, 1, 0.55, 1)

type Ambience = {
  root: Entity
  /** The circle's glow breathes. */
  circle: Entity
  clock: number
}

let ambience: Ambience | undefined

function emitter(parent: Entity, position: Vector3, config: PBParticleSystem, rotation = Quaternion.Identity()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, rotation })
  ParticleSystem.create(e, { ...config, active: true, loop: true, prewarm: true, playbackState: PLAYING })
  return e
}

function ritualPlane(parent: Entity, position: Vector3, size: number, color: Color4): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(size, size, 1) })
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({ src: TEX_RITUAL }),
    emissiveTexture: Material.Texture.Common({ src: TEX_RITUAL }),
    albedoColor: color,
    emissiveColor: Color3.create(color.r, color.g, color.b),
    emissiveIntensity: 2.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  return e
}

// --- the configurations -----------------------------------------------------------

function mistConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: TEX_SMOKE },
    blendMode: BLEND_ALPHA,
    rate: Math.max(1.2, (w * d) / 600),
    maxParticles: 30,
    lifetime: 10,
    gravity: 0,
    initialSize: { start: 7, end: 12 },
    sizeOverTime: { start: 0.8, end: 1.2 },
    initialColor: { start: Color4.create(0.5, 0.6, 0.62, 0.13), end: Color4.create(0.42, 0.52, 0.5, 0.11) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.05, end: 0.2 },
    additionalForce: Vector3.create(-0.06, 0, 0.04),
    rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 4),
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 0.3, d) }),
    simulationSpace: WORLD_SPACE
  }
}

function motesConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK },
    blendMode: BLEND_ADD,
    rate: Math.max(1.5, (w * d) / 420),
    maxParticles: 50,
    lifetime: 6,
    gravity: 0,
    initialSize: { start: 0.05, end: 0.1 },
    sizeOverTime: { start: 0.2, end: 1 },
    initialColor: { start: Color4.create(0.5, 0.9, 0.7, 1), end: Color4.create(0.6, 0.75, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.1, end: 0.4 },
    additionalForce: Vector3.create(0, 0.08, 0),
    limitVelocity: { speed: 0.3, dampen: 0.1 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 3, d) }),
    simulationSpace: WORLD_SPACE
  }
}

function flameConfig(size: number): PBParticleSystem {
  const lifetime = 0.9
  return {
    texture: { src: TEX_FIRE_SHEET },
    spriteSheet: { tilesX: SHEET_TILES, tilesY: SHEET_TILES, framesPerSecond: (SHEET_TILES * SHEET_TILES) / lifetime },
    blendMode: BLEND_ADD,
    rate: 7 * size,
    maxParticles: 24,
    lifetime,
    gravity: 0,
    additionalForce: Vector3.create(0, 0.6, 0),
    initialSize: { start: 1.1 * size, end: 1.6 * size },
    sizeOverTime: { start: 0.7, end: 1.1 },
    initialColor: { start: Color4.create(1, 0.95, 0.8, 1), end: Color4.create(1, 0.75, 0.45, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.5, 0.2, 0) },
    initialVelocitySpeed: { start: 0.2, end: 0.5 },
    shape: ParticleSystem.Shape.Cone({ angle: 8, radius: 0.25 * size })
  }
}

function emberConfig(size: number): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK },
    blendMode: BLEND_ADD,
    rate: 8 * size,
    maxParticles: 50,
    lifetime: 2.4,
    gravity: 0,
    additionalForce: Vector3.create(0.1, 0.9, 0.05),
    initialSize: { start: 0.05, end: 0.12 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1, 0.8, 0.4, 1), end: Color4.create(1, 0.5, 0.2, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.4, 0.1, 0) },
    initialVelocitySpeed: { start: 0.8, end: 1.8 },
    shape: ParticleSystem.Shape.Cone({ angle: 25, radius: 0.3 * size }),
    simulationSpace: WORLD_SPACE
  }
}

/** Bats over the graveyard: the pack's bat sprite, tumbling across the yard at roof height. */
function batsConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: CRYPT_TEXTURES.bat },
    blendMode: BLEND_ALPHA,
    rate: Math.max(0.8, (w * d) / 900),
    maxParticles: 14,
    lifetime: 7,
    gravity: 0,
    initialSize: { start: 0.9, end: 1.4 },
    sizeOverTime: { start: 1, end: 1 },
    initialColor: { start: Color4.create(0.12, 0.1, 0.14, 1), end: Color4.create(0.2, 0.16, 0.22, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 2.5, end: 4.5 },
    additionalForce: Vector3.create(0, 0.15, 0),
    rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 40),
    faceTravelDirection: true,
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 2.5, d) }),
    simulationSpace: WORLD_SPACE
  }
}

function ritualConfig(radius: number, rate: number): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK },
    blendMode: BLEND_ADD,
    rate,
    maxParticles: 50,
    lifetime: 1.8,
    gravity: 0,
    additionalForce: Vector3.create(0, 0.9, 0),
    initialSize: { start: 0.08, end: 0.16 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: GRAVE_GREEN, end: Color4.create(0.8, 1, 0.7, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(GRAVE_GREEN.r, GRAVE_GREEN.g, GRAVE_GREEN.b, 0) },
    initialVelocitySpeed: { start: 0.2, end: 0.6 },
    shape: ParticleSystem.Shape.Cone({ angle: 12, radius })
  }
}

// --- build / clear ----------------------------------------------------------------

/** Client: fill the crypt (or the Barrow Yard, built from its kit) with its mist, its fires and its night. Call when the map is built. */
export function buildCryptFx(map: 'crypt' | 'yard' = 'crypt') {
  clearCryptFx()
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  const yard = map === 'yard'
  const roomBoxes = yard ? YARD_ROOM_BOXES : CRYPT_ROOM_BOXES
  const openBoxes = yard ? YARD_ROOM_BOXES : CRYPT_OPEN_BOXES
  const fires = yard ? yardFires() : cryptFires()
  const CIRCLE = yard ? YARD_CIRCLE : CRYPT_CIRCLE

  for (const box of roomBoxes) {
    const cx = box.x + box.w / 2
    const cz = box.z + box.d / 2
    emitter(root, Vector3.create(cx, FLOOR_Y + 0.5, cz), mistConfig(box.w + 4, box.d + 4))
    emitter(root, Vector3.create(cx, FLOOR_Y + 1.8, cz), motesConfig(box.w, box.d))
  }
  for (const box of openBoxes) {
    emitter(root, Vector3.create(box.x + box.w / 2, FLOOR_Y + 7, box.z + box.d / 2), batsConfig(box.w + 10, box.d + 10))
  }

  for (const fire of fires) {
    const at = Vector3.create(fire.x, FLOOR_Y + fire.y, fire.z)
    emitter(root, at, flameConfig(fire.size))
    if (fire.size >= 0.4) emitter(root, at, emberConfig(fire.size))
    if (fire.light) {
      const glow = engine.addEntity()
      Transform.create(glow, { parent: root, position: Vector3.create(fire.x, FLOOR_Y + fire.y + 1, fire.z) })
      LightSource.create(glow, {
        type: LightSource.Type.Point({}), color: Color3.create(1, 0.6, 0.25), intensity: 3.5 + 2 * fire.size, range: 10 + 5 * fire.size, shadow: false, active: true
      })
    }
  }

  // The Lich's circle: the ring glows grave-green and breathes; the dead rise out of it.
  const circle = ritualPlane(root, Vector3.create(CIRCLE.x, FLOOR_Y + 0.07, CIRCLE.z), 7, Color4.create(GRAVE_GREEN.r, GRAVE_GREEN.g, GRAVE_GREEN.b, 0.8))
  emitter(root, Vector3.create(CIRCLE.x, FLOOR_Y + 0.2, CIRCLE.z), ritualConfig(3, 16))
  const circleLight = engine.addEntity()
  Transform.create(circleLight, { parent: root, position: Vector3.create(CIRCLE.x, FLOOR_Y + 2.5, CIRCLE.z) })
  LightSource.create(circleLight, { type: LightSource.Type.Point({}), color: Color3.create(0.35, 1, 0.55), intensity: 9, range: 18, shadow: false, active: true })

  // The moon over the hill, north-east, a billboard just inside the plot's edge.
  const moon = engine.addEntity()
  Transform.create(moon, { parent: root, position: Vector3.create(150, 44, 8), scale: Vector3.create(14, 14, 1) })
  MeshRenderer.setPlane(moon)
  Billboard.create(moon, { billboardMode: BillboardMode.BM_Y })
  Material.setPbrMaterial(moon, {
    texture: Material.Texture.Common({ src: CRYPT_TEXTURES.moon }),
    emissiveTexture: Material.Texture.Common({ src: CRYPT_TEXTURES.moon }),
    albedoColor: Color4.create(0.9, 0.92, 1, 1),
    emissiveColor: Color3.create(0.8, 0.85, 1),
    emissiveIntensity: 1.6,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })

  // The wind under the hill, everywhere at once.
  const wind = engine.addEntity()
  Transform.create(wind, { parent: root, position: Vector3.create(80, FLOOR_Y + 2, 80) })
  AudioSource.create(wind, { audioClipUrl: WIND_LOOP, playing: true, loop: true, volume: 0.3, global: true })

  ambience = { root, circle, clock: 0 }
}

export function clearCryptFx() {
  if (!ambience) return
  engine.removeEntityWithChildren(ambience.root)
  ambience = undefined
}

/** Client: the circle's glow breathes. */
export function tickCryptFx(dt: number) {
  const a = ambience
  if (!a) return
  a.clock += dt
  const pulse = 0.65 + 0.35 * Math.sin(a.clock * 1.4)
  const mat = Material.getMutableOrNull(a.circle)
  if (mat?.material?.$case === 'pbr') mat.material.pbr.emissiveIntensity = 1.6 + 1.6 * pulse
}
