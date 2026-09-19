import {
  engine,
  Entity,
  executeTask,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { openSceneCamera, closeSceneCamera, prepareSceneCameraReturn, SceneCameraSession } from './sceneCamera'
import {
  createMenuPreviewStage, destroyMenuPreviewStage, MENU_CAMERA_POSITION, MENU_CAMERA_TARGET,
  MENU_PREVIEW_FACING, MenuPreviewStage, updateMenuPreviewStage
} from './menuPreviewStage'
import { getCommittedLoadout, setCommittedLoadout } from './equipmentState'
import { CharacterAppearance, getCommittedAppearance, normalizeAppearance, setCommittedAppearance } from './appearance'
import {
  EQUIPMENT_CLIPS, destroyEquipmentAvatar, getEquipmentLoading,
  setEquipmentAvatar, setEquipmentMotion
} from './equipmentAvatar'

export type CharacterId = 'vanguard' | 'scout' | 'striker' | 'brute'
export type PreviewMotion = 'idle' | 'walk' | 'run'

export interface CharacterDefinition {
  id: CharacterId
  name: string
  role: string
  description: string
  model: string
  portrait: string
  clips?: Partial<Record<PreviewMotion, string>>
}

const SIDEKICK_CLIPS: Record<PreviewMotion, string> = EQUIPMENT_CLIPS

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: 'vanguard',
    name: 'Vanguard',
    role: 'Armored',
    description: 'Heavy plate. A steady presence. Meet the original Sidekick knight.',
    model: 'models/knight.glb',
    portrait: 'images/characters/vanguard-idle.png',
    clips: SIDEKICK_CLIPS
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'Utility',
    description: 'A fox mask, bright armor and an adventurous spirit. Always ready to explore.',
    model: 'models/characters/scout-animated.glb',
    portrait: 'images/characters/scout-idle.png',
    clips: SIDEKICK_CLIPS
  },
  {
    id: 'striker',
    name: 'Striker',
    role: 'Hybrid',
    description: 'A bold mix of armor and utility pieces. A little of everything, with attitude.',
    model: 'models/characters/striker-animated.glb',
    portrait: 'images/characters/striker-idle.png',
    clips: SIDEKICK_CLIPS
  },
  {
    id: 'brute',
    name: 'Brute',
    role: 'Wildcard',
    description: 'A grinning pumpkin mask and a playful, stripped-back outfit. Impossible to miss.',
    model: 'models/characters/brute-animated.glb',
    portrait: 'images/characters/brute-idle.png',
    clips: SIDEKICK_CLIPS
  }
]

export interface PickerState {
  open: boolean
  hasCreatedCharacter: boolean
  confirming: boolean
  confirmationError: string
  selectedId: CharacterId
  equippedId: CharacterId
  motion: PreviewMotion
  autoRotate: boolean
  loading: 'loading' | 'ready' | 'error'
}

const state: PickerState = {
  open: false,
  hasCreatedCharacter: false,
  confirming: false,
  confirmationError: '',
  selectedId: 'vanguard',
  equippedId: 'vanguard',
  motion: 'idle',
  autoRotate: false,
  loading: 'loading'
}

let initialized = false
let applySelection: (character: CharacterDefinition, previewRoot?: Entity) => boolean = () => false
let preview: Entity | undefined
let stage: MenuPreviewStage | undefined
let facing = MENU_PREVIEW_FACING
let cameraSession: SceneCameraSession | undefined
let creatorAppearance = getCommittedAppearance(state.selectedId)

export function getCreatorAppearance(): Readonly<CharacterAppearance> {
  return creatorAppearance
}

export function setCreatorAppearance(patch: Partial<CharacterAppearance>) {
  if (!state.open || state.confirming) return
  const next = normalizeAppearance({ ...creatorAppearance, ...patch })
  if (next.bodyType === creatorAppearance.bodyType && next.hairStyle === creatorAppearance.hairStyle &&
    next.hairColor === creatorAppearance.hairColor && next.skinTone === creatorAppearance.skinTone) return
  creatorAppearance = next
  replacePreview()
}

export function getPickerState(): Readonly<PickerState> {
  return state
}

export function getSelectedCharacter(): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === state.selectedId) ?? CHARACTERS[0]
}

export function getEquippedCharacter(): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === state.equippedId) ?? CHARACTERS[0]
}

export function initializeCharacterPicker(
  onConfirm: (character: CharacterDefinition, previewRoot?: Entity) => boolean
) {
  applySelection = onConfirm
  if (initialized) return
  initialized = true
  engine.addSystem(pickerSystem)
}

/**
 * Take up a hero that was saved earlier (appearance and loadout already
 * committed for `id`): the body is loaded fresh, no creator preview involved.
 */
export function adoptSavedCharacter(id: string): boolean {
  if (state.open || state.confirming) return false
  const character = CHARACTERS.find((entry) => entry.id === id)
  if (!character) return false
  if (!applySelection(character)) return false
  state.equippedId = character.id
  state.selectedId = character.id
  state.hasCreatedCharacter = true
  return true
}

export function openPicker() {
  if (!initialized || state.open) return
  const session = openSceneCamera('picker', MENU_CAMERA_POSITION, MENU_CAMERA_TARGET)
  if (!session) return
  cameraSession = session
  state.open = true
  state.confirmationError = ''
  state.selectedId = state.equippedId
  creatorAppearance = getCommittedAppearance(state.equippedId)
  state.motion = 'idle'
  state.autoRotate = false
  facing = MENU_PREVIEW_FACING

  stage = createMenuPreviewStage('picker')

  replacePreview()
}

/** Closing without confirmation discards the roster selection. */
export function closePicker() {
  if (!state.open || state.confirming) return
  state.selectedId = state.equippedId
  leavePicker()
}

export function selectCharacter(id: CharacterId) {
  if (!state.open || state.confirming || !CHARACTERS.some((character) => character.id === id)) return
  if (id === state.selectedId && state.loading !== 'error') return
  state.selectedId = id
  // Outfit selection keeps the user's angle and preview motion.
  replacePreview()
}

export function confirmCharacter() {
  if (!state.open || state.confirming || state.loading !== 'ready' || preview === undefined) return
  const selected = getSelectedCharacter()
  const source = preview
  const session = cameraSession
  state.confirming = true
  state.confirmationError = ''
  executeTask(async () => {
    try {
      await prepareSceneCameraReturn(session, !state.hasCreatedCharacter)
      const previousAppearance = getCommittedAppearance(selected.id)
      const previousLoadout = getCommittedLoadout(selected.id)
      setCommittedAppearance(selected.id, creatorAppearance)
      // Transfer the already-loaded preview instead of loading a second body.
      setCommittedLoadout(selected.id, { ...previousLoadout, head: 'none-head' })
      if (!applySelection(selected, source)) {
        setCommittedAppearance(selected.id, previousAppearance)
        setCommittedLoadout(selected.id, previousLoadout)
        throw new Error('The ready character could not be transferred')
      }
      state.equippedId = selected.id
      state.hasCreatedCharacter = true
      leavePicker()
    } catch (error) {
      console.log('Character creation handoff failed', error)
      state.confirmationError = 'Could not enter the dungeon. Please try again.'
    } finally {
      state.confirming = false
    }
  })
}

export function rotatePreview(delta: number) {
  if (!state.open || state.confirming || !Number.isFinite(delta)) return
  facing = (facing + delta + 360) % 360
  if (preview !== undefined) {
    Transform.getMutable(preview).rotation = Quaternion.fromEulerDegrees(0, facing, 0)
  }
}

export function setPreviewMotion(motion: PreviewMotion) {
  if (!state.open || state.confirming || !getSelectedCharacter().clips?.[motion]) return
  state.motion = motion
  // The assembly loader keeps this motion for the incoming parts, too.
  playPreviewMotion()
}

export function toggleAutoRotate() {
  if (state.open && !state.confirming) state.autoRotate = !state.autoRotate
}

function playPreviewMotion() {
  if (preview === undefined) return
  setEquipmentMotion(preview, state.motion, true)
}

function replacePreview() {
  if (!stage) return
  const character = getSelectedCharacter()
  if (preview === undefined) {
    preview = engine.addEntity()
    Transform.create(preview, {
      parent: stage.anchor
    })
  }
  state.loading = 'loading'
  Transform.getMutable(preview).rotation = Quaternion.fromEulerDegrees(0, facing, 0)
  // Keep the preview root and current character until the replacement parts are
  // ready. Selecting a card does not rebuild or retarget the camera.
  const loadout = getCommittedLoadout(character.id)
  loadout.head = 'none-head'
  setEquipmentAvatar(preview, character.id, loadout, false, { appearance: creatorAppearance, presentation: 'menu' })
  setEquipmentMotion(preview, state.motion)
}

function leavePicker() {
  state.open = false
  state.autoRotate = false
  state.motion = 'idle'

  closeSceneCamera(cameraSession)
  cameraSession = undefined

  if (preview !== undefined) destroyEquipmentAvatar(preview)
  if (preview !== undefined) engine.removeEntity(preview)
  preview = undefined
  if (stage) destroyMenuPreviewStage(stage)
  stage = undefined
}

function pickerSystem(dt: number) {
  if (!state.open || preview === undefined) return
  if (stage) updateMenuPreviewStage(stage)
  state.loading = getEquipmentLoading(preview)

  if (state.autoRotate) rotatePreview(Math.min(dt, 0.1) * 24)
}
