/**
 * Weapon trail: the glowing ribbon a blade drags through a swing.
 *
 * The blade's path is not measured at runtime; it is baked (scripts/bake-blade-paths.py
 * -> src/bladePaths.json) from the hand joint's animation in the weapon GLBs
 * and each weapon's own extent in the hand. Every frame the swing's elapsed
 * time is turned into where the hilt and the tip were over the last tenth of
 * a second, and a strip of pooled planes is laid between those samples: a
 * wide soft haze layer under a thin hot core, both emissive so the Explorer's
 * bloom picks them up. Because the strip is rebuilt from the curve each frame
 * it is as smooth at 20 fps as at 120, and it costs no allocation per sample
 * beyond the Transform values themselves.
 *
 * Everything is in the attacker's body space (the planes are children of the
 * body, like the old crescent), so it rides the body's glide and scale.
 */
import {
  AvatarAttach, engine, Entity, Material, MaterialTransparencyMode, MeshRenderer, TextureWrapMode, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import paths from './bladePaths.json'
import { WeaponMotion } from './combatActions'
import { COMBAT_CLIPS, EQUIPMENT_CLIPS } from './combatAnimations'
import { getEquipmentItemOrNull } from './equipmentCatalog'
import { playerEntityByAddress } from './multiplayer'

type Curve = { t: number[]; p: number[]; q: number[] }
type Blade = { hilt: number[]; tip: number[]; len: number }
const CURVES = paths.clips as Record<string, Curve>
const BLADES = paths.weapons as Record<string, Blade>
/** The hand joint is authored in centimetres. */
const JOINT_SCALE = paths.scale[0]
const KEY_RATE = 30

/** Segments in the strip and the clip time between them: the trail is SEGMENTS * STEP seconds long. */
const SEGMENTS = 18
const STEP = 0.008
/**
 * Each slat is twice as wide as the step it covers, so it lies half over each
 * neighbour: the textures ramp to nothing across the sweep and at half overlap
 * the ramps sum to one, a single continuous sheet with no slat edges.
 */
const OVERLAP = 2
const MAX_TRAILS = 6
/** Tip speed (m/s) below which nothing shows and above which the trail is fully lit: the windup fades in, the stroke burns. */
const SPEED_LOW = 3
const SPEED_HIGH = 9
const HIDDEN = Vector3.create(0, -40, 0)
const TEX_HAZE = 'images/fx/trail_haze.png'
const TEX_CORE = 'images/fx/trail_core.png'
/** UVs for a slat covering u0..u1 of the texture (hilt -> tip along the plane's X), on both faces. */
function uvs(u0: number, u1: number): number[] {
  return [u0, 0, u1, 0, u1, 1, u0, 1, u1, 0, u0, 0, u0, 1, u1, 1]
}

/**
 * A trail's look. The haze is `haze` where it leaves the blade and `tail` by
 * the time it dies (a hot colour cooling to a deep one, the way a real ember
 * or a film-grade slash reads), the core is near white. `life` is how much of
 * the strip's full length this weapon leaves behind: a dagger's flick is a
 * short bright streak, a warhammer drags a long smear.
 */
type Tint = {
  haze: Color3; tail: Color3; core: Color3
  hazeAlpha: number; coreGlow: number; hazeGlow: number
  life: number
  /** Motes shed at the top of the stroke, relative to a sword's. */
  flecks: number
}
type Layer = { entity: Entity; alpha: number; glow: number }
/**
 * One step of the sweep. The wedge the blade covers in a step is a trapezoid
 * (the tip moves farther than the hilt), which a rectangle cannot fill without
 * gaps at the tip or a pile-up at the hand; so the haze is two slats, each
 * sized to its own outer end, and the core rides only the outer half where
 * the texture has anything to show.
 */
type Segment = { inner: Layer; outer: Layer; core: Layer }
type Trail = {
  anchor: Entity
  curve: Curve
  blade: Blade
  tint: Tint
  /** Seconds since the swing started, in the clip's own time. */
  time: number
  rate: number
  end: number
  contact: number
  /** Whether the contact frame has fired its sparks this swing. */
  struck: boolean
  heavy: boolean
  on: boolean
  segments: Segment[]
}

const trails: Trail[] = []

// Scratch space: the strip is rebuilt every frame and must not allocate per sample.
const hiltA = Vector3.Zero(), tipA = Vector3.Zero(), hiltB = Vector3.Zero(), tipB = Vector3.Zero()
const midA = Vector3.Zero(), midB = Vector3.Zero(), cutA = Vector3.Zero(), cutB = Vector3.Zero()
const hazeColor = Color3.create(1, 1, 1)
const along = Vector3.Zero(), sweep = Vector3.Zero(), normal = Vector3.Zero(), axisX = Vector3.Zero()

/** Swords: a clean cold edge. */
const STEEL: Tint = {
  haze: Color3.create(0.6, 0.85, 1), tail: Color3.create(0.2, 0.35, 1), core: Color3.create(0.9, 0.97, 1),
  hazeAlpha: 0.6, coreGlow: 5, hazeGlow: 2.4, life: 0.85, flecks: 1
}
/** Daggers: quick, short and bright, more edge than haze. */
const QUICK: Tint = {
  haze: Color3.create(0.75, 0.95, 1), tail: Color3.create(0.3, 0.6, 1), core: Color3.create(1, 1, 1),
  hazeAlpha: 0.45, coreGlow: 6.5, hazeGlow: 2, life: 0.6, flecks: 0.7
}
/** Axes, hammers, clubs, greatswords: a long hot smear that darkens to embers and throws more of them. */
const EMBER: Tint = {
  haze: Color3.create(1, 0.6, 0.15), tail: Color3.create(0.7, 0.08, 0.02), core: Color3.create(1, 0.9, 0.6),
  hazeAlpha: 0.75, coreGlow: 5, hazeGlow: 3, life: 1, flecks: 1.8
}
/** Maces: the blade's cold edge with a warmer, heavier body. */
const IRON: Tint = {
  haze: Color3.create(0.85, 0.8, 0.7), tail: Color3.create(0.5, 0.25, 0.1), core: Color3.create(1, 0.97, 0.9),
  hazeAlpha: 0.65, coreGlow: 4.5, hazeGlow: 2.4, life: 0.9, flecks: 1.3
}
/** Staves and sceptres: violet, lingering, more motes than edge. */
const ARCANE: Tint = {
  haze: Color3.create(0.7, 0.45, 1), tail: Color3.create(0.3, 0.05, 0.8), core: Color3.create(0.95, 0.85, 1),
  hazeAlpha: 0.65, coreGlow: 5.5, hazeGlow: 2.8, life: 1, flecks: 2.2
}
/** Bows: the tracer of a loosed arrow and the release, a pale wind green. */
const WIND: Tint = {
  haze: Color3.create(0.75, 1, 0.8), tail: Color3.create(0.2, 0.7, 0.45), core: Color3.create(0.95, 1, 0.95),
  hazeAlpha: 0.7, coreGlow: 5, hazeGlow: 2.6, life: 0.8, flecks: 0.8
}
/** Pride: gold going to orange, the brightest of all. */
const GOLD: Tint = {
  haze: Color3.create(1, 0.8, 0.3), tail: Color3.create(1, 0.4, 0.05), core: Color3.create(1, 0.97, 0.8),
  hazeAlpha: 0.7, coreGlow: 6, hazeGlow: 3, life: 1, flecks: 1.6
}
/** A goblin's arrow: dim and red, so the thing to dodge reads at a glance. */
export const HOSTILE_TINT: Tint = {
  haze: Color3.create(1, 0.35, 0.25), tail: Color3.create(0.5, 0.05, 0.02), core: Color3.create(1, 0.7, 0.6),
  hazeAlpha: 0.5, coreGlow: 2.5, hazeGlow: 1.5, life: 0.8, flecks: 0
}
/** How much of the inner slat's hilt end the oldest step has lost: the tail erodes toward the tip as it dies. */
const ERODE = 0.6
/** Told where a blade lands (world metres) and in what colour: the sparks live in src/combatFx.ts. */
let onContact: ((world: Vector3, tint: Tint, heavy: boolean) => void) | undefined
export type BladeTint = Tint

export function setBladeContactHandler(fn: (world: Vector3, tint: Tint, heavy: boolean) => void) {
  onContact = fn
}
/**
 * The look a weapon leaves: by its class, Pride overriding. Rarity belongs to the copy, not
 * the weapon, and a remote swing does not say which copy, so the trail does not read it.
 */
export function bladeTintFor(weapon: string | undefined): Tint {
  const info = weapon ? getEquipmentItemOrNull(weapon)?.weapon : undefined
  if (!info) return STEEL
  if (info.pride) return GOLD
  return (
    info.class === 'dagger' ? QUICK :
    info.class === 'mace' ? IRON :
    info.class === 'axe' || info.class === 'hammer' || info.class === 'club' || info.class === 'great' ? EMBER :
    info.class === 'staff' || info.class === 'sceptre' ? ARCANE :
    info.class === 'bow' ? WIND : STEEL
  )
}

/** Whether a swing by this weapon leaves a trail: the weapon and the clip must both be baked. */
export function bladeTrailReady(motion: WeaponMotion, weapon: string | undefined): boolean {
  return weapon !== undefined && BLADES[weapon] !== undefined && CURVES[EQUIPMENT_CLIPS[motion]] !== undefined
}

/** Start a trail on the attacker's body for a swing that begins now; a trail already on that body restarts. */
export function fxBladeTrail(anchor: Entity, motion: WeaponMotion, weapon: string) {
  const curve = CURVES[EQUIPMENT_CLIPS[motion]]
  const blade = BLADES[weapon]
  if (!curve || !blade) return
  const clip = COMBAT_CLIPS[motion]
  let slot = trails.find((x) => x.on && x.anchor === anchor) ?? trails.find((x) => !x.on)
  if (!slot) {
    if (trails.length >= MAX_TRAILS) {
      slot = trails.reduce((a, b) => (a.time / a.end > b.time / b.end ? a : b))
    } else {
      slot = { anchor, curve, blade, tint: STEEL, time: 0, rate: 1, end: 1, contact: 0.5, struck: false, heavy: false, on: false, segments: [] }
      for (let i = 0; i < SEGMENTS; i++) {
        slot.segments.push({ inner: makeLayer(TEX_HAZE, 0, 0.5), outer: makeLayer(TEX_HAZE, 0.5, 1), core: makeLayer(TEX_CORE, 0.5, 1) })
      }
      trails.push(slot)
    }
  }
  slot.anchor = anchor
  slot.curve = curve
  slot.blade = blade
  slot.tint = bladeTintFor(weapon)
  slot.time = 0
  slot.rate = clip.rate ?? 1
  slot.end = Math.min(clip.duration, curve.t[curve.t.length - 1]) + SEGMENTS * STEP
  slot.contact = clip.contact ?? clip.duration * 0.45
  slot.struck = false
  slot.heavy = motion === 'attack_heavy' || motion === 'flourish_heavy' || motion === 'heavy_combo_c' || motion === 'leap' || motion === 'stab'
  slot.on = true
}

function makeLayer(texture: string, u0: number, u1: number): Layer {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.clone(HIDDEN) })
  MeshRenderer.setPlane(entity, uvs(u0, u1))
  const map = Material.Texture.Common({ src: texture, wrapMode: TextureWrapMode.TWM_CLAMP })
  Material.setPbrMaterial(entity, {
    texture: map,
    emissiveTexture: map,
    albedoColor: Color4.create(1, 1, 1, 0),
    emissiveColor: Color3.create(1, 1, 1),
    emissiveIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  VisibilityComponent.create(entity, { visible: false })
  return { entity, alpha: -1, glow: 0 }
}

/** Hilt and tip in the body's space (DCL handedness) at a clip time, written into the given vectors. */
function sample(trail: Trail, time: number, hilt: Vector3.MutableVector3, tip: Vector3.MutableVector3) {
  const { t, p, q } = trail.curve
  const last = t.length - 1
  const f = Math.max(0, Math.min(last, time * KEY_RATE))
  const i0 = Math.floor(f)
  const i1 = Math.min(last, i0 + 1)
  const k = f - i0
  const px = p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k
  const py = p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k
  const pz = p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k
  // Keys are 33 ms apart and hemisphere-continuous: a normalised lerp is as good as a slerp here.
  let qx = q[i0 * 4] + (q[i1 * 4] - q[i0 * 4]) * k
  let qy = q[i0 * 4 + 1] + (q[i1 * 4 + 1] - q[i0 * 4 + 1]) * k
  let qz = q[i0 * 4 + 2] + (q[i1 * 4 + 2] - q[i0 * 4 + 2]) * k
  let qw = q[i0 * 4 + 3] + (q[i1 * 4 + 3] - q[i0 * 4 + 3]) * k
  const n = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
  qx *= n; qy *= n; qz *= n; qw *= n
  place(trail.blade.hilt, px, py, pz, qx, qy, qz, qw, hilt)
  place(trail.blade.tip, px, py, pz, qx, qy, qz, qw, tip)
}

/** A joint-space point carried by the hand, then mirrored from glTF into DCL's handedness (X flips). */
function place(v: number[], px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, out: Vector3.MutableVector3) {
  const x = v[0] * JOINT_SCALE, y = v[1] * JOINT_SCALE, z = v[2] * JOINT_SCALE
  // q * v * q^-1 as v + 2w(q x v) + 2(q x (q x v))
  const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x
  const dx = qy * cz - qz * cy, dy = qz * cx - qx * cz, dz = qx * cy - qy * cx
  out.x = -(px + x + 2 * (qw * cx + dx))
  out.y = py + y + 2 * (qw * cy + dy)
  out.z = pz + z + 2 * (qw * cz + dz)
}

export function updateBladeTrails(dt: number) {
  for (const trail of trails) if (trail.on) updateTrail(trail, dt)
}

function updateTrail(trail: Trail, dt: number) {
  const anchor = Transform.getOrNull(trail.anchor)
  trail.time += dt * trail.rate
  if (!anchor || trail.time >= trail.end) {
    for (const s of trail.segments) hideSegment(s)
    trail.on = false
    return
  }
  // The blow's own frame flares the core briefly and throws sparks off the tip.
  const flare = 1 + 0.6 * Math.max(0, 1 - Math.abs(trail.time - trail.contact) / 0.08)
  const tint = trail.tint
  if (!trail.struck && trail.time >= trail.contact) {
    trail.struck = true
    if (onContact) {
      sample(trail, trail.contact, hiltA, tipA)
      // Two thirds out along the blade: where a cut actually bites.
      const world = Vector3.create(
        hiltA.x + (tipA.x - hiltA.x) * 0.7, hiltA.y + (tipA.y - hiltA.y) * 0.7, hiltA.z + (tipA.z - hiltA.z) * 0.7)
      if (toWorld(trail.anchor, world)) onContact(world, tint, trail.heavy)
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = trail.segments[i]
    const tA = trail.time - i * STEP
    const tB = tA - STEP
    if (tB < 0) {
      hideSegment(seg)
      continue
    }
    sample(trail, tA, hiltA, tipA)
    sample(trail, tB, hiltB, tipB)
    const tipSpeed = Vector3.distance(tipA, tipB) / STEP
    const lit = Math.max(0, Math.min(1, (tipSpeed - SPEED_LOW) / (SPEED_HIGH - SPEED_LOW)))
    const age = 1 - i / (SEGMENTS * tint.life)
    if (age <= 0) {
      hideSegment(seg)
      continue
    }
    const fade = lit * age * age
    if (fade < 0.02) {
      hideSegment(seg)
      continue
    }
    midA.x = (hiltA.x + tipA.x) * 0.5; midA.y = (hiltA.y + tipA.y) * 0.5; midA.z = (hiltA.z + tipA.z) * 0.5
    midB.x = (hiltB.x + tipB.x) * 0.5; midB.y = (hiltB.y + tipB.y) * 0.5; midB.z = (hiltB.z + tipB.z) * 0.5
    const hazeAlpha = fade * tint.hazeAlpha
    const hazeGlow = fade * tint.hazeGlow
    // Hot where it leaves the blade, cooling to the tail colour as it ages.
    const cool = (1 - age) * (1 - age)
    hazeColor.r = tint.haze.r + (tint.tail.r - tint.haze.r) * cool
    hazeColor.g = tint.haze.g + (tint.tail.g - tint.haze.g) * cool
    hazeColor.b = tint.haze.b + (tint.tail.b - tint.haze.b) * cool
    // The tail erodes from the hand outward: the inner slat gives up its hilt end as it ages.
    const cut = ERODE * cool
    cutA.x = hiltA.x + (midA.x - hiltA.x) * cut; cutA.y = hiltA.y + (midA.y - hiltA.y) * cut; cutA.z = hiltA.z + (midA.z - hiltA.z) * cut
    cutB.x = hiltB.x + (midB.x - hiltB.x) * cut; cutB.y = hiltB.y + (midB.y - hiltB.y) * cut; cutB.z = hiltB.z + (midB.z - hiltB.z) * cut
    slat(seg.inner, trail.anchor, cutA, cutB, midA, midB, hazeColor, hazeAlpha, hazeGlow)
    if (slat(seg.outer, trail.anchor, midA, midB, tipA, tipB, hazeColor, hazeAlpha, hazeGlow)) {
      slat(seg.core, trail.anchor, midA, midB, tipA, tipB, tint.core, fade, tint.coreGlow * fade * flare)
    } else {
      hide(seg.core)
    }
  }
}

function hideSegment(seg: Segment) {
  hide(seg.inner)
  hide(seg.outer)
  hide(seg.core)
}

/**
 * Lay one slat over the wedge between the blade at two instants, from its
 * inner end (nA -> nB) to its outer end (fA -> fB). The plane runs along the
 * blade and is as wide as twice the outer end's sweep (see OVERLAP). Returns
 * whether anything was shown.
 */
function slat(layer: Layer, anchor: Entity, nA: Vector3, nB: Vector3, fA: Vector3, fB: Vector3,
  color: Color3, alpha: number, glow: number): boolean {
  along.x = (fA.x + fB.x - nA.x - nB.x) * 0.5
  along.y = (fA.y + fB.y - nA.y - nB.y) * 0.5
  along.z = (fA.z + fB.z - nA.z - nB.z) * 0.5
  const length = Vector3.length(along)
  sweep.x = fA.x - fB.x; sweep.y = fA.y - fB.y; sweep.z = fA.z - fB.z
  if (length < 0.02) {
    hide(layer)
    return false
  }
  along.x /= length; along.y /= length; along.z /= length
  // The sweep made perpendicular to the blade: the plane's other axis.
  const d = Vector3.dot(sweep, along)
  sweep.x -= along.x * d; sweep.y -= along.y * d; sweep.z -= along.z * d
  const step = Vector3.length(sweep)
  if (step < 0.002) {
    hide(layer)
    return false
  }
  sweep.x /= step; sweep.y /= step; sweep.z /= step
  Vector3.crossToRef(along, sweep, normal)
  const rotation = Quaternion.lookRotation(normal, sweep)
  // The plane's U runs along its +X; flip the scale when the rotation put +X toward the hilt.
  Vector3.rotateToRef(Vector3.Right(), rotation, axisX)
  const sign = Vector3.dot(axisX, along) < 0 ? -1 : 1
  const mid = Vector3.create(
    (nA.x + nB.x + fA.x + fB.x) * 0.25,
    (nA.y + nB.y + fA.y + fB.y) * 0.25,
    (nA.z + nB.z + fA.z + fB.z) * 0.25)
  show(layer, anchor, mid, rotation, sign * length * 1.04, step * OVERLAP, color, alpha, glow)
  return true
}

function show(layer: Layer, anchor: Entity, mid: Vector3, rotation: Quaternion, sx: number, sy: number, color: Color3, alpha: number, glow: number) {
  const t = Transform.getMutable(layer.entity)
  if (t.parent !== anchor) t.parent = anchor
  t.position = mid
  t.rotation = rotation
  t.scale = Vector3.create(sx, sy, 1)
  if (layer.alpha < 0) VisibilityComponent.getMutable(layer.entity).visible = true
  // Material writes are the expensive part: only when the eye would notice.
  if (Math.abs(layer.alpha - alpha) > 0.04 || Math.abs(layer.glow - glow) > 0.2) {
    layer.alpha = alpha
    layer.glow = glow
    const m = Material.getMutable(layer.entity)
    if (m.material?.$case === 'pbr') {
      // The glow is all emissive: the lit albedo is kept near black so the sheet
      // is light laid over the scene, not a coloured plastic shaded by the torches.
      m.material.pbr.albedoColor = Color4.create(color.r * 0.12, color.g * 0.12, color.b * 0.12, alpha)
      m.material.pbr.emissiveColor = Color3.create(color.r, color.g, color.b)
      m.material.pbr.emissiveIntensity = glow
    }
  }
}

function hide(layer: Layer) {
  if (layer.alpha < 0) return
  layer.alpha = -1
  layer.glow = 0
  VisibilityComponent.getMutable(layer.entity).visible = false
  const t = Transform.getMutable(layer.entity)
  t.parent = undefined
  t.position = Vector3.clone(HIDDEN)
}

/**
 * A point in the body's space taken to the world through its Transform
 * ancestry (the enemy body under its root, the hero body under the player
 * root). An AvatarAttach anchor rides the avatar: its own Transform is
 * relative to that player, so that player's Transform stands in for it.
 * Returns false when the chain cannot be followed.
 */
function toWorld(anchor: Entity, point: Vector3.MutableVector3): boolean {
  let cursor: Entity | undefined = anchor
  for (let depth = 0; cursor !== undefined && depth < 6; depth++) {
    const attach = AvatarAttach.getOrNull(cursor)
    if (attach) {
      const player = attach.avatarId ? playerEntityByAddress(attach.avatarId) : engine.PlayerEntity
      const t = player !== undefined ? Transform.getOrNull(player) : undefined
      if (!t) return false
      Vector3.rotateToRef(point, t.rotation, point)
      point.x += t.position.x; point.y += t.position.y; point.z += t.position.z
      return true
    }
    const t = Transform.getOrNull(cursor)
    if (!t) return false
    point.x *= t.scale.x; point.y *= t.scale.y; point.z *= t.scale.z
    Vector3.rotateToRef(point, t.rotation, point)
    point.x += t.position.x; point.y += t.position.y; point.z += t.position.z
    cursor = t.parent
  }
  return true
}

/** Warm the textures and the pool before the first swing. */
export function warmBladeTrails(anchor: Entity) {
  fxBladeTrail(anchor, 'attack_light', 'pride-sword')
}
