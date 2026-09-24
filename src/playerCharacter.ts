import {
  CameraMode, CameraType, engine, Entity, InputAction, InputModifier, inputSystem, Transform
} from '@dcl/sdk/ecs'
import { hallPromptActive } from './hallPrompt'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { COURTYARD, isInCourtyard } from './courtyard'
import { EquipmentLoadout } from './equipmentCatalog'
import {
  AttackContext, createRoamingCombat, healRoamingCharacter, hitRoamingCharacter, isRoamingBlocking, isRoamingInvulnerable, isRoamingSwinging,
  isRoamingRooted, maxStamina, resetRoamingCombat, restoreRoamingHealth, RoamingCombatHooks, setRoamingClass, setRoamingHealth, updateRoamingCombat
} from './roamingCombat'
import { CombatPose, HeroAttackMotion, isHeavyMotion, isRangedAttack, isSlashMotion, MAX_COMBAT_HEALTH } from './combatActions'
import { getCommittedAppearance } from './appearance'
import {
  destroyEquipmentAvatar, EquipmentAvatarOptions, EquipmentLoading, EquipmentMotion,
  getEquipmentLoading, getEquipmentMotion, setEquipmentAvatar, setEquipmentMotion, setEquipmentStride, setEquipmentTimeScale, setEquipmentVisible,
  transferEquipmentAvatar
} from './equipmentAvatar'
import { fxNumber, fxSlash, fxSound } from './combatFx'
import { rearmAvatarHiding } from './avatarHiding'
import { localAddress, publishHero, withdrawHero } from './multiplayer'
import { CRAWLER_CAMERA, isCrawlerCameraOn, kickCrawlerCamera } from './dungeon/crawlerCamera'
import { SkillDef } from './shared/skills'

type Locomotion = 'idle' | 'walk' | 'run'
export type PlayerCharacterState = {
  active: boolean
  loading: EquipmentLoading
  visible: boolean
  characterId: string | undefined
}

const IDLE_CONFIRM_SECONDS = 0.12
const RUN_ENTER_SPEED = 3
const RUN_EXIT_SPEED = 2.6
/** Ground speeds the walk and run cycles were authored for (m/s); playback is scaled from these. */
const WALK_CLIP_SPEED = 1.5
const RUN_CLIP_SPEED = 5.5
const STRIDE_MIN = 0.7
const STRIDE_MAX = 1.35
/** The walk band must persist this long before the walk cycle is shown. */
const WALK_DWELL_SECONDS = 0.22
/** A new gait plays as authored for this long before speed matching starts. */
const STRIDE_SETTLE_SECONDS = 0.4
let characterRoot: Entity | undefined
let systemAdded = false
let active = false
let suspended = false
let hasReadyCharacter = false
let visible = false
let characterId: string | undefined
let requestedLoadout: EquipmentLoadout | undefined
let requestedOptions: EquipmentAvatarOptions = {}
let samplePosition: Vector3 | undefined
let sampleElapsed = 0
let locomotion: Locomotion = 'idle'
/** Latest measured ground speed (m/s) from the locomotion sampler. */
let groundSpeed = 0
/** Eased walk/run playback rate currently applied to the character. */
let strideRate = 1
let walkBandSeconds = 0
let poseAge = 0
const roamingCombat = createRoamingCombat()
let attackContactHandler: ((motion: HeroAttackMotion, context: AttackContext) => void) | undefined
let attackStartHandler: ((motion: HeroAttackMotion, context: AttackContext) => void) | undefined
/** Whether an enemy stands within reach in front (the world answers); a ranged class strikes instead of shooting. */
let enemyWithinHandler: ((range: number) => boolean) | undefined
/** The skill bar's side of the fight: what is in each slot, and why a tap did nothing. */
let skillInSlotHandler: ((slot: number) => SkillDef | undefined) | undefined
let skillRefusedHandler: ((slot: number, why: 'locked' | 'cooldown' | 'stamina') => void) | undefined
/** World yaw the body is turned to while locked on (soft lock-on); undefined = native yaw. */
let facingOverride: number | undefined
let hitStopSeconds = 0
let exhaustedNotice = 0
let echoMismatches = 0
/** Restart counter written into our HeroBody: bumps when a one-shot clip begins. */
let motionSeq = 0
let lastPublishedMotion: EquipmentMotion | undefined
/** A one-shot began this tick (set by the combat hooks) even if the clip name is unchanged. */
let motionEvent = false
const ONE_SHOT_MOTIONS = new Set<EquipmentMotion>([
  'attack_light', 'attack_light2', 'attack_heavy', 'hit', 'death', 'block', 'dodge_roll',
  'bow_shoot', 'bow_volley', 'bow_bash', 'bow_block', 'cast_bolt', 'cast_nova'
])

export type PlayerVitals = {
  health: number; maxHealth: number; stamina: number; maxStamina: number
  comboStep: number; dodging: boolean; blocking: boolean; exhausted: boolean
  /** Seconds left on each skill slot (0..3). */
  cooldowns: readonly number[]
  /** The skill being cast right now, if any. */
  casting: string | undefined
}

/** World combat reads the native pose; it never takes over the player transform. */
export function getPlayerCombatPose(): (CombatPose & { health: number; invulnerable: boolean; blocking: boolean; swinging: boolean; speed: number }) | undefined {
  if (!active || suspended || characterRoot === undefined || getEquipmentLoading(characterRoot) !== 'ready') return undefined
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player || !isInsideScene(player.position)) return undefined
  return { position: player.position, facing: facingOverride ?? playerYaw(player.rotation),
    health: roamingCombat.health, invulnerable: isRoamingInvulnerable(roamingCombat), blocking: isRoamingBlocking(roamingCombat),
    swinging: isRoamingSwinging(roamingCombat), speed: groundSpeed }
}

/** The weapon id the local hero's body is carrying right now ('none-weapon' when unarmed). */
export function getPlayerWeapon(): string {
  return requestedLoadout?.weapon || 'none-weapon'
}

export function getPlayerVitals(): PlayerVitals {
  return {
    health: roamingCombat.health, maxHealth: MAX_COMBAT_HEALTH, stamina: roamingCombat.stamina, maxStamina: maxStamina(),
    comboStep: roamingCombat.comboStep, dodging: !!roamingCombat.dodge, blocking: roamingCombat.blocking,
    exhausted: exhaustedNotice > 0, cooldowns: roamingCombat.cooldowns, casting: roamingCombat.swing?.skill
  }
}

/** The world decides what the skill keys hold (class and level) and hears when one is refused. */
export function setPlayerSkillHandlers(
  inSlot: (slot: number) => SkillDef | undefined, refused: (slot: number, why: 'locked' | 'cooldown' | 'stamina') => void
) {
  skillInSlotHandler = inSlot
  skillRefusedHandler = refused
}

export function setPlayerAttackContactHandler(handler: (motion: HeroAttackMotion, context: AttackContext) => void) {
  attackContactHandler = handler
}

/** Fired when a swing is selected, before its first frame; used for lock-on and the step-in. */
export function setPlayerAttackStartHandler(handler: (motion: HeroAttackMotion, context: AttackContext) => void) {
  attackStartHandler = handler
}

/** The world tells the archer/spellblade when a foe is at arm's length (point-blank strike instead of a shot). */
export function setPlayerEnemyWithinHandler(handler: (range: number) => boolean) {
  enemyWithinHandler = handler
}

/** Turn the visible body to this world yaw (radians) until the swing ends. */
export function setPlayerFacingOverride(yaw: number | undefined) {
  facingOverride = yaw
  if (yaw === undefined && characterRoot !== undefined) Transform.getMutable(characterRoot).rotation = Quaternion.Identity()
}

function footprintOnFloor(p: Vector3): boolean {
  const r = 0.32
  return isInCourtyard(Vector3.create(p.x - r, p.y, p.z - r)) && isInCourtyard(Vector3.create(p.x + r, p.y, p.z - r)) &&
    isInCourtyard(Vector3.create(p.x - r, p.y, p.z + r)) && isInCourtyard(Vector3.create(p.x + r, p.y, p.z + r))
}

/**
 * Carry the native player along the ground: the dodge roll, or a swing's lunge.
 * The renderer's timed move (`movePlayerTo` with a duration) glides the
 * character every frame with a smooth-step and turns it to face the way it
 * goes, so the travel reads as one motion rather than a string of teleports;
 * it ignores colliders, so the path is walked against the dungeon floor first
 * and cut at the first wall.
 */
function glidePlayer(direction: Vector3, distance: number, seconds: number) {
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return
  const from = player.position
  const step = 0.25
  let reach = 0
  for (let d = Math.min(step, distance); ; d = Math.min(d + step, distance)) {
    const p = Vector3.create(from.x + direction.x * d, from.y, from.z + direction.z * d)
    if (!footprintOnFloor(p)) break
    reach = d
    if (d >= distance) break
  }
  if (reach < 0.05) return
  const to = Vector3.create(from.x + direction.x * reach, from.y, from.z + direction.z * reach)
  // Keep the travel's speed when a wall shortens it.
  movePlayerTo({ newRelativePosition: to, duration: seconds * (reach / distance) })
    .catch((error: unknown) => console.log('glide failed', error))
}

/**
 * Ground the swing clips are animated to cover when nothing is locked on. With a
 * target, `lockOn` sizes the step to land at sword reach instead.
 */
const LUNGE_DISTANCE: Record<HeroAttackMotion, number> = {
  attack_light: 0.45, attack_light2: 0.4, attack_heavy: 0.7,
  // The Berserker: the cross-cut steps like a light, the smash plants, the leap flies.
  attack_light3: 0.45, heavy_combo_c: 0.5, leap: 2.4,
  // Shots are fired from a standstill; the bow bash is a short shove forward.
  bow_shoot: 0, bow_volley: 0, bow_bash: 0.35, cast_bolt: 0, cast_nova: 0
}
const LUNGE_MAX = 1.3
/** The leap is the one swing meant to cover ground: up to three metres to land at reach. */
const LEAP_MAX = 3.0
let stepIn: number | undefined

/** Distance the next swing's wind-up should carry the hero (clamped per motion; 0 = stand and swing). */
export function setPlayerStepIn(distance: number) {
  stepIn = Math.max(0, distance)
}

/** The wind-up carries the body toward where it faces, arriving as the blow lands. */
function lungePlayer(motion: HeroAttackMotion, seconds: number) {
  // A skill's clip has no authored step: the lock-on sets its carry, up to a leap's reach.
  const authored = LUNGE_DISTANCE[motion] as number | undefined
  const max = motion === 'leap' || authored === undefined ? LEAP_MAX : LUNGE_MAX
  const distance = isRangedAttack(motion) ? 0 : Math.min(max, stepIn ?? authored ?? 0)
  stepIn = undefined
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player || distance < 0.05) return
  const yaw = facingOverride ?? playerYaw(player.rotation)
  glidePlayer(Vector3.create(Math.sin(yaw), 0, Math.cos(yaw)), distance, seconds)
}

let inputFrozen = false

/**
 * While rooted (rolling, mid-swing on the ground, or dead) WASD and jump are
 * muted at the renderer: a timed move is cancelled by any movement input, and a
 * hero that keeps jogging through a roll or a swing slides. Menus own
 * `InputModifier` while they are open (disableAll), so only a modifier of our
 * own shape is ever removed.
 */
function syncInputFreeze(rooted: boolean) {
  if (rooted === inputFrozen) return
  inputFrozen = rooted
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  const menuOwned = current?.mode?.$case === 'standard' && !!current.mode.standard.disableAll
  if (rooted) {
    if (!menuOwned) InputModifier.createOrReplace(engine.PlayerEntity, {
      mode: InputModifier.Mode.Standard({ disableWalk: true, disableJog: true, disableRun: true, disableJump: true })
    })
  } else if (current && !menuOwned) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
}

/** Briefly freeze the player's animation (impact weight). */
export function hitStopPlayer(seconds: number) {
  if (characterRoot === undefined) return
  hitStopSeconds = Math.max(hitStopSeconds, seconds)
  setEquipmentTimeScale(characterRoot, 0.02)
}

/** A strike parried by the raised guard: light feedback, no damage or stagger. */
export function playerBlockedHit(fromYaw: number) {
  const pose = getPlayerCombatPose()
  if (!pose) return
  fxSound('block', 0.8)
  fxNumber(Vector3.add(pose.position, Vector3.create(0, 1.9, 0)), 'Blocked', 'blocked')
  kickCrawlerCamera(Vector3.create(Math.sin(fromYaw) * 0.1, 0, Math.cos(fromYaw) * 0.1))
  hitStopPlayer(0.05)
}

/** The host judged a blow as rolled through: feedback only. */
export function playerDodgedHit() {
  const pose = getPlayerCombatPose()
  if (!pose) return
  fxNumber(Vector3.add(pose.position, Vector3.create(0, 1.9, 0)), 'Dodged', 'note')
}

/**
 * An enemy blow the host resolved against us. `health` is the host's number
 * after the blow; the local mirror adopts it and plays the matching feedback.
 * Returns true when the hero went down.
 */
export function receivePlayerCombatHit(damage: number, stagger: number, health: number, fromYaw?: number): boolean {
  if (roamingCombat.health <= 0 || characterRoot === undefined) return false
  const pose = getPlayerCombatPose()
  const killed = hitRoamingCharacter(roamingCombat, health, stagger)
  setPlayerFacingOverride(undefined)
  motionEvent = true
  if (pose && damage > 0) fxNumber(Vector3.add(pose.position, Vector3.create(0, 1.9, 0)), `-${damage}`, 'player')
  const yaw = fromYaw ?? (pose ? pose.facing + Math.PI : 0)
  if (killed) {
    // The fall plays once and rests on its last frame until the host revives the hero.
    setEquipmentMotion(characterRoot, 'death', true)
    fxSound('death', 0.9)
    kickCrawlerCamera(Vector3.create(Math.sin(yaw) * 0.4, -0.25, Math.cos(yaw) * 0.4))
    hitStopPlayer(0.1)
    return true
  }
  setEquipmentMotion(characterRoot, 'hit', true)
  fxSound('hurt', 0.9)
  kickCrawlerCamera(Vector3.create(Math.sin(yaw) * 0.25, -0.1, Math.cos(yaw) * 0.25))
  hitStopPlayer(0.06)
  return false
}

/** The host restored health (heart pickup, later a spell). */
export function healPlayer(amount: number, health: number) {
  const rose = healRoamingCharacter(roamingCombat, health)
  const pose = getPlayerCombatPose()
  const shown = amount > 0 ? amount : rose
  if (shown > 0 && pose) fxNumber(Vector3.add(pose.position, Vector3.create(0, 1.9, 0)), `+${Math.round(shown)}`, 'heal')
}

/**
 * The host echoes our own packet with its idea of our health. Normally it
 * matches; when a `hitPlayer`, `heal` or `revive` was lost this pulls the
 * mirror back in line, and reports a death or revive the world must act on.
 */
export function reconcilePlayerHealth(health: number): 'died' | 'revived' | undefined {
  if (characterRoot === undefined || !Number.isFinite(health)) return undefined
  const before = roamingCombat.health
  const after = Math.max(0, Math.min(MAX_COMBAT_HEALTH, health))
  if (Math.abs(before - after) < 0.5) {
    echoMismatches = 0
    return undefined
  }
  // An echo relayed just before a blow legitimately lags one step behind the
  // `hitPlayer` that follows it; only a mismatch that persists is a lost message.
  if (++echoMismatches < 3) return undefined
  echoMismatches = 0
  if (before > 0 && after <= 0) {
    hitRoamingCharacter(roamingCombat, 0, 0)
    setPlayerFacingOverride(undefined)
    motionEvent = true
    setEquipmentMotion(characterRoot, 'death', true)
    fxSound('death', 0.9)
    return 'died'
  }
  if (before <= 0 && after > 0) return 'revived'
  setRoamingHealth(roamingCombat, after)
  return undefined
}

export function isPlayerDown(): boolean {
  return roamingCombat.health <= 0
}

export function restorePlayerCombatHealth() {
  restoreRoamingHealth(roamingCombat)
}

function playerYaw(rotation: Quaternion): number {
  return Quaternion.toEulerAngles(rotation).y * Math.PI / 180
}

/** WASD relative to whichever camera is driving the view, on the ground plane. */
function moveDirection(): Vector3 | undefined {
  let forward = 0
  let side = 0
  if (inputSystem.isPressed(InputAction.IA_FORWARD)) forward++
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) forward--
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) side++
  if (inputSystem.isPressed(InputAction.IA_LEFT)) side--
  if (!forward && !side) return undefined
  const yaw = isCrawlerCameraOn()
    ? (CRAWLER_CAMERA.yaw * Math.PI) / 180
    : playerYaw(Transform.getOrNull(engine.CameraEntity)?.rotation ?? Quaternion.Identity())
  const fx = Math.sin(yaw), fz = Math.cos(yaw)
  return Vector3.normalize(Vector3.create(fx * forward + fz * side, 0, fz * forward - fx * side))
}

const combatHooks: RoamingCombatHooks = {
  moveDirection,
  skillInSlot: (slot) => skillInSlotHandler?.(slot),
  onSkillRefused: (slot, why) => skillRefusedHandler?.(slot, why),
  retreatDirection: () => {
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player) return undefined
    const yaw = playerYaw(player.rotation)
    return Vector3.create(-Math.sin(yaw), 0, -Math.cos(yaw))
  },
  onAttackStart: (motion, context) => {
    // The world's lock-on may size the step-in for this swing; otherwise the clip's own step is used.
    stepIn = undefined
    attackStartHandler?.(motion, context)
    // Swings announce themselves; a shot's sound is the projectile leaving at the contact frame.
    if (context.skill?.effect.kind === 'aura') {
      fxSound('roar', 0.55)
    } else if (!isRangedAttack(motion)) {
      if (characterRoot !== undefined && isSlashMotion(motion)) fxSlash(characterRoot, motion)
      fxSound(isHeavyMotion(motion) || !!context.skill ? 'swing_heavy' : 'swing_light', 0.7)
    }
    motionEvent = true
  },
  onAttackLunge: lungePlayer,
  onAttackContact: (motion, context) => attackContactHandler?.(motion, context),
  enemyWithin: (range) => enemyWithinHandler?.(range) ?? false,
  onAttackEnd: () => setPlayerFacingOverride(undefined),
  onDodgeStart: (direction) => {
    fxSound('dodge', 0.8)
    motionEvent = true
    // Face the roll from its first frame; the renderer turns the native
    // controller the same way once the travel starts, so nothing snaps after.
    setPlayerFacingOverride(Math.atan2(direction.x, direction.z))
  },
  onDodgeTravel: glidePlayer,
  onExhausted: () => {
    if (exhaustedNotice > 0) return
    exhaustedNotice = 0.6
    const pose = getPlayerCombatPose()
    if (pose) fxNumber(Vector3.add(pose.position, Vector3.create(0, 1.9, 0)), 'Winded', 'note')
  }
}

/** The native player owns movement, collisions, jumping and the camera. */
export function initializePlayerCharacter(): Entity {
  if (characterRoot !== undefined) return characterRoot
  characterRoot = engine.addEntity()
  // The SDK recommends this parent over the deprecated POSITION attachment.
  // Native position and yaw flow straight through the renderer hierarchy, without
  // a scene-update delay or the attachment's legacy vertical pivot correction.
  Transform.create(characterRoot, { parent: engine.PlayerEntity })
  // No name tag over our own head: the HUD carries our name. Other heroes get theirs in remotePlayers.ts.
  if (!systemAdded) {
    engine.addSystem(updatePlayerCharacter)
    systemAdded = true
  }
  return characterRoot
}

/** Called only when the creator or inventory commits a character/outfit. */
export function setPlayerCharacter(
  nextCharacterId: string, loadout: EquipmentLoadout, options: EquipmentAvatarOptions = {}
) {
  const root = initializePlayerCharacter()
  resetRoamingCombat(roamingCombat)
  setRoamingClass(roamingCombat, nextCharacterId)
  characterId = nextCharacterId
  requestedLoadout = { ...loadout }
  requestedOptions = { ...options }
  active = true
  setEquipmentAvatar(root, nextCharacterId, requestedLoadout, false, requestedOptions)
  // The equipment adapter retains the previous ready assembly during replacement.
  // Keep its visibility and native-avatar suppression while the new outfit loads.
  setEquipmentVisible(root, visible)
  setEquipmentMotion(root, locomotion)
}

/** Adopt the already loaded creator model instead of preparing a second copy. */
export function adoptPlayerCharacter(
  previewRoot: Entity, nextCharacterId: string, loadout: EquipmentLoadout,
  options: EquipmentAvatarOptions = {}
): boolean {
  const root = initializePlayerCharacter()
  if (!transferEquipmentAvatar(previewRoot, root)) return false

  resetRoamingCombat(roamingCombat)
  setRoamingClass(roamingCombat, nextCharacterId)
  characterId = nextCharacterId
  requestedLoadout = { ...loadout }
  requestedOptions = { ...options }
  active = true
  hasReadyCharacter = true
  samplePosition = undefined
  sampleElapsed = 0
  locomotion = 'idle'
  // The source preview can be visible even when the player module's own flag is
  // already false. Force its assembly hidden until the normal identity gate runs.
  visible = false
  setEquipmentVisible(root, false)
  setEquipmentMotion(root, locomotion)
  return true
}

/** Shared preview/arena ownership hides the free-roam model, not the player controller. */
export function setPlayerCharacterSuspended(value: boolean) {
  suspended = value
  resetRoamingCombat(roamingCombat)
  samplePosition = undefined
  sampleElapsed = 0
  if (value) setCharacterVisible(false)
}

export function getPlayerCharacterState(): PlayerCharacterState {
  return {
    active,
    loading: characterRoot !== undefined && active ? getEquipmentLoading(characterRoot) : 'loading',
    visible,
    characterId
  }
}

export function retryPlayerCharacter() {
  if (!characterId || !requestedLoadout) return
  setPlayerCharacter(characterId, requestedLoadout, requestedOptions)
}

/** Restore the native avatar and release this module's entities. */
export function disposePlayerCharacter() {
  restoreRoamingHealth(roamingCombat)
  active = false
  suspended = false
  hasReadyCharacter = false
  visible = false
  characterId = undefined
  requestedLoadout = undefined
  requestedOptions = {}
  samplePosition = undefined
  sampleElapsed = 0
  locomotion = 'idle'
  withdrawHero()
  if (characterRoot !== undefined) {
    destroyEquipmentAvatar(characterRoot)
    engine.removeEntity(characterRoot)
    characterRoot = undefined
  }
}

function setCharacterVisible(next: boolean) {
  if (visible === next) return
  visible = next
  if (characterRoot !== undefined) setEquipmentVisible(characterRoot, next)
}

function isInsideScene(position: Vector3) {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) &&
    position.x >= 0 && position.x < COURTYARD.sceneSize &&
    position.z >= 0 && position.z < COURTYARD.sceneSize
}

function updatePlayerCharacter(dt: number) {
  if (characterRoot === undefined || !active) return
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player || !isInsideScene(player.position)) {
    resetRoamingCombat(roamingCombat)
    syncInputFreeze(false)
    setCharacterVisible(false)
    samplePosition = undefined
    sampleElapsed = 0
    return
  }

  const equipmentReady = getEquipmentLoading(characterRoot) === 'ready'
  if (equipmentReady && !hasReadyCharacter) {
    hasReadyCharacter = true
    // Our body is up: make sure the native avatar under it is hidden, whatever reset it meanwhile.
    rearmAvatarHiding()
  }
  updateLocomotion(player.position, dt)
  if (!equipmentReady || suspended) resetRoamingCombat(roamingCombat)
  const actionMotion = equipmentReady && !suspended
    ? updateRoamingCombat(roamingCombat, characterRoot, player.position, dt,
      // Beside one of the hall's folk or the war table, E is the hall's key (hold, or turn the page), not a swing.
      !!requestedLoadout?.weapon && requestedLoadout.weapon !== 'none-weapon' && !hallPromptActive(), locomotion !== 'idle', combatHooks)
    : undefined
  // Rooting follows the combat state every tick, so it is up before a roll's or
  // swing's timed move starts (those are issued a beat after the pose) and a
  // reset (menu, teleport) or a revive hands the controls straight back.
  syncInputFreeze(isRoamingRooted(roamingCombat))
  // One owner chooses the final pose. Locomotion sampling cannot interrupt a swing.
  setEquipmentMotion(characterRoot, actionMotion ?? locomotion)
  exhaustedNotice = Math.max(0, exhaustedNotice - dt)
  if (hitStopSeconds > 0) {
    hitStopSeconds -= dt
    if (hitStopSeconds <= 0) {
      hitStopSeconds = 0
      setEquipmentTimeScale(characterRoot, 1)
    }
  }
  // Soft lock-on turns only the visible body; the native controller keeps its own yaw.
  if (facingOverride !== undefined) {
    if (!roamingCombat.swing && !roamingCombat.dodge && roamingCombat.recovery <= 0) setPlayerFacingOverride(undefined)
    else {
      const delta = facingOverride - playerYaw(player.rotation)
      Transform.getMutable(characterRoot).rotation = Quaternion.fromEulerDegrees(0, (delta * 180) / Math.PI, 0)
    }
  }

  const canReplace = hasReadyCharacter && !!localAddress()

  const firstPerson = CameraMode.getOrNull(engine.CameraEntity)?.mode === CameraType.CT_FIRST_PERSON
  const shown = canReplace && !suspended && !firstPerson
  setCharacterVisible(shown)
  publishLocalPlayer(player, dt)
}

/** Our HeroBody: what everyone else needs to show this hero. */
function publishLocalPlayer(player: { position: Vector3; rotation: Quaternion }, dt: number) {
  if (!characterId || !requestedLoadout || characterRoot === undefined) return
  const appearance = requestedOptions.appearance ?? getCommittedAppearance(characterId)
  const motion = getEquipmentMotion(characterRoot)
  // A one-shot that begins (or begins again) bumps the counter so watchers restart it.
  if (motionEvent || (motion !== lastPublishedMotion && ONE_SHOT_MOTIONS.has(motion))) motionSeq++
  motionEvent = false
  lastPublishedMotion = motion
  publishHero({
    x: player.position.x,
    y: player.position.y,
    z: player.position.z,
    f: facingOverride ?? playerYaw(player.rotation),
    lock: facingOverride !== undefined,
    motion,
    seq: motionSeq,
    cid: characterId,
    body: appearance.bodyType,
    hair: appearance.hairStyle,
    hc: appearance.hairColor,
    skin: appearance.skinTone,
    loadout: { ...requestedLoadout },
    block: roamingCombat.blocking,
    // The host reads `dodge` as "blows pass through right now": the roll's
    // invulnerable window, not the whole roll.
    dodge: isRoamingInvulnerable(roamingCombat)
  }, dt)
}

function updateLocomotion(position: Vector3, dt: number) {
  if (characterRoot === undefined) return
  if (!Number.isFinite(dt) || dt <= 0) return
  if (suspended || !samplePosition) {
    samplePosition = Vector3.create(position.x, position.y, position.z)
    sampleElapsed = 0
    locomotion = 'idle'
    groundSpeed = 0
    return
  }

  sampleElapsed += dt
  const dx = position.x - samplePosition.x
  const dz = position.z - samplePosition.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  // React to fresh movement immediately, including touchdown. Only stopping
  // needs a grace interval so repeated native snapshots do not flicker to idle.
  if (distance <= 0.0001 && sampleElapsed < IDLE_CONFIRM_SECONDS) return
  const speed = distance / sampleElapsed
  // Position recovery/teleports are not a burst of running animation.
  const teleported = distance > Math.max(1.5, sampleElapsed * 16)
  groundSpeed = teleported ? 0 : speed
  const idleThreshold = locomotion === 'idle' ? 0.16 : 0.08
  const runThreshold = locomotion === 'run' ? RUN_EXIT_SPEED : RUN_ENTER_SPEED
  const previous = locomotion
  const span = sampleElapsed
  samplePosition = Vector3.create(position.x, position.y, position.z)
  sampleElapsed = 0
  if (teleported || speed < idleThreshold) {
    locomotion = 'idle'
    walkBandSeconds = 0
  } else if (speed >= runThreshold) {
    locomotion = 'run'
    walkBandSeconds = 0
  } else {
    // The walk band is crossed in a few samples on every start and stop. Showing
    // the walk cycle for those samples is a visible pop between idle and run, so
    // walking has to persist before it is believed; until then a start goes
    // straight to run and a stop holds the run until it is idle.
    walkBandSeconds += span
    if (walkBandSeconds >= WALK_DWELL_SECONDS) locomotion = 'walk'
    else if (previous === 'idle') locomotion = 'run'
  }
  if (locomotion !== previous) {
    poseAge = 0
    // Play a fresh cycle as authored; the measured speed is still ramping.
    strideRate = 1
    setEquipmentStride(characterRoot, 1)
  } else {
    poseAge += span
  }
  // Once the gait has settled, match the cycle to the ground speed so the feet
  // stay planted, eased so the renderer's uneven position cadence cannot stutter it.
  if (locomotion !== 'idle' && poseAge >= STRIDE_SETTLE_SECONDS) {
    const reference = locomotion === 'run' ? RUN_CLIP_SPEED : WALK_CLIP_SPEED
    const wanted = Math.min(STRIDE_MAX, Math.max(STRIDE_MIN, speed / reference))
    strideRate += (wanted - strideRate) * (1 - Math.exp(-span * 6))
    setEquipmentStride(characterRoot, strideRate)
  }
}