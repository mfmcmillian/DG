import { engine, executeTask, InputModifier, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { closePicker, openPicker } from './characterPicker'
import { COURTYARD } from './courtyard'
import { DEFAULT_LOADOUTS, EquipmentLoadout } from './equipmentCatalog'
import { closeTalk } from './hallTalk'
import { suppressTrainingSquire } from './hallFolk'
import { setHallPromptSuppressed } from './hallPrompt'
import {
  continueSavedHero, getHeroSaveState, persistTutorialComplete, tutorialIsComplete, tutorialStatusLoaded
} from './heroSave'
import { markHintSeen } from './hints'
import {
  disposePlayerCharacter, getPlayerVitals, setPlayerCharacter, setPlayerCharacterPublishing
} from './playerCharacter'
import { preparePlayerForCameraReturn } from './playerPlacement'
import { closeTitleForTutorial, isSavedHeroReady, isTitleOpen, titleBegin, titleResumeSaved } from './titleScreen'
import { onTrainingHit, TrainingHit } from './trainingDummies'

export type TutorialPhase =
  | 'idle' | 'starting' | 'move' | 'face' | 'light' | 'heavy' | 'guard' | 'dodge' | 'bow' | 'ranged' | 'complete'

export type TutorialView = {
  phase: TutorialPhase
  title: string
  instruction: string
  desktop: string
  touch: string
  progress: number
  goal: number
  feedback: string
}

const START = Vector3.create(60.5, COURTYARD.characterFloorY, 54.5)
const MELEE_TARGET = Vector3.create(60.5, COURTYARD.characterFloorY, 47)
/** Start across the yard, not already on the lesson's dummy: facing must be an intentional input. */
const START_CAMERA_TARGET = Vector3.create(65, COURTYARD.characterFloorY + 1.2, 53)
const RECRUIT_APPEARANCE = { bodyType: 'male' as const, hairStyle: 'short', hairColor: 'brown', skinTone: 'warm' }
const SWORD_LOADOUT: EquipmentLoadout = { ...DEFAULT_LOADOUTS.vanguard }
/** Scout class supplies bow combat while the armor remains the same neutral recruit kit. */
const BOW_LOADOUT: EquipmentLoadout = { ...SWORD_LOADOUT, weapon: DEFAULT_LOADOUTS.scout.weapon }

let phase: TutorialPhase = 'idle'
let phaseAge = 0
let feedback = ''
let feedbackLeft = 0
let baseline: Vector3 | undefined
let lightHits = 0
let guardHeld = 0
let initialized = false
let playNudge = false
let pendingTitleRoute = false
let startAttempt = 0

const COPY: Record<Exclude<TutorialPhase, 'idle'>, Omit<TutorialView, 'phase' | 'progress' | 'goal' | 'feedback'>> = {
  starting: { title: 'Training yard', instruction: 'Preparing your recruit…', desktop: '', touch: '' },
  move: { title: 'Move', instruction: 'Move around the yard.', desktop: 'Use WASD to move', touch: 'Use the movement stick to move' },
  face: { title: 'Face the dummy', instruction: 'Turn toward the dummy ahead.', desktop: 'Move the mouse to turn', touch: 'Drag the screen to turn toward the dummy' },
  light: { title: 'Light attack', instruction: 'Land two quick attacks.', desktop: 'Press E or left-click to light attack', touch: 'Tap E / LIGHT twice' },
  heavy: { title: 'Heavy attack', instruction: 'Land one heavy attack.', desktop: 'Press F to heavy attack', touch: 'Tap F / HEAVY' },
  guard: { title: 'Guard', instruction: 'Hold guard for a moment.', desktop: 'Hold Space to guard', touch: 'Hold GUARD' },
  dodge: { title: 'Dodge', instruction: 'Move and dodge.', desktop: 'Move with WASD and press Ctrl to dodge', touch: 'Move with the joystick and tap DODGE' },
  bow: { title: 'Ranged weapon', instruction: 'Equip the recruit’s training bow.', desktop: 'Equip Bow', touch: 'Equip Bow' },
  ranged: { title: 'Take aim', instruction: 'Hit a round target on the wall.', desktop: 'Face a target, then press E or left-click to fire', touch: 'Face a target, then tap E / LIGHT to fire' },
  complete: { title: 'Training complete', instruction: 'Your champion is ready for the Hall.', desktop: '', touch: '' }
}

export function initializeTutorial() {
  if (initialized) return
  initialized = true
  onTrainingHit(noteHit)
  engine.addSystem(update)
}

export function tutorialOfferRequired(): boolean {
  return isTitleOpen() && tutorialStatusLoaded() && !tutorialIsComplete() && phase === 'idle'
}

export function tutorialActive(): boolean {
  return phase !== 'idle'
}

export function tutorialView(): TutorialView | undefined {
  if (phase === 'idle') return undefined
  const copy = COPY[phase]
  return {
    phase, ...copy, progress: phase === 'light' ? lightHits : 0, goal: phase === 'light' ? 2 : 0,
    feedback: feedbackLeft > 0 ? feedback : ''
  }
}

export function tutorialPlayNudge(): boolean {
  return playNudge
}

export function clearTutorialPlayNudge() {
  playNudge = false
}

export function startTutorial() {
  if (!tutorialOfferRequired()) return
  const attempt = ++startAttempt
  phase = 'starting'
  phaseAge = 0
  executeTask(async () => {
    try {
      closePicker()
      closeTalk()
      await preparePlayerForCameraReturn(START, START_CAMERA_TARGET)
      if (attempt !== startAttempt || phase !== 'starting') return
      suppressTrainingSquire(true)
      setHallPromptSuppressed(true)
      setPlayerCharacterPublishing(false)
      setPlayerCharacter('vanguard', SWORD_LOADOUT, { appearance: RECRUIT_APPEARANCE, preloadWeapons: [BOW_LOADOUT.weapon] })
      if (!closeTitleForTutorial()) throw new Error('The title could not hand control to training')
      releaseMenuInputLock()
      baseline = playerPosition()
      enter('move')
    } catch (error) {
      console.log('[DG] tutorial start failed', error)
      cleanupRecruit()
      phase = 'idle'
    }
  })
}

/** Available both on the title offer and throughout the active lesson. */
export function skipTutorial() {
  if (!tutorialOfferRequired() && !tutorialActive()) return
  const skippedWhileTitleHeld = tutorialOfferRequired() || phase === 'starting'
  startAttempt++
  const wasActive = tutorialActive()
  persistTutorialComplete()
  markHintSeen('yard')
  if (skippedWhileTitleHeld) {
    cleanupRecruit()
    phase = 'idle'
    routeFromTitle()
    return
  }
  if (wasActive) {
    cleanupRecruit()
    routeAfterTraining()
  } else {
    routeFromTitle()
  }
}

function routeFromTitle() {
  playNudge = true
  if (getHeroSaveState().found) {
    pendingTitleRoute = true
    if (isSavedHeroReady()) {
      pendingTitleRoute = false
      titleResumeSaved()
    }
  } else titleBegin()
}

export function equipTutorialBow() {
  if (phase !== 'bow') return
  setPlayerCharacter('scout', BOW_LOADOUT, { appearance: RECRUIT_APPEARANCE })
  succeed('Bow equipped')
  enter('ranged')
}

function enter(next: TutorialPhase) {
  phase = next
  phaseAge = 0
  guardHeld = 0
  if (next === 'move') baseline = playerPosition()
}

function succeed(message: string) {
  feedback = message
  feedbackLeft = 1.1
}

function playerPosition(): Vector3 | undefined {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  return p ? Vector3.create(p.x, p.y, p.z) : undefined
}

function noteHit(hit: TrainingHit) {
  const melee = hit.tag === 'dummy-0' || hit.tag === 'dummy-1' || hit.tag === 'dummy-2'
  if (phase === 'light' && melee && !hit.heavy) {
    lightHits = Math.min(2, lightHits + 1)
    succeed(lightHits >= 2 ? 'Light attacks complete' : 'Good hit')
    if (lightHits >= 2) enter('heavy')
  } else if (phase === 'heavy' && melee && hit.heavy) {
    succeed('Heavy attack complete')
    enter('guard')
  } else if (phase === 'ranged' && (hit.tag === 'dummy-3' || hit.tag === 'dummy-4')) {
    // A wall-target collision is the facing/aim proof: the bow projectile only
    // reaches one when the player's camera-directed shot is on it.
    succeed('Bullseye')
    enter('complete')
    persistTutorialComplete()
    markHintSeen('yard')
  }
}

function angularDistance(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}

function update(dt: number) {
  if (pendingTitleRoute && isTitleOpen() && isSavedHeroReady()) {
    pendingTitleRoute = false
    titleResumeSaved()
  }
  if (phase === 'idle' || phase === 'starting') return
  releaseMenuInputLock()
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  phaseAge += span
  feedbackLeft = Math.max(0, feedbackLeft - span)
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (phase === 'move' && p && baseline && Math.hypot(p.position.x - baseline.x, p.position.z - baseline.z) >= 1.25) {
    succeed('Movement complete')
    enter('face')
  } else if (phase === 'face' && p) {
    const yaw = Quaternion.toEulerAngles(p.rotation).y * Math.PI / 180
    const wanted = Math.atan2(MELEE_TARGET.x - p.position.x, MELEE_TARGET.z - p.position.z)
    if (angularDistance(yaw, wanted) < Math.PI / 5) {
      succeed('Target found')
      lightHits = 0
      enter('light')
    }
  } else if (phase === 'guard') {
    guardHeld = getPlayerVitals().blocking ? guardHeld + span : 0
    if (guardHeld >= 0.45) {
      succeed('Guard complete')
      enter('dodge')
    }
  } else if (phase === 'dodge' && getPlayerVitals().dodging) {
    succeed('Dodge complete')
    enter('bow')
  } else if (phase === 'complete' && phaseAge >= 1.8) {
    cleanupRecruit()
    routeAfterTraining()
  }
}

/** A title/menu lock must never survive the camera handoff into interactive training. */
function releaseMenuInputLock() {
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
}

function cleanupRecruit() {
  suppressTrainingSquire(false)
  setHallPromptSuppressed(false)
  disposePlayerCharacter()
  setPlayerCharacterPublishing(true)
  closeTalk()
}

function routeAfterTraining() {
  phase = 'idle'
  playNudge = true
  if (getHeroSaveState().found) {
    if (!continueSavedHero()) openPicker()
  } else {
    openPicker()
  }
}
