import {
  engine,
  Entity,
  Transform
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { openSceneCamera, closeSceneCamera, SceneCameraSession } from './sceneCamera'
import {
  createMenuPreviewStage, destroyMenuPreviewStage, MENU_CAMERA_POSITION, MENU_CAMERA_TARGET,
  MENU_PREVIEW_FACING, MenuPreviewStage, updateMenuPreviewStage
} from './menuPreviewStage'
import {
  CHARACTERS,
  CharacterDefinition,
  closePicker,
  getPickerState,
  openPicker,
  getEquippedCharacter
} from './characterPicker'
import {
  DEFAULT_LOADOUTS,
  EQUIPMENT_ITEMS,
  EQUIPMENT_SLOTS,
  EquipmentItem,
  EquipmentLoadout,
  EquipmentSlot,
  getEquipmentItemOrNull,
  getUnequippedItem
} from './equipmentCatalog'
import {
  destroyEquipmentAvatar,
  getEquipmentLoading,
  setEquipmentAvatar,
  setEquipmentMotion,
  setEquipmentPreviewWeapon,
  setEquipmentVisible
} from './equipmentAvatar'
import {
  getCommittedLoadout as readCommittedLoadout,
  setCommittedLoadout
} from './equipmentState'
import { classAllowsArmor, classAllowsWeapon, HERO_CLASSES } from './heroClasses'

export type InventoryFilter = 'all' | 'other' | EquipmentSlot

export interface InventoryState {
  open: boolean
  characterId: string
  selectedSlot: EquipmentSlot
  selectedItemId: string
  filter: InventoryFilter
  page: number
  loading: 'loading' | 'ready' | 'error'
}

const state: InventoryState = {
  open: false,
  characterId: 'vanguard',
  selectedSlot: 'chest',
  selectedItemId: '',
  filter: 'all',
  page: 0,
  loading: 'loading'
}

const PAGE_SIZE = 12

let initialized = false
let onApply: (character: CharacterDefinition) => void = () => {}
let committedPreview: Entity | undefined
let candidatePreview: Entity | undefined
let previewLoadout: EquipmentLoadout | undefined
let facing = MENU_PREVIEW_FACING
let generation = 0
let pendingUnequip: { generation: number; slot: EquipmentSlot; itemId: string } | undefined
let equipmentWasApplied = false
let cameraSession: SceneCameraSession | undefined
let stage: MenuPreviewStage | undefined
const previewVisibility = new Map<Entity, boolean>()

export function initializeInventory(
  applyEquipment: (character: CharacterDefinition) => void
) {
  onApply = applyEquipment
  if (initialized) return
  initialized = true
  engine.addSystem(inventorySystem)
}

export function getInventoryState(): Readonly<InventoryState> {
  return state
}

export function getInventoryCharacter(): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === state.characterId) ?? getEquippedCharacter()
}

export function getCommittedLoadout(characterId = state.characterId): EquipmentLoadout {
  return readCommittedLoadout(characterId)
}

export function getPreviewLoadout(): EquipmentLoadout {
  return { ...(previewLoadout ?? getCommittedLoadout()) }
}

export function getInventoryIsDirty(): boolean {
  if (!state.open || !previewLoadout) return false
  const committed = getCommittedLoadout()
  return EQUIPMENT_SLOTS.some((slot) => previewLoadout![slot.id] !== committed[slot.id])
}

// Loot-gated gear: locked until the dungeon hands it over. Every loot weapon
// but the class starters (sword, axe, bow, staff) is earned, and so is every
// armor set but the class's own: a set's pieces drop in its realm.
export const STARTER_WEAPON = HERO_CLASSES.blade.starterWeapon
const STARTER_WEAPONS = new Set<string>(Object.values(HERO_CLASSES).map((c) => c.starterWeapon))
const GATED_ITEMS = EQUIPMENT_ITEMS.filter((item) => item.weapon ? !STARTER_WEAPONS.has(item.id) : !!item.realm).map((item) => item.id)
const lockedItems = new Set<string>(GATED_ITEMS)

/** Gear the hero's class can use: a weapon of its classes, armor cut for it (empty slots always pass). */
function usableByHero(item: EquipmentItem, characterId: string = getEquippedCharacter().id): boolean {
  if (item.weapon) return classAllowsWeapon(characterId, item.weapon.class)
  return classAllowsArmor(characterId, item.hero)
}

/** Whether this hero's class could ever wear or wield the item (locked or not). */
export function isUsableByHero(id: string, characterId: string = getEquippedCharacter().id): boolean {
  const item = getEquipmentItemOrNull(id)
  return !!item && usableByHero(item, characterId)
}

/** A slot that holds gear the hero has not earned (a save from before armor was) goes back to the class default. */
export function enforceOwnedLoadout(characterId: string): boolean {
  const committed = readCommittedLoadout(characterId)
  const defaults = DEFAULT_LOADOUTS[characterId] ?? DEFAULT_LOADOUTS.vanguard
  let changed = false
  for (const slot of EQUIPMENT_SLOTS) {
    if (lockedItems.has(committed[slot.id])) {
      committed[slot.id] = defaults[slot.id]
      changed = true
    }
  }
  if (changed) setCommittedLoadout(characterId, committed)
  return changed
}

export function isInventoryItemLocked(id: string): boolean {
  return lockedItems.has(id)
}

/** Returns true when the item was locked and is now available. */
export function unlockInventoryItem(id: string): boolean {
  return lockedItems.delete(id)
}

/** Developer: hand over every loot weapon and armor piece so they can be inspected on the hero. Saved with the hero like any unlock. */
export function unlockAllWeapons(): number {
  let granted = 0
  for (const id of GATED_ITEMS) if (lockedItems.delete(id)) granted++
  return granted
}

/** Developer: back to the starter gear only. Unequips anything that is no longer owned. */
export function relockAllWeapons() {
  for (const id of GATED_ITEMS) lockedItems.add(id)
  const character = getEquippedCharacter()
  if (enforceOwnedLoadout(character.id)) onApply(character)
}

/** Gated items the hero has earned; what a saved hero carries between sessions. */
export function getUnlockedItems(): string[] {
  return GATED_ITEMS.filter((id) => !lockedItems.has(id))
}

/** Weapons this hero can equip right now: the class starter plus everything looted for the class. */
export function ownedWeaponIds(characterId: string = getEquippedCharacter().id): string[] {
  return EQUIPMENT_ITEMS.filter((item) => item.slot === 'weapon' && !lockedItems.has(item.id) && usableByHero(item, characterId)).map((item) => item.id)
}

/**
 * The backpack: what the hero owns first, then the class's gear still to be
 * found (dimmed, with where it drops), so the wardrobe reads as something to
 * fill out. Locked pieces can be previewed but not equipped.
 */
/** The backpack shows what the hero owns: the class's gear that has been earned (or never needed earning). */
export function getInventoryItems(): EquipmentItem[] {
  return filtered(wardrobe().filter((item) => !lockedItems.has(item.id)))
}

/** Everything the class could ever own under the current filter, for the "N of M found" count. */
export function getInventoryTotalCount(): number {
  return filtered(wardrobe()).length
}

function wardrobe(): EquipmentItem[] {
  const characterId = getInventoryCharacter().id
  return EQUIPMENT_ITEMS.filter((item) => usableByHero(item, characterId))
}

function filtered(items: EquipmentItem[]): EquipmentItem[] {
  if (state.filter === 'all') return items
  if (state.filter === 'other') return items.filter((item) => item.slot !== 'head' && item.slot !== 'chest' && item.slot !== 'weapon')
  return items.filter((item) => item.slot === state.filter)
}

/** Runs once when the inventory closes (the lobby uses it to come back). */
let onCloseOnce: (() => void) | undefined

/** Returns true when the inventory is now open (the character creator may take over instead). */
export function openInventory(options: { onClose?: () => void } = {}): boolean {
  if (!initialized || state.open) return false
  if (!getPickerState().hasCreatedCharacter) {
    openPicker()
    return false
  }
  closePicker()
  const session = openSceneCamera('inventory', MENU_CAMERA_POSITION, MENU_CAMERA_TARGET)
  if (!session) return false
  cameraSession = session
  onCloseOnce = options.onClose
  state.open = true
  state.characterId = getEquippedCharacter().id
  state.selectedSlot = 'chest'
  state.filter = 'all'
  state.page = 0
  state.loading = 'loading'
  previewLoadout = getCommittedLoadout()
  state.selectedItemId = previewLoadout[state.selectedSlot]
  equipmentWasApplied = false
  pendingUnequip = undefined
  facing = MENU_PREVIEW_FACING
  generation++

  stage = createMenuPreviewStage('inventory')
  committedPreview = createPreview(getCommittedLoadout())
  return true
}

export function closeInventory() {
  if (!state.open) return
  state.open = false
  const after = onCloseOnce
  onCloseOnce = undefined
  pendingUnequip = undefined
  generation++

  closeSceneCamera(cameraSession)
  cameraSession = undefined

  // Apply the final committed outfit once when returning to the playable character.
  if (equipmentWasApplied) onApply(getInventoryCharacter())

  removePreview(candidatePreview)
  removePreview(committedPreview)
  candidatePreview = undefined
  committedPreview = undefined
  if (stage) destroyMenuPreviewStage(stage)
  stage = undefined
  previewVisibility.clear()
  previewLoadout = undefined
  after?.()
}

export function selectInventorySlot(slot: EquipmentSlot) {
  if (!state.open || !EQUIPMENT_SLOTS.some((entry) => entry.id === slot)) return
  state.selectedSlot = slot
  state.selectedItemId = getCommittedLoadout()[slot]
  state.filter = slot
  state.page = 0
  revertInventoryPreview()
}

export function selectInventoryItem(id: string) {
  if (!state.open) return
  const item = EQUIPMENT_ITEMS.find((entry) => entry.id === id)
  if (!item) return
  state.selectedSlot = item.slot
  state.selectedItemId = item.id
  const next = getCommittedLoadout()
  next[item.slot] = item.id
  replaceCandidate(next)
}

export function setInventoryFilter(filter: InventoryFilter) {
  if (!state.open) return
  if (filter !== 'all' && filter !== 'other' && !EQUIPMENT_SLOTS.some((slot) => slot.id === filter)) return
  state.filter = filter
  state.page = 0
}

export function setInventoryPage(page: number) {
  if (!state.open || !Number.isFinite(page)) return
  const lastPage = Math.max(0, Math.ceil(getInventoryItems().length / PAGE_SIZE) - 1)
  state.page = Math.max(0, Math.min(Math.floor(page), lastPage))
}

export function equipSelectedItem() {
  if (!state.open || state.loading !== 'ready' || !getInventoryIsDirty()) return
  const item = EQUIPMENT_ITEMS.find((entry) => entry.id === state.selectedItemId && entry.slot === state.selectedSlot)
  if (!item || previewLoadout?.[item.slot] !== item.id || lockedItems.has(item.id)) return
  const readyPreview = candidatePreview ?? committedPreview
  if (readyPreview === undefined || getEquipmentLoading(readyPreview) !== 'ready') return
  if (candidatePreview === undefined && item.slot !== 'weapon') return

  const committed = getCommittedLoadout()
  committed[item.slot] = item.id
  setCommittedLoadout(state.characterId, committed)
  previewLoadout = getCommittedLoadout()
  pendingUnequip = undefined
  equipmentWasApplied = true

  if (candidatePreview !== undefined) {
    removePreview(committedPreview)
    committedPreview = candidatePreview
    candidatePreview = undefined
  }
  showPreview(committedPreview, true)
}

export function unequipSelectedSlot() {
  if (!state.open) return
  const item = getUnequippedItem(state.selectedSlot)
  const next = getCommittedLoadout()
  next[state.selectedSlot] = item.id
  state.selectedItemId = item.id
  replaceCandidate(next, true)
}

export function revertInventoryPreview() {
  if (!state.open) return
  pendingUnequip = undefined
  generation++
  removePreview(candidatePreview)
  candidatePreview = undefined
  previewLoadout = getCommittedLoadout()
  state.selectedItemId = previewLoadout[state.selectedSlot]
  if (committedPreview === undefined || getEquipmentLoading(committedPreview) === 'error') {
    removePreview(committedPreview)
    committedPreview = createPreview(previewLoadout)
  } else {
    setEquipmentPreviewWeapon(committedPreview, previewLoadout.weapon)
  }
  state.loading = getEquipmentLoading(committedPreview)
  showPreview(committedPreview, state.loading === 'ready')
}

export function retryInventoryPreview() {
  if (!state.open) return
  if (!getInventoryIsDirty()) {
    removePreview(committedPreview)
    committedPreview = createPreview(getCommittedLoadout())
    state.loading = 'loading'
    return
  }
  const autoCommit = pendingUnequip?.generation === generation
  replaceCandidate(getPreviewLoadout(), autoCommit)
}

export function rotateInventoryPreview(delta: number) {
  if (!state.open || !Number.isFinite(delta)) return
  facing = (facing + delta + 360) % 360
  for (const root of [committedPreview, candidatePreview]) {
    if (root !== undefined) Transform.getMutable(root).rotation = Quaternion.fromEulerDegrees(0, facing, 0)
  }
}

function replaceCandidate(loadout: EquipmentLoadout, autoCommit = false) {
  generation++
  pendingUnequip = undefined
  removePreview(candidatePreview)
  candidatePreview = undefined
  previewLoadout = { ...loadout }
  if (!getInventoryIsDirty()) {
    revertInventoryPreview()
    return
  }

  const committed = getCommittedLoadout()
  const weaponOnly = EQUIPMENT_SLOTS.every((slot) =>
    slot.id === 'weapon' || previewLoadout![slot.id] === committed[slot.id]
  )
  if (weaponOnly) {
    // Keep the character and its body animation alive while changing only the cached sword.
    if (
      committedPreview === undefined ||
      getEquipmentLoading(committedPreview) === 'error' ||
      !setEquipmentPreviewWeapon(committedPreview, previewLoadout.weapon)
    ) {
      removePreview(committedPreview)
      committedPreview = createPreview(previewLoadout)
    }
    state.loading = getEquipmentLoading(committedPreview)
    showPreview(committedPreview, state.loading === 'ready')
  } else {
    if (committedPreview !== undefined) setEquipmentPreviewWeapon(committedPreview, committed.weapon)
    candidatePreview = createPreview(previewLoadout)
    state.loading = 'loading'
    showPreview(committedPreview, committedPreview !== undefined && getEquipmentLoading(committedPreview) === 'ready')
  }
  if (autoCommit) {
    pendingUnequip = { generation, slot: state.selectedSlot, itemId: state.selectedItemId }
  }
}

function createPreview(loadout: EquipmentLoadout): Entity {
  const root = engine.addEntity()
  Transform.create(root, {
    parent: stage!.anchor,
    rotation: Quaternion.fromEulerDegrees(0, facing, 0)
  })
  setEquipmentAvatar(root, state.characterId, loadout, false, { preloadWeapons: ownedWeaponIds(state.characterId), presentation: 'menu' })
  // Show the outfit in a relaxed standing pose, including the matching sword clip.
  setEquipmentMotion(root, 'idle')
  showPreview(root, false)
  return root
}

function showPreview(root: Entity | undefined, visible: boolean) {
  if (root === undefined || previewVisibility.get(root) === visible) return
  setEquipmentVisible(root, visible)
  previewVisibility.set(root, visible)
}

function removePreview(root: Entity | undefined) {
  if (root === undefined) return
  destroyEquipmentAvatar(root)
  engine.removeEntity(root)
  previewVisibility.delete(root)
}

function inventorySystem() {
  if (!state.open || committedPreview === undefined) return
  if (stage) updateMenuPreviewStage(stage)
  const committedReady = getEquipmentLoading(committedPreview) === 'ready'
  if (candidatePreview === undefined) {
    state.loading = getEquipmentLoading(committedPreview)
    showPreview(committedPreview, committedReady)
  } else {
    state.loading = getEquipmentLoading(candidatePreview)
    showPreview(candidatePreview, state.loading === 'ready')
    showPreview(committedPreview, state.loading !== 'ready' && committedReady)
  }
  if (
    state.loading === 'ready' &&
    pendingUnequip?.generation === generation &&
    pendingUnequip.slot === state.selectedSlot &&
    pendingUnequip.itemId === state.selectedItemId
  ) equipSelectedItem()
}
