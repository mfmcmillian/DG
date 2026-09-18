import {
  engine, Entity, InputAction,
  inputSystem, LightSource, Material, MeshRenderer,
  PointerLock, Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { closeSceneCamera, openSceneCamera, SceneCameraSession } from './sceneCamera'
import { COURTYARD } from './courtyard'
import { CHARACTERS, closePicker, getEquippedCharacter, getPickerState, openPicker } from './characterPicker'
import { closeInventory } from './inventory'
import { DEFAULT_LOADOUTS, EquipmentLoadout } from './equipmentCatalog'
import { getCommittedLoadout } from './equipmentState'
import {
  destroyEquipmentAvatar, EquipmentMotion, getEquipmentJumpMotion, getEquipmentLoading,
  setEquipmentAvatar, setEquipmentMotion, setEquipmentVisible
} from './equipmentAvatar'
import { JUMP_PROFILES, JumpMotion } from './combatAnimations'
import {
  advanceAttack, attackCanReach, attackRecovery, AttackMotion, canStartAttack, COMBAT_RULES,
  combatDistance, createSwing, facesCombatant, MAX_COMBAT_HEALTH, resolveCombatHit, Swing
} from './combatActions'
import { actionButtonsReleased, createCombatControls, readCombatControls, resetCombatControls } from './combatControls'
import { createRivalBrain, resetRivalBrain, updateRivalBrain } from './rivalBrain'

export type CombatPhase = 'loading' | 'ready' | 'fighting' | 'victory' | 'defeat' | 'error'

export interface CombatState {
  open: boolean
  phase: CombatPhase
  playerName: string
  rivalName: string
  playerHealth: number
  rivalHealth: number
  maxHealth: number
  notice: string
  playerBlocking: boolean
  playerJumping: boolean
  rivalBlocking: boolean
  playerAction: string
  rivalAction: string
  elapsedSeconds: number
  resultElapsedSeconds: number
  inputLocked: boolean
  rivalTelegraph: string
}

type Fighter = {
  root: Entity
  position: Vector3
  facing: number
  health: number
  motion: EquipmentMotion
  blocking: boolean
  moving: boolean
  locomotion: 'walk' | 'run'
  stagger: number
  recovery: number
  swing?: Swing
  jump?: { elapsed: number; motion: JumpMotion; startedAt: number; interrupted?: boolean }
}

const ARENA_MIN = 15
const ARENA_MAX = 26
const JUMP_HEIGHT = 0.95
const CAMERA_POSITION = Vector3.create(20.5, 6.5, 11.5)
const CAMERA_TARGET = Vector3.create(20.5, 0.85, 20.5)
const CAMERA_FORWARD = Vector3.normalize(Vector3.create(
  CAMERA_TARGET.x - CAMERA_POSITION.x, 0, CAMERA_TARGET.z - CAMERA_POSITION.z
))
const CAMERA_RIGHT = Vector3.create(CAMERA_FORWARD.z, 0, -CAMERA_FORWARD.x)

const state: CombatState = {
  open: false, phase: 'loading', playerName: '', rivalName: '',
  playerHealth: MAX_COMBAT_HEALTH, rivalHealth: MAX_COMBAT_HEALTH, maxHealth: MAX_COMBAT_HEALTH,
  notice: '', playerBlocking: false, playerJumping: false, rivalBlocking: false,
  playerAction: 'Ready', rivalAction: 'Ready', elapsedSeconds: 0, resultElapsedSeconds: 0,
  inputLocked: false, rivalTelegraph: ''
}

let initialized = false
let player: Fighter | undefined
let rival: Fighter | undefined
let playerCharacterId = 'vanguard'
let rivalCharacterId = 'striker'
const arenaEntities: Entity[] = []
let cameraSession: SceneCameraSession | undefined
let readyElapsed = 0
let loadingElapsed = 0
let noticeRemaining = 0
const controls = createCombatControls()
let uiBlock = false
let lightSequence = 0
const rivalBrain = createRivalBrain()

export function initializeCombat() {
  if (initialized) return
  initialized = true
  engine.addSystem(combatSystem)
}

export function getCombatState(): Readonly<CombatState> {
  return state
}

export function openCombat() {
  if (!initialized || state.open) return
  if (!getPickerState().hasCreatedCharacter) {
    openPicker()
    return
  }
  closeInventory()
  closePicker()
  const session = openSceneCamera('combat', CAMERA_POSITION, CAMERA_TARGET)
  if (!session) return
  cameraSession = session
  state.open = true
  const selected = getEquippedCharacter()
  const opponent = CHARACTERS.find((character) => character.id === (selected.id === 'vanguard' ? 'striker' : 'vanguard'))!
  playerCharacterId = selected.id
  rivalCharacterId = opponent.id
  state.playerName = selected.name
  state.rivalName = opponent.name

  createArenaPresentation()

  startRound()
}

export function closeCombat() {
  if (!state.open) return
  state.open = false
  uiBlock = false
  resetCombatControls(controls)
  state.playerBlocking = false
  state.playerJumping = false
  state.rivalBlocking = false
  state.rivalTelegraph = ''
  removeFighters()

  closeSceneCamera(cameraSession)
  cameraSession = undefined
  for (const entity of arenaEntities) {
    if (entity !== undefined) engine.removeEntity(entity)
  }
  arenaEntities.length = 0
}

export function rematchCombat() {
  if (state.open) startRound()
}

export function retryCombat() {
  rematchCombat()
}

export function requestLightAttack() {
  if (state.phase !== 'fighting' || !player || !rival || !canStartAttack(player)) return
  uiBlock = false
  beginAttack(player, rival, lightSequence++ % 2 === 0 ? 'attack_light' : 'attack_light2')
}

export function requestHeavyAttack() {
  if (state.phase !== 'fighting' || !player || !rival || !canStartAttack(player)) return
  uiBlock = false
  beginAttack(player, rival, 'attack_heavy')
}

export function requestCombatJump() {
  if (!state.open || state.phase !== 'fighting' || !player || !canAct(player)) return
  uiBlock = false
  player.blocking = false
  const motion = getEquipmentJumpMotion(player.root)
  player.jump = { elapsed: 0, motion, startedAt: state.elapsedSeconds }
  state.playerBlocking = false
  state.playerJumping = true
  playMotion(player, motion, true)
}

// Retained for a future guard binding; Space is reserved for jumping.
export function toggleCombatBlock() {
  if (!state.open || state.phase !== 'fighting' || !player || player.health <= 0) return
  uiBlock = !uiBlock
  if (canAct(player)) {
    player.blocking = uiBlock
    state.playerBlocking = uiBlock
    playMotion(player, uiBlock ? 'block' : 'combat_idle')
  }
}

function startRound() {
  removeFighters()
  state.phase = 'loading'
  state.playerHealth = MAX_COMBAT_HEALTH
  state.rivalHealth = MAX_COMBAT_HEALTH
  state.elapsedSeconds = 0
  state.resultElapsedSeconds = 0
  state.playerBlocking = false
  state.playerJumping = false
  state.rivalBlocking = false
  state.playerAction = 'Ready'
  state.rivalAction = 'Ready'
  state.rivalTelegraph = ''
  state.notice = 'Preparing fighters...'
  readyElapsed = 0
  loadingElapsed = 0
  noticeRemaining = 0
  uiBlock = false
  lightSequence = 0
  resetRivalBrain(rivalBrain)
  resetCombatControls(controls, 0.3)

  const loadout = getCommittedLoadout(playerCharacterId)
  if (!loadout.weapon || loadout.weapon === 'none-weapon') {
    state.phase = 'error'
    state.notice = 'Equip a sword in Inventory to enter the arena.'
    return
  }
  const rivalLoadout: EquipmentLoadout = { ...DEFAULT_LOADOUTS[rivalCharacterId], weapon: 'pride-sword' }
  player = createFighter(playerCharacterId, loadout, 18.5, 19, Math.PI / 2)
  rival = createFighter(rivalCharacterId, rivalLoadout, 22.5, 22, -Math.PI / 2)
  faceOpponent(player, rival)
  faceOpponent(rival, player)
  syncTransform(player)
  syncTransform(rival)
}

function createFighter(characterId: string, loadout: EquipmentLoadout, x: number, z: number, facing: number): Fighter {
  const root = engine.addEntity()
  const position = Vector3.create(x, COURTYARD.characterFloorY, z)
  Transform.create(root, { position, rotation: Quaternion.fromEulerDegrees(0, facing * 180 / Math.PI, 0) })
  setEquipmentAvatar(root, characterId, loadout, false)
  setEquipmentVisible(root, false)
  setEquipmentMotion(root, 'combat_idle', true)
  return { root, position, facing, health: MAX_COMBAT_HEALTH, motion: 'combat_idle', blocking: false, moving: false, locomotion: 'walk', stagger: 0, recovery: 0 }
}

function removeFighters() {
  for (const fighter of [player, rival]) {
    if (!fighter) continue
    destroyEquipmentAvatar(fighter.root)
    engine.removeEntity(fighter.root)
  }
  player = undefined
  rival = undefined
}

function combatSystem(deltaTime: number) {
  if (!state.open) return
  const dt = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
  // Animation clocks follow real frame time; only movement is capped after a stalled frame.
  const movementDt = Math.min(dt, 0.05)
  state.inputLocked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false
  if (!player || !rival) return

  if (state.phase === 'loading') {
    loadingElapsed += dt
    const playerStatus = getEquipmentLoading(player.root)
    const rivalStatus = getEquipmentLoading(rival.root)
    if (playerStatus === 'error' || rivalStatus === 'error' || loadingElapsed > 35) {
      state.phase = 'error'
      state.notice = loadingElapsed > 35
        ? 'Fighters are taking too long to load. Retry the match.'
        : 'A fighter could not load. Retry the match or return to your gear.'
      return
    }
    if (playerStatus === 'ready' && rivalStatus === 'ready') {
      setEquipmentVisible(player.root, true)
      setEquipmentVisible(rival.root, true)
      playMotion(player, 'combat_idle', true)
      playMotion(rival, 'combat_idle', true)
      state.phase = 'ready'
      state.notice = 'Get ready...'
    }
    return
  }

  if (state.phase === 'ready') {
    readyElapsed += dt
    if (readyElapsed >= 1.2 && actionButtonsReleased()) {
      state.phase = 'fighting'
      showNotice('Fight!', 1.1)
      resetCombatControls(controls)
    } else if (readyElapsed >= 1.2) state.notice = 'Release attack and jump controls to begin.'
    return
  }

  if (state.phase === 'victory' || state.phase === 'defeat') {
    state.resultElapsedSeconds += dt
    // A round ending in midair must still let the fighter land.
    advanceJump(player, dt)
    advanceJump(rival, dt)
    syncTransform(player)
    syncTransform(rival)
    syncState()
    return
  }
  if (state.phase !== 'fighting') return
  state.elapsedSeconds += dt
  if (noticeRemaining > 0) {
    noticeRemaining = Math.max(0, noticeRemaining - dt)
    if (noticeRemaining === 0) state.notice = ''
  }
  advanceRecovery(player, dt)
  advanceRecovery(rival, dt)
  updatePlayer(dt, movementDt)
  updateRival(dt, movementDt)
  // Like swings, a jump selected this update starts its animation at time zero.
  if (player.jump?.startedAt !== state.elapsedSeconds) advanceJump(player, dt)
  if (rival.jump?.startedAt !== state.elapsedSeconds) advanceJump(rival, dt)
  if (!player.swing && player.stagger <= 0) faceOpponent(player, rival)
  if (!rival.swing && rival.stagger <= 0) faceOpponent(rival, player)
  separateFighters(player, rival)
  advanceSwing(player, rival, dt)
  if (state.phase === 'fighting') advanceSwing(rival, player, dt)
  refreshMotion(player)
  refreshMotion(rival)
  syncTransform(player)
  syncTransform(rival)
  syncState()
}

function updatePlayer(dt: number, movementDt: number) {
  if (!player) return
  const { acceptsKeys, action } = readCombatControls(controls, dt)
  player.blocking = canAct(player) && uiBlock
  player.moving = false
  if (action === 'jump') requestCombatJump()
  else if (action === 'heavy') requestHeavyAttack()
  else if (action === 'light') requestLightAttack()
  if (!acceptsKeys || !canMove(player)) return

  let side = 0
  let forward = 0
  if (inputSystem.isPressed(InputAction.IA_FORWARD)) forward++
  if (inputSystem.isPressed(InputAction.IA_BACKWARD)) forward--
  if (inputSystem.isPressed(InputAction.IA_RIGHT)) side++
  if (inputSystem.isPressed(InputAction.IA_LEFT)) side--
  const length = Math.sqrt(side * side + forward * forward)
  if (length === 0) return
  const speed = player.blocking ? 1.05 : inputSystem.isPressed(InputAction.IA_WALK) ? 1.6 : 3.2
  player.locomotion = speed > 2 ? 'run' : 'walk'
  const x = (CAMERA_RIGHT.x * side + CAMERA_FORWARD.x * forward) / length
  const z = (CAMERA_RIGHT.z * side + CAMERA_FORWARD.z * forward) / length
  moveFighter(player, x * speed * movementDt, z * speed * movementDt)
  player.moving = true
}

function updateRival(dt: number, movementDt: number) {
  if (!rival || !player) return
  rival.moving = false
  const available = canStartAttack(rival)
  const distance = combatDistance(rival, player)
  const decision = updateRivalBrain(rivalBrain, dt, distance, available)
  rival.blocking = decision.block
  state.rivalTelegraph = decision.telegraph
  if (!available) return
  faceOpponent(rival, player)
  if (decision.advance) {
    const amount = Math.min(COMBAT_RULES.rivalSpeed * movementDt, distance - COMBAT_RULES.approachStop)
    moveFighter(rival, (player.position.x - rival.position.x) / distance * amount,
      (player.position.z - rival.position.z) / distance * amount)
    rival.moving = true
  }
  // The arena duel never asks for the boss slam; only sword swings reach here.
  if (decision.attack && decision.attack !== 'slam') beginAttack(rival, player, decision.attack)
}

function beginAttack(attacker: Fighter, defender: Fighter, motion: AttackMotion) {
  if (!canStartAttack(attacker)) return
  attacker.blocking = false
  attacker.moving = false
  faceOpponent(attacker, defender)
  attacker.swing = createSwing(motion, state.elapsedSeconds)
  // Replacing the jump pose does not cancel its takeoff/flight. Release the
  // interrupted jump at touchdown while the swing finishes on its own clock.
  if (attacker.jump) attacker.jump.interrupted = true
  playMotion(attacker, motion, true)
}

function advanceSwing(attacker: Fighter, defender: Fighter, dt: number) {
  const swing = attacker.swing
  if (!swing || attacker.health <= 0) return
  const finished = advanceAttack(swing, state.elapsedSeconds, dt, () => {
    // Each swing gets one contact attempt; walking into a completed swing cannot deal damage.
    if (attackCanReach(attacker, defender, swing.motion)) {
      strike(attacker, defender, swing.motion as AttackMotion)
    }
  })
  if (attacker.swing === swing && finished) {
    attacker.swing = undefined
    attacker.recovery = attackRecovery(swing.motion)
  }
}

function strike(attacker: Fighter, defender: Fighter, motion: AttackMotion) {
  if (defender.health <= 0) return
  const heavy = motion === 'attack_heavy'
  const guarded = defender.blocking && facesCombatant(defender, attacker, 0.1)
  const hit = resolveCombatHit(motion, guarded)
  defender.health = Math.max(0, defender.health - hit.damage)
  if (guarded) {
    showNotice(heavy ? 'Heavy strike chipped through guard' : 'Blocked!', 0.85)
    if (!hit.interrupt && defender.health > 0) return
  } else showNotice(defender === rival ? heavy ? 'Heavy hit! 28' : 'Hit! 14' : heavy ? 'Heavy hit taken' : 'Hit taken', 0.75)

  interruptJump(defender)
  defender.swing = undefined
  defender.blocking = false
  defender.moving = false
  if (defender === rival) {
    resetRivalBrain(rivalBrain, 0.1, false)
    state.rivalTelegraph = ''
  }
  if (defender.health === 0) {
    playMotion(defender, 'death', true)
    endRound(defender === rival)
    return
  }
  defender.stagger = hit.stagger
  playMotion(defender, 'hit', true)
  moveFighter(defender, Math.sin(attacker.facing) * hit.knockback, Math.cos(attacker.facing) * hit.knockback)
}

function endRound(victory: boolean) {
  state.phase = victory ? 'victory' : 'defeat'
  state.resultElapsedSeconds = 0
  state.notice = victory ? 'Victory! Your rival is down.' : 'Defeat. Gear up and try again.'
  noticeRemaining = 0
  state.rivalTelegraph = ''
  uiBlock = false
  for (const fighter of [player, rival]) {
    if (!fighter) continue
    fighter.blocking = false
    fighter.moving = false
    fighter.swing = undefined
    interruptJump(fighter)
    if (fighter.health > 0) {
      fighter.stagger = 0
      playMotion(fighter, 'combat_idle', true)
    }
  }
  syncState()
}

function advanceRecovery(fighter: Fighter, dt: number) {
  fighter.stagger = Math.max(0, fighter.stagger - dt)
  fighter.recovery = Math.max(0, fighter.recovery - dt)
}

function canMove(fighter: Fighter) {
  return canStartAttack(fighter)
}

function canAct(fighter: Fighter) {
  return canMove(fighter) && !fighter.jump
}

function interruptJump(fighter: Fighter) {
  const jump = fighter.jump
  if (!jump) return
  const profile = JUMP_PROFILES[jump.motion]
  if (jump.elapsed <= profile.takeoff || jump.elapsed >= profile.landing) {
    fighter.jump = undefined
    fighter.position = Vector3.create(fighter.position.x, COURTYARD.characterFloorY, fighter.position.z)
  } else {
    // A hit replaces the jump animation, but flight still finishes at the floor.
    jump.interrupted = true
  }
}

function advanceJump(fighter: Fighter, dt: number) {
  if (!fighter.jump) return
  fighter.jump.elapsed += dt
  const profile = JUMP_PROFILES[fighter.jump.motion]
  // These clips keep the root stationary. Only the airborne interval raises the
  // fighter root; authored crouch, knee tuck and landing remain in the skeleton.
  const progress = Math.max(0, Math.min(1,
    (fighter.jump.elapsed - profile.takeoff) / (profile.landing - profile.takeoff)))
  const height = 4 * JUMP_HEIGHT * progress * (1 - progress)
  fighter.position = Vector3.create(fighter.position.x, COURTYARD.characterFloorY + height, fighter.position.z)
  const end = fighter.jump.interrupted ? profile.landing : profile.duration
  if (fighter.jump.elapsed >= end) fighter.jump = undefined
}

function refreshMotion(fighter: Fighter) {
  if (fighter.health <= 0 || fighter.swing || fighter.stagger > 0) return
  // Let the one-shot complete, including its landing. A hit may interrupt its
  // pose; never replay a jump from frame zero while its flight is in progress.
  if (fighter.jump) return
  playMotion(fighter, fighter.blocking ? 'block' : fighter.moving ? fighter.locomotion : 'combat_idle')
}

function playMotion(fighter: Fighter, motion: EquipmentMotion, reset = false) {
  if (fighter.motion === motion && !reset) return
  fighter.motion = motion
  setEquipmentMotion(fighter.root, motion, reset)
}

function faceOpponent(fighter: Fighter, opponent: Fighter) {
  const x = opponent.position.x - fighter.position.x
  const z = opponent.position.z - fighter.position.z
  if (x * x + z * z > 0.0001) fighter.facing = Math.atan2(x, z)
}

function moveFighter(fighter: Fighter, x: number, z: number) {
  fighter.position = Vector3.create(
    Math.max(ARENA_MIN, Math.min(ARENA_MAX, fighter.position.x + x)),
    fighter.position.y,
    Math.max(ARENA_MIN, Math.min(ARENA_MAX, fighter.position.z + z))
  )
}

function separateFighters(first: Fighter, second: Fighter) {
  for (let pass = 0; pass < 2; pass++) {
    const distance = combatDistance(first, second)
    if (distance >= COMBAT_RULES.bodySeparation) return
    const directionX = distance > 0.0001 ? (second.position.x - first.position.x) / distance : 1
    const directionZ = distance > 0.0001 ? (second.position.z - first.position.z) / distance : 0
    const push = (COMBAT_RULES.bodySeparation - distance) * 0.5
    moveFighter(first, -directionX * push, -directionZ * push)
    moveFighter(second, directionX * push, directionZ * push)
  }
}

function syncTransform(fighter: Fighter) {
  const transform = Transform.getMutable(fighter.root)
  transform.position = { ...fighter.position }
  transform.rotation = Quaternion.fromEulerDegrees(0, fighter.facing * 180 / Math.PI, 0)
}

function syncState() {
  if (!player || !rival) return
  state.playerHealth = player.health
  state.rivalHealth = rival.health
  state.playerBlocking = player.blocking
  state.playerJumping = !!player.jump
  state.rivalBlocking = rival.blocking
  state.playerAction = actionLabel(player)
  state.rivalAction = actionLabel(rival)
}

function actionLabel(fighter: Fighter) {
  if (fighter.health <= 0) return 'Down'
  if (fighter.stagger > 0) return 'Staggered'
  if (fighter.swing) return fighter.swing.motion === 'attack_heavy' ? 'Heavy strike' : 'Light strike'
  if (fighter.jump) return 'Jumping'
  if (fighter.blocking) return 'Blocking'
  if (fighter === rival && rivalBrain.mode === 'telegraph') return 'Winding up'
  if (fighter.moving) return 'Moving'
  return 'Ready'
}

function showNotice(notice: string, seconds: number) {
  state.notice = notice
  noticeRemaining = seconds
}

function createArenaPresentation() {
  for (const line of [
    { x: 20.5, z: ARENA_MIN, width: 11, depth: 0.035 },
    { x: 20.5, z: ARENA_MAX, width: 11, depth: 0.035 },
    { x: ARENA_MIN, z: 20.5, width: 0.035, depth: 11 },
    { x: ARENA_MAX, z: 20.5, width: 0.035, depth: 11 }
  ]) {
    const entity = engine.addEntity()
    arenaEntities.push(entity)
    Transform.create(entity, {
      position: Vector3.create(line.x, COURTYARD.characterFloorY + 0.015, line.z),
      scale: Vector3.create(line.width, 0.015, line.depth)
    })
    MeshRenderer.setBox(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(0.18, 0.65, 0.56, 1),
      emissiveColor: Color3.create(0.18, 0.65, 0.56), emissiveIntensity: 1.2,
      roughness: 0.6, metallic: 0
    })
  }
  for (const x of [17, 24]) {
    const entity = engine.addEntity()
    arenaEntities.push(entity)
    Transform.create(entity, { position: Vector3.create(x, 5, 18) })
    LightSource.create(entity, {
      type: LightSource.Type.Point({}), color: Color3.create(1, 0.9, 0.8), intensity: 950, range: 12
    })
  }
}
