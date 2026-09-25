// The fire in the upgrade pit: the smithy's cauldron burns all the time (two
// looping emitters, flame and embers, and a warm light of its own), and roars
// up for a moment when a weapon goes in (`flarePitFire`). Presentation only;
// the upgrade itself is src/upgrades.ts and the shot is src/pitCinematic.ts.

import {
  engine, Entity, LightSource, ParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { getDungeonState, onDungeonLoaded } from './dungeon'
import { UPGRADE_PIT_TAG } from './dungeon/hub'

const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState

const TEX_SOFT = 'images/fx/soft_spot.png'
const TEX_SPARK = 'images/fx/sparkle.png'

/** Where the flames sit above the cauldron's base (its rim, at UPGRADE_PIT_SCALE), and where an item hovers when it comes back. */
export const PIT_FLAME_HEIGHT = 1.65
export const PIT_HOVER_HEIGHT = 3.3
/** The mouth of the pit: how wide the fire is. */
export const PIT_MOUTH_RADIUS = 0.8

const FLAME_RATE = 48
const EMBER_RATE = 16
/** The fire's own light, on top of the hall's pooled flicker: at rest, and per unit of flare. */
const GLOW_BASE = 5
const GLOW_FLARE = 7

type Fire = { root: Entity; flames: Entity; embers: Entity; glow: Entity; position: Vector3 }

let fire: Fire | undefined
/** The flare: how far above normal the fire stands (0 = calm) and how fast it settles. */
let flare = 0
let flareFall = 1
let initialized = false

export function initializePitFire() {
  if (initialized) return
  initialized = true
  engine.addSystem(update)
  // Fires at once when the hall is already up, and again after every rebuild.
  onDungeonLoaded(rebuild)
}

/** The cauldron's position in the world, when the hall is the loaded dungeon. */
export function pitFirePosition(): Vector3 | undefined {
  return fire ? Vector3.clone(fire.position) : undefined
}

/** The fire leaps: `strength` times its usual size, settling back over `seconds`. */
export function flarePitFire(strength: number, seconds: number) {
  flare = Math.max(flare, Math.max(0, strength - 1))
  flareFall = Math.max(0.2, seconds)
}

function rebuild() {
  destroy()
  const instance = getDungeonState().instance
  const cauldron = instance?.tagged[UPGRADE_PIT_TAG]
  const at = cauldron !== undefined ? Transform.getOrNull(cauldron)?.position : undefined
  if (!at) return
  const position = Vector3.create(at.x, at.y, at.z)
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(at.x, at.y + PIT_FLAME_HEIGHT, at.z) })
  const flames = engine.addEntity()
  Transform.create(flames, { parent: root })
  ParticleSystem.create(flames, flameConfig(1))
  const embers = engine.addEntity()
  Transform.create(embers, { parent: root })
  ParticleSystem.create(embers, emberConfig(1))
  const glow = engine.addEntity()
  Transform.create(glow, { parent: root, position: Vector3.create(0, 0.9, 0) })
  LightSource.create(glow, {
    type: LightSource.Type.Point({}),
    color: Color3.create(1, 0.55, 0.2),
    intensity: GLOW_BASE,
    range: 16,
    // One shadow caster in the hall is the pit's: the hero and the smith throw long shadows from the fire.
    shadow: true,
    active: true
  })
  fire = { root, flames, embers, glow, position }
}

function destroy() {
  if (!fire) return
  for (const e of [fire.glow, fire.embers, fire.flames, fire.root]) engine.removeEntity(e)
  fire = undefined
}

function flameConfig(scale: number) {
  return {
    texture: { src: TEX_SOFT },
    blendMode: BLEND_ADD,
    active: true,
    loop: true,
    prewarm: true,
    rate: FLAME_RATE * scale,
    maxParticles: 160,
    lifetime: 0.8 + 0.35 * scale,
    gravity: -2.2 * scale,
    initialSize: { start: 0.6 * scale, end: 1.1 * scale },
    sizeOverTime: { start: 1, end: 0.15 },
    initialColor: { start: Color4.create(1, 0.75, 0.3, 1), end: Color4.create(1, 0.45, 0.1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.9), end: Color4.create(0.8, 0.1, 0.05, 0) },
    initialVelocitySpeed: { start: 0.6, end: 1.4 * scale },
    shape: ParticleSystem.Shape.Cone({ angle: 10, radius: PIT_MOUTH_RADIUS * 0.85 }),
    playbackState: PLAYING
  }
}

function emberConfig(scale: number) {
  return {
    texture: { src: TEX_SPARK },
    blendMode: BLEND_ADD,
    active: true,
    loop: true,
    prewarm: true,
    rate: EMBER_RATE * scale,
    maxParticles: 90,
    lifetime: 2.2,
    gravity: -0.6,
    initialSize: { start: 0.06, end: 0.14 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1, 0.8, 0.4, 1), end: Color4.create(1, 0.5, 0.2, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.4, 0.1, 0) },
    initialVelocitySpeed: { start: 1.2, end: 2.8 * scale },
    shape: ParticleSystem.Shape.Cone({ angle: 28, radius: PIT_MOUTH_RADIUS * 0.7 }),
    playbackState: PLAYING
  }
}

let lastScale = 1
let flickerT = 0

function update(dt: number) {
  if (!fire) return
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0
  if (flare > 0) flare = Math.max(0, flare - step * (2.5 / flareFall) * Math.max(0.35, flare))
  const scale = 1 + flare
  // The emitters are rewritten only while the fire is moving; a calm fire is left alone.
  if (Math.abs(scale - lastScale) > 0.12 || (flare === 0 && lastScale !== 1)) {
    lastScale = scale
    ParticleSystem.createOrReplace(fire.flames, flameConfig(scale))
    ParticleSystem.createOrReplace(fire.embers, emberConfig(scale))
  }
  // A slow breathing flicker at rest; the flare piles on top of it.
  flickerT += step
  const breath = 0.88 + 0.12 * Math.sin(flickerT * 5.3) * Math.sin(flickerT * 2.1 + 1) + (Math.random() - 0.5) * 0.06
  const light = LightSource.getMutable(fire.glow)
  light.intensity = GLOW_BASE * breath + GLOW_FLARE * flare
  light.range = 16 + 6 * Math.min(2, flare)
}
