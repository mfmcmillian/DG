// Client side of the saved hero. On joining, asks the host for what is saved
// under this wallet and, if there is a hero, commits its look, gear, coins and
// unlocks so the title can offer "Continue". Afterwards, whenever any of those
// change, the hero is written back (throttled).

import { engine } from '@dcl/sdk/ecs'
import { getCommittedAppearance, normalizeAppearance, setCommittedAppearance } from './appearance'
import { adoptSavedCharacter, CHARACTERS, getEquippedCharacter, getPickerState } from './characterPicker'
import { EQUIPMENT_SLOTS, EquipmentLoadout } from './equipmentCatalog'
import { getCommittedLoadout, setCommittedLoadout } from './equipmentState'
import { getUnlockedItems, unlockInventoryItem } from './inventory'
import { getLootState, setCoins } from './loot'
import { isClientSynced, localAddress } from './multiplayer'
import { onNet, sendNet } from './net'
import { setProgress } from './party'
import { requestHeroPreload } from './preloadPlan'
import { loadSettings, serializeSettings } from './settings'

type SaveState = {
  /** The host answered our load request. */
  loaded: boolean
  /** A hero was saved for this wallet. */
  found: boolean
  cid: string
  /** Seconds since the load was requested (for the title's "checking" line). */
  waited: number
}

const state: SaveState = { loaded: false, found: false, cid: '', waited: 0 }
/** Coins alone are written this often at most; anything else goes out within a second. */
const COIN_SAVE_SECONDS = 10
const SAVE_SECONDS = 1

let requested = false
let lastSaved = ''
let lastSavedCoins = -1
let sinceSave = 0
let initialized = false

export function initializeHeroSave() {
  if (initialized) return
  initialized = true
  onNet('savedHero', (msg) => {
    if (msg.id.toLowerCase() !== localAddress()) return
    state.loaded = true
    state.found = msg.found && CHARACTERS.some((c) => c.id === msg.cid)
    setProgress(msg.progress)
    if (!state.found) return
    // A champion made this session while the answer was on its way is the
    // player's choice: it replaces the save (the writer below sends it), and
    // only the level progress, which belongs to the wallet, is taken up.
    if (getPickerState().hasCreatedCharacter) {
      state.found = false
      return
    }
    state.cid = msg.cid
    setCommittedAppearance(msg.cid, normalizeAppearance({
      bodyType: msg.body === 'female' ? 'female' : 'male', hairStyle: msg.hair, hairColor: msg.hc, skinTone: msg.skin
    }))
    const loadout = parseLoadout(msg.loadout)
    if (loadout) setCommittedLoadout(msg.cid, loadout)
    // The title's Continue waits on this outfit; fetch it ahead of the queue.
    requestHeroPreload(msg.cid, getCommittedLoadout(msg.cid), true)
    for (const id of msg.unlocks) unlockInventoryItem(id)
    setCoins(msg.coins)
    loadSettings(msg.prefs)
    // What came back is what is stored; do not write it straight back.
    lastSaved = fingerprint(msg.cid)
    lastSavedCoins = msg.coins
    console.log(`[DG] saved hero found: ${msg.cid}, ${msg.coins} coins, ${msg.unlocks.length} unlock(s)`)
  })
  engine.addSystem(update)
}

export function getHeroSaveState(): Readonly<SaveState> {
  return state
}

/** Title: pick the saved hero back up and stand it in the hub. */
export function continueSavedHero(): boolean {
  if (!state.found) return false
  return adoptSavedCharacter(state.cid)
}

/** The title is still waiting to hear whether this wallet has a champion. */
export function isHeroSavePending(): boolean {
  return !state.loaded && state.waited < 12
}

export function savedHeroName(): string {
  return CHARACTERS.find((c) => c.id === state.cid)?.name ?? ''
}

function parseLoadout(json: string): EquipmentLoadout | undefined {
  if (!json) return undefined
  try {
    const value = JSON.parse(json) as Partial<EquipmentLoadout>
    if (!value || typeof value !== 'object') return undefined
    return value as EquipmentLoadout
  } catch {
    return undefined
  }
}

function fingerprint(cid: string): string {
  const a = getCommittedAppearance(cid)
  const l = getCommittedLoadout(cid)
  return [cid, a.bodyType, a.hairStyle, a.hairColor, a.skinTone, ...EQUIPMENT_SLOTS.map((s) => l[s.id]), ...getUnlockedItems(), serializeSettings()].join('|')
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  if (!state.loaded) state.waited += span
  if (!isClientSynced()) return
  if (!requested) {
    requested = true
    sendNet('loadHero', { v: 1 })
  }
  if (!getPickerState().hasCreatedCharacter) return
  sinceSave += span
  const cid = getEquippedCharacter().id
  const now = fingerprint(cid)
  const coins = getLootState().coins
  const heroChanged = now !== lastSaved
  const coinsChanged = coins !== lastSavedCoins
  if (!heroChanged && !coinsChanged) return
  if (heroChanged ? sinceSave < SAVE_SECONDS : sinceSave < COIN_SAVE_SECONDS) return
  const a = getCommittedAppearance(cid)
  sendNet('saveHero', {
    cid, body: a.bodyType, hair: a.hairStyle, hc: a.hairColor, skin: a.skinTone,
    loadout: JSON.stringify(getCommittedLoadout(cid)), coins, unlocks: getUnlockedItems(), prefs: serializeSettings()
  })
  lastSaved = now
  lastSavedCoins = coins
  sinceSave = 0
}

/** Send the hero immediately (developer toggle, so the host sees `dev: 1` before the next party create). */
export function flushHeroSave() {
  if (!isClientSynced() || !getPickerState().hasCreatedCharacter) return
  const cid = getEquippedCharacter().id
  const a = getCommittedAppearance(cid)
  const coins = getLootState().coins
  sendNet('saveHero', {
    cid, body: a.bodyType, hair: a.hairStyle, hc: a.hairColor, skin: a.skinTone,
    loadout: JSON.stringify(getCommittedLoadout(cid)), coins, unlocks: getUnlockedItems(), prefs: serializeSettings()
  })
  lastSaved = fingerprint(cid)
  lastSavedCoins = coins
  sinceSave = 0
}
