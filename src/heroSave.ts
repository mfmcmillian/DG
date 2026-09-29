// Client side of the saved hero. On joining, asks the host for what is saved
// under this wallet and, if there is a hero, commits its look, gear, coins and
// unlocks so the title can offer "Continue". Afterwards, whenever any of those
// change, the hero is written back (throttled).

import { engine } from '@dcl/sdk/ecs'
import { getCommittedAppearance, normalizeAppearance, setCommittedAppearance } from './appearance'
import { adoptSavedCharacter, CHARACTERS, getEquippedCharacter, getPickerState } from './characterPicker'
import { EQUIPMENT_SLOTS, EquipmentLoadout, getEquipmentItemOrNull } from './equipmentCatalog'
import { getCommittedLoadout, setCommittedLoadout } from './equipmentState'
import { enforceOwnedLoadout, getUnlockedItems } from './inventory'
import { classOfCharacter } from './heroClasses'
import { getLootState, setCoins } from './loot'
import { isClientSynced, isSoloMode, localAddress } from './multiplayer'
import { onNet, sendNet } from './net'
import { setProgress } from './party'
import { requestHeroPreload, scheduleHeroPreload } from './preloadPlan'
import { loadSettings, serializeSettings } from './settings'
import { addGear, bagRevision, clearBag, convertLegacyBag, loadBag, serializeBag } from './shared/gearBag'
import { parsePrefs } from './shared/prefs'
import { printedRankOf } from './weapons'

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
/** The set each class started in before 2.8.0, by character id. */
const LEGACY_STARTERS: Record<string, string> = { scout: 'elf', striker: 'sorc', vanguard: 'paladin', brute: 'viking' }

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
    if (!state.found) {
      // No champion: the picker is next, and it shows every hero.
      scheduleHeroPreload()
      return
    }
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
    const prefs = parsePrefs(msg.prefs)
    if (prefs.bg) {
      loadBag(msg.bag)
    } else {
      // A save from before the bag (2.8.34 and earlier): one copy per unlocked
      // item, at the rarity and level `ups` gave it. Before 2.8.6 the pit raised
      // rarity, and a weapon's steps were all its doing: those become levels first.
      clearBag()
      const ups = prefs.lv ? msg.ups : msg.ups.map((entry) => {
        const at = entry.lastIndexOf(':')
        const id = entry.slice(0, at)
        if (at <= 0 || !getEquipmentItemOrNull(id)?.weapon) return entry
        const [rank, level] = entry.slice(at + 1).split('/').map(Number)
        return `${id}:0/${Math.max(level || 1, 1 + (rank || 0) * 2)}`
      })
      convertLegacyBag(msg.unlocks, ups, printedRankOf)
      // Before 2.8.0 a hero started in a set of its class (Elven Warden, Sorcerer,
      // Paladin, Northman) that was never gated; now those drop in their realms.
      // A hero still wearing any of it owns the whole set, so nothing is taken away.
      const legacy = LEGACY_STARTERS[msg.cid] ?? ''
      if (legacy && loadout && EQUIPMENT_SLOTS.some((slot) => loadout[slot.id]?.startsWith(`${legacy}-`))) {
        for (const slot of EQUIPMENT_SLOTS) {
          const id = `${legacy}-${slot.id}`
          if (slot.id !== 'weapon' && getEquipmentItemOrNull(id)) addGear(id, 0, 1, `m-${id}`, true)
        }
      }
      // Before 2.8.15 a Blade hero started with the Prism Saber, a Pride weapon,
      // never gated because it was the starter. A hero saved before that owns it
      // still, whatever is in hand today; new heroes start on a plain sword.
      if (!prefs.ps && classOfCharacter(msg.cid) === 'blade') addGear('pride-sword', 0, 1, 'm-pride-sword', true)
    }
    // Armor from before it had to be earned comes off; the class default goes back on.
    enforceOwnedLoadout(msg.cid)
    // The title's Continue waits on this outfit; fetch it ahead of the queue.
    requestHeroPreload(msg.cid, getCommittedLoadout(msg.cid), true)
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

/**
 * The server never answered and this client is hosting itself: whatever is
 * saved under this wallet is out of reach, and nothing made now is kept. The
 * title must not pass that off as "no champion saved".
 */
export function isHeroSaveUnreachable(): boolean {
  return isSoloMode() && !state.found
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
  // The bag goes in as its revision, not its rows: this runs every frame, and a bag of a hundred copies is not for serializing that often.
  return [cid, a.bodyType, a.hairStyle, a.hairColor, a.skinTone, ...EQUIPMENT_SLOTS.map((s) => l[s.id]), bagRevision(), serializeSettings()].join('#')
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
    loadout: JSON.stringify(getCommittedLoadout(cid)), coins, unlocks: getUnlockedItems(), prefs: serializeSettings(), ups: [], bag: serializeBag()
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
    loadout: JSON.stringify(getCommittedLoadout(cid)), coins, unlocks: getUnlockedItems(), prefs: serializeSettings(), ups: [], bag: serializeBag()
  })
  lastSaved = fingerprint(cid)
  lastSavedCoins = coins
  sinceSave = 0
}
