// The short shots: a few seconds where the camera leaves the hero's shoulder
// for a rig of its own, and comes back. Two of them so far: the boss taking
// the room as he wakes, and a legendary coming up out of the bag as it is
// picked up. Both ride one runner, so the freeze, the skip and the hand-back
// are written once.
//
// A shot is a list of keys (seconds, where the camera stands, what it looks
// at). On desktop one rig eases between the keys every tick and looks at a
// focus entity that eases with it, the way the pit's offering plays
// (src/pitCinematic.ts). The phone (Godot) applies scene-written Transforms
// once per scene tick, so a rig moved that way steps; what it does glide every
// render frame is the transition between two virtual cameras. There each key
// is its own fixed mount and MainCamera is retargeted mount to mount with the
// leg's length as the transition, the same trick the overhead camera's relay
// uses (src/dungeon/crawlerCamera.ts). Mounts hold a fixed rotation toward
// the focus rather than a look-at, which that client turns into a tilt.
//
// The hero's own body stays in the shot, so none of this goes through
// src/sceneCamera.ts, which hides it for the menus. The HUD and the hall's
// prompt ask cinematicPlaying() and stand aside; a press of E, a click or a
// tap skips a shot that allows it.

import { engine, Entity, InputAction, InputModifier, inputSystem, MainCamera, PointerEventType, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { fxGlitter, fxLootBeam, fxMagicBurst, fxNumber, fxSound } from './combatFx'
import { isDungeonFloor, resumeDungeonCamera, suspendDungeonCamera } from './dungeon'
import { isGodotClient } from './explorerAgent'
import { showGear } from './gearShow'
import { t } from './i18n'
import { heroPosition, isHeadless, publishPitEvent } from './multiplayer'
import { pitCinematicPlaying } from './pitCinematic'
import { getPlayerCombatPose, playScriptedMotion } from './playerCharacter'
import { isSceneCameraOpen } from './sceneCamera'

/** Where the camera is and what it looks at, `at` seconds into the shot. */
type Key = { at: number; position: Vector3; focus: Vector3 }

type Shot = {
  keys: Key[]
  skippable: boolean
  /** Runs every tick with the seconds elapsed (the reveal's beats and the item's rise). */
  onTick?: (t: number, dt: number) => void
  onEnd?: () => void
}

/** The cut into the first key. */
const CUT_SECONDS = 0.4
/** A skip is not read before this, so the press that brought the shot on does not also end it. */
const SKIP_ARMED_AFTER = 0.35

const GOLD = Color4.create(1, 0.78, 0.3, 1)
const WHITE = Color4.create(1, 1, 1, 1)
const EMBER = Color4.create(0.85, 0.2, 0.1, 1)

let shot: Shot | undefined
let elapsed = 0
/** Desktop: the one rig and its focus. */
let rig: Entity | undefined
let focus: Entity | undefined
/** Phone: a mount per key, kept and reused; and which leg the camera is on. */
const mounts: Entity[] = []
let leg = 0
let systemAdded = false

/** The camera is a shot's: HUD, prompts and the hero's swings stand aside. */
export function cinematicPlaying(): boolean {
  return shot !== undefined
}

/** ...and a press ends it. */
export function cinematicSkippable(): boolean {
  return !!shot?.skippable && elapsed >= SKIP_ARMED_AFTER
}

export function initializeCinematics() {
  if (systemAdded || isHeadless()) return
  systemAdded = true
  engine.addSystem(update)
}

/** Whether a shot may begin now: nothing else has the camera. */
function canStart(): boolean {
  return !isHeadless() && shot === undefined && !pitCinematicPlaying() && !isSceneCameraOpen()
}

function ease(x: number) {
  const k = Math.max(0, Math.min(1, x))
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
}

function lookAt(from: Vector3, to: Vector3): Quaternion {
  const dir = Vector3.subtract(to, from)
  if (Vector3.lengthSquared(dir) < 1e-6) return Quaternion.Identity()
  return Quaternion.lookRotation(dir, Vector3.Up())
}

function start(next: Shot): boolean {
  if (!canStart() || next.keys.length < 2) return false
  shot = next
  elapsed = 0
  leg = 0
  // The follow camera lets go first, then the rig takes MainCamera; the hero is held still.
  suspendDungeonCamera()
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  const first = next.keys[0]
  if (isGodotClient()) {
    for (let i = 0; i < next.keys.length; i++) {
      const key = next.keys[i]
      const mount = mounts[i] ?? (mounts[i] = engine.addEntity())
      Transform.createOrReplace(mount, { position: Vector3.clone(key.position), rotation: lookAt(key.position, key.focus) })
      // Leg i glides from the moment the camera has reached mount i-1 until key i's time (the cut is over before the first leg is sent).
      const seconds = i === 0 ? CUT_SECONDS : key.at - next.keys[i - 1].at - (i === 1 ? CUT_SECONDS : 0)
      VirtualCamera.createOrReplace(mount, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(Math.max(0.05, seconds)) } })
    }
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: mounts[0] })
    return true
  }
  if (rig === undefined || focus === undefined) {
    rig = engine.addEntity()
    focus = engine.addEntity()
  }
  Transform.createOrReplace(focus, { position: Vector3.clone(first.focus) })
  Transform.createOrReplace(rig, { position: Vector3.clone(first.position), rotation: lookAt(first.position, first.focus) })
  VirtualCamera.createOrReplace(rig, { lookAtEntity: focus, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(CUT_SECONDS) } })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig })
  return true
}

/** The camera is handed back: the follow camera first, then the rig let go of only if nothing else took MainCamera. */
function release() {
  const ending = shot
  shot = undefined
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) InputModifier.deleteFrom(engine.PlayerEntity)
  resumeDungeonCamera()
  const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
  const held = mainCamera?.virtualCameraEntity
  if (mainCamera && held !== undefined && (held === rig || mounts.includes(held as Entity))) mainCamera.virtualCameraEntity = undefined
  ending?.onEnd?.()
}

function update(dt: number) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  if (!shot) return
  elapsed += step
  const keys = shot.keys
  const last = keys[keys.length - 1]
  if (cinematicSkippable() && (
    inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) ||
    inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN) ||
    inputSystem.isTriggered(InputAction.IA_JUMP, PointerEventType.PET_DOWN))) {
    release()
    return
  }
  if (isGodotClient()) {
    // The camera is sent on to the next mount as it reaches this one (the first, once the cut has landed).
    while (leg + 1 < keys.length && elapsed >= keys[leg].at + (leg === 0 ? CUT_SECONDS : 0)) {
      leg++
      MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: mounts[leg] })
    }
  } else if (rig !== undefined && focus !== undefined) {
    let i = 0
    while (i + 1 < keys.length - 1 && elapsed >= keys[i + 1].at) i++
    const a = keys[i]
    const b = keys[Math.min(i + 1, keys.length - 1)]
    const k = b.at > a.at ? ease((elapsed - a.at) / (b.at - a.at)) : 1
    Transform.getMutable(rig).position = Vector3.lerp(a.position, b.position, k)
    Transform.getMutable(focus).position = Vector3.lerp(a.focus, b.focus, k)
  }
  shot.onTick?.(elapsed, step)
  if (elapsed >= last.at) release()
}

/** Unit vectors for a facing: yaw 0 looks along +Z, PI/2 along +X; right is a quarter turn on. */
function facingAxes(yaw: number): { forward: Vector3; right: Vector3 } {
  return { forward: Vector3.create(Math.sin(yaw), 0, Math.cos(yaw)), right: Vector3.create(Math.cos(yaw), 0, -Math.sin(yaw)) }
}

/** A camera spot pulled in toward `toward` until it stands over dungeon floor (a wall or rock would swallow the shot). */
function onFloor(spot: Vector3, toward: Vector3): Vector3 {
  let p = spot
  for (let i = 0; i < 4 && !isDungeonFloor(p.x, p.z); i++) p = Vector3.lerp(p, toward, 0.3)
  return p
}

// --- the boss wakes -------------------------------------------------------------------

const BOSS_SECONDS = 4

/**
 * The boss has been called (src/dungeonEnemies.ts wake): the camera drops in
 * low and close in front of him as he rises, then cranes up and back to take
 * in the room, and cuts back to the party. Every run; a press skips it. His
 * own brain spends longer than this posing before he comes on, so nobody is
 * hit while held.
 */
export function playBossIntro(at: Vector3, facing: number) {
  if (!canStart()) return
  const { forward, right } = facingAxes(facing)
  const feet = Vector3.create(at.x, at.y, at.z)
  const near = onFloor(Vector3.create(at.x + forward.x * 2.6 + right.x * 1.1, at.y + 1.2, at.z + forward.z * 2.6 + right.z * 1.1), feet)
  const wide = onFloor(Vector3.create(at.x + forward.x * 6.5 + right.x * 2.2, at.y + 4.2, at.z + forward.z * 6.5 + right.z * 2.2), feet)
  const started = start({
    keys: [
      { at: 0, position: near, focus: Vector3.create(at.x, at.y + 1.8, at.z) },
      { at: BOSS_SECONDS, position: wide, focus: Vector3.create(at.x, at.y + 1.2, at.z) }
    ],
    skippable: true
  })
  if (started) fxMagicBurst(Vector3.create(at.x, at.y + 0.3, at.z), EMBER, 1.6)
}

// --- a legendary is taken -----------------------------------------------------------------

const REVEAL_SECONDS = 2.8
/** Where the piece starts (the hero's chest) and how high it climbs. */
const REVEAL_FROM = 1.2
const REVEAL_TO = 2.4

/**
 * A legendary has gone into the bag (src/loot.ts award): the piece comes up
 * out of the hero in a column of gold, the hero salutes it, and the camera
 * pushes in from the front. Every time; a press skips it. The party sees the
 * beam at the hero (presentRemoteLegend), without the camera.
 */
export function playLegendaryReveal(id: string) {
  const hero = getPlayerCombatPose()
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!hero || !player || !canStart()) return
  const at = Vector3.create(player.x, player.y, player.z)
  const { forward, right } = facingAxes(hero.facing)
  const godot = isGodotClient()
  const from = Vector3.create(at.x, at.y + REVEAL_FROM, at.z)
  const top = Vector3.create(at.x, at.y + REVEAL_TO, at.z)
  // On the phone a transform written every tick steps (see the header): the piece is shown at its height from the start.
  let item: Entity | undefined = showGear(id, godot ? top : from)
  const beats = [false, false, false]
  const started = start({
    keys: [
      { at: 0, position: onFloor(Vector3.create(at.x + forward.x * 3.6 + right.x * 0.8, at.y + 1.5, at.z + forward.z * 3.6 + right.z * 0.8), at), focus: Vector3.create(at.x, at.y + 1.4, at.z) },
      { at: REVEAL_SECONDS, position: onFloor(Vector3.create(at.x + forward.x * 2.8 + right.x * 0.5, at.y + 1.9, at.z + forward.z * 2.8 + right.z * 0.5), at), focus: Vector3.create(at.x, at.y + 2.1, at.z) }
    ],
    skippable: true,
    onTick: (s) => {
      if (item !== undefined && !godot) {
        const k = ease(s / 1.6)
        const tr = Transform.getMutable(item)
        tr.position = Vector3.lerp(from, top, k)
        tr.rotation = Quaternion.fromEulerDegrees(0, (s * 120) % 360, 0)
      }
      if (!beats[0] && s >= 0.5) { beats[0] = true; fxLootBeam(Vector3.create(at.x, at.y + 0.1, at.z), GOLD); ring(Vector3.create(at.x, at.y + 0.2, at.z), 1.0, 10, GOLD); fxSound('legendary', 0.8) }
      if (!beats[1] && s >= 1.4) { beats[1] = true; fxMagicBurst(top, GOLD, 1.4); fxNumber(Vector3.create(top.x, top.y + 0.6, top.z), t('LEGENDARY'), 'coin'); fxSound('slam', 0.6) }
      if (!beats[2] && s >= 2.1) { beats[2] = true; fxGlitter(top, WHITE); ring(top, 0.7, 8, GOLD) }
    },
    onEnd: () => {
      if (item !== undefined) engine.removeEntityWithChildren(item)
      item = undefined
    }
  })
  if (!started) {
    engine.removeEntityWithChildren(item)
    item = undefined
    return
  }
  fxMagicBurst(from, GOLD, 1.2)
  fxSound('reveal', 1)
  playScriptedMotion('flourish', 1.8, hero.facing)
  publishPitEvent('legend', id, 'legendary', true)
}

/** Another hero's legendary, from where they stand: the beam and the rings, no camera. */
export function presentRemoteLegend(id: string) {
  const at = heroPosition(id)
  if (!at) return
  const top = Vector3.create(at.x, at.y + REVEAL_TO, at.z)
  fxMagicBurst(Vector3.create(at.x, at.y + REVEAL_FROM, at.z), GOLD, 1.2)
  fxLootBeam(Vector3.create(at.x, at.y + 0.1, at.z), GOLD)
  ring(Vector3.create(at.x, at.y + 0.2, at.z), 1.0, 10, GOLD)
  fxGlitter(top, WHITE)
  fxSound('reveal', 0.7)
}

/** Glitter in a ring, `count` points wide. */
function ring(center: Vector3, radius: number, count: number, color: Color4) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    fxGlitter(Vector3.create(center.x + Math.sin(a) * radius, center.y, center.z + Math.cos(a) * radius), color)
  }
}
