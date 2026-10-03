// The Barrow Run on the client: a three-lane graveyard road high above the
// hall, a puppet of the hero running on the spot while the road, its graves and
// its embers stream toward the camera, and A/D to swap lanes. The race itself
// is src/shared/barrowRun.ts, stepped here for the picture and on the host for
// the truth; the host's word on distance and the meter arrives twice a second
// and the picture leans to it. The real avatar waits boxed in an unseen cage so
// the keys still reach us while the camera is ours.

import {
  engine, Entity, GltfContainer, InputAction, inputSystem, LightSource, MainCamera, Material, MaterialTransparencyMode, MeshCollider, MeshRenderer, ParticleSystem,
  PBParticleSystem, PBParticleSystem_BlendMode, PBParticleSystem_PlaybackState, PBParticleSystem_SimulationSpace, PointerEventType, PointerLock, Transform,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { onNet, sendNet } from './net'
import { localAddress } from './multiplayer'
import { playerDisplayName } from './heroNameTag'
import { fxSound } from './combatFx'
import { setPlayerCharacterSuspended } from './playerCharacter'
import { suspendDungeonCamera, resumeDungeonCamera } from './dungeon'
import { courtyardSpawnCameraTarget, courtyardSpawnPosition } from './courtyard'
import { getEquippedCharacter } from './characterPicker'
import { getCommittedLoadout } from './equipmentState'
import { DEFAULT_LOADOUTS } from './equipmentCatalog'
import { getCommittedAppearance } from './appearance'
import { destroyEquipmentAvatar, setEquipmentAvatar, setEquipmentMotion } from './equipmentAvatar'
import { KIT, KitId } from './dungeon/kit'
import {
  chunkItems, isObstacle, laneOffset, newRunState, RUN_CHUNK, RUN_LANES, RUN_STUMBLE_SECONDS, RunEvent, RunItem, RunState, runTierEmbers, stepRun
} from './shared/barrowRun'

/** Where the road sits: well above the hall, inside the parcels, out of every window. */
const ORIGIN = Vector3.create(100, 72, 40)
/** The hero stands this far down the road from the origin; the road is drawn this far ahead. */
const HERO_Z = 8
const AHEAD = 70
const BEHIND = 8
const ROAD_WIDTH = RUN_LANES * 2.2 + 1.6
/** One crypt fence along x, and how many tile the strip: the scenery wraps over exactly that many. */
const FENCE = 10.033
const FENCES = Math.ceil((AHEAD + BEHIND) / FENCE)
const SPAN = FENCES * FENCE
/** The lane swap, as the puppet slides (metres a second). */
const SLIDE_SPEED = 11
/** The cage the real avatar waits in, beside the road and out of shot. */
const CAGE = Vector3.create(ORIGIN.x + 28, ORIGIN.y, ORIGIN.z + HERO_Z)
/** A high view from above and behind the hero, tilted down the road so what is coming shows at the top of the screen. */
const CAMERA_AT = Vector3.create(ORIGIN.x, ORIGIN.y + 15, ORIGIN.z + HERO_Z - 7)
const CAMERA_LOOK = Vector3.create(ORIGIN.x, ORIGIN.y, ORIGIN.z + HERO_Z + 5)
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
/** Where we were lately (run time, distance, stamina), two seconds of it, so the host's late word is judged fairly. */
const history: { t: number; s: number; stamina: number }[] = []
/** Corrections owed to the host, paid out a little each frame. */
let drift = 0
let staminaDrift = 0
/** How fast a correction is paid (metres a second, stamina a second). */
const DRIFT_RATE = 2.5
const STAMINA_DRIFT_RATE = 12

function sampleAt(t: number): { s: number; stamina: number } {
  const st = state
  if (!st || history.length === 0) return { s: st?.s ?? 0, stamina: st?.stamina ?? 0 }
  if (t >= st.t) return { s: st.s, stamina: st.stamina }
  for (let i = history.length - 1; i >= 0; i--) {
    const a = history[i]
    if (a.t <= t) {
      const b = i + 1 < history.length ? history[i + 1] : { t: st.t, s: st.s, stamina: st.stamina }
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
      return { s: a.s + (b.s - a.s) * k, stamina: a.stamina + (b.stamina - a.stamina) * k }
    }
  }
  return { s: history[0].s, stamina: history[0].stamina }
}

// --- the scene ---------------------------------------------------------------------------
let built = false
let rig: { camera: Entity; target: Entity } | undefined
let cage: Entity[] = []
let puppet: Entity | undefined
let puppetX = 0
let puppetMotion = ''
const scenery: { entity: Entity; lane: number; along: number; span: number; y: number; yaw: number; bob: boolean }[] = []
/** `gone`: undefined while live; -1 once hit (it stays and rolls past); 0+ counting up after a smash, removed at a second. */
const itemEntities = new Map<string, { entity: Entity; item: RunItem; bob: boolean; body: boolean; gone?: number }>()
/** The dead that stand in the road: a body and the weapon it carries, picked by the item's key so every player sees the same. */
const GHOULS: readonly { body: string; weapon: string }[] = [
  { body: 'dk-skeleton', weapon: 'dk-sword-03' },
  { body: 'dk-skeleton', weapon: 'dk-sword-03' },
  { body: 'dk-skeleton-flesh', weapon: 'dk-sickle-01' },
  { body: 'dk-skeleton-ranger', weapon: 'dk-sword-01' },
  { body: 'dk-skeleton-heavy', weapon: 'dk-mace-01' },
  { body: 'dk-witch', weapon: 'dk-staff-01' }
]
/** How hard the camera shakes at a stumble (metres), and how long the end card waits for the fall to be seen. */
const SHAKE = 0.12
export const CARD_DELAY = 0.8

// The look: the pack's spark sprite and fire sheet for the particles.
const TEX_SPARK = 'images/fx/sparkle.png'
const TEX_FIRE_SHEET = 'images/fx/fire_sheet.png'
const SHEET_TILES = 8
const SHOULDER = 1.4
const VERGE = 16
// The protocol enums are const enums in the SDK typings: no runtime export.
const BLEND_ALPHA = 0 as PBParticleSystem_BlendMode
const BLEND_ADD = 1 as PBParticleSystem_BlendMode
const PLAYING = 0 as PBParticleSystem_PlaybackState
const WORLD_SPACE = 1 as PBParticleSystem_SimulationSpace
/** Effects on the hero: the lantern's spark trail and the ward's shell. */
let trail: Entity | undefined
let trailOn = false
let shell: Entity | undefined
/** Short-lived things at the hero's chest: a puff grows and rises until 0.45 s; anything with `until` just waits and goes. */
const effects: { entity: Entity; t: number; until?: number }[] = []

export function initializeBarrowRun() {
  if (initialized) return
  initialized = true
  onNet('gwRun', (msg) => {
    if (phase !== 'waiting' && phase !== 'idle') return
    seed = msg.seed
    state = newRunState(msg.staminaMax, msg.speedMult, msg.luck)
    result = { metres: 0, paid: 0 }
    sinceOver = 0
    history.length = 0
    drift = 0
    staminaDrift = 0
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
    // The host's word is from a quarter second ago, so it is compared with where we were at its time,
    // not where we are now; the difference is then fed in gently over the next frames rather than jumped.
    const then = sampleAt(msg.t)
    const gap = msg.s - then.s
    if (Math.abs(gap) > 6) {
      state.s += gap
      drift = 0
    } else if (Math.abs(gap) > 0.15) drift += gap
    const staminaGap = msg.stamina - then.stamina
    if (Math.abs(staminaGap) > 0.5) staminaDrift += staminaGap
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
  sendNet('gwRunStart', { v: 1, name: playerDisplayName(localAddress()) })
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
  dropAllItems()
  for (const fx of effects) engine.removeEntity(fx.entity)
  effects.length = 0
  if (puppet !== undefined) {
    destroyEquipmentAvatar(puppet)
    engine.removeEntityWithChildren(puppet)
    puppet = undefined
    trail = undefined
    shell = undefined
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
    trail = engine.addEntity()
    Transform.create(trail, { parent: puppet, position: Vector3.create(0, 1.0, 0) })
    ParticleSystem.create(trail, { ...sparksConfig(45, Color4.create(1, 0.6, 0.2, 1)), active: false, loop: true, playbackState: PLAYING })
    trailOn = false
    shell = engine.addEntity()
    Transform.create(shell, { parent: puppet, position: Vector3.create(0, 1.0, 0), scale: Vector3.Zero() })
    MeshRenderer.setSphere(shell)
    Material.setPbrMaterial(shell, {
      albedoColor: Color4.create(0.6, 0.4, 1, 0.22), emissiveColor: Color4.create(0.6, 0.4, 1, 1), emissiveIntensity: 1.2,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false
    })
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
  dropAllItems()
  phase = 'waiting'
  motion('idle')
  sendNet('gwRunStart', { v: 1, name: playerDisplayName(localAddress()) })
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
  // The dark ground fills the parcels, so nothing of the world below shows round the road.
  const ground = engine.addEntity()
  Transform.create(ground, { position: Vector3.create(80, ORIGIN.y - 0.2, 80), scale: Vector3.create(160, 0.2, 160) })
  MeshRenderer.setBox(ground)
  Material.setPbrMaterial(ground, { albedoColor: Color4.create(0.04, 0.05, 0.035, 1), roughness: 1, metallic: 0 })
  // Everything beside the road scrolls and wraps over one span: a whole number of fence lengths, so the fence never gaps.
  const span = SPAN
  const length = span + 2
  const roadZ = ORIGIN.z + HERO_Z - BEHIND + length / 2 - 1
  // The road itself: plain dirt, flagstone shoulders and a dark verge. Flat colour, no texture: a scrolling texture read as sideways drift.
  slab(0, -0.08, ROAD_WIDTH, length, Color4.create(0.17, 0.145, 0.115, 1), roadZ)
  for (const side of [-1, 1]) {
    slab(side * (ROAD_WIDTH / 2 + SHOULDER / 2), -0.07, SHOULDER, length, Color4.create(0.24, 0.235, 0.22, 1), roadZ)
    slab(side * (ROAD_WIDTH / 2 + SHOULDER + VERGE / 2), -0.1, VERGE, length, Color4.create(0.075, 0.095, 0.06, 1), roadZ)
  }
  // Lane marks as short kerb stones every few metres; they roll with the road.
  for (const k of [-0.5, 0.5]) {
    for (let d = 0; d * 4 < span; d++) {
      const mark = engine.addEntity()
      Transform.create(mark, { position: Vector3.create(ORIGIN.x + k * 2.2, ORIGIN.y + 0.04, ORIGIN.z + HERO_Z - BEHIND + d * 4), scale: Vector3.create(0.14, 0.07, 1.0) })
      MeshRenderer.setBox(mark)
      Material.setPbrMaterial(mark, { albedoColor: Color4.create(0.36, 0.34, 0.3, 1), roughness: 1, metallic: 0 })
      scenery.push({ entity: mark, lane: k * 2.2, along: d * 4, span, y: 0.04, yaw: 0, bob: false })
    }
  }
  // The air: a few motes drifting over the road. (No mist: big soft sprites seen from above are a lot of overdraw.)
  const mid = Vector3.create(ORIGIN.x, ORIGIN.y, ORIGIN.z + HERO_Z - BEHIND + span / 2)
  emitter(Vector3.create(mid.x, mid.y + 1.6, mid.z), motesConfig(ROAD_WIDTH + 2 * SHOULDER + 20, span))
  // A cold moon over the hero and the warm pools under the lamps light the road.
  const moon = engine.addEntity()
  Transform.create(moon, { position: Vector3.create(ORIGIN.x - 6, ORIGIN.y + 12, ORIGIN.z + HERO_Z + 10) })
  LightSource.create(moon, { type: LightSource.Type.Point({}), color: Color3.create(0.62, 0.7, 1), intensity: 4, range: 40, shadow: false, active: true })
  // The far end: the yard gate across the road and a wall of dead trees behind it, so the strip never shows its edge.
  const end = ORIGIN.z + HERO_Z - BEHIND + span
  still('crypt_yard_gate', 0, end + 1.5, 0)
  for (const x of [-6, 6]) still('crypt_lamp_post', x, end + 1, 0)
  for (let i = -4; i <= 4; i++) still(i % 2 === 0 ? 'crypt_tree_c' : 'crypt_tree_b', i * 7 + (i % 2 === 0 ? 0 : 1.5), end + (i % 2 === 0 ? 5 : 9), (i * 53) % 360)
  for (let i = -3; i <= 3; i++) still('crypt_tree_c', i * 9 + 4, end + 14, (i * 71) % 360)
  // Fences the whole way, both sides; lamp posts every two fences, alternating sides.
  for (let k = 0; k < FENCES; k++) {
    for (const side of [-1, 1]) scenery.push(piece('crypt_fence', side * (ROAD_WIDTH / 2 + 0.4), k * FENCE, span, 0, 90, false))
    if (k % 2 === 0) {
      const side = k % 4 === 0 ? -1 : 1
      const post = piece('crypt_lamp_post', side * (ROAD_WIDTH / 2 + SHOULDER + 0.6), k * FENCE + 4, span, 0, 90, false)
      scenery.push(post)
      // The lamp's pool of light and its flame ride on the post.
      const lamp = engine.addEntity()
      Transform.create(lamp, { parent: post.entity, position: Vector3.create(0, 3.6, -side * 0.9) })
      LightSource.create(lamp, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.66, 0.3), intensity: 6, range: 13, shadow: false, active: true })
      const flame = engine.addEntity()
      Transform.create(flame, { parent: post.entity, position: Vector3.create(0, 3.45, -side * 0.9) })
      ParticleSystem.create(flame, { ...flameConfig(0.3), active: true, loop: true, prewarm: true, playbackState: PLAYING })
    }
  }
  // One of each dead body stood under the ground, out of sight, so their models are loaded before the first one steps into the road.
  const seen = new Set<string>()
  for (const who of GHOULS) {
    if (seen.has(who.body)) continue
    seen.add(who.body)
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(ORIGIN.x + 40 + seen.size * 2, ORIGIN.y - 12, ORIGIN.z) })
    setEquipmentAvatar(e, who.body, { ...(DEFAULT_LOADOUTS[who.body] ?? DEFAULT_LOADOUTS.vanguard), weapon: who.weapon }, false)
  }
  // Graves, trees, bones and weeds down both verges.
  const dressing: KitId[] = [
    'crypt_stone_a', 'crypt_grass', 'crypt_stone_b', 'crypt_tree_a', 'crypt_fern', 'crypt_stone_d', 'crypt_tomb_b', 'crypt_grass', 'crypt_tree_b', 'crypt_stone_c',
    'crypt_bone_pile', 'crypt_plant_b', 'crypt_skull_pile', 'crypt_stone_a', 'crypt_rock', 'crypt_grass', 'crypt_tree_a', 'crypt_stone_d', 'crypt_fern', 'crypt_tomb_b'
  ]
  for (let k = 0; k < 36; k++) {
    const side = k % 2 === 0 ? -1 : 1
    const id = dressing[k % dressing.length]
    scenery.push(piece(id, side * (ROAD_WIDTH / 2 + SHOULDER + 1.6 + (k * 7) % 12), (k * 11.3) % span, span, 0, (k * 47) % 360, false))
  }
}

/** A flat coloured box lying on the road at x, the full length of the strip. */
function slab(x: number, y: number, width: number, length: number, colour: Color4, z: number) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(ORIGIN.x + x, ORIGIN.y + y, z), scale: Vector3.create(width, 0.2, length) })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, { albedoColor: colour, roughness: 1, metallic: 0, specularIntensity: 0 })
}

function emitter(position: Vector3, config: PBParticleSystem): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position })
  ParticleSystem.create(e, { ...config, active: true, loop: true, prewarm: true, playbackState: PLAYING })
  return e
}

// --- the particles ---------------------------------------------------------------------

function motesConfig(w: number, d: number): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK }, blendMode: BLEND_ADD,
    rate: Math.max(2, (w * d) / 300), maxParticles: 60, lifetime: 6, gravity: 0,
    initialSize: { start: 0.05, end: 0.1 }, sizeOverTime: { start: 0.2, end: 1 },
    initialColor: { start: Color4.create(0.5, 0.9, 0.7, 1), end: Color4.create(0.6, 0.75, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 0), end: Color4.create(1, 1, 1, 0) },
    initialVelocitySpeed: { start: 0.1, end: 0.4 }, additionalForce: Vector3.create(0, 0.08, -0.3),
    limitVelocity: { speed: 0.6, dampen: 0.1 },
    shape: ParticleSystem.Shape.Box({ size: Vector3.create(w, 3, d) }), simulationSpace: WORLD_SPACE
  }
}

function flameConfig(size: number): PBParticleSystem {
  const lifetime = 0.9
  return {
    texture: { src: TEX_FIRE_SHEET }, spriteSheet: { tilesX: SHEET_TILES, tilesY: SHEET_TILES, framesPerSecond: (SHEET_TILES * SHEET_TILES) / lifetime },
    blendMode: BLEND_ADD, rate: 7 * size, maxParticles: 12, lifetime, gravity: 0, additionalForce: Vector3.create(0, 0.6, 0),
    initialSize: { start: 1.1 * size, end: 1.6 * size }, sizeOverTime: { start: 0.7, end: 1.1 },
    initialColor: { start: Color4.create(1, 0.95, 0.8, 1), end: Color4.create(1, 0.75, 0.45, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.5, 0.2, 0) },
    initialVelocitySpeed: { start: 0.2, end: 0.5 }, shape: ParticleSystem.Shape.Cone({ angle: 8, radius: 0.25 * size })
  }
}

/** Sparks off an ember on the road, or a steady trail off the hero while a lantern burns. */
function sparksConfig(rate: number, colour: Color4): PBParticleSystem {
  return {
    texture: { src: TEX_SPARK }, blendMode: BLEND_ADD,
    rate, maxParticles: 30, lifetime: 1.1, gravity: 0, additionalForce: Vector3.create(0, 1.2, 0),
    initialSize: { start: 0.08, end: 0.18 }, sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1, 0.85, 0.5, 1), end: colour },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 0.4, 0.1, 0) },
    initialVelocitySpeed: { start: 0.6, end: 1.6 }, shape: ParticleSystem.Shape.Cone({ angle: 30, radius: 0.25 }), simulationSpace: WORLD_SPACE
  }
}

/** A one-shot shower when something is picked up: a fast emitter the effects list removes a moment later. */
function shower(colour: Color4) {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(puppetX, ORIGIN.y + 1.0, ORIGIN.z + HERO_Z + 0.3) })
  ParticleSystem.create(e, {
    ...sparksConfig(0, colour), lifetime: 0.7, initialVelocitySpeed: { start: 1.5, end: 3.5 }, shape: ParticleSystem.Shape.Sphere({ radius: 0.2 }),
    bursts: { values: [{ time: 0, count: 26, cycles: 1 }] }, active: true, loop: false, playbackState: PLAYING
  })
  effects.push({ entity: e, t: 0, until: 1.0 })
}

/** A kit piece that stands still: the horizon dressing past the end of the strip. */
function still(id: KitId, x: number, z: number, yaw: number) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(ORIGIN.x + x, ORIGIN.y, z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  GltfContainer.create(entity, { src: KIT[id].src, invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
}

/** A kit piece beside the road at `along` metres, scrolling with the road and wrapping every `span`. */
function piece(id: KitId, x: number, along: number, span: number, y: number, yaw: number, bob: boolean) {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + HERO_Z - BEHIND + along), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  GltfContainer.create(entity, { src: KIT[id].src, invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
  return { entity, lane: x, along, span, y, yaw, bob }
}

function itemModel(kind: RunItem['kind']): { id?: KitId; y: number; yaw: number; sphere?: Color4; ghoul?: boolean } {
  switch (kind) {
    case 'stone': return { id: 'crypt_stone_b', y: 0, yaw: 180 }
    case 'tomb': return { id: 'crypt_tomb_a', y: 0, yaw: 0 }
    case 'ghoul': return { y: 0, yaw: 180, ghoul: true }
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
      fxSound('dodge', 0.22)
    }
    const events = stepRun(st, span, seed)
    for (const ev of events) onEvent(ev)
    // Owed corrections, a little a frame, so the host's word never shows as a jump.
    if (drift !== 0) {
      const pay = Math.sign(drift) * Math.min(Math.abs(drift), DRIFT_RATE * span + Math.abs(drift) * 0.5 * span)
      st.s += pay
      drift -= pay
    }
    if (staminaDrift !== 0) {
      const pay = Math.sign(staminaDrift) * Math.min(Math.abs(staminaDrift), STAMINA_DRIFT_RATE * span)
      st.stamina = Math.min(st.staminaMax, st.stamina + pay)
      staminaDrift -= pay
    }
    history.push({ t: st.t, s: st.s, stamina: st.stamina })
    while (history.length > 1 && history[0].t < st.t - 2) history.shift()
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
  // The lantern's spark trail and the ward's shell on the hero.
  const running = phase === 'running'
  if (trail !== undefined && trailOn !== (running && st.lantern > 0)) {
    trailOn = running && st.lantern > 0
    ParticleSystem.getMutable(trail).active = trailOn
  }
  if (shell !== undefined) {
    const k = running && st.ward > 0 ? 1.15 + 0.08 * Math.sin(st.t * 9) : 0
    Transform.getMutable(shell).scale = Vector3.create(k, k, k)
  }
  const first = Math.max(0, Math.floor((st.s - BEHIND) / RUN_CHUNK))
  const last = Math.floor((st.s + AHEAD) / RUN_CHUNK)
  for (let c = first; c <= last; c++) {
    for (const item of chunkItems(seed, c, st.luck)) {
      if (st.taken.has(item.key)) {
        const held = itemEntities.get(item.key)
        if (held && held.gone === undefined) {
          // A pickup vanishes; a smashed thing falls (the dead with their death clip); a thing merely hit stays and rolls past.
          if (!isObstacle(item.kind)) dropItem(item.key)
          else if (st.ward > 0) {
            held.gone = 0
            if (held.body) setEquipmentMotion(held.entity, 'death', true)
            else dropItem(item.key)
          } else held.gone = -1
        }
        continue
      }
      if (item.at < st.s - BEHIND || item.at > st.s + AHEAD || itemEntities.has(item.key)) continue
      const look = itemModel(item.kind)
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.create(ORIGIN.x + laneOffset(item.lane), ORIGIN.y + look.y, ORIGIN.z + HERO_Z + (item.at - st.s)), rotation: Quaternion.fromEulerDegrees(0, look.yaw, 0) })
      if (look.ghoul) {
        const who = GHOULS[hashKey(item.key) % GHOULS.length]
        setEquipmentAvatar(entity, who.body, { ...(DEFAULT_LOADOUTS[who.body] ?? DEFAULT_LOADOUTS.vanguard), weapon: who.weapon }, false)
        setEquipmentMotion(entity, 'menace', true)
      } else if (look.id) GltfContainer.create(entity, { src: KIT[look.id].src, invisibleMeshesCollisionMask: 0, visibleMeshesCollisionMask: 0 })
      if (look.sphere) {
        // A glowing core with sparks coming off it: an ember on the road, or the violet ward.
        const core = engine.addEntity()
        Transform.create(core, { parent: entity, scale: Vector3.create(0.34, 0.34, 0.34) })
        MeshRenderer.setSphere(core)
        Material.setPbrMaterial(core, { albedoColor: look.sphere, emissiveColor: look.sphere, emissiveIntensity: 3, roughness: 0.4 })
        const sparks = engine.addEntity()
        Transform.create(sparks, { parent: entity })
        ParticleSystem.create(sparks, { ...sparksConfig(item.kind === 'ember' ? 9 : 6, look.sphere), active: true, loop: true, prewarm: true, playbackState: PLAYING })
      }
      if (item.kind === 'lantern') {
        const flame = engine.addEntity()
        Transform.create(flame, { parent: entity, position: Vector3.create(0, 0.1, 0) })
        ParticleSystem.create(flame, { ...flameConfig(0.35), active: true, loop: true, prewarm: true, playbackState: PLAYING })
      }
      itemEntities.set(item.key, { entity, item, bob: !isObstacle(item.kind), body: !!look.ghoul })
    }
  }
  for (const [key, held] of itemEntities) {
    const rel = held.item.at - st.s
    if (held.gone !== undefined && held.gone >= 0) held.gone += span
    if (rel < -BEHIND || (held.gone !== undefined && held.gone > 1.2)) {
      dropItem(key)
      continue
    }
    const look = itemModel(held.item.kind)
    const tr = Transform.getMutable(held.entity)
    const bob = held.bob ? Math.sin(st.t * 4 + held.item.at) * 0.15 : 0
    tr.position = Vector3.create(ORIGIN.x + laneOffset(held.item.lane), ORIGIN.y + look.y + bob, ORIGIN.z + HERO_Z + rel)
    if (held.bob) tr.rotation = Quaternion.fromEulerDegrees(0, (st.t * 90) % 360, 0)
  }
  // A stumble shakes the camera a little, settling as the hero recovers.
  if (rig) {
    // A smooth wobble that dies away, not random jitter: jitter reads as the picture skipping.
    const k = phase === 'running' ? st.stumble / RUN_STUMBLE_SECONDS : 0
    const wobble = k > 0 ? SHAKE * k * k : 0
    const at = st.t * 28
    Transform.getMutable(rig.camera).position = Vector3.create(CAMERA_AT.x + Math.sin(at) * wobble, CAMERA_AT.y + Math.cos(at * 0.7) * wobble * 0.6, CAMERA_AT.z)
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i]
    fx.t += span
    if (fx.until !== undefined) {
      if (fx.t >= fx.until) {
        engine.removeEntity(fx.entity)
        effects.splice(i, 1)
      }
      continue
    }
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

function dropItem(key: string) {
  const held = itemEntities.get(key)
  if (!held) return
  if (held.body) destroyEquipmentAvatar(held.entity)
  engine.removeEntityWithChildren(held.entity)
  itemEntities.delete(key)
}

function dropAllItems() {
  for (const key of [...itemEntities.keys()]) dropItem(key)
}

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

function onEvent(ev: RunEvent) {
  switch (ev) {
    case 'hit': fxSound('hurt', 0.8); fxSound('thunk_wood', 0.6); burst(Color4.create(0.5, 0.1, 0.05, 1)); break
    case 'smash': fxSound('hit_heavy', 0.7); shower(Color4.create(0.7, 0.5, 1, 1)); break
    case 'ember': fxSound('coin', 0.7); shower(Color4.create(1, 0.55, 0.2, 1)); break
    case 'lantern': fxSound('fire_flare', 0.8); shower(Color4.create(1, 0.85, 0.4, 1)); break
    case 'ward': fxSound('reveal', 0.8); shower(Color4.create(0.6, 0.4, 1, 1)); break
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
