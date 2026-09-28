// Arrows, bolts and orbs: what the ranged classes' contact frame fires instead
// of a sword reaching an enemy. A projectile flies straight, is tested every
// frame as a sphere against the ready enemies, stops at the first one (or at
// the dungeon's rock when it leaves the floor) and fades at its range.
//
// Damage is not decided here. A shot the local hero fired reports the enemy it
// reached through `onHit`, and dungeonEnemies puts it on the same path a sword
// blow takes (host applies, client publishes for the host to validate). Shots
// other players fired arrive as `shot` messages and are flown here as visuals
// only: the blow they land is announced by the host's enemy snapshot.

import {
  Billboard, BillboardMode, engine, Entity, GltfContainer, Material, MaterialTransparencyMode, MeshRenderer, TextureWrapMode, Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { BladeTint, bladeTintFor, HOSTILE_TINT } from './bladeTrail'
import { HeroAttackMotion } from './combatActions'
import { fxBladeFlecks, fxImpact, fxMagicBurst, fxSlam, fxSound } from './combatFx'
import { COURTYARD } from './courtyard'
import { isDungeonFloor } from './dungeon'
import { ProjectileKind, ShotProfile } from './heroClasses'

export const ARROW_MODEL = 'models/roaming/projectiles/arrow.glb'
/** Where shots leave the hero: chest height on the standing body. */
export const SHOT_HEIGHT = 1.35

/** An enemy as the flight sees it: index into the sim, feet position and body size. */
export type ProjectileTarget = { index: number; position: Vector3; height: number; radius: number }

export type Shot = {
  origin: Vector3
  /** World yaw (radians, the hero's facing convention: x = sin, z = cos) and pitch (up positive). */
  yaw: number
  pitch: number
  profile: ShotProfile
  motion: HeroAttackMotion
  finisher: boolean
  /** The enemy the shot reached, with the impact point. Absent for visual-only shots. */
  onHit?: (target: ProjectileTarget, at: Vector3) => void
  /** A goblin's shot: flies past the enemies (its own side) and ends at `range`; the host lands the hurt itself. */
  hostile?: boolean
  /** The bow it left (an arrow's tracer takes its colour from it, src/bladeTrail.ts). */
  weapon?: string
}

type Projectile = {
  entity: Entity
  glow?: Entity
  /** An arrow's tracer: two crossed planes behind the head, so the streak reads from any side. */
  tracer?: Entity
  tracerPlanes?: Entity[]
  tracerTint?: BladeTint
  kind: ProjectileKind
  position: Vector3
  velocity: Vector3
  travelled: number
  range: number
  radius: number
  burst?: number
  /** Piercing: keeps flying; the bodies already hit, not to be hit again. */
  pierce: boolean
  pierced: Set<number>
  motion: HeroAttackMotion
  finisher: boolean
  onHit?: Shot['onHit']
  hostile: boolean
  live: boolean
}

const MAX_LIVE = 24
const pool: Projectile[] = []
let targetsFn: () => ProjectileTarget[] = () => []
let systemAdded = false

const BOLT_COLOR = Color4.create(0.45, 0.7, 1, 1)
const ORB_COLOR = Color4.create(0.75, 0.4, 1, 1)
const VENOM_COLOR = Color4.create(0.45, 1, 0.3, 1)

function colorOf(kind: ProjectileKind): Color4 {
  return kind === 'orb' ? ORB_COLOR : kind === 'venom' ? VENOM_COLOR : BOLT_COLOR
}
const GLOW_TEXTURE = 'images/fx/soft_spot.png'
const TRACER_TEXTURE = 'images/fx/arrow_streak.png'
/** How far behind the arrowhead the tracer reaches, and how wide it is. */
const TRACER_LENGTH = 1.7
const TRACER_WIDTH = 0.16

/** dungeonEnemies hands over the enemies shots can reach. */
export function setProjectileTargets(fn: () => ProjectileTarget[]) {
  targetsFn = fn
}

/**
 * Build the first few of each projectile up front, hidden below the floor, so
 * their meshes, halo planes and glow texture are resident before the first
 * shot. A halo created on the fly draws as a white square until its sprite
 * arrives; a pooled one just turns visible.
 */
export function initializeProjectiles() {
  ensureSystem()
  const want: Array<[ProjectileKind, number]> = [['arrow', 4], ['bolt', 3], ['orb', 2]]
  for (const [kind, count] of want) {
    while (pool.filter((p) => p.kind === kind).length < count) pool.push(create(kind))
  }
}

/** Fire one shot: `count` projectiles fanned over `spread` degrees around the aim. */
export function launchShot(shot: Shot) {
  ensureSystem()
  const { profile } = shot
  const n = Math.max(1, profile.count)
  const spread = (profile.spread * Math.PI) / 180
  for (let i = 0; i < n; i++) {
    const yaw = shot.yaw + (n > 1 ? spread * (i / (n - 1) - 0.5) : 0)
    const p = acquire(profile.kind)
    if (!p) return
    const cp = Math.cos(shot.pitch)
    p.position = Vector3.clone(shot.origin)
    p.velocity = Vector3.create(Math.sin(yaw) * cp * profile.speed, Math.sin(shot.pitch) * profile.speed, Math.cos(yaw) * cp * profile.speed)
    p.travelled = 0
    p.range = profile.range
    p.radius = profile.radius
    p.burst = profile.burst
    p.pierce = !!profile.pierce
    p.pierced.clear()
    p.motion = shot.motion
    p.finisher = shot.finisher
    p.onHit = shot.onHit
    p.hostile = !!shot.hostile
    p.live = true
    if (p.tracer !== undefined) tintTracer(p, shot.hostile ? HOSTILE_TINT : bladeTintFor(shot.weapon))
    place(p)
    VisibilityComponent.createOrReplace(p.entity, { visible: true })
    if (p.glow !== undefined) VisibilityComponent.createOrReplace(p.glow, { visible: true })
  }
  // The release: a few motes off the bow hand in the arrow's colour.
  if (profile.kind === 'arrow' && !shot.hostile) fxBladeFlecks(shot.origin, bladeTintFor(shot.weapon), n > 1)
  if (shot.hostile) fxSound(profile.kind === 'arrow' ? 'bow' : 'swing_heavy', 0.5)
  else fxSound(profile.kind === 'arrow' ? 'swing_light' : 'swing_heavy', profile.kind === 'orb' ? 0.6 : 0.45)
}

/** Everything in flight disappears (dungeon reset, hero withdrawn). */
export function clearProjectiles() {
  for (const p of pool) if (p.live) retire(p)
}

function ensureSystem() {
  if (systemAdded) return
  systemAdded = true
  engine.addSystem(updateProjectiles)
}

function acquire(kind: ProjectileKind): Projectile | undefined {
  let free = pool.find((p) => !p.live && p.kind === kind)
  if (!free) {
    if (pool.filter((p) => p.live).length >= MAX_LIVE) {
      // Recycle the oldest in flight rather than refuse the shot.
      const oldest = pool.filter((p) => p.live).sort((a, b) => b.travelled / b.range - a.travelled / a.range)[0]
      if (oldest && oldest.kind === kind) {
        retire(oldest)
        return oldest
      }
      return undefined
    }
    free = create(kind)
    pool.push(free)
  }
  return free
}

function create(kind: ProjectileKind): Projectile {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, -40, 0) })
  let glow: Entity | undefined
  let tracer: Entity | undefined
  let tracerPlanes: Entity[] | undefined
  if (kind === 'arrow') {
    GltfContainer.create(entity, { src: ARROW_MODEL, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    // The tracer hangs behind the head along the arrow's -Z, its planes' U
    // (bright end at u = 1) pointing up the shaft toward the head.
    tracer = engine.addEntity()
    const turn = Quaternion.fromEulerDegrees(0, -90, 0)
    const flip = Vector3.rotate(Vector3.Right(), turn).z < 0 ? -1 : 1
    Transform.create(tracer, { parent: entity, position: Vector3.create(0, 0, -TRACER_LENGTH / 2), rotation: turn })
    tracerPlanes = []
    for (const roll of [0, 90]) {
      const plane = engine.addEntity()
      Transform.create(plane, {
        parent: tracer, rotation: Quaternion.fromEulerDegrees(roll, 0, 0), scale: Vector3.create(flip * TRACER_LENGTH, TRACER_WIDTH, 1)
      })
      MeshRenderer.setPlane(plane, [0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1])
      const map = Material.Texture.Common({ src: TRACER_TEXTURE, wrapMode: TextureWrapMode.TWM_CLAMP })
      Material.setPbrMaterial(plane, {
        texture: map, emissiveTexture: map,
        albedoColor: Color4.create(0.1, 0.1, 0.1, 0.8),
        emissiveColor: Color3.create(1, 1, 1),
        emissiveIntensity: 3,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false
      })
      tracerPlanes.push(plane)
    }
  } else {
    const orb = kind === 'orb'
    const size = orb ? 0.55 : kind === 'venom' ? 0.34 : 0.28
    Transform.getMutable(entity).scale = Vector3.create(size, size, size)
    MeshRenderer.setSphere(entity)
    const color = colorOf(kind)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(color.r, color.g, color.b, 0.85),
      emissiveColor: Color3.create(color.r, color.g, color.b),
      emissiveIntensity: orb ? 5 : 4,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      roughness: 0.2, metallic: 0
    })
    // A soft additive halo around the core sells the light without a real one.
    glow = engine.addEntity()
    const halo = orb ? 1.9 : 1.2
    Transform.create(glow, { parent: entity, scale: Vector3.create(halo / size, halo / size, halo / size) })
    MeshRenderer.setPlane(glow)
    Material.setPbrMaterial(glow, {
      texture: Material.Texture.Common({ src: GLOW_TEXTURE }),
      albedoColor: Color4.create(color.r, color.g, color.b, 0.9),
      emissiveTexture: Material.Texture.Common({ src: GLOW_TEXTURE }),
      emissiveColor: Color3.create(color.r, color.g, color.b),
      emissiveIntensity: 3,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    Billboard.create(glow, { billboardMode: BillboardMode.BM_ALL })
  }
  VisibilityComponent.create(entity, { visible: false })
  if (glow !== undefined) VisibilityComponent.create(glow, { visible: false })
  return {
    entity, glow, tracer, tracerPlanes, kind, position: Vector3.Zero(), velocity: Vector3.Zero(), travelled: 0, range: 0, radius: 0,
    pierce: false, pierced: new Set<number>(), motion: 'attack_light', finisher: false, hostile: false, live: false
  }
}

function tintTracer(p: Projectile, tint: BladeTint) {
  if (p.tracerTint === tint || !p.tracerPlanes) return
  p.tracerTint = tint
  for (const plane of p.tracerPlanes) {
    const m = Material.getMutable(plane)
    if (m.material?.$case === 'pbr') {
      m.material.pbr.albedoColor = Color4.create(tint.haze.r * 0.12, tint.haze.g * 0.12, tint.haze.b * 0.12, tint.hazeAlpha + 0.15)
      m.material.pbr.emissiveColor = Color3.create(tint.haze.r, tint.haze.g, tint.haze.b)
      m.material.pbr.emissiveIntensity = tint.hazeGlow + 1
    }
  }
}

function retire(p: Projectile) {
  p.live = false
  p.onHit = undefined
  VisibilityComponent.createOrReplace(p.entity, { visible: false })
  if (p.glow !== undefined) VisibilityComponent.createOrReplace(p.glow, { visible: false })
  Transform.getMutable(p.entity).position = Vector3.create(0, -40, 0)
}

function place(p: Projectile) {
  const t = Transform.getMutable(p.entity)
  t.position = Vector3.clone(p.position)
  if (p.kind === 'arrow') {
    // The arrow model runs along +Z; look down the velocity so the tip leads.
    const dir = Vector3.normalize(p.velocity)
    t.rotation = Quaternion.fromLookAt(Vector3.Zero(), dir)
    if (p.tracer !== undefined) {
      // The tracer grows out of the bow over the first metre rather than poking back through the archer.
      const reach = Math.min(1, p.travelled / TRACER_LENGTH)
      const tt = Transform.getMutable(p.tracer)
      tt.position = Vector3.create(0, 0, -TRACER_LENGTH * reach / 2)
      tt.scale = Vector3.create(reach, 1, 1)
    }
  }
}

function updateProjectiles(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return
  let targets: ProjectileTarget[] | undefined
  for (const p of pool) {
    if (!p.live) continue
    const step = Math.min(dt, 0.05)
    const stride = Vector3.scale(p.velocity, step)
    const length = Vector3.length(stride)
    // Fast arrows cross more than a body radius per frame; sample the segment.
    const samples = Math.max(1, Math.ceil(length / Math.max(0.25, p.radius)))
    let stopped = false
    for (let s = 1; s <= samples && !stopped; s++) {
      const at = Vector3.add(p.position, Vector3.scale(stride, s / samples))
      if (!targets) targets = targetsFn()
      const hit = p.hostile ? undefined : firstHit(at, p.radius, targets, p.pierce ? p.pierced : undefined)
      if (hit) {
        land(p, at, hit, targets)
        // A piercing shot notes the body and flies on; the rest stop here.
        if (p.pierce) {
          p.pierced.add(hit.index)
          continue
        }
        stopped = true
        break
      }
      // Off the dungeon floor: into rock or a wall. Into the ground or the ceiling too.
      if (!isDungeonFloor(at.x, at.z) || at.y < COURTYARD.characterFloorY || at.y > COURTYARD.wallHeight) {
        strike(p, at)
        stopped = true
        break
      }
    }
    if (stopped) {
      retire(p)
      continue
    }
    p.position = Vector3.add(p.position, stride)
    p.travelled += length
    // Orbs drift; arrows and bolts fly true.
    if (p.kind === 'orb') p.velocity = Vector3.add(p.velocity, Vector3.create(0, -1.2 * step, 0))
    place(p)
    if (p.travelled >= p.range) {
      // A goblin's shot ends where it was aimed: the host has already said whether it hurt.
      if (p.kind !== 'arrow' || p.hostile) strike(p, p.position)
      retire(p)
    }
  }
}

/** The nearest target whose body the sphere at `at` overlaps. */
function firstHit(at: Vector3, radius: number, targets: ProjectileTarget[], skip?: Set<number>): ProjectileTarget | undefined {
  let best: ProjectileTarget | undefined
  let bestD = Infinity
  for (const t of targets) {
    if (skip?.has(t.index)) continue
    const dx = at.x - t.position.x
    const dz = at.z - t.position.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d > radius + t.radius) continue
    if (at.y < t.position.y - 0.2 || at.y > t.position.y + t.height + radius) continue
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

/** The projectile found a body. Orbs go off and take everyone nearby with them. */
function land(p: Projectile, at: Vector3, hit: ProjectileTarget, targets: ProjectileTarget[]) {
  if (p.kind === 'arrow') {
    fxImpact(at, p.finisher || !!p.burst, false)
    // An explosive arrow: the blast, dust and all.
    if (p.burst) {
      fxSlam(Vector3.create(at.x, Math.max(COURTYARD.characterFloorY, at.y - 1), at.z), p.burst)
      fxMagicBurst(at, Color4.create(1, 0.6, 0.25, 1), p.burst)
      fxSound('slam', 0.6)
    }
  } else {
    fxMagicBurst(at, colorOf(p.kind), p.burst ?? 0.4)
    if (p.kind === 'orb') fxSound('slam', 0.5)
  }
  if (!p.onHit) return
  if (p.burst) {
    for (const t of targets) {
      const dx = at.x - t.position.x
      const dz = at.z - t.position.z
      if (Math.sqrt(dx * dx + dz * dz) <= p.burst + t.radius) p.onHit(t, at)
    }
  } else {
    p.onHit(hit, at)
  }
}

/** Into a wall or spent: the flight ends with a small mark and nothing hurt. */
function strike(p: Projectile, at: Vector3) {
  if (p.kind === 'arrow') {
    fxImpact(at, false, true)
    return
  }
  fxMagicBurst(at, colorOf(p.kind), p.kind === 'orb' ? (p.burst ?? 1) : 0.35)
  if (p.kind === 'orb') fxSound('slam', 0.4)
  // A nova that reaches its range still goes off on whoever stands there.
  if (p.kind === 'orb' && p.onHit && p.burst) {
    for (const t of targetsFn()) {
      const dx = at.x - t.position.x
      const dz = at.z - t.position.z
      if (Math.sqrt(dx * dx + dz * dz) <= p.burst + t.radius) p.onHit(t, at)
    }
  }
}

/** Assets the title-screen preloader should warm. */
export function projectileAssets(): string[] {
  return [ARROW_MODEL, GLOW_TEXTURE, TRACER_TEXTURE]
}
