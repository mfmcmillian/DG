// Drops: coins and hearts that pop out of a slain enemy, settle on the floor,
// bob and spin, and are collected by walking over them.

import { engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { fxGlitter, fxNumber, fxSound } from './combatFx'
import { isInCourtyard } from './courtyard'
import { publishPickup } from './multiplayer'
import { getPlayerCombatPose, getPlayerVitals } from './playerCharacter'

export type LootKind = 'coin' | 'heart'

type Drop = {
  entity: Entity
  kind: LootKind
  from: Vector3
  to: Vector3
  /** Seconds since the drop; the pop-out arc lasts POP seconds. */
  age: number
  phase: number
}

const POP = 0.55
const PICKUP_RADIUS = 0.95
const MAX_DROPS = 40
const drops: Drop[] = []
const state = { coins: 0 }
let initialized = false

export function initializeLoot() {
  if (initialized) return
  initialized = true
  engine.addSystem(update)
}

export function getLootState(): Readonly<{ coins: number }> {
  return state
}

export function clearLoot() {
  for (const d of drops) engine.removeEntity(d.entity)
  drops.length = 0
}

/** Scatter `count` drops of a kind around a point on the floor. */
export function spawnLoot(origin: Vector3, kind: LootKind, count: number) {
  for (let i = 0; i < count; i++) {
    if (drops.length >= MAX_DROPS) engine.removeEntity(drops.shift()!.entity)
    const angle = Math.random() * Math.PI * 2
    const radius = 0.5 + Math.random() * 0.9
    let to = Vector3.create(origin.x + Math.sin(angle) * radius, origin.y, origin.z + Math.cos(angle) * radius)
    if (!isInCourtyard(to)) to = Vector3.create(origin.x, origin.y, origin.z)
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.add(origin, Vector3.create(0, 0.9, 0)),
      rotation: Quaternion.Identity(),
      scale: kind === 'coin' ? Vector3.create(1.4, 1.4, 1.4) : Vector3.create(1, 1, 1)
    })
    GltfContainer.create(entity, { src: `models/loot/${kind}.glb`, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    drops.push({ entity, kind, from: Vector3.add(origin, Vector3.create(0, 0.9, 0)), to, age: 0, phase: Math.random() * Math.PI * 2 })
  }
}

function update(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0 || !drops.length) return
  const player = getPlayerCombatPose()
  const vitals = getPlayerVitals()
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]
    d.age += dt
    const t = Transform.getMutable(d.entity)
    if (d.age < POP) {
      const k = d.age / POP
      const arc = Math.sin(k * Math.PI) * 0.8
      t.position = Vector3.create(
        d.from.x + (d.to.x - d.from.x) * k,
        d.from.y + (d.to.y - d.from.y) * k + arc,
        d.from.z + (d.to.z - d.from.z) * k
      )
      t.rotation = Quaternion.fromEulerDegrees(d.kind === 'coin' ? 90 : 0, k * 720, 0)
      continue
    }
    const wobble = d.age + d.phase
    t.position = Vector3.create(d.to.x, d.to.y + 0.18 + Math.sin(wobble * 3) * 0.06, d.to.z)
    // The coin is authored flat; stand it up and spin it. The heart is authored upright.
    t.rotation = d.kind === 'coin'
      ? Quaternion.multiply(Quaternion.fromEulerDegrees(0, wobble * 160, 0), Quaternion.fromEulerDegrees(90, 0, 0))
      : Quaternion.fromEulerDegrees(0, wobble * 90, 0)

    if (!player) continue
    const dx = player.position.x - d.to.x
    const dz = player.position.z - d.to.z
    if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS || Math.abs(player.position.y - d.to.y) > 1.5) continue
    if (d.kind === 'heart' && vitals.health >= vitals.maxHealth) continue
    collect(d)
    drops.splice(i, 1)
  }
}

function collect(d: Drop) {
  const at = Vector3.add(d.to, Vector3.create(0, 0.6, 0))
  if (d.kind === 'coin') {
    state.coins++
    fxSound('coin', 0.6)
    fxGlitter(at, Color4.create(1, 0.85, 0.3, 1))
    fxNumber(at, '+1', 'coin')
  } else {
    // The host owns hero health: it checks the heart against its own drop
    // record and answers with `heal`, which plays the +N. The sparkle is local.
    publishPickup(d.to.x, d.to.z)
    fxSound('heal', 0.8)
    fxGlitter(at, Color4.create(0.5, 1, 0.6, 1))
  }
  engine.removeEntity(d.entity)
}
