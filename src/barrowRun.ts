// The Barrow Run on the client: a three-lane graveyard road high above the
// hall, a puppet of the hero running on the spot while the road, its graves and
// its embers stream toward the camera, and A/D to swap lanes. The race itself
// is src/shared/barrowRun.ts, stepped here for the picture and on the host for
// the truth; the host's word on distance and the meter arrives twice a second
// and the picture leans to it. The real avatar waits boxed in an unseen cage so
// the keys still reach us while the camera is ours.

import {
  engine, Entity, GltfContainer, InputAction, inputSystem, MainCamera, Material, MeshCollider, MeshRenderer, PointerEventType, PointerLock, Transform, VirtualCamera
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { onNet, sendNet } from './net'
import { fxSound } from './combatFx'
import { setPlayerCharacterSuspended } from './playerCharacter'
import { suspendDungeonCamera, resumeDungeonCamera } from './dungeon'
import { courtyardSpawnCameraTarget, courtyardSpawnPosition } from './courtyard'
import { getEquippedCharacter } from './characterPicker'
import { getCommittedLoadout } from './equipmentState'
import { getCommittedAppearance } from './appearance'
import { destroyEquipmentAvatar, setEquipmentAvatar, setEquipmentMotion } from './equipmentAvatar'
import { KIT, KitId } from './dungeon/kit'
import {
  chunkItems, isObstacle, laneOffset, newRunState, RUN_CHUNK, RUN_LANES, RunEvent, RunItem, RunState, runTierEmbers, stepRun
} from './shared/barrowRun'

/** Where the road sits: well above the hall, inside the parcels, out of every window. */
const ORIGIN = Vector3.create(100, 72, 40)
/** The hero stands this far down the road from the origin; the road is drawn this far ahead. */
const HERO_Z = 8
const AHEAD = 70
const BEHIND = 8
const ROAD_WIDTH = RUN_LANES * 2.2 + 1.6
/** The lane swap, as the puppet slides (metres a second). */
const SLIDE_SPEED = 11
/** The cage the real avatar waits in, beside the road and out of shot. */
const CAGE = Vector3.create(ORIGIN.x + 16, ORIGIN.y, ORIGIN.z + HERO_Z)
const CAMERA_AT = Vector3.create(ORIGIN.x, ORIGIN.y + 3.6, ORIGIN.z + HERO_Z - 6.5)
const CAMERA_LOOK = Vector3.create(ORIGIN.x, ORIGIN.y + 1.0, ORIGIN.z + HERO_Z + 7)
/** The end card waits this long before the hall is offered. */
const END_HOLD = 1.2

type Phase = 'idle' | 'waiting' | 'running' | 'over'
export type RunView = {
  phase: Phase
  s: number
  stamina: number
  staminaMax: number
  embers: number
  hits: number
  lantern: number
  ward: number
  stumble: number
  /** The result once over: distance (m) and embers paid. */
  metres: number
  paid: number
  sinceOver: number
  tierEmbers: number
}

let phase: Phase = 'idle'
let seed = 0
let state: RunState | undefined
let result = { metres: 0, paid: 0 }
let sinceOver = 0
let initialized = false

// --- the scene ---------------------------------------------------------------------------
let built = false
let rig: { camera: Entity; target: Entity } | undefined
let cage: Entity[] = []
let puppet: Entity | undefined
let puppetX = 0
let puppetMotion = ''
const scenery: { entity: Entity; lane: number; along: number; span: number; y: number; yaw: number; bob: boolean }[] = []
const itemEntities = new Map<string, { entity: Entity; item: RunItem; bob: boolean }>()
const effects: { entity: Entity; t: number }[] = []

export function initializeBarrowRun() {
  if (initialized) return
  initialized = true
  onNet('gwRun', (msg) => {
    if (phase !== 'waiting' && phase !== 'idle') return
    seed = msg.seed
    state = newRunState(msg.staminaMax, msg.speedMult, msg.luck)
    result = { metres: 0, paid: 0 }
    sinceOver = 0
    begin()
  })
  onNet('gwRunSync', (msg) => {
    if (!state || phase !== 'running') return
    if (msg.over) {
      state.s = msg.s
      state.stamina = 0
      state.over = true
      result = { metres: Math.floor(msg.s), paid: msg.paid }
      finish()
      return
    }
    // Lean toward the host: half the gap each word, a snap when far off.
    const gap = msg.s - state.s
    if (Math.abs(gap) > 6) state.s = msg.s
    else state.s += gap * 0.5
    state.stamina += (msg.stamina - state.stamina) * 0.5
    if (msg.hits > state.hits) {
      state.hits = msg.hits
      state.stumble = Math.max(state.stumble, 0.4)
      fxSound('hurt', 0.6)
    }
    state.embers = Math.max(state.embers, msg.embers)
  })
  engine.addSystem(update)
}

/** Ask the host for a run; the sheet should be closed first. */
export function startBarrowRun() {
  if (phase !== 'idle') return
  phase = 'waiting'
  sendNet('gwRunStart', { v: 1 })
}

export function isBarrowRunOpen(): boolean {
  return phase === 'running' || phase === 'over' || (phase === 'waiting' && cage.length > 0)
}

/** The host would not start a run (no embers, a guest, the event over): back to where we were. */
export function barrowRunRefused() {
  if (phase !== 'waiting') return
  phase = cage.length ? 'over' : 'idle'
  sinceOver = END_HOLD
}

export function barrowRunView(): RunView {
  const st = state
  return {
    phase,
    s: st?.s ?? 0,
    stamina: st?.stamina ?? 0,
    staminaMax: st?.staminaMax ?? 1,
    embers: st?.embers ?? 0,
    hits: st?.hits ?? 0,
    lantern: st?.lantern ?? 0,
    ward: st?.ward ?? 0,
    stumble: st?.stumble ?? 0,
    metres: result.metres,
    paid: result.paid,
    sinceOver,
    tierEmbers: runTierEmbers(result.metres)
  }
}

export function canLeaveBarrowRun(): boolean {
  return phase === 'over' && sinceOver >= END_HOLD
}

/** Back to the hall: the camera given back, the avatar let out, the road left standing for next time. */
export function leaveBarrowRun() {
  if (phase === 'idle' || phase === 'waiting') {
    phase = 'idle'
    return
  }
  phase = 'idle'
  state = undefined
  for (const e of itemEntities.values()) engine.removeEntity(e.entity)
  itemEntities.clear()
  for (const fx of effects) engine.removeEntity(fx.entity)
  effects.length = 0
  if (puppet !== undefined) {
    destroyEquipmentAvatar(puppet)
    engine.removeEntity(puppet)
    puppet = undefined
  }
  const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mainCamera) mainCamera.virtualCameraEntity = undefined
  for (const wall of cage) engine.removeEntity(wall)
  cage = []
  setPlayerCharacterSuspended(false)
  resumeDungeonCamera()
  const spawn = courtyardSpawnPosition()
  const look = courtyardSpawnCameraTarget()
  movePlayerTo({ newRelativePosition: spawn, cameraTarget: look, avatarTarget: look }).catch(() => {})
}

// --- building ----------------------------------------------------------------------------

function begin() {
  build()
  // The camera first, so the hall is never seen from the sky.
  if (!rig) rig = { camera: engine.addEntity(), target: engine.addEntity() }
  Transform.createOrReplace(rig.target, { position: CAMERA_LOOK })
  Transform.createOrReplace(rig.camera, { position: CAMERA_AT, rotation: Quaternion.lookRotation(Vector3.subtract(CAMERA_LOOK, CAMERA_AT), Vector3.Up()) })
  VirtualCamera.createOrReplace(rig.camera, { lookAtEntity: rig.target, defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) } })
  suspendDungeonCamera()
  setPlayerCharacterSuspended(true)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig.camera })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  // The avatar into its cage: six unseen walls, so the keys are ours and the body stays put.
  if (!cage.length) buildCage()
  // The hero's double, running on the spot.
  if (puppet === undefined) {
    puppet = engine.addEntity()
    puppetX = ORIGIN.x
    Transform.create(puppet, { position: Vector3.create(ORIGIN.x, ORIGIN.y, ORIGIN.z + HERO_Z), rotation: Quaternion.fromEulerDegrees(0, 0, 0) })
    const hero = getEquippedCharacter()
    setEquipmentAvatar(puppet, hero.id, getCommittedLoadout(hero.id), false, { appearance: getCommittedAppearance(hero.id), presentation: 'gameplay' })
    puppetMotion = ''
  }
  motion('run')
  phase = 'running'
  fxSound('fire_flare', 0.5)
}

function buildCage() {
  const walls: [Vector3, Vector3][] = [
    [Vector3.create(CAGE.x + 1, CAGE.y + 1.5, CAGE.z), Vector3.create(0.2, 4, 2.2)],
    [Vector3.create(CAGE.x - 1, CAGE.y + 1.5, CAGE.z), Vector3.create(0.2, 4, 2.2)],
    [Vector3.create(CAGE.x, CAGE.y + 1.5, CAGE.z + 1), Vector3.create(2.2, 4, 0.2)],
    [Vector3.create(CAGE.x, CAGE.y + 1.5, CAGE.z - 1), Vector3.create(2.2, 4, 0.2)],
    [Vector3.create(CAGE.x, CAGE.y + 3.6, CAGE.z), Vector3.create(2.2, 0.2, 2.2)],
    [Vector3.create(CAGE.x, CAGE.y - 0.1, CAGE.z), Vector3.create(2.2, 0.2, 2.2)]
  ]
  for (const [position, scale] of walls) {
    const wall = engine.addEntity()
    Transform.create(wall, { position, scale })
    MeshCollider.setBox(wall)
    cage.push(wall)
  }
  movePlayerTo({ newRelativePosition: Vector3.create(CAGE.x, CAGE.y + 0.2, CAGE.z), cameraTarget: CAMERA_LOOK }).catch(() => {})
}

/** Another go without leaving the road: the items cleared, the host asked again. */
export function restartBarrowRun() {
  if (phase !== 'over') return
  for (const e of itemEntities.values()) engine.removeEntity(e.entity)
  itemEntities.clear()
  phase = 'waiting'
  motion('idle')
  sendNet('gwRunStart', { v: 1 })
}

function motion(name: 'run' | 'hit' | 'idle' | 'stun') {
  if (puppet === undefined || puppetMotion === name) return
  puppetMotion = name
  setEquipmentMotion(puppet, name, true)
}

/** The road and its sides, laid once and kept; they scroll by moving, never by rebuilding. */
function build() {
  if (built) return
  built = true
  const ground = engine.addEntity()
  Transform.create(ground, { position: Vector3.create(ORIGIN.x, ORIGIN.y - 0.2, ORIGIN.z + HERO_Z + (AHEAD - BEHIND) / 2), scale: Vector3.create(ROAD_WIDTH + 30, 0.2, AHEAD + BEHIND + 10) })
  MeshRenderer.setBox(ground)
  Material.setPbrMaterial(ground, { albedoColor: Color4.create(0.07, 0.08, 0.06, 1), roughness: 1, metallic: 0 })
  const road = engine.addEntity()
  Transform.create(road, { position: Vector3.create(ORIGIN.x, ORIGIN.y - 0.08, ORIGIN.z + HERO_Z + (AHEAD - BEHIND) / 2), scale: Vector3.create(ROAD_WIDTH, 0.2, AHEAD + BEHIND + 10) })
  MeshRenderer.setBox(road)
  Material.setPbrMaterial(road, { albedoColor: Color4.create(0.16, 0.14, 0.12, 1), roughness: 0.95, metallic: 0 })
  for (const k of [-0.5, 0.5]) {
    const line = engine.addEntity()
    Transform.create(line, { position: Vector3.create(ORIGIN.x + k * 2.2, ORIGIN.y + 0.025, ORIGIN.z + HERO_Z + (AHEAD - BEHIND) / 2), scale: Vector3.create(0.05, 0.02, AHEAD + BEHIND + 10) })
    MeshRenderer.setBox(line)
    Material.setPbrMaterial(line, { albedoColor: Color4.create(0.4, 0.33, 0.2, 1), emissiveColor: Color4.create(0.5, 0.35, 0.1, 1), emissiveIntensity: 0.6 })
  }
  // A dim lantern sky: nothing to see but the road, so the ceiling is dark.
  const span = AHEAD + BEHIND
  const fence = KIT.crypt_fence
  for (let k = 0; k < Math.ceil(span / 10) + 1; k++) {
    for (const side of [-1, 1]) scenery.push(piece('crypt_fence', side * (ROAD_WIDTH / 2 + 0.4), k * 10 - BEHIND, 10.033, 0, 90, false))
  }
  for (let k = 0; k < Math.ceil(span / 20) + 1; k++) scenery.push(piece('crypt_lamp_post', -(ROAD_WIDTH / 2 + 1.3), k * 20 - BEHIND + 4, 20, 0, 90, false))
  const stones: KitId[] = ['crypt_stone_a', 'crypt_stone_b', 'crypt_stone_d', 'crypt_tomb_b', 'crypt_tree_a', 'crypt_stone_c']
  for (let k = 0; k < 14; k++) {
    const side = k % 2 === 0 ? -1 : 1
    const id = stones[k % stones.length]
    scenery.push(piece(id, side * (ROAD_WIDTH / 2 + 2.5 + (k * 7) % 9), (k * 13) % span - BEHIND, span, 0, (k * 47) % 360, false))
  }
  void fence
}

/** A kit piece beside the road at `along` metres, scrolling with the road and wrapping every `span`. */
function piece(id: KitId, x: number, along: number, span: number, y: number, yaw: number, bob: boolean) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + HERO_Z - BEHIND + along), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  GltfContainer.create(entity, { src: KIT[id].src, invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
  return { entity, lane: x, along, span, y, yaw, bob }
}

function itemModel(kind: RunItem['kind']): { id?: KitId; y: number; yaw: number; sphere?: Color4 } {
  switch (kind) {
    case 'stone': return { id: 'crypt_stone_b', y: 0, yaw: 180 }
    case 'tomb': return { id: 'crypt_tomb_a', y: 0, yaw: 0 }
    case 'ghoul': return { id: 'crypt_gargoyle', y: 0, yaw: 180 }
    case 'ember': return { y: 1.0, yaw: 0, sphere: Color4.create(1, 0.5, 0.15, 1) }
    case 'lantern': return { id: 'crypt_lantern', y: 1.1, yaw: 0 }
    default: return { y: 1.0, yaw: 0, sphere: Color4.create(0.6, 0.4, 1, 1) }
  }
}

// --- each frame ----------------------------------------------------------------------------

function positiveMod(a: number, n: number): number {
  return ((a % n) + n) % n
}

function update(dt: number) {
  if (phase !== 'running' && phase !== 'over') return
  const st = state
  if (!st) return
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  if (phase === 'running') {
    // Lanes: one step per press, told to the host at our run clock.
    let lane = st.lane
    if (inputSystem.isTriggered(InputAction.IA_LEFT, PointerEventType.PET_DOWN)) lane--
    if (inputSystem.isTriggered(InputAction.IA_RIGHT, PointerEventType.PET_DOWN)) lane++
    lane = Math.max(0, Math.min(RUN_LANES - 1, lane))
    if (lane !== st.lane) {
      st.lane = lane
      sendNet('gwRunLane', { at: st.t, lane })
      fxSound('dodge', 0.5)
    }
    const events = stepRun(st, span, seed)
    for (const ev of events) onEvent(ev)
    if (st.over && phase === 'running') {
      // Our picture ran out first; the host's word (gwRunSync over) settles the result.
      motion('stun')
    }
  } else {
    sinceOver += span
  }
  // The puppet: slides to its lane, stumbles when hit.
  if (puppet !== undefined) {
    const targetX = ORIGIN.x + laneOffset(st.lane)
    const dx = targetX - puppetX
    const step = SLIDE_SPEED * span
    puppetX = Math.abs(dx) <= step ? targetX : puppetX + Math.sign(dx) * step
    const tr = Transform.getMutable(puppet)
    tr.position = Vector3.create(puppetX, ORIGIN.y, ORIGIN.z + HERO_Z)
    tr.rotation = Quaternion.fromEulerDegrees(0, dx > 0.05 ? 18 : dx < -0.05 ? -18 : 0, 0)
    if (phase === 'running') {
      if (st.stumble > 0) motion('hit')
      else motion('run')
    }
  }
  // The road streams past: scenery wraps, items ride at their distance, the taken ones go.
  for (const sc of scenery) {
    const z = ORIGIN.z + HERO_Z - BEHIND + positiveMod(sc.along - st.s, sc.span)
    Transform.getMutable(sc.entity).position = Vector3.create(ORIGIN.x + sc.lane, ORIGIN.y + sc.y, z)
  }
  const first = Math.max(0, Math.floor((st.s - BEHIND) / RUN_CHUNK))
  const last = Math.floor((st.s + AHEAD) / RUN_CHUNK)
  for (let c = first; c <= last; c++) {
    for (const item of chunkItems(seed, c, st.luck)) {
      if (st.taken.has(item.key)) {
        const held = itemEntities.get(item.key)
        if (held) {
          engine.removeEntity(held.entity)
          itemEntities.delete(item.key)
        }
        continue
      }
      if (item.at < st.s - BEHIND || item.at > st.s + AHEAD || itemEntities.has(item.key)) continue
      const look = itemModel(item.kind)
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.create(ORIGIN.x + laneOffset(item.lane), ORIGIN.y + look.y, ORIGIN.z + HERO_Z + (item.at - st.s)), rotation: Quaternion.fromEulerDegrees(0, look.yaw, 0) })
      if (look.id) GltfContainer.create(entity, { src: KIT[look.id].src, invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
      else {
        MeshRenderer.setSphere(entity)
        Transform.getMutable(entity).scale = Vector3.create(0.5, 0.5, 0.5)
        Material.setPbrMaterial(entity, { albedoColor: look.sphere, emissiveColor: look.sphere, emissiveIntensity: 2.5, roughness: 0.4 })
      }
      itemEntities.set(item.key, { entity, item, bob: !isObstacle(item.kind) })
    }
  }
  for (const [key, held] of itemEntities) {
    const rel = held.item.at - st.s
    if (rel < -BEHIND) {
      engine.removeEntity(held.entity)
      itemEntities.delete(key)
      continue
    }
    const look = itemModel(held.item.kind)
    const tr = Transform.getMutable(held.entity)
    const bob = held.bob ? Math.sin(st.t * 4 + held.item.at) * 0.15 : 0
    tr.position = Vector3.create(ORIGIN.x + laneOffset(held.item.lane), ORIGIN.y + look.y + bob, ORIGIN.z + HERO_Z + rel)
    if (held.bob) tr.rotation = Quaternion.fromEulerDegrees(0, (st.t * 90) % 360, 0)
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i]
    fx.t += span
    const k = Math.min(1, fx.t / 0.45)
    const tr = Transform.getMutable(fx.entity)
    tr.scale = Vector3.create(0.5 + k * 1.4, 0.5 + k * 1.4, 0.5 + k * 1.4)
    tr.position = Vector3.create(tr.position.x, tr.position.y + span * 1.5, tr.position.z)
    if (k >= 1) {
      engine.removeEntity(fx.entity)
      effects.splice(i, 1)
    }
  }
}

function onEvent(ev: RunEvent) {
  switch (ev) {
    case 'hit': fxSound('hurt', 0.8); fxSound('thunk_wood', 0.6); burst(Color4.create(0.5, 0.1, 0.05, 1)); break
    case 'smash': fxSound('hit_heavy', 0.7); burst(Color4.create(0.7, 0.5, 1, 1)); break
    case 'ember': fxSound('coin', 0.7); burst(Color4.create(1, 0.55, 0.2, 1)); break
    case 'lantern': fxSound('fire_flare', 0.8); burst(Color4.create(1, 0.85, 0.4, 1)); break
    case 'ward': fxSound('reveal', 0.8); burst(Color4.create(0.6, 0.4, 1, 1)); break
    case 'over': fxSound('bell', 0.7); break
  }
}

/** A glowing puff at the hero's chest, gone in half a second. */
function burst(color: Color4) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(puppetX, ORIGIN.y + 1.1, ORIGIN.z + HERO_Z + 0.4), scale: Vector3.create(0.5, 0.5, 0.5) })
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, { albedoColor: Color4.create(color.r, color.g, color.b, 0.5), emissiveColor: color, emissiveIntensity: 3, transparencyMode: 2 })
  effects.push({ entity, t: 0 })
}

function finish() {
  phase = 'over'
  sinceOver = 0
  motion('stun')
  fxSound('bell', 0.7)
}
