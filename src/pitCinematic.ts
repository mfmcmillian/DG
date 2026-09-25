// The offering, as a shot. A weapon has been chosen and paid for (src/upgrades.ts
// rolled the result already); this plays the moment: the camera leaves the
// hero's shoulder for a rig of its own beside the fire, the hero winds up and
// the weapon arcs into the cauldron, the fire roars, and what comes back rises
// out of it in a beam of its rarity (or a grey puff when the fire did not take
// it). Then the camera is handed back and the item hovers over the fire until
// the hero holds E to take it (src/hallPrompt.ts), which is when the upgrade is
// written. The hero's own body stays in the shot, so this does not go through
// src/sceneCamera.ts, which hides it for the menus.

import { engine, Entity, GltfContainer, InputModifier, LightSource, MainCamera, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { fxDeathPuff, fxGlitter, fxLootBeam, fxMagicBurst, fxNumber, fxSound } from './combatFx'
import { onDungeonLoaded, resumeDungeonCamera, suspendDungeonCamera } from './dungeon'
import { getEquipmentItemOrNull, WEAPON_DROP_OFFSET, WEAPON_DROP_OFFSET_LEFT } from './equipmentCatalog'
import { flushHeroSave } from './heroSave'
import { t } from './i18n'
import { PitEventNet, publishPitEvent, setPitEventHandler } from './multiplayer'
import { hallNotice } from './party'
import { flarePitFire, PIT_FLAME_HEIGHT, PIT_HOVER_HEIGHT, PIT_MOUTH_RADIUS, pitFirePosition } from './pitFire'
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
/** A legendary takes longer to come up: the fire builds, then the reveal, then the camera cranes out. */
const T_LEGEND_RISE = 2.2
const T_LEGEND_END = 7.0
const CUT_SECONDS = 0.6
const DOLLY_SECONDS = 2.2

/**
 * The hero's mark: where they stand for the shot, east of the pit (toward the
 * smithy door) facing it, so the framing is the same every time and the rig
 * never meets a wall. Metres from the cauldron's centre.
 */
const MARK_OFFSET = Vector3.create(2.5, 0, 0)

const ORANGE = Color4.create(1, 0.55, 0.15, 1)
const ASH = Color4.create(0.5, 0.5, 0.5, 1)
const GOLD = Color4.create(1, 0.78, 0.3, 1)
const WHITE = Color4.create(1, 1, 1, 1)

type Phase = 'idle' | 'shot' | 'hover'

type Shot = {
  t: number
  rig: Entity
  focus: Entity
  from: Vector3
  to: Vector3
  /** Where a legendary's crane-out ends: higher and further back, the whole pit in frame. */
  crane: Vector3
  /** Beats of the legendary build-up already fired. */
  legendBeat: number
  /** Rig shake left (seconds). */
  shake: number
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
/**
 * The camera rig and what it looks at, made once and kept: the Explorer blends
 * from the outgoing virtual camera when MainCamera lets go of it, so the rig
 * must still exist (with its VirtualCamera) through the hand-back. Same as
 * src/sceneCamera.ts, which keeps its rig for the menus.
 */
let rigEntities: { rig: Entity; focus: Entity } | undefined
let hoverT = 0
let glitterT = 0
let pulseT = 0
/** A legendary hovers under its own gold light. */
let hoverLight: Entity | undefined
let systemAdded = false

export function initializePitCinematic() {
  if (systemAdded) return
  systemAdded = true
  engine.addSystem(update)
  // The hall is left (a run starts, or the party walks out): whatever waits over the fire is written now.
  onDungeonLoaded(settlePitResult)
  setPitEventHandler(onRemotePitEvent)
}

/** Another hero's offering: the fire and the reveal play for us too, from the pit, without the camera. */
function onRemotePitEvent(msg: PitEventNet) {
  const fire = pitFirePosition()
  if (!fire) return
  const mouth = Vector3.create(fire.x, fire.y + PIT_FLAME_HEIGHT, fire.z)
  if (msg.beat === 'throw') {
    fxSound('thunk_wood', 0.6)
    flarePitFire(3.5, 1.6)
    fxMagicBurst(mouth, ORANGE, 1.6)
    fxSound('fire_flare', 0.7)
    return
  }
  if (msg.beat !== 'result') return
  const rarity = (msg.rarity in RARITIES ? msg.rarity : 'common') as keyof typeof RARITIES
  const color = RARITIES[rarity].color
  if (!msg.success) {
    fxDeathPuff(above(mouth, -0.6))
    fxSound('thud_straw', 0.6)
    return
  }
  if (rarity === 'legendary') {
    flarePitFire(6, 3)
    fxSound('roar', 0.5)
    fxMagicBurst(mouth, GOLD, 1.8)
    ring(mouth, PIT_MOUTH_RADIUS * 1.4, 12, GOLD)
    fxLootBeam(mouth, GOLD)
    fxSound('reveal', 0.9)
    fxNumber(above(mouth, HOVER_LIFT + 0.6), t('LEGENDARY'), 'coin')
    return
  }
  fxLootBeam(mouth, color)
  fxGlitter(above(mouth, 0.5), color)
  fxSound('reveal', 0.6)
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
  const current = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!fire || !current) return false
  result = upgrade
  const mouth = Vector3.create(fire.x, fire.y + PIT_FLAME_HEIGHT, fire.z)
  // The hero steps to the mark first, so the shot is framed the same every time.
  const player = Vector3.create(fire.x + MARK_OFFSET.x, current.y, fire.z + MARK_OFFSET.z)
  movePlayerTo({ newRelativePosition: player, avatarTarget: mouth }).catch((error: unknown) => console.log('pit mark failed', error))
  // The hero faces the pot; the camera stands off to one side, a little in front of the hero, looking across at the fire.
  const toFire = Vector3.create(fire.x - player.x, 0, fire.z - player.z)
  const dist = Math.max(0.01, Vector3.length(toFire))
  const dir = Vector3.scale(toFire, 1 / dist)
  const right = Vector3.create(dir.z, 0, -dir.x)
  const mid = Vector3.create((player.x + fire.x) / 2, player.y + 1.5, (player.z + fire.z) / 2)
  const from = Vector3.create(mid.x + right.x * 4.2 - dir.x * 1.6, player.y + 2.0, mid.z + right.z * 4.2 - dir.z * 1.6)
  const to = Vector3.create(mid.x + right.x * 3.4 + dir.x * 0.4, player.y + 2.7, mid.z + right.z * 3.4 + dir.z * 0.4)
  const crane = Vector3.create(mid.x + right.x * 4.6 - dir.x * 2.4, player.y + 4.2, mid.z + right.z * 4.6 - dir.z * 2.4)
  if (!rigEntities) rigEntities = { rig: engine.addEntity(), focus: engine.addEntity() }
  const { rig, focus } = rigEntities
  Transform.createOrReplace(focus, { position: mid })
  Transform.createOrReplace(rig, { position: Vector3.clone(from), rotation: Quaternion.lookRotation(Vector3.subtract(mid, from), Vector3.Up()) })
  VirtualCamera.createOrReplace(rig, { lookAtEntity: focus, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(CUT_SECONDS) } })
  suspendDungeonCamera()
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig })
  shot = {
    t: 0, rig, focus, from, to, crane, legendBeat: 0, shake: 0,
    hand: Vector3.create(player.x + dir.x * 0.45 + right.x * 0.25, player.y + 1.25, player.z + dir.z * 0.45 + right.z * 0.25),
    pot: Vector3.create(fire.x, fire.y + PIT_FLAME_HEIGHT - 0.5, fire.z),
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
    const legend = taken.success && taken.to === 'legendary'
    fxMagicBurst(at, taken.success ? color : ASH, legend ? 1.4 : 0.8)
    if (legend) fxGlitter(at, WHITE)
    fxSound(taken.success ? 'coin' : 'thud_straw', 0.8)
    if (legend) fxSound('heal', 0.9)
    fxNumber(Vector3.add(at, Vector3.create(0, 0.3, 0)), taken.success ? t(RARITIES[taken.to].label) : t('Unchanged'), taken.success ? 'coin' : 'note')
  }
  if (taken) {
    const name = getEquipmentItemOrNull(taken.id)?.name ?? taken.id
    hallNotice(taken.success
      ? t('{name} is now {rarity}.', { name: t(name), rarity: t(RARITIES[taken.to].label) })
      : t('The fire did not take {name}. {n} coins lost.', { name: t(name), n: taken.coins }))
    // A paid-for step is not left to the next periodic save.
    flushHeroSave()
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
  if (pendingUpgrade()) {
    takeUpgrade()
    flushHeroSave()
  }
  clearAll()
}

function clearAll() {
  removeItem()
  if (hoverLight !== undefined) {
    engine.removeEntity(hoverLight)
    hoverLight = undefined
  }
  shot = undefined
  result = undefined
  phase = 'idle'
}

function release() {
  if (!shot) return
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) InputModifier.deleteFrom(engine.PlayerEntity)
  // The follow camera comes back first, while MainCamera still names the rig: the
  // shoulder camera sees it is taking over from a scene camera and settles behind
  // the hero instead of reading the rig's off-axis view for its yaw and pitch.
  // The rig stays where it is, VirtualCamera and all, so the Explorer has
  // something to blend out from. Only if nothing took MainCamera is it let go.
  resumeDungeonCamera()
  const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mainCamera?.virtualCameraEntity === shot.rig) mainCamera.virtualCameraEntity = undefined
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

function isLegend(r: UpgradeResult | undefined): boolean {
  return !!r && r.success && r.to === 'legendary'
}

function above(p: Vector3, dy: number): Vector3 {
  return Vector3.create(p.x, p.y + dy, p.z)
}

/** Glitter in a ring round the mouth of the pit, `count` points wide. */
function ring(center: Vector3, radius: number, count: number, color: Color4) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    fxGlitter(Vector3.create(center.x + Math.sin(a) * radius, center.y, center.z + Math.cos(a) * radius), color)
  }
}

const HOVER_LIFT = PIT_HOVER_HEIGHT - PIT_FLAME_HEIGHT

/**
 * The legendary reveal, beat by beat after the throw lands: the fire climbs
 * to a roar, rings of light run round the rim, white flashes at the mouth,
 * and the weapon comes up slowly in a gold column while the camera cranes out.
 */
const LEGEND_BEATS: Array<{ at: number; run: (s: Shot) => void }> = [
  { at: 0.0, run: (s) => { flarePitFire(4, 3.2); fxSound('roar', 0.6); fxSound('fire_flare', 0.8); s.shake = 0.5 } },
  { at: 0.5, run: (s) => { ring(s.mouth, PIT_MOUTH_RADIUS * 1.3, 10, GOLD); fxSound('heal', 0.5) } },
  { at: 0.9, run: (s) => { fxMagicBurst(s.mouth, GOLD, 1.6); flarePitFire(6, 2.4); fxSound('slam', 0.6); s.shake = 0.6 } },
  { at: 1.3, run: (s) => { ring(above(s.mouth, 0.6), PIT_MOUTH_RADIUS * 1.6, 12, WHITE); fxLootBeam(s.mouth, GOLD) } },
  { at: 1.7, run: (s) => { fxMagicBurst(above(s.mouth, 0.4), WHITE, 1.2); fxSound('heal', 0.8) } },
  { at: 2.0, run: (s) => { fxLootBeam(s.mouth, GOLD); fxLootBeam(Vector3.add(s.mouth, Vector3.create(0.3, 0, 0)), WHITE); fxLootBeam(Vector3.add(s.mouth, Vector3.create(-0.3, 0, 0)), WHITE) } },
  { at: 2.6, run: (s) => { ring(above(s.mouth, 1.2), PIT_MOUTH_RADIUS * 1.2, 10, GOLD); fxSound('coin', 0.7) } },
  { at: 3.2, run: (s) => {
    fxMagicBurst(above(s.mouth, HOVER_LIFT), GOLD, 1.8); fxSound('slam', 0.8); fxSound('reveal', 1); s.shake = 0.4
    fxNumber(above(s.mouth, HOVER_LIFT + 0.6), t('LEGENDARY'), 'coin')
  } },
  { at: 3.8, run: (s) => { ring(above(s.mouth, HOVER_LIFT), 0.9, 12, WHITE); fxGlitter(above(s.mouth, HOVER_LIFT), GOLD) } }
]

function update(dt: number) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  if (phase === 'shot' && shot && result) {
    shot.t += step
    const s = shot
    const legend = isLegend(result)
    const end = legend ? T_LEGEND_END : T_END
    // The dolly: a slow drift round toward the fire while the hero winds up and throws; a legendary then cranes up and out.
    const d = ease((s.t - T_WINDUP) / DOLLY_SECONDS)
    const rig = Transform.getMutable(s.rig)
    let at = Vector3.lerp(s.from, s.to, d)
    if (legend && s.t > T_RESULT) at = Vector3.lerp(s.to, s.crane, ease((s.t - T_RESULT) / (T_LEGEND_END - T_RESULT)))
    if (s.shake > 0) {
      s.shake = Math.max(0, s.shake - step)
      const k = s.shake * 0.12
      at = Vector3.add(at, Vector3.create((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k))
    }
    rig.position = at
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
        flarePitFire(3.5, 1.6)
        fxMagicBurst(s.mouth, ORANGE, 1.6)
        fxSound('fire_flare', 1)
        // The blast rocks the rig.
        s.shake = 0.35
        publishPitEvent('throw', result.id, result.to, result.success)
      }
    }
    // A legendary builds from the moment the weapon lands.
    if (legend && s.landed) {
      while (s.legendBeat < LEGEND_BEATS.length && s.t - T_LAND >= LEGEND_BEATS[s.legendBeat].at) LEGEND_BEATS[s.legendBeat++].run(s)
    }
    // The result: it rises from the fire's mouth into the air above it.
    if (s.t >= T_RESULT && !s.risen) {
      s.risen = true
      const shown = showItem(result.id, s.mouth)
      const color = RARITIES[result.to].color
      if (legend) {
        // Its own light comes up with it, and the hero squares up to it.
        hoverLight = engine.addEntity()
        Transform.create(hoverLight, { parent: shown, position: Vector3.create(0, 0.4, 0) })
        LightSource.create(hoverLight, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.8, 0.35), intensity: 0, range: 12, shadow: false, active: true })
        playScriptedMotion('menace_enter', 2.4, Math.atan2(s.mouth.x - s.hand.x, s.mouth.z - s.hand.z))
      } else if (result.success) {
        fxLootBeam(s.mouth, color)
        fxGlitter(above(s.mouth, 0.5), color)
        fxSound('reveal', 0.9)
      } else {
        fxDeathPuff(above(s.mouth, -0.6))
        fxSound('thud_straw', 0.8)
      }
      publishPitEvent('result', result.id, result.to, result.success)
    }
    if (s.risen && item !== undefined) {
      const k = ease((s.t - T_RESULT) / (legend ? T_LEGEND_RISE : T_RISE))
      const tr = Transform.getMutable(item)
      tr.position = above(s.mouth, HOVER_LIFT * k)
      tr.rotation = Quaternion.fromEulerDegrees(0, k * (legend ? 720 : 360), 0)
      if (hoverLight !== undefined) LightSource.getMutable(hoverLight).intensity = 8 * k
    }
    if (s.t >= end) {
      release()
      phase = 'hover'
      hoverT = 0
      glitterT = 0
      pulseT = 0
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
    const legend = isLegend(result)
    if (glitterT >= (legend ? 0.45 : 0.9) && at) {
      glitterT = 0
      fxGlitter(at, result.success ? RARITIES[result.to].color : ASH)
    }
    if (legend && at) {
      pulseT += step
      if (hoverLight !== undefined) LightSource.getMutable(hoverLight).intensity = 7 + 2.5 * Math.sin(hoverT * 3)
      if (pulseT >= 2.4) {
        pulseT = 0
        fxLootBeam(above(at, -1.2), GOLD)
        ring(at, 0.7, 8, GOLD)
      }
    }
  }
}
