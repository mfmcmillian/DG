// Bogmaw's air: fog lying on the marsh, fireflies, the camp's fires, bubbles
// out of the deep mud, a rain that follows the hero with thunder now and then,
// and the shaman's green rituals (the shrine's, and one under every standing
// war totem). All of it is presentation on the client; nothing here is
// gameplay. Built with the camp (buildBogFx) and torn down with it (clearBogFx).

import {
  AudioSource, engine, Entity, LightSource, Material, MaterialTransparencyMode, MeshRenderer, ParticleSystem, PBParticleSystem,
  PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, PBParticleSystem_SimulationSpace, Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { bogFires, BOG_ROOM_BOXES, BOG_SHRINE, BOG_TRAPS } from './dungeon/bogmaw'
import { fxSound } from './combatFx'
import { localHeroInMud } from './bogTraps'

// The protocol enums are const enums in the SDK typings: no runtime export.
const BLEND_ALPHA = 0 as PBParticleSystem_BlendMode
const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState
const STOPPED = 2 as PBParticleSystem_PlaybackState
const WORLD_SPACE = 1 as PBParticleSystem_SimulationSpace

const FLOOR_Y = COURTYARD.characterFloorY
const TEX_SOFT = 'images/fx/soft_spot.png'
const TEX_SPARK = 'images/fx/sparkle.png'
const TEX_SMOKE = 'images/fx/smoke_01.png'
const TEX_RITUAL = 'images/fx/ritualcircle_01.png'
const TEX_FIRE_SHEET = 'images/fx/fire_sheet.png'
const SHEET_TILES = 8
const RAIN_LOOP = 'sounds/rain_loop.wav'

const GREEN = Color4.create(0.45, 1, 0.3, 1)

type Ambience = {
  root: Entity
  /** Follows the local hero: the rain, its sound, the lightning, the wading bubbles. */
  sky: Entity
  rain: Entity
  bolt: Entity
  wade: Entity
  wading: boolean
  flash: number
  thunderIn: number
  nextBolt: number
  clock: number
}

let ambience: Ambience | undefined
const totemAuras = new Map<Entity, Entity>()

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

function fogConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: TEX_SMOKE },
    blendMode: BLEND_ALPHA,
    rate: Math.max(1.5, (w * d) / 500),
    maxParticles: 36,
    lifetime: 9,
    gravity: 0,
    initialSize: { start: 7, end: 11 },
    sizeOverTime: { start: 0.8, end: 1.2 },
    initialColor: { start: Color4.create(0.55, 0.66, 0.5, 0.16), end: Color4.create(0.45, 0.55, 0.42, 0.14) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.1, end: 0.3 },
    additionalForce: Vector3.create(0.12, 0, 0.05),
    rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 6),
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 0.4, d) }),
    simulationSpace: WORLD_SPACE
  }
}

function firefliesConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK },
    blendMode: BLEND_ADD,
    rate: Math.max(2, (w * d) / 300),
    maxParticles: 60,
    lifetime: 5,
    gravity: 0,
    initialSize: { start: 0.07, end: 0.12 },
    sizeOverTime: { start: 0.2, end: 1 },
    initialColor: { start: Color4.create(0.75, 1, 0.35, 1), end: Color4.create(1, 0.95, 0.5, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.2, end: 0.6 },
    limitVelocity: { speed: 0.4, dampen: 0.1 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 2, d) }),
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
    rate: 9 * size,
    maxParticles: 60,
    lifetime: 2.4,
    gravity: 0,
    additionalForce: Vector3.create(0.2, 0.9, 0.1),
    initialSize: { start: 0.05, end: 0.12 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1, 0.8, 0.4, 1), end: Color4.create(1, 0.5, 0.2, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.4, 0.1, 0) },
    initialVelocitySpeed: { start: 0.8, end: 1.8 },
    shape: ParticleSystem.Shape.Cone({ angle: 25, radius: 0.3 * size }),
    simulationSpace: WORLD_SPACE
  }
}

function bubblesConfig(rate: number, radius: number): PBParticleSystem {
  return {
    texture: { src: TEX_SOFT },
    blendMode: BLEND_ALPHA,
    rate,
    maxParticles: 30,
    lifetime: 1.1,
    gravity: 0,
    additionalForce: Vector3.create(0, 0.5, 0),
    initialSize: { start: 0.08, end: 0.2 },
    sizeOverTime: { start: 0.6, end: 1.2 },
    initialColor: { start: Color4.create(0.7, 0.85, 0.6, 0.7), end: Color4.create(0.55, 0.7, 0.45, 0.7) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.8), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.1, end: 0.3 },
    shape: ParticleSystem.Shape.Cone({ angle: 10, radius }),
    simulationSpace: WORLD_SPACE
  }
}

function rainConfig(): PBParticleSystem {
  return {
    texture: { src: TEX_SOFT },
    blendMode: BLEND_ALPHA,
    rate: 260,
    maxParticles: 320,
    lifetime: 1.25,
    gravity: 0,
    additionalForce: Vector3.create(0.8, -14, 0),
    initialSize: { start: 0.05, end: 0.09 },
    sizeOverTime: { start: 1, end: 1 },
    initialColor: { start: Color4.create(0.75, 0.85, 0.95, 0.5), end: Color4.create(0.85, 0.9, 1, 0.35) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0.6) },
    initialVelocitySpeed: { start: 9, end: 12 },
    faceTravelDirection: true,
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(34, 0.5, 34) }),
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
    initialColor: { start: GREEN, end: Color4.create(0.8, 1, 0.6, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(GREEN.r, GREEN.g, GREEN.b, 0) },
    initialVelocitySpeed: { start: 0.2, end: 0.6 },
    shape: ParticleSystem.Shape.Cone({ angle: 12, radius })
  }
}

// --- build / clear ----------------------------------------------------------------

/** Client: fill the camp with its weather and its fires. Call when Bogmaw is built. */
export function buildBogFx() {
  clearBogFx()
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })

  for (const box of BOG_ROOM_BOXES) {
    const centre = Vector3.create(box.x + box.w / 2, FLOOR_Y, box.z + box.d / 2)
    emitter(root, Vector3.create(centre.x, FLOOR_Y + 0.7, centre.z), fogConfig(box.w + 6, box.d + 6))
    emitter(root, Vector3.create(centre.x, FLOOR_Y + 1.6, centre.z), firefliesConfig(box.w, box.d))
  }

  for (const fire of bogFires()) {
    const at = Vector3.create(fire.x, FLOOR_Y + fire.y, fire.z)
    emitter(root, at, flameConfig(fire.size))
    emitter(root, at, emberConfig(fire.size))
    if (fire.light) {
      const glow = engine.addEntity()
      Transform.create(glow, { parent: root, position: Vector3.create(fire.x, FLOOR_Y + fire.y + 1, fire.z) })
      LightSource.create(glow, {
        type: LightSource.Type.Point({}), color: Color3.create(1, 0.55, 0.2), intensity: 3.5 + 2 * fire.size, range: 9 + 5 * fire.size, shadow: false, active: true
      })
    }
  }

  for (const mud of BOG_TRAPS.mud) emitter(root, Vector3.create(mud.x, FLOOR_Y + 0.05, mud.z), bubblesConfig(3, BOG_TRAPS.mudRadius * 0.8))

  ritualPlane(root, Vector3.create(BOG_SHRINE.x, FLOOR_Y + 0.05, BOG_SHRINE.z), 6, Color4.create(GREEN.r, GREEN.g, GREEN.b, 0.8))
  emitter(root, Vector3.create(BOG_SHRINE.x, FLOOR_Y + 0.2, BOG_SHRINE.z), ritualConfig(2.4, 14))

  const sky = engine.addEntity()
  Transform.create(sky, { parent: root, position: Vector3.create(80, FLOOR_Y, 80) })
  // Turned over: the box throws its drops down its own -y, the force keeps them falling.
  const rain = emitter(sky, Vector3.create(0, 13, 0), rainConfig(), Quaternion.fromEulerDegrees(180, 0, 0))
  AudioSource.create(sky, { audioClipUrl: RAIN_LOOP, playing: true, loop: true, volume: 0.22 })
  const bolt = engine.addEntity()
  Transform.create(bolt, { parent: sky, position: Vector3.create(0, 22, 0) })
  LightSource.create(bolt, { type: LightSource.Type.Point({}), color: Color3.create(0.8, 0.85, 1), intensity: 40, range: 70, shadow: false, active: false })
  const wade = emitter(sky, Vector3.create(0, 0.05, 0), { ...bubblesConfig(9, 0.5), prewarm: false })
  ParticleSystem.getMutable(wade).playbackState = STOPPED

  ambience = { root, sky, rain, bolt, wade, wading: false, flash: 0, thunderIn: 0, nextBolt: 6 + Math.random() * 8, clock: 0 }
}

export function clearBogFx() {
  if (ambience) {
    engine.removeEntityWithChildren(ambience.root)
    ambience = undefined
  }
  for (const aura of totemAuras.values()) engine.removeEntityWithChildren(aura)
  totemAuras.clear()
}

/** Client: the ritual under a war totem, while it stands. `root` is the totem enemy's position entity. */
export function syncTotemAura(root: Entity, on: boolean) {
  const have = totemAuras.get(root)
  if (on === !!have) return
  if (!on) {
    if (have) engine.removeEntityWithChildren(have)
    totemAuras.delete(root)
    return
  }
  const aura = engine.addEntity()
  Transform.create(aura, { parent: root, position: Vector3.Zero() })
  ritualPlane(aura, Vector3.create(0, 0.06, 0), 4.2, Color4.create(GREEN.r, GREEN.g, GREEN.b, 0.75))
  emitter(aura, Vector3.create(0, 0.3, 0), ritualConfig(1.6, 10))
  totemAuras.set(root, aura)
}

/** Client: follow the hero with the weather; strike now and then. */
export function tickBogFx(dt: number) {
  const a = ambience
  if (!a) return
  a.clock += dt
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (player) {
    const t = Transform.getMutable(a.sky)
    t.position = Vector3.create(player.x, FLOOR_Y, player.z)
  }

  const wading = localHeroInMud()
  if (wading !== a.wading) {
    a.wading = wading
    ParticleSystem.getMutable(a.wade).playbackState = wading ? PLAYING : STOPPED
  }

  if (a.flash > 0) {
    a.flash -= dt
    if (a.flash <= 0) LightSource.getMutable(a.bolt).active = false
  }
  if (a.thunderIn > 0) {
    a.thunderIn -= dt
    if (a.thunderIn <= 0) fxSound('thunder', 0.8)
  }
  a.nextBolt -= dt
  if (a.nextBolt <= 0) {
    a.nextBolt = 9 + Math.random() * 14
    a.flash = 0.14 + Math.random() * 0.1
    a.thunderIn = 0.5 + Math.random() * 1.5
    const light = LightSource.getMutable(a.bolt)
    light.active = true
    light.intensity = 30 + Math.random() * 25
    // The strike falls somewhere off to the side, not on the hero's head.
    const angle = Math.random() * Math.PI * 2
    Transform.getMutable(a.bolt).position = Vector3.create(Math.cos(angle) * 25, 22, Math.sin(angle) * 25)
  }
}
