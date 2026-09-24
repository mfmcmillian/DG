// The offering, as a shot. A weapon has been chosen and paid for (src/upgrades.ts
// rolled the result already); this plays the moment: the camera leaves the
// hero's shoulder for a rig of its own beside the fire, the hero winds up and
// the weapon arcs into the cauldron, the fire roars, and what comes back rises
// out of it in a beam of its rarity (or a grey puff when the fire did not take
// it). Then the camera is handed back and the item hovers over the fire until
// the hero holds E to take it (src/hallPrompt.ts), which is when the upgrade is
// written. The hero's own body stays in the shot, so this does not go through
// src/sceneCamera.ts, which hides it for the menus.

import { engine, Entity, GltfContainer, InputModifier, MainCamera, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { fxDeathPuff, fxGlitter, fxLootBeam, fxMagicBurst, fxNumber, fxSound } from './combatFx'
import { onDungeonLoaded, resumeDungeonCamera, suspendDungeonCamera } from './dungeon'
import { getEquipmentItemOrNull, WEAPON_DROP_OFFSET, WEAPON_DROP_OFFSET_LEFT } from './equipmentCatalog'
import { t } from './i18n'
import { flarePitFire, PIT_FLAME_HEIGHT, PIT_HOVER_HEIGHT, pitFirePosition } from './pitFire'
import { playScriptedMotion } from './playerCharacter'
import { pendingUpgrade, takeUpgrade, UpgradeResult } from './upgrades'
import { RARITIES } from './weapons'

/** Beats of the shot, in seconds from the cut. */
const T_WINDUP = 0.3
const T_THROW = 1.0
const T_LAND = 1.45
const T_RESULT = 2.6
const T_RISE = 0.7
const T_END = 3.5
const CUT_SECONDS = 0.6
const DOLLY_SECONDS = 2.2

const ORANGE = Color4.create(1, 0.55, 0.15, 1)
const ASH = Color4.create(0.5, 0.5, 0.5, 1)

type Phase = 'idle' | 'shot' | 'hover'

type Shot = {
  t: number
  rig: Entity
  focus: Entity
  from: Vector3
  to: Vector3
  /** Where the throw starts (the hero's hand) and where it lands (inside the pot). */
  hand: Vector3
  pot: Vector3
  /** The fire's mouth, where the result comes up. */
  mouth: Vector3
  thrown: boolean
  landed: boolean
  risen: boolean
}

let phase: Phase = 'idle'
let shot: Shot | undefined
let result: UpgradeResult | undefined
/** The weapon on show: thrown, then risen. */
let item: Entity | undefined
let hoverT = 0
let glitterT = 0
let systemAdded = false

export function initializePitCinematic() {
  if (systemAdded) return
  systemAdded = true
  engine.addSystem(update)
  // The hall is left (a run starts, or the party walks out): whatever waits over the fire is written now.
  onDungeonLoaded(settlePitResult)
}

/** The camera is the shot's: HUD, prompts and the hero's controls stand aside. */
export function pitCinematicPlaying(): boolean {
  return phase === 'shot'
}

/** Something waits over the fire to be taken. */
export function pitResultHovering(): boolean {
  return phase === 'hover' && !!result
}

/** The weapon waiting over the fire, for the prompt. */
export function pitHoverItem(): { id: string; position: Vector3 } | undefined {
  if (!pitResultHovering() || !shot || !result) return undefined
  return { id: result.id, position: Vector3.create(shot.mouth.x, shot.mouth.y + PIT_HOVER_HEIGHT - PIT_FLAME_HEIGHT, shot.mouth.z) }
}

/** Begin the shot for a result `attemptUpgrade` produced. False when the pit is not in this dungeon or a shot is already up. */
export function startPitCinematic(upgrade: UpgradeResult): boolean {
  if (phase !== 'idle') return false
  const fire = pitFirePosition()
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!fire || !player) return false
  result = upgrade
  const mouth = Vector3.create(fire.x, fire.y + PIT_FLAME_HEIGHT, fire.z)
  // The hero faces the pot; the camera stands off to one side, a little in front of the hero, looking across at the fire.
  const toFire = Vector3.create(fire.x - player.x, 0, fire.z - player.z)
  const dist = Math.max(0.01, Vector3.length(toFire))
  const dir = Vector3.scale(toFire, 1 / dist)
  const right = Vector3.create(dir.z, 0, -dir.x)
  const mid = Vector3.create((player.x + fire.x) / 2, player.y + 1.1, (player.z + fire.z) / 2)
  const from = Vector3.create(mid.x + right.x * 3.4 - dir.x * 1.2, player.y + 1.6, mid.z + right.z * 3.4 - dir.z * 1.2)
  const to = Vector3.create(mid.x + right.x * 2.6 + dir.x * 0.6, player.y + 2.1, mid.z + right.z * 2.6 + dir.z * 0.6)
  const focus = engine.addEntity()
  Transform.create(focus, { position: mid })
  const rig = engine.addEntity()
  Transform.create(rig, { position: Vector3.clone(from), rotation: Quaternion.lookRotation(Vector3.subtract(mid, from), Vector3.Up()) })
  VirtualCamera.createOrReplace(rig, { lookAtEntity: focus, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(CUT_SECONDS) } })
  suspendDungeonCamera()
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig })
  shot = {
    t: 0, rig, focus, from, to,
    hand: Vector3.create(player.x + dir.x * 0.45 + right.x * 0.25, player.y + 1.25, player.z + dir.z * 0.45 + right.z * 0.25),
    pot: Vector3.create(fire.x, fire.y + PIT_FLAME_HEIGHT - 0.35, fire.z),
    mouth, thrown: false, landed: false, risen: false
  }
  phase = 'shot'
  // Facing: yaw 0 looks down +Z, so the angle comes from (dx, dz).
  playScriptedMotion('flourish', 1.8, Math.atan2(dir.x, dir.z))
  return true
}

/** The hero takes what came out: the step is written (on a success), with a word over the fire. */
export function takePitResult(): boolean {
  if (!pitResultHovering()) return false
  const taken = takeUpgrade()
  const at = pitHoverItem()?.position
  if (taken && at) {
    const color = RARITIES[taken.to].color
    fxMagicBurst(at, taken.success ? color : ASH, 0.8)
    fxSound(taken.success ? 'coin' : 'thud_straw', 0.8)
    fxNumber(Vector3.add(at, Vector3.create(0, 0.3, 0)), taken.success ? t(RARITIES[taken.to].label) : t('Unchanged'), taken.success ? 'coin' : 'note')
  }
  clearAll()
  return true
}

/**
 * Nothing waits: the shot is cut short and the result, if any, is written at
 * once. For leaving the hall or a run starting with the item still over the fire.
 */
export function settlePitResult() {
  if (phase === 'idle') return
  if (phase === 'shot') release()
  if (pendingUpgrade()) takeUpgrade()
  clearAll()
}

function clearAll() {
  removeItem()
  if (shot) {
    engine.removeEntity(shot.rig)
    engine.removeEntity(shot.focus)
  }
  shot = undefined
  result = undefined
  phase = 'idle'
}

function release() {
  if (!shot) return
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  VirtualCamera.deleteFrom(shot.rig)
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) InputModifier.deleteFrom(engine.PlayerEntity)
  resumeDungeonCamera()
}

function showItem(id: string, at: Vector3): Entity {
  removeItem()
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(at) })
  const weapon = getEquipmentItemOrNull(id)
  if (weapon?.models[0]) {
    // The weapon GLB is authored in the hero's hand; a child carries the offset that stands it up (as loot does).
    const model = engine.addEntity()
    const offset = weapon.weapon?.hand === 'l' ? WEAPON_DROP_OFFSET_LEFT : WEAPON_DROP_OFFSET
    Transform.create(model, {
      parent: root,
      position: Vector3.create(offset.position[0], offset.position[1], offset.position[2]),
      rotation: Quaternion.create(offset.rotation[0], offset.rotation[1], offset.rotation[2], offset.rotation[3])
    })
    GltfContainer.create(model, { src: weapon.models[0], visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  }
  item = root
  return root
}

function removeItem() {
  if (item === undefined) return
  engine.removeEntityWithChildren(item)
  item = undefined
}

function ease(x: number) {
  const k = Math.max(0, Math.min(1, x))
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
}

function update(dt: number) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  if (phase === 'shot' && shot && result) {
    shot.t += step
    const s = shot
    // The dolly: a slow drift round toward the fire while the hero winds up and throws.
    const d = ease((s.t - T_WINDUP) / DOLLY_SECONDS)
    const rig = Transform.getMutable(s.rig)
    rig.position = Vector3.lerp(s.from, s.to, d)
    // The throw: the weapon leaves the hand on a low arc and drops into the pot.
    if (s.t >= T_THROW && !s.thrown) {
      s.thrown = true
      showItem(result.id, s.hand)
    }
    if (s.thrown && !s.landed && item !== undefined) {
      const k = Math.max(0, Math.min(1, (s.t - T_THROW) / (T_LAND - T_THROW)))
      const p = Vector3.lerp(s.hand, s.pot, k)
      p.y += Math.sin(k * Math.PI) * 0.7
      const tr = Transform.getMutable(item)
      tr.position = p
      tr.rotation = Quaternion.fromEulerDegrees(k * 540, 20, 0)
      if (k >= 1) {
        s.landed = true
        removeItem()
        fxSound('thunk_wood', 0.9)
        flarePitFire(3, 1.4)
        fxMagicBurst(s.mouth, ORANGE, 1.2)
        fxSound('slam', 0.5)
        // The blast rocks the rig.
        s.from = Vector3.add(s.from, Vector3.create(0, 0.08, 0))
      }
    }
    // The result: it rises from the fire's mouth into the air above it.
    if (s.t >= T_RESULT && !s.risen) {
      s.risen = true
      showItem(result.id, s.mouth)
      const color = RARITIES[result.to].color
      if (result.success) {
        fxLootBeam(s.mouth, color)
        fxGlitter(Vector3.add(s.mouth, Vector3.create(0, 0.5, 0)), color)
        fxSound('heal', 0.8)
      } else {
        fxDeathPuff(Vector3.subtract(s.mouth, Vector3.create(0, 0.6, 0)))
        fxSound('thud_straw', 0.8)
      }
    }
    if (s.risen && item !== undefined) {
      const k = ease((s.t - T_RESULT) / T_RISE)
      const tr = Transform.getMutable(item)
      tr.position = Vector3.create(s.mouth.x, s.mouth.y + (PIT_HOVER_HEIGHT - PIT_FLAME_HEIGHT) * k, s.mouth.z)
      tr.rotation = Quaternion.fromEulerDegrees(0, k * 360, 0)
    }
    if (s.t >= T_END) {
      release()
      phase = 'hover'
      hoverT = 0
      glitterT = 0
    }
    return
  }
  if (phase === 'hover' && shot && result) {
    hoverT += step
    glitterT += step
    const at = pitHoverItem()?.position
    if (item !== undefined && at) {
      const tr = Transform.getMutable(item)
      tr.position = Vector3.create(at.x, at.y + Math.sin(hoverT * 2.2) * 0.08, at.z)
      tr.rotation = Quaternion.fromEulerDegrees(0, (hoverT * 45) % 360, 0)
    }
    if (glitterT >= 0.9 && at) {
      glitterT = 0
      fxGlitter(at, result.success ? RARITIES[result.to].color : ASH)
    }
  }
}
