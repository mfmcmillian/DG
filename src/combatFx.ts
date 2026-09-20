// Combat feedback: particle bursts (Synty POLYGON Particle FX sprites), floating
// damage numbers, one-shot sounds and ground telegraph decals. Everything is
// pooled; nothing here owns gameplay state.

import {
  AudioSource, AvatarAttach, Billboard, BillboardMode, engine, Entity, Material, MaterialTransparencyMode,
  MeshRenderer, ParticleSystem, PBParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState,
  TextShape, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'

// The protocol enums are const enums in the SDK typings, so they have no runtime
// export; spell out the values we use.
const BLEND_ALPHA = 0 as PBParticleSystem_BlendMode
const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState
const STOPPED = 2 as PBParticleSystem_PlaybackState
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { AttackMotion } from './combatActions'
import { COMBAT_CLIPS } from './combatAnimations'
import { playerEntityByAddress } from './multiplayer'

export type FxSound =
  | 'swing_light' | 'swing_heavy' | 'hit_light' | 'hit_heavy' | 'block' | 'hurt'
  | 'dodge' | 'coin' | 'heal' | 'slam' | 'roar' | 'death'
  | 'thunk_wood' | 'thud_straw'

const FX_SOUNDS: FxSound[] = [
  'swing_light', 'swing_heavy', 'hit_light', 'hit_heavy', 'block', 'hurt',
  'dodge', 'coin', 'heal', 'slam', 'roar', 'death', 'thunk_wood', 'thud_straw'
]

/** Every clip `fxSound` can play, for the title-screen preloader. */
export function fxSoundAssets(): string[] {
  return FX_SOUNDS.map((name) => `sounds/${name}.wav`)
}

/** Every sprite the bursts, swipes and decals draw, for the title-screen preloader. */
export function fxTextureAssets(): string[] {
  return Object.values(TEX)
}

type BurstKind = 'sparks' | 'flash' | 'puff' | 'dust' | 'glitter'
type Emitter = { entity: Entity; until: number }
type Slash = {
  entity: Entity
  /** Seconds until the arc starts; it is timed to land on the swing's contact frame. */
  delay: number
  life: number
  duration: number
  frame: number
  /** The attacker's body: the arc is parented to it so it rides along every rendered frame. */
  anchor: Entity
  heavy: boolean
  mirror: boolean
}
type Number3d = { entity: Entity; life: number; duration: number; rise: number; color: Color4; base: Vector3 }

const HIDDEN = Vector3.create(0, -40, 0)
const emitters: Record<BurstKind, Emitter[]> = { sparks: [], flash: [], puff: [], dust: [], glitter: [] }
const numbers: Number3d[] = []
const slashes: Slash[] = []
const speakers: Entity[] = []
let speakerIndex = 0
let clock = 0
let initialized = false

const TEX = {
  sparkle: 'images/fx/sparkle.png',
  soft: 'images/fx/soft_spot.png',
  smoke: 'images/fx/smoke_01.png',
  /** 4-frame flipbook of a growing crescent, 1x4. */
  swipe: 'images/fx/swipe_02.png',
  ring: 'images/fx/ring_02.png',
  circle: 'images/fx/circle_01.png',
  ritual: 'images/fx/ritualcircle_01.png',
  crack: 'images/fx/groundbreak.png'
}

export function initializeCombatFx() {
  if (initialized) return
  initialized = true
  for (let i = 0; i < 6; i++) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.clone(HIDDEN) })
    speakers.push(e)
  }
  engine.addSystem(update)
  warmFx()
}

/**
 * Fire every effect once out of sight (40 m under the floor) so the renderer
 * builds the particle materials and sprite planes now. Otherwise the first
 * real hit shows a plain white quad for the frames its texture is still on
 * its way, and pays the material compile mid-fight.
 */
function warmFx() {
  fxImpact(HIDDEN, false, false)
  fxImpact(HIDDEN, true, false)
  fxWoodHit(HIDDEN, false, false)
  fxWoodHit(HIDDEN, false, true)
  fxMagicBurst(HIDDEN, Color4.create(0.45, 0.7, 1, 1))
  fxGlitter(HIDDEN, Color4.create(1, 0.9, 0.5, 1))
  fxDeathPuff(HIDDEN)
  fxSlam(HIDDEN, 1)
  const anchor = engine.addEntity()
  Transform.create(anchor, { position: Vector3.clone(HIDDEN) })
  fxSlash(anchor, 'attack_light')
  fxSlash(anchor, 'attack_heavy')
}

// --- bursts ------------------------------------------------------------------

function burst(kind: BurstKind, position: Vector3, config: PBParticleSystem, lifetime: number, rotation?: Quaternion) {
  const pool = emitters[kind]
  let slot = pool.find((p) => p.until <= clock)
  if (!slot) {
    if (pool.length >= 8) {
      slot = pool.reduce((a, b) => (a.until < b.until ? a : b))
    } else {
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.clone(HIDDEN) })
      slot = { entity, until: 0 }
      pool.push(slot)
    }
  }
  const t = Transform.getMutable(slot.entity)
  t.position = Vector3.clone(position)
  t.rotation = rotation ?? Quaternion.Identity()
  ParticleSystem.createOrReplace(slot.entity, {
    ...config,
    active: true,
    loop: false,
    rate: 0,
    playbackState: PLAYING
  })
  slot.until = clock + lifetime
}

export function fxImpact(position: Vector3, heavy: boolean, blocked: boolean) {
  const count = blocked ? 10 : heavy ? 26 : 16
  const color = blocked
    ? { start: Color4.create(0.75, 0.85, 1, 1), end: Color4.create(0.4, 0.55, 1, 0) }
    : { start: Color4.create(1, 0.85, 0.45, 1), end: Color4.create(1, 0.35, 0.1, 0) }
  burst('sparks', position, {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ADD,
    lifetime: 0.35,
    maxParticles: 40,
    gravity: -6,
    initialSize: { start: 0.12, end: heavy ? 0.34 : 0.24 },
    sizeOverTime: { start: 1, end: 0.1 },
    initialColor: { start: color.start, end: color.start },
    colorOverTime: color,
    initialVelocitySpeed: { start: 2.5, end: heavy ? 6.5 : 4.5 },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.12 }),
    bursts: { values: [{ time: 0, count }] }
  }, 0.5)
  burst('flash', position, {
    texture: { src: TEX.soft },
    blendMode: BLEND_ADD,
    lifetime: 0.12,
    maxParticles: 2,
    gravity: 0,
    initialSize: { start: heavy ? 1.6 : 1.1, end: heavy ? 1.6 : 1.1 },
    sizeOverTime: { start: 1, end: 1.6 },
    initialColor: { start: blocked ? Color4.create(0.7, 0.8, 1, 1) : Color4.create(1, 0.95, 0.8, 1), end: Color4.create(1, 1, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0, end: 0 },
    shape: ParticleSystem.Shape.Point(),
    bursts: { values: [{ time: 0, count: 1 }] }
  }, 0.2)
  if (!blocked) {
    burst('puff', position, {
      texture: { src: TEX.smoke },
      blendMode: BLEND_ALPHA,
      lifetime: 0.55,
      maxParticles: 8,
      gravity: 0.6,
      initialSize: { start: 0.3, end: 0.5 },
      sizeOverTime: { start: 0.6, end: 1.6 },
      initialColor: { start: Color4.create(0.55, 0.12, 0.12, 0.8), end: Color4.create(0.75, 0.2, 0.15, 0.8) },
      colorOverTime: { start: Color4.create(1, 1, 1, 0.8), end: Color4.create(1, 1, 1, 0) },
      initialVelocitySpeed: { start: 0.6, end: 1.4 },
      rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 90),
      shape: ParticleSystem.Shape.Sphere({ radius: 0.1 }),
      bursts: { values: [{ time: 0, count: heavy ? 6 : 4 }] }
    }, 0.7)
  }
}

/**
 * A blow on a training dummy: chips of wood (or flecks of straw) thrown off
 * the point of contact and a puff of dry dust, in place of sparks and blood.
 */
export function fxWoodHit(position: Vector3, heavy: boolean, straw: boolean) {
  const chip = straw
    ? { start: Color4.create(0.93, 0.82, 0.45, 1), end: Color4.create(0.75, 0.6, 0.3, 0) }
    : { start: Color4.create(0.62, 0.42, 0.22, 1), end: Color4.create(0.4, 0.26, 0.14, 0) }
  burst('sparks', position, {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ALPHA,
    lifetime: 0.55,
    maxParticles: 40,
    gravity: -11,
    initialSize: { start: 0.05, end: straw ? 0.14 : 0.1 },
    sizeOverTime: { start: 1, end: 0.6 },
    initialColor: { start: chip.start, end: chip.start },
    colorOverTime: chip,
    initialVelocitySpeed: { start: 2, end: heavy ? 5.5 : 3.8 },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.1 }),
    bursts: { values: [{ time: 0, count: heavy ? 22 : 12 }] }
  }, 0.7)
  burst('puff', position, {
    texture: { src: TEX.smoke },
    blendMode: BLEND_ALPHA,
    lifetime: 0.7,
    maxParticles: 8,
    gravity: 0.3,
    initialSize: { start: 0.3, end: 0.5 },
    sizeOverTime: { start: 0.6, end: 1.8 },
    initialColor: { start: Color4.create(0.6, 0.55, 0.45, 0.55), end: Color4.create(0.7, 0.65, 0.5, 0.55) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.55), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.5, end: 1.2 },
    rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 60),
    shape: ParticleSystem.Shape.Sphere({ radius: 0.12 }),
    bursts: { values: [{ time: 0, count: heavy ? 5 : 3 }] }
  }, 0.9)
}

// --- sword swipes ------------------------------------------------------------

const SLASH_FRAMES = 4
const SLASH_DURATION = 0.22

/** UVs selecting one frame of the 1x4 swipe sheet, for both faces of a plane. */
function slashUvs(frame: number): number[] {
  const u0 = frame / SLASH_FRAMES
  const u1 = (frame + 1) / SLASH_FRAMES
  return [u0, 0, u1, 0, u1, 1, u0, 1, u1, 0, u0, 0, u0, 1, u1, 1]
}

/**
 * Sword swipe: a flipbook crescent on a plane parented to the attacker's body
 * (so it moves with them between ticks), timed to bloom on the swing's contact
 * frame. Lights sweep a flat arc across the front (the second light mirrored,
 * as the return stroke); heavies drop a tall arc turned toward the camera.
 */
export function fxSlash(anchor: Entity, motion: AttackMotion) {
  const clip = COMBAT_CLIPS[motion]
  const contact = clip.contact ?? clip.duration * 0.45
  let slot = slashes.find((x) => x.life >= x.duration)
  if (!slot) {
    if (slashes.length >= 6) {
      slot = slashes.reduce((a, b) => (a.life / a.duration > b.life / b.duration ? a : b))
    } else {
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.clone(HIDDEN) })
      MeshRenderer.setPlane(entity, slashUvs(0))
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common({ src: TEX.swipe }),
        emissiveTexture: Material.Texture.Common({ src: TEX.swipe }),
        albedoColor: Color4.create(1, 1, 1, 1),
        emissiveColor: Color3.create(1, 1, 1),
        emissiveIntensity: 3,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false
      })
      VisibilityComponent.create(entity, { visible: false })
      slot = { entity, delay: 0, life: 0, duration: SLASH_DURATION, frame: -1, anchor, heavy: false, mirror: false }
      slashes.push(slot)
    }
  }
  slot.delay = Math.max(0, contact - 0.1)
  slot.life = 0
  slot.frame = -1
  slot.anchor = anchor
  slot.heavy = motion === 'attack_heavy'
  slot.mirror = motion === 'attack_light2'
  VisibilityComponent.getMutable(slot.entity).visible = false
}

function updateSlash(s: Slash, dt: number) {
  if (s.life >= s.duration) return
  if (s.delay > 0) {
    s.delay -= dt
    if (s.delay > 0) return
  }
  const anchor = Transform.getOrNull(s.anchor)
  if (!anchor) {
    s.life = s.duration
    return
  }
  s.life = Math.min(s.duration, s.life + dt)
  const k = s.life / s.duration
  const frame = Math.min(SLASH_FRAMES - 1, Math.floor(k * SLASH_FRAMES * 1.25))
  if (frame !== s.frame) {
    s.frame = frame
    MeshRenderer.setPlane(s.entity, slashUvs(frame))
    if (frame === 0) VisibilityComponent.getMutable(s.entity).visible = true
  }
  const t = Transform.getMutable(s.entity)
  if (t.parent !== s.anchor) t.parent = s.anchor
  // Everything below is in the body's local space: +Z is the way it faces.
  // Bodies may be scaled (the boss); keep the arc the same size in the world.
  const inv = 1 / Math.max(0.01, anchor.scale.x)
  if (s.heavy) {
    // Tall crescent in front of the fighter, turned to the crawler camera (world
    // heading 180) and tilted up toward it, dropping as the blow lands.
    const size = 2.9 * inv
    t.position = Vector3.create(0, (1.55 - 0.45 * k) * inv, 0.7 * inv)
    t.rotation = Quaternion.fromEulerDegrees(-30, 180 - bodyWorldYaw(s.anchor), 90)
    t.scale = Vector3.create(size, size, 1)
  } else {
    // Flat crescent bulging forward at chest height, swept across the body over the stroke.
    const size = 2.3 * inv
    const sweep = (s.mirror ? -1 : 1) * (30 - 60 * k)
    t.position = Vector3.create(0, 1.15 * inv, 0.75 * inv)
    t.rotation = Quaternion.fromEulerDegrees(90, sweep, -90)
    t.scale = Vector3.create(s.mirror ? -size : size, size, 1)
  }
  const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4
  const m = Material.getMutable(s.entity)
  if (m.material?.$case === 'pbr') {
    m.material.pbr.albedoColor = Color4.create(1, 1, 1, alpha)
    m.material.pbr.emissiveIntensity = 3 * alpha
  }
  if (s.life >= s.duration) {
    VisibilityComponent.getMutable(s.entity).visible = false
    t.parent = undefined
    t.position = Vector3.clone(HIDDEN)
  }
}

/**
 * World yaw (degrees) of a body entity, summing its yaw-only ancestors (the
 * player root is the only deep case). An AvatarAttach anchor turns with the
 * avatar it follows; the Transform the renderer reports for it is relative to
 * the local player, so the yaw is read from that player's entity instead.
 */
function bodyWorldYaw(entity: Entity): number {
  let yaw = 0
  let cursor: Entity | undefined = entity
  for (let depth = 0; cursor !== undefined && depth < 6; depth++) {
    const attach = AvatarAttach.getOrNull(cursor)
    if (attach) {
      const player = attach.avatarId ? playerEntityByAddress(attach.avatarId) : engine.PlayerEntity
      const rotation = player !== undefined ? Transform.getOrNull(player)?.rotation : undefined
      if (rotation) yaw += Quaternion.toEulerAngles(rotation).y
      break
    }
    const t = Transform.getOrNull(cursor)
    if (!t) break
    yaw += Quaternion.toEulerAngles(t.rotation).y
    cursor = t.parent
  }
  return yaw
}

/** Ground slam: a dust ring plus a crack decal flash. */
export function fxSlam(position: Vector3, radius: number) {
  burst('dust', Vector3.add(position, Vector3.create(0, 0.15, 0)), {
    texture: { src: TEX.smoke },
    blendMode: BLEND_ALPHA,
    lifetime: 0.9,
    maxParticles: 40,
    gravity: -0.4,
    initialSize: { start: 0.7, end: 1.3 },
    sizeOverTime: { start: 0.7, end: 2 },
    initialColor: { start: Color4.create(0.55, 0.5, 0.45, 0.85), end: Color4.create(0.4, 0.36, 0.33, 0.85) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.85), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: radius * 2.2, end: radius * 3 },
    limitVelocity: { speed: 1.2, dampen: 0.25 },
    shape: ParticleSystem.Shape.Cone({ angle: 88, radius: 0.3 }),
    bursts: { values: [{ time: 0, count: 30 }] }
  }, 1)
  burst('sparks', Vector3.add(position, Vector3.create(0, 0.3, 0)), {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ADD,
    lifetime: 0.6,
    maxParticles: 40,
    gravity: -9,
    initialSize: { start: 0.15, end: 0.35 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1, 0.6, 0.2, 1), end: Color4.create(1, 0.9, 0.5, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.3, 0, 0) },
    initialVelocitySpeed: { start: 4, end: 8 },
    shape: ParticleSystem.Shape.Cone({ angle: 45, radius: 0.5 }),
    bursts: { values: [{ time: 0, count: 30 }] }
  }, 0.8)
}

/**
 * A spell landing: a cold flash and a ring of embers in the bolt's colour. The
 * nova's burst is the same at `radius` metres, wide enough to read as an area.
 */
export function fxMagicBurst(position: Vector3, color: Color4, radius = 0.4) {
  const big = radius > 1
  burst('sparks', position, {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ADD,
    lifetime: big ? 0.6 : 0.4,
    maxParticles: 40,
    gravity: big ? -2 : 1.5,
    initialSize: { start: 0.12, end: big ? 0.36 : 0.22 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: color, end: Color4.create(1, 1, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(color.r, color.g, color.b, 0) },
    initialVelocitySpeed: { start: radius * 2.5, end: radius * 5 },
    shape: ParticleSystem.Shape.Sphere({ radius: Math.min(0.3, radius * 0.3) }),
    bursts: { values: [{ time: 0, count: big ? 36 : 18 }] }
  }, big ? 0.8 : 0.5)
  burst('flash', position, {
    texture: { src: TEX.soft },
    blendMode: BLEND_ADD,
    lifetime: big ? 0.28 : 0.14,
    maxParticles: 2,
    gravity: 0,
    initialSize: { start: radius * 2.2, end: radius * 2.2 },
    sizeOverTime: { start: 0.6, end: 1.4 },
    initialColor: { start: color, end: color },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0, end: 0 },
    shape: ParticleSystem.Shape.Point(),
    bursts: { values: [{ time: 0, count: 1 }] }
  }, big ? 0.4 : 0.2)
}

/** Sparkle on pickups, heals and unlocks. */
export function fxGlitter(position: Vector3, color: Color4) {
  burst('glitter', position, {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ADD,
    lifetime: 0.7,
    maxParticles: 24,
    gravity: 1.5,
    initialSize: { start: 0.1, end: 0.22 },
    sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: color, end: Color4.create(1, 1, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 1, end: 2.2 },
    shape: ParticleSystem.Shape.Sphere({ radius: 0.25 }),
    bursts: { values: [{ time: 0, count: 18 }] }
  }, 0.9)
}

/**
 * A column of light over the Warlord's drop: sparks rising three metres in the
 * rarity's colour. Loot re-fires it every half second while the weapon lies
 * there, so it reads from across the room.
 */
export function fxLootBeam(position: Vector3, color: Color4) {
  burst('glitter', position, {
    texture: { src: TEX.sparkle },
    blendMode: BLEND_ADD,
    lifetime: 1.3,
    maxParticles: 24,
    gravity: 0,
    initialSize: { start: 0.08, end: 0.16 },
    sizeOverTime: { start: 1, end: 0.2 },
    initialColor: { start: color, end: Color4.create(1, 1, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.9), end: Color4.create(color.r, color.g, color.b, 0) },
    initialVelocitySpeed: { start: 1.8, end: 2.6 },
    shape: ParticleSystem.Shape.Cone({ angle: 4, radius: 0.18 }),
    bursts: { values: [{ time: 0, count: 12 }] }
  }, 1.4)
}

/** Death: a dark puff where the body was. */
export function fxDeathPuff(position: Vector3) {
  burst('puff', Vector3.add(position, Vector3.create(0, 0.9, 0)), {
    texture: { src: TEX.smoke },
    blendMode: BLEND_ALPHA,
    lifetime: 1.1,
    maxParticles: 20,
    gravity: 0.8,
    initialSize: { start: 0.6, end: 1 },
    sizeOverTime: { start: 0.8, end: 1.8 },
    initialColor: { start: Color4.create(0.25, 0.08, 0.1, 0.85), end: Color4.create(0.15, 0.1, 0.14, 0.85) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0.85), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.4, end: 1.2 },
    rotationOverTime: Quaternion.fromEulerDegrees(0, 0, 60),
    shape: ParticleSystem.Shape.Sphere({ radius: 0.4 }),
    bursts: { values: [{ time: 0, count: 14 }] }
  }, 1.3)
}

// --- damage numbers ----------------------------------------------------------

export type NumberKind = 'damage' | 'heavy' | 'finisher' | 'blocked' | 'player' | 'heal' | 'coin' | 'note'

const NUMBER_COLORS: Record<NumberKind, Color4> = {
  damage: Color4.create(1, 0.93, 0.7, 1),
  heavy: Color4.create(1, 0.68, 0.25, 1),
  finisher: Color4.create(1, 0.45, 0.15, 1),
  blocked: Color4.create(0.7, 0.8, 1, 1),
  player: Color4.create(1, 0.3, 0.32, 1),
  heal: Color4.create(0.45, 1, 0.55, 1),
  coin: Color4.create(1, 0.86, 0.3, 1),
  note: Color4.create(0.95, 0.95, 1, 1)
}

export function fxNumber(position: Vector3, text: string, kind: NumberKind = 'damage') {
  let slot = numbers.find((n) => n.life >= n.duration)
  if (!slot) {
    if (numbers.length >= 14) slot = numbers.reduce((a, b) => (a.life > b.life ? a : b))
    else {
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.clone(HIDDEN) })
      Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
      TextShape.create(entity, { text: '', fontSize: 5, outlineWidth: 0.15, outlineColor: Color3.create(0, 0, 0) })
      slot = { entity, life: 1, duration: 1, rise: 1, color: NUMBER_COLORS.damage, base: Vector3.clone(HIDDEN) }
      numbers.push(slot)
    }
  }
  const big = kind === 'finisher' || kind === 'heavy'
  slot.life = 0
  slot.duration = kind === 'note' ? 1.3 : 0.9
  slot.rise = big ? 1.3 : 1
  slot.color = NUMBER_COLORS[kind]
  slot.base = Vector3.add(position, Vector3.create((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5))
  const shape = TextShape.getMutable(slot.entity)
  shape.text = text
  // The crawler camera sits ~13 m away, so these are large by label standards.
  shape.fontSize = kind === 'finisher' ? 8 : big ? 6.5 : kind === 'note' ? 4.5 : 5
  shape.textColor = slot.color
  Transform.getMutable(slot.entity).position = slot.base
}

// --- sounds ------------------------------------------------------------------

/** Sounds play at the camera so the high crawler camera never attenuates them. */
export function fxSound(name: FxSound, volume = 1) {
  if (!speakers.length) return
  const speaker = speakers[speakerIndex++ % speakers.length]
  const listener = Transform.getOrNull(engine.CameraEntity)?.position
  if (listener) Transform.getMutable(speaker).position = Vector3.clone(listener)
  AudioSource.createOrReplace(speaker, {
    audioClipUrl: `sounds/${name}.wav`,
    playing: true,
    loop: false,
    volume,
    pitch: 0.94 + Math.random() * 0.12
  })
}

// --- telegraph decals --------------------------------------------------------

export type Decal = { entity: Entity; visible: boolean }

export function createDecal(style: 'ring' | 'disc' | 'ritual'): Decal {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.clone(HIDDEN),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(1, 1, 1)
  })
  MeshRenderer.setPlane(entity)
  const src = style === 'ring' ? TEX.ring : style === 'disc' ? TEX.circle : TEX.ritual
  Material.setPbrMaterial(entity, {
    texture: Material.Texture.Common({ src }),
    emissiveTexture: Material.Texture.Common({ src }),
    albedoColor: Color4.create(1, 0.2, 0.15, 0.85),
    emissiveColor: Color3.create(1, 0.25, 0.15),
    emissiveIntensity: 2.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  VisibilityComponent.create(entity, { visible: false })
  return { entity, visible: false }
}

/** `progress` runs 0..1 over the wind-up; the decal grows and brightens toward the strike. */
export function updateDecal(decal: Decal, visible: boolean, position?: Vector3, radius = 1, progress = 0, color: Color3 = Color3.create(1, 0.25, 0.15)) {
  if (visible !== decal.visible) {
    VisibilityComponent.getMutable(decal.entity).visible = visible
    decal.visible = visible
  }
  if (!visible || !position) return
  const t = Transform.getMutable(decal.entity)
  t.position = Vector3.create(position.x, position.y + 0.06, position.z)
  const size = radius * 2 * (0.45 + 0.55 * Math.min(1, progress))
  t.scale = Vector3.create(size, size, 1)
  const m = Material.getMutable(decal.entity)
  if (m.material?.$case === 'pbr') {
    const pulse = 0.55 + 0.45 * Math.sin(progress * Math.PI * 6) * progress
    m.material.pbr.albedoColor = Color4.create(color.r, color.g, color.b, 0.35 + 0.55 * progress)
    m.material.pbr.emissiveColor = color
    m.material.pbr.emissiveIntensity = 1.5 + 4 * pulse
  }
}

export function destroyDecal(decal: Decal) {
  engine.removeEntity(decal.entity)
}

// --- per-frame ---------------------------------------------------------------

function update(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return
  clock += dt
  for (const kind of Object.keys(emitters) as BurstKind[]) {
    for (const slot of emitters[kind]) {
      if (slot.until > 0 && slot.until <= clock) {
        slot.until = 0
        const ps = ParticleSystem.getMutableOrNull(slot.entity)
        if (ps) ps.playbackState = STOPPED
      }
    }
  }
  for (const sl of slashes) updateSlash(sl, dt)
  for (const n of numbers) {
    if (n.life >= n.duration) continue
    n.life = Math.min(n.duration, n.life + dt)
    const k = n.life / n.duration
    const ease = 1 - (1 - k) * (1 - k)
    Transform.getMutable(n.entity).position = Vector3.create(n.base.x, n.base.y + n.rise * ease, n.base.z)
    const shape = TextShape.getMutable(n.entity)
    const alpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4
    shape.textColor = Color4.create(n.color.r, n.color.g, n.color.b, alpha)
    if (n.life >= n.duration) {
      shape.text = ''
      Transform.getMutable(n.entity).position = Vector3.clone(HIDDEN)
    }
  }
}
