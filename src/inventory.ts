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
  isItemCommitted,
  setCommittedLoadout
} from './equipmentState'
import { classAllowsArmor, classAllowsWeapon, HERO_CLASSES } from './heroClasses'
import { isGearNew, markGearSeen } from './newGear'
import { setLegendaryAura } from './legendaryAura'
import { legendaryPieces } from './weapons'
import { addGear, bagRow, bagRowsOf, clearBag, ownsGear, setActiveGear, setGearProbes } from './shared/gearBag'

export type InventoryFilter = 'all' | 'other' | EquipmentSlot

/**
 * One card in the backpack: a copy the hero owns, or the free copy of a
 * starter piece (`virtual`, not in the bag, shown until a real one is found).
 */
export type InventoryEntry = { uid: string; item: EquipmentItem; rank: number; level: number; affix: number; virtual: boolean }

export interface InventoryState {
  open: boolean
  characterId: string
  selectedSlot: EquipmentSlot
  selectedItemId: string
  /** The copy the selected card stands for ('s:<item>' for a starter's free copy). */
  selectedUid: string
  filter: InventoryFilter
  page: number
  loading: 'loading' | 'ready' | 'error'
}

const state: InventoryState = {
  open: false,
  characterId: 'vanguard',
  selectedSlot: 'chest',
  selectedItemId: '',
  selectedUid: '',
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
  setGearProbes((id) => (getEquipmentItemOrNull(id)?.slot === 'weapon' ? 'weapon' : 'armor'), isItemCommitted)
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
// armor piece but the starter outfit every new hero wears (DEFAULT_LOADOUTS):
// a set's pieces drop in its realm. What is owned lives in the bag
// (src/shared/gearBag.ts), one row per copy; a starter has a free copy besides.
export const STARTER_WEAPON = HERO_CLASSES.blade.starterWeapon
const STARTER_WEAPONS = new Set<string>(Object.values(HERO_CLASSES).map((c) => c.starterWeapon))
const STARTER_ARMOR = new Set<string>(Object.values(DEFAULT_LOADOUTS).flatMap((l) => EQUIPMENT_SLOTS.filter((s) => s.id !== 'weapon').map((s) => l[s.id])))
const GATED_ITEMS = EQUIPMENT_ITEMS.filter((item) => item.weapon ? !STARTER_WEAPONS.has(item.id) : !!item.realm && !STARTER_ARMOR.has(item.id)).map((item) => item.id)
const GATED = new Set<string>(GATED_ITEMS)

/** The uid a starter's free copy goes by in the backpack. */
export const FREE_COPY = 's:'

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

/** A slot that holds gear the hero has not earned (a save from before armor was, or a copy since sold) goes back to the class default. */
export function enforceOwnedLoadout(characterId: string): boolean {
  const committed = readCommittedLoadout(characterId)
  const defaults = DEFAULT_LOADOUTS[characterId] ?? DEFAULT_LOADOUTS.vanguard
  let changed = false
  for (const slot of EQUIPMENT_SLOTS) {
    if (isInventoryItemLocked(committed[slot.id])) {
      committed[slot.id] = defaults[slot.id]
      changed = true
    }
  }
  if (changed) setCommittedLoadout(characterId, committed)
  return changed
}

/** Gear that must be earned and has not been: no copy in the bag. */
export function isInventoryItemLocked(id: string): boolean {
  return GATED.has(id) && !ownsGear(id)
}

/** Developer: hand over one copy of every loot weapon and armor piece so they can be inspected on the hero. Saved with the hero like any find. */
export function unlockAllWeapons(): number {
  let granted = 0
  for (const id of GATED_ITEMS) if (!ownsGear(id) && addGear(id, 0, 1, `d-${id}`, true)) granted++
  return granted
}

/** Developer: back to the starter gear only. The bag is emptied; anything worn from it comes off. */
export function relockAllWeapons() {
  clearBag()
  const character = getEquippedCharacter()
  if (enforceOwnedLoadout(character.id)) onApply(character)
}

/** Gated items the hero owns at least one copy of. */
export function getUnlockedItems(): string[] {
  return GATED_ITEMS.filter((id) => ownsGear(id))
}

/** Weapons this hero can equip right now: the class starter plus everything looted for the class. */
export function ownedWeaponIds(characterId: string = getEquippedCharacter().id): string[] {
  return EQUIPMENT_ITEMS.filter((item) => item.slot === 'weapon' && !isInventoryItemLocked(item.id) && usableByHero(item, characterId)).map((item) => item.id)
}

/** Armor this hero owns: the starter outfit and every piece the dungeons handed over (empty slots excluded). */
export function ownedArmorIds(): string[] {
  return EQUIPMENT_ITEMS.filter((item) => !item.weapon && item.slot !== 'weapon' && !!item.set && !isInventoryItemLocked(item.id)).map((item) => item.id)
}

/** The cards for one catalog item: its free copy when it is a starter the hero owns no copy of, then every copy in the bag. */
function entriesFor(item: EquipmentItem): InventoryEntry[] {
  const rows = bagRowsOf(item.id)
  const out: InventoryEntry[] = []
  if (!GATED.has(item.id) && !rows.length) out.push({ uid: FREE_COPY + item.id, item, rank: 0, level: 1, affix: 0, virtual: true })
  for (const row of rows) out.push({ uid: row.uid, item, rank: row.rank, level: row.level, affix: row.affix, virtual: false })
  return out
}

/** The card `uid` stands for, if the hero still has it. */
export function inventoryEntry(uid: string): InventoryEntry | undefined {
  if (uid.startsWith(FREE_COPY)) {
    const item = getEquipmentItemOrNull(uid.slice(FREE_COPY.length))
    return item && !GATED.has(item.id) ? { uid, item, rank: 0, level: 1, affix: 0, virtual: true } : undefined
  }
  const row = bagRow(uid)
  const item = row ? getEquipmentItemOrNull(row.item) : undefined
  return row && item ? { uid, item, rank: row.rank, level: row.level, affix: row.affix, virtual: false } : undefined
}

/** The backpack: every copy the hero owns that its class can use, under the current filter. */
export function getInventoryItems(): InventoryEntry[] {
  return filtered(wardrobe()).flatMap(entriesFor)
}

/** Owned gear not yet looked at, whatever the filter (the backpack's NEW tags and tab dots). */
export function getInventoryNewItems(): InventoryEntry[] {
  return wardrobe().flatMap(entriesFor).filter((entry) => isGearNew(entry.uid))
}

/** Everything the class could ever own under the current filter, for the "N of M found" count. */
export function getInventoryTotalCount(): number {
  return filtered(wardrobe()).length
}

/** How many different items of the class's gear the hero has found (the starters count). */
export function getInventoryFoundCount(): number {
  return filtered(wardrobe()).filter((item) => !isInventoryItemLocked(item.id)).length
}

/** The class's gear, the empty slots left out: taking a piece off is the detail panel's Unequip, not a card. */
function wardrobe(): EquipmentItem[] {
  const characterId = getInventoryCharacter().id
  return EQUIPMENT_ITEMS.filter((item) => usableByHero(item, characterId) && item.id !== getUnequippedItem(item.slot).id)
}

function filtered(items: EquipmentItem[]): EquipmentItem[] {
  if (state.filter === 'all') return items
  if (state.filter === 'other') return items.filter((item) => item.slot !== 'head' && item.slot !== 'chest' && item.slot !== 'weapon')
  return items.filter((item) => item.slot === state.filter)
}

/** The copy of an item the hero uses, as a card uid: the active row, or the free copy. */
function activeUidOf(itemId: string): string {
  return bagRowsOf(itemId)[0]?.uid ?? FREE_COPY + itemId
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
  state.selectedUid = activeUidOf(state.selectedItemId)
  equipmentWasApplied = false
  pendingUnequip = undefined
  facing = MENU_PREVIEW_FACING
  generation++

  // Something new in the bag: open on its page so it is not missed.
  const firstNew = getInventoryItems().findIndex((entry) => isGearNew(entry.uid))
  if (firstNew >= 0) state.page = Math.floor(firstNew / PAGE_SIZE)

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
  state.selectedUid = activeUidOf(state.selectedItemId)
  state.filter = slot
  state.page = 0
  revertInventoryPreview()
}

/**
 * Pick a card. A copy of the item already on the hero needs no preview: it
 * becomes the copy in use there and then (same look, its own rarity and
 * level). Anything else is tried on first.
 */
export function selectInventoryItem(uid: string) {
  if (!state.open) return
  const entry = inventoryEntry(uid)
  if (!entry) return
  markGearSeen(uid)
  const item = entry.item
  state.selectedSlot = item.slot
  state.selectedItemId = item.id
  state.selectedUid = uid
  const committed = getCommittedLoadout()
  if (committed[item.slot] === item.id && !getInventoryIsDirty()) {
    if (!entry.virtual && setActiveGear(uid)) {
      equipmentWasApplied = true
      if (committedPreview !== undefined) previewAura(committedPreview, committed)
    }
    return
  }
  const next = { ...committed }
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
  if (!item || previewLoadout?.[item.slot] !== item.id || isInventoryItemLocked(item.id)) return
  const readyPreview = candidatePreview ?? committedPreview
  if (readyPreview === undefined || getEquipmentLoading(readyPreview) !== 'ready') return
  if (candidatePreview === undefined && item.slot !== 'weapon') return

  const committed = getCommittedLoadout()
  committed[item.slot] = item.id
  setCommittedLoadout(state.characterId, committed)
  // The card picked is the copy that goes on.
  if (!state.selectedUid.startsWith(FREE_COPY) && bagRow(state.selectedUid)?.item === item.id) setActiveGear(state.selectedUid)
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
  state.selectedUid = FREE_COPY + item.id
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
  state.selectedUid = activeUidOf(state.selectedItemId)
  if (committedPreview === undefined || getEquipmentLoading(committedPreview) === 'error') {
    removePreview(committedPreview)
    committedPreview = createPreview(previewLoadout)
  } else {
    setEquipmentPreviewWeapon(committedPreview, previewLoadout.weapon)
    previewAura(committedPreview, previewLoadout)
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
    } else {
      previewAura(committedPreview, previewLoadout)
    }
    state.loading = getEquipmentLoading(committedPreview)
    showPreview(committedPreview, state.loading === 'ready')
  } else {
    if (committedPreview !== undefined) {
      setEquipmentPreviewWeapon(committedPreview, committed.weapon)
      previewAura(committedPreview, committed)
    }
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
  previewAura(root, loadout)
  // Show the outfit in a relaxed standing pose, including the matching sword clip.
  setEquipmentMotion(root, 'idle')
  showPreview(root, false)
  return root
}

/** The legendary aura on a preview, as this hero's copies of the outfit shown are. */
function previewAura(root: Entity, loadout: EquipmentLoadout) {
  const { weapon, pieces } = legendaryPieces(loadout)
  setLegendaryAura(root, weapon, pieces)
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
