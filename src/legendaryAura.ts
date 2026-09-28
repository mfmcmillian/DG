// Legendary gear shows on the hero who wears it: gold motes drift up through a
// looping particle emitter parented to the body root, so they ride and turn
// with the body. Every legendary piece adds motes; a legendary weapon adds
// brighter embers on top, since the body's parts all share the root's origin
// and the hand cannot be followed outside a swing (bladeTrail has the swings).
// The avatar shown as the player's own Decentraland avatar gets the weapon's
// embers on the model in its hand instead (src/nativeHero.ts), where the
// renderer's anchor does follow the hand.
//
// equipmentAvatar.ts owns the lifecycle: the aura hides with the outfit, moves
// with a transferred one and goes with a destroyed one. Imports only the SDK,
// so it can sit under equipmentAvatar without a cycle.

import {
  engine, Entity, ParticleSystem, PBParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState,
  PBParticleSystem_SimulationSpace, Transform
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// The protocol enums are const enums in the SDK typings, so they have no runtime export.
const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState
const PAUSED = 1 as PBParticleSystem_PlaybackState
const LOCAL_SPACE = 0 as PBParticleSystem_SimulationSpace

const SPARKLE = 'images/fx/sparkle.png'
/** RARITIES.legendary.color (src/weapons.ts), spelled out to keep this module free of game imports. */
const GOLD = Color4.create(1, 0.72, 0.25, 1)
const WHITE = Color4.create(1, 1, 1, 1)

/** Motes per legendary armor piece per second, and the embers a legendary weapon adds. */
const MOTES_PER_PIECE = 4
const WEAPON_EMBERS = 10

type Aura = {
  weapon: boolean
  pieces: number
  shown: boolean
  motes?: Entity
  embers?: Entity
}

const auras = new Map<Entity, Aura>()
/** Outfits hidden before their aura is set remember it here (an outfit is often hidden while it loads). */
const shownBeforeAura = new Map<Entity, boolean>()

/** Gold motes through the torso: slow, small, fading to white. */
function motesConfig(pieces: number): PBParticleSystem {
  return {
    texture: { src: SPARKLE },
    blendMode: BLEND_ADD,
    rate: MOTES_PER_PIECE * pieces,
    maxParticles: 40,
    lifetime: 1.8,
    gravity: 0,
    additionalForce: Vector3.create(0, 0.22, 0),
    initialSize: { start: 0.03, end: 0.07 },
    sizeOverTime: { start: 0.6, end: 1 },
    initialColor: { start: GOLD, end: Color4.create(1, 0.85, 0.5, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.9), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.02, end: 0.08 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(0.7, 1.3, 0.5) }),
    simulationSpace: LOCAL_SPACE
  }
}

/** Embers for the weapon: brighter, quicker, rising from around the hands. */
function embersConfig(radius: number): PBParticleSystem {
  return {
    texture: { src: SPARKLE },
    blendMode: BLEND_ADD,
    rate: WEAPON_EMBERS,
    maxParticles: 24,
    lifetime: 1.1,
    gravity: -0.4,
    initialSize: { start: 0.05, end: 0.11 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: GOLD, end: WHITE },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.72, 0.25, 0) },
    initialVelocitySpeed: { start: 0.1, end: 0.35 },
    shape: ParticleSystem.Shape.Sphere({ radius }),
    simulationSpace: LOCAL_SPACE
  }
}

function emitter(parent: Entity, position: Vector3, config: PBParticleSystem, shown: boolean): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position })
  ParticleSystem.create(e, { ...config, active: true, loop: true, prewarm: true, playbackState: shown ? PLAYING : PAUSED })
  return e
}

function setPlaying(entity: Entity | undefined, playing: boolean) {
  if (entity === undefined) return
  const p = ParticleSystem.getMutableOrNull(entity)
  if (p) p.playbackState = playing ? PLAYING : PAUSED
}

/**
 * What of the outfit on `root` is legendary: the weapon, and how many armor
 * pieces. Nothing legendary takes the aura away.
 */
export function setLegendaryAura(root: Entity, weapon: boolean, pieces: number) {
  let aura = auras.get(root)
  if (!weapon && pieces <= 0) {
    if (aura) removeAura(root)
    return
  }
  if (!aura) {
    aura = { weapon: false, pieces: 0, shown: shownBeforeAura.get(root) ?? true }
    shownBeforeAura.delete(root)
    auras.set(root, aura)
  }
  // The weapon counts as a piece for the motes too: a bare legendary blade still lights the hero.
  const moteCount = pieces + (weapon ? 1 : 0)
  if (moteCount !== aura.pieces + (aura.weapon ? 1 : 0) || aura.motes === undefined) {
    if (aura.motes !== undefined) engine.removeEntity(aura.motes)
    aura.motes = emitter(root, Vector3.create(0, 1.0, 0), motesConfig(moteCount), aura.shown)
  }
  if (weapon && aura.embers === undefined) {
    aura.embers = emitter(root, Vector3.create(0, 1.05, 0), embersConfig(0.35), aura.shown)
  } else if (!weapon && aura.embers !== undefined) {
    engine.removeEntity(aura.embers)
    aura.embers = undefined
  }
  aura.weapon = weapon
  aura.pieces = pieces
}

/** Embers on a weapon model in the avatar's hand (nativeHero): the model's origin is the grip. */
export function weaponEmbers(model: Entity): Entity {
  return emitter(model, Vector3.Zero(), embersConfig(0.25), true)
}

export function setAuraShown(root: Entity, shown: boolean) {
  const aura = auras.get(root)
  if (!aura) {
    shownBeforeAura.set(root, shown)
    return
  }
  if (aura.shown === shown) return
  aura.shown = shown
  setPlaying(aura.motes, shown)
  setPlaying(aura.embers, shown)
}

export function moveAura(sourceRoot: Entity, targetRoot: Entity) {
  const aura = auras.get(sourceRoot)
  if (!aura) return
  auras.delete(sourceRoot)
  auras.set(targetRoot, aura)
  for (const e of [aura.motes, aura.embers]) {
    if (e !== undefined) Transform.getMutable(e).parent = targetRoot
  }
}

export function removeAura(root: Entity) {
  shownBeforeAura.delete(root)
  const aura = auras.get(root)
  if (!aura) return
  auras.delete(root)
  for (const e of [aura.motes, aura.embers]) if (e !== undefined) engine.removeEntity(e)
}
