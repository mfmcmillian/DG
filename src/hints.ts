// How to play, told at the moment it matters and never as a wall of text. A
// strip of key caps appears the first time a hero stands at the yard's dummies
// with a weapon, and again for the opening of their first fortress; short
// nudges answer the first blow taken, an empty stamina bar, and a fall. Each
// shows once per hero (the seen list rides in the saved prefs) except the
// fall, which is a status line, not a lesson. The Squire and the Hedge Witch
// say the same things in the hall for whoever asks; the Settings sheet keeps
// the full list. Drawn by HintStrip in src/worldHudUi.tsx.

import { engine, Transform } from '@dcl/sdk/ecs'
import { getPickerState } from './characterPicker'
import { heroClassOf } from './heroClasses'
import { localXp } from './heroXp'
import { t } from './i18n'
import { getInventoryState, getUnlockedItems } from './inventory'
import { getLobbyState, inRaid, inRun, myPhase } from './party'
import { HUB } from './partyLookup'
import { getPlayerCharacterState, getPlayerVitals, getPlayerWeapon } from './playerCharacter'
import { isSettingsOpen } from './settings'
import { skillsFor } from './shared/skills'
import { nearTrainingDummy, trainingTally } from './trainingDummies'

/** `gear` is not a strip: it is the glow on the HUD's Inventory button (newGearWaiting), seen once like the rest. */
export type HintId = 'yard' | 'dungeon' | 'hit' | 'breath' | 'downed' | 'gear'

/** One key cap and what it does. */
export type HintChip = { key: string; label: string }

export type HintView = {
  id: HintId
  chips: HintChip[]
  /** A one-line nudge instead of, or under, the chips. */
  text: string
  /** Seconds it has been up (for the fade in) and seconds it has left (for the fade out). */
  age: number
  remaining: number
}

/** How far from a dummy the yard counts as being used. */
const YARD_REACH = 7
/** How long each hint stays unless its lesson is learned sooner. */
const SECONDS: Record<HintId, number> = { yard: 22, dungeon: 20, hit: 6, breath: 4, downed: 30, gear: 0 }
/** Blows on the dummies that count as having learned the keys. */
const YARD_BLOWS = 4

const seen = new Set<HintId>()
let current: HintView | undefined
/** The yard tally's `since` drops back to zero with every blow; counting the drops counts the blows since the hint came up. */
let blowsAtShow = 0
let lastSince = Infinity
let blows = 0
let lastHealth = 0
let lastHeroKey = ''
let systemAdded = false

export function getHint(): Readonly<HintView> | undefined {
  return current
}

// --- persistence (in the hero's prefs, via settings.ts) ------------------------------------

export function seenHints(): HintId[] {
  return [...seen]
}

export function hintSeen(id: HintId): boolean {
  return seen.has(id)
}

export function markHintSeen(id: HintId) {
  seen.add(id)
}

export function loadSeenHints(list: unknown) {
  seen.clear()
  if (!Array.isArray(list)) return
  for (const id of list) if (typeof id === 'string' && id in SECONDS) seen.add(id as HintId)
}

/**
 * Back from a clear with something found and the bag never opened: the HUD's
 * Inventory button glows and wears a NEW badge until it is (src/worldHudUi.tsx).
 */
export function newGearWaiting(): boolean {
  if (seen.has('gear')) return false
  return getLobbyState().progress.some((n) => n > 0) && getUnlockedItems().length > 0
}

// --- what the keys are -----------------------------------------------------------------

function combatChips(): HintChip[] {
  return [
    { key: 'E', label: t('Light') },
    { key: 'F', label: t('Heavy') },
    { key: t('Space'), label: t('Guard') },
    { key: 'Ctrl', label: t('Roll') }
  ]
}

/** A skill is open at this level: the number keys are worth a cap. */
function hasSkill(): boolean {
  const cls = heroClassOf(getPickerState().equippedId)
  const level = localXp().level
  return skillsFor(cls.id).some((s) => s.level <= level)
}

// --- the loop ----------------------------------------------------------------------------

function show(id: HintId, chips: HintChip[], text: string) {
  current = { id, chips, text, age: 0, remaining: SECONDS[id] }
  blowsAtShow = blows
}

function dismiss(learned: boolean) {
  if (!current) return
  if (learned || current.id !== 'downed') seen.add(current.id)
  current = undefined
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  const picker = getPickerState()
  const player = getPlayerCharacterState()
  const ready = picker.hasCreatedCharacter && player.active && player.loading === 'ready'
  if (!ready) {
    current = undefined
    return
  }
  // A different hero on the same wallet starts from what its prefs say (loadSeenHints ran on load).
  const heroKey = picker.equippedId
  if (heroKey !== lastHeroKey) {
    lastHeroKey = heroKey
    current = undefined
  }
  const vitals = getPlayerVitals()
  const tally = trainingTally()
  if (tally.since < lastSince) blows++
  lastSince = tally.since
  const tookHit = vitals.health < lastHealth && vitals.health > 0
  lastHealth = vitals.health
  const running = inRun() && !inRaid()
  const menus = getLobbyState().open || isSettingsOpen() || getInventoryState().open || picker.open
  const hall = myPhase() === HUB
  if (getInventoryState().open && newGearWaiting()) seen.add('gear')
  const p = Transform.getOrNull(engine.PlayerEntity)?.position

  // What is up: time it out, or end it early once the lesson has landed.
  if (current) {
    current.age += span
    current.remaining -= span
    const c = current
    if (c.remaining <= 0) dismiss(false)
    else if (c.id === 'yard' && (blows - blowsAtShow >= YARD_BLOWS || !hall)) dismiss(blows - blowsAtShow >= YARD_BLOWS)
    else if (c.id === 'dungeon' && (!running || tookHit)) dismiss(tookHit)
    else if (c.id === 'downed' && vitals.health > 0) dismiss(false)
    else if (c.id === 'hit' && !running) dismiss(false)
  }
  if (menus) return
  const armed = getPlayerWeapon() !== 'none-weapon'

  // Status first: a fall always says so.
  if (running && vitals.health <= 0) {
    if (current?.id !== 'downed') show('downed', [], t("You are down. You'll be back on your feet in a moment."))
    return
  }
  if (current) return

  // Lessons, each once.
  if (!seen.has('yard') && hall && armed && p && nearTrainingDummy(p.x, p.z, YARD_REACH)) {
    show('yard', combatChips(), t('Try the keys on the dummies.'))
    return
  }
  if (!seen.has('dungeon') && running && armed) {
    const chips = combatChips()
    if (hasSkill()) chips.push({ key: '1-4', label: t('Skills') })
    show('dungeon', chips, '')
    return
  }
  if (!seen.has('hit') && running && tookHit) {
    show('hit', [{ key: t('Space'), label: t('Guard') }, { key: 'Ctrl', label: t('Roll') }], t('Hold Space to guard a blow, or roll clear of it.'))
    return
  }
  if (!seen.has('breath') && (vitals.exhausted || vitals.stamina <= 0.5) && (running || hall)) {
    show('breath', [], t('Out of breath. Stand still a moment and it comes back.'))
    return
  }
}

export function initializeHints() {
  if (systemAdded) return
  systemAdded = true
  engine.addSystem(update)
}
