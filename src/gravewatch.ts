// Gravewatch on the client: the sheet's state, what the server last said, and
// the small animations (the wheel's turn, the dice's reveal). Everything the
// player can do is a message to the host; the answer is their whole sheet
// (gwState), so this file never computes an ember itself. The server's clock
// comes with every answer and every countdown is drawn from it.

import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { onNet, sendNet } from './net'
import { isSoloMode, localAddress } from './multiplayer'
import { getPlayerCharacterState, setPumpkinCurse } from './playerCharacter'
import { myParty, myPhase } from './party'
import { HUB } from './partyLookup'
import { isTitleOpen } from './titleScreen'
import { GW_EVENT_END, GW_WHEEL, GwItem, GwRisingPhase, risingAt } from './shared/gravewatch'
import { RISING_PARTY } from './shared/levels'
import { fxSound } from './combatFx'
import { t } from './i18n'

export type GwTab = 'rounds' | 'wheel' | 'dice' | 'rising' | 'reliquary'
export const GW_TABS: readonly GwTab[] = ['rounds', 'wheel', 'dice', 'rising', 'reliquary']

export type GwSheet = {
  /** Something has arrived from the host at least once. */
  known: boolean
  over: boolean
  guest: boolean
  embers: number
  rounds: number
  clears: number
  spins: number
  rolls: number
  /** Server times (0: none). */
  mult: number
  curse: number
  held: boolean
  live: GwItem[]
  won: GwItem[]
  sold: GwItem[]
  keyed: GwItem[]
  redeemed: Partial<Record<GwItem, 'pending' | 'granted' | 'failed'>>
  rising: number
  phase: GwRisingPhase
  signed: number
  signedUp: boolean
  arena: number
  note: string
  noteFor: number
}

type Wheel = { target: number; t: number; seq: number; done: boolean }
type Dice = { mine: [number, number]; house: [number, number]; wager: number; won: boolean; t: number }

const WHEEL_SECONDS = 3.2
const WHEEL_TURNS = 3
const DICE_SECONDS = 1.1
const NOTE_SECONDS = 4
const POLL_SECONDS = 10
/** The flyer waits this long after the hero stands in the hall. */
const FLYER_AFTER_SECONDS = 1.5

const sheet: GwSheet = {
  known: false, over: false, guest: false, embers: 0, rounds: 0, clears: 0, spins: 0, rolls: 0, mult: 0, curse: 0, held: false,
  live: ['w1'], won: [], sold: [], keyed: [], redeemed: {}, rising: 0, phase: 'idle', signed: 0, signedUp: false, arena: 0, note: '', noteFor: 0
}
let open = false
let tab: GwTab = 'rounds'
let flyer = false
let flyerShown = false
let standingFor = 0
let sincePoll = 0
let askedOnce = false
/** Server clock minus ours. */
let clockOffset = 0
let lastSeq = 0
let wheel: Wheel | undefined
let dice: Dice | undefined
/** Waiting on the host's answer to a spin, a roll or a redeem. */
let busy = ''
let confirmItem: GwItem | '' = ''
let screenNote = ''
let screenNoteFor = 0
let initialized = false

export function initializeGravewatch() {
  if (initialized) return
  initialized = true
  onNet('gwState', (msg) => {
    clockOffset = msg.now - Date.now()
    const before = sheet.embers
    sheet.known = true
    sheet.over = msg.over
    sheet.guest = msg.guest
    sheet.embers = msg.embers
    sheet.rounds = msg.rounds
    sheet.clears = msg.clears
    sheet.spins = msg.spins
    sheet.rolls = msg.rolls
    sheet.mult = msg.mult
    sheet.curse = msg.curse
    sheet.held = msg.held
    sheet.live = msg.live as GwItem[]
    sheet.won = msg.won as GwItem[]
    sheet.sold = msg.sold as GwItem[]
    sheet.keyed = msg.keyed as GwItem[]
    const redeemed: GwSheet['redeemed'] = {}
    for (const entry of msg.redeemed) {
      const [item, state] = entry.split(':')
      if (item === 'w1' || item === 'w2' || item === 'w3') redeemed[item] = state as 'pending' | 'granted' | 'failed'
    }
    sheet.redeemed = redeemed
    sheet.rising = msg.rising
    sheet.phase = msg.phase as GwRisingPhase
    sheet.signed = msg.signed
    sheet.signedUp = msg.signedUp
    sheet.arena = msg.arena
    setPumpkinCurse(msg.curse > 0 ? msg.curse - clockOffset : 0)
    const fresh = msg.seq !== lastSeq
    lastSeq = msg.seq
    if (fresh && msg.note) takeNote(msg.note, msg, before)
    if (busy && fresh) busy = ''
  })
  onNet('gwNote', (msg) => {
    screenNote = msg.text
    screenNoteFor = NOTE_SECONDS
  })
  engine.addSystem(update)
}

function takeNote(note: string, msg: { spin: number; roll: number[] }, embersBefore: number) {
  if (note.startsWith('spin:')) {
    wheel = { target: msg.spin, t: 0, seq: lastSeq, done: false }
    fxSound('coin', 0.5)
    return
  }
  if (note === 'roll:won' || note === 'roll:lost') {
    const r = msg.roll
    if (r.length >= 6) dice = { mine: [r[0], r[1]], house: [r[2], r[3]], wager: r[4], won: r[5] === 1, t: 0 }
    return
  }
  const text = noteText(note, embersBefore)
  if (text) {
    sheet.note = text
    sheet.noteFor = NOTE_SECONDS
  }
}

/** The host's short reasons, in the player's words. */
function noteText(note: string, embersBefore: number): string {
  switch (note) {
    case 'over': return t('Gravewatch has ended.')
    case 'guest': return t('Sign in with a wallet to take part in Gravewatch.')
    case 'poor': return t('Not enough embers.')
    case 'capped': return t('Knucklebones is done for today. Come back tomorrow.')
    case 'wager': return ''
    case 'nokey': return t('Not yet available.')
    case 'locked': return t('Not unlocked yet.')
    case 'sold': return t('Sold out.')
    case 'yours': return t('Already yours.')
    case 'owned': return t('This wallet already holds one.')
    case 'minting': return t('Minting. Check your backpack in a minute.')
    case 'granted': return t('It is yours. Look in your backpack.')
    case 'failed': return t('The mint was refused; your embers are back.')
    case 'closed': return t('Not open right now.')
    case 'won': return t('The Rising was won tonight. The yard rests.')
    case 'busy': return t('Finish your run first.')
    case 'joined': return ''
    case 'signed': return t('You are on the list. Be in the hall at 9:15.')
    case 'party': return t('They have to be in your party.')
    case 'cursed': return sheet.curse > 0 ? t('Cursed! A pumpkin for an hour.') : t('The curse is given.')
    default:
      return embersBefore !== sheet.embers ? '' : ''
  }
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  if (sheet.noteFor > 0) {
    sheet.noteFor -= span
    if (sheet.noteFor <= 0) sheet.note = ''
  }
  if (screenNoteFor > 0) {
    screenNoteFor -= span
    if (screenNoteFor <= 0) screenNote = ''
  }
  if (wheel && !wheel.done) {
    wheel.t += span
    if (wheel.t >= WHEEL_SECONDS) {
      wheel.done = true
      fxSound('coin', 0.9)
    }
  }
  if (dice && dice.t < DICE_SECONDS) dice.t += span
  if (!available()) return
  // The first sheet on arrival, and a fresh one every so often while it is open.
  const inHall = myPhase() === HUB && !isTitleOpen() && getPlayerCharacterState().visible
  if (inHall && !askedOnce) {
    askedOnce = true
    ask('state')
  }
  if (open) {
    sincePoll += span
    if (sincePoll >= POLL_SECONDS) {
      sincePoll = 0
      ask('state')
    }
  }
  // The flyer, once a session, when the hero has stood in the hall a moment.
  if (!flyerShown && inHall && !myParty() && !open) {
    standingFor += span
    if (standingFor >= FLYER_AFTER_SECONDS && sheet.known) {
      flyerShown = true
      flyer = true
      openGravewatch('rising')
    }
  }
}

// --- what the UI reads ---------------------------------------------------------------------

export function getGravewatch(): Readonly<GwSheet> {
  return sheet
}

export function isGravewatchOpen(): boolean {
  return open
}

export function gravewatchTab(): GwTab {
  return tab
}

export function isFlyer(): boolean {
  return flyer
}

export function gravewatchBusy(): string {
  return busy
}

export function gravewatchConfirm(): GwItem | '' {
  return confirmItem
}

export function gravewatchScreenNote(): { text: string; left: number } {
  return { text: screenNote, left: screenNoteFor }
}

/** The host's clock, as near as the last answer put it. */
export function serverNow(): number {
  return Date.now() + clockOffset
}

/** The event shows at all: before its end, and only with a host to keep the ledger. */
export function available(): boolean {
  return !isSoloMode() && serverNow() < GW_EVENT_END
}

/** The wheel as it turns: which segment is lit, and whether it has stopped. */
export function wheelState(): { lit: number; done: boolean; target: number } | undefined {
  if (!wheel) return undefined
  if (wheel.done) return { lit: wheel.target, done: true, target: wheel.target }
  const k = Math.min(1, wheel.t / WHEEL_SECONDS)
  const eased = 1 - Math.pow(1 - k, 3)
  const steps = WHEEL_TURNS * GW_WHEEL.length + wheel.target
  const lit = Math.floor(eased * steps) % GW_WHEEL.length
  return { lit, done: false, target: wheel.target }
}

/** The last roll: the house's dice show after a beat. */
export function diceState(): (Dice & { revealed: boolean }) | undefined {
  if (!dice) return undefined
  return { ...dice, revealed: dice.t >= DICE_SECONDS }
}

/** The next Rising from the host's clock: start, phase and seconds to the start (or to the gate shutting). */
export function risingClock(): { start: number; phase: GwRisingPhase; seconds: number } {
  const now = serverNow()
  const at = sheet.known ? { start: sheet.rising, phase: sheet.phase } : risingAt(now)
  const seconds = at.start > 0 ? Math.max(0, (at.start - now) / 1000) : 0
  return { start: at.start, phase: at.phase, seconds }
}

export function inRisingArena(): boolean {
  return myPhase() === RISING_PARTY
}

// --- what the player does ----------------------------------------------------------------------

export function openGravewatch(which: GwTab = tab): boolean {
  if (open) {
    tab = which
    return false
  }
  open = true
  tab = which
  confirmItem = ''
  sincePoll = 0
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  ask('state')
  return true
}

export function closeGravewatch() {
  if (!open) return
  open = false
  flyer = false
  confirmItem = ''
  InputModifier.deleteFrom(engine.PlayerEntity)
}

export function setGravewatchTab(which: GwTab) {
  tab = which
  confirmItem = ''
  flyer = false
}

function ask(what: string) {
  if (!localAddress()) return
  sendNet('gwAct', { what })
}

/** Rounds: into an open Barrow Yard party, or off in one of your own. The sheet closes so the lobby can show. */
export function gravewatchRounds() {
  ask('rounds')
  closeGravewatch()
}

export function gravewatchSpin() {
  if (busy) return
  if (wheel && !wheel.done) return
  busy = 'spin'
  wheel = undefined
  sendNet('gwSpin', { v: 1 })
}

export function gravewatchRoll(wager: number) {
  if (busy) return
  if (dice && dice.t < DICE_SECONDS) return
  busy = 'roll'
  sendNet('gwRoll', { wager })
}

/** Two taps: the first asks, the second buys. */
export function gravewatchRedeem(item: GwItem) {
  if (busy) return
  if (confirmItem !== item) {
    confirmItem = item
    return
  }
  confirmItem = ''
  busy = 'redeem'
  sendNet('gwRedeem', { item })
}

export function gravewatchRising(what: 'signup' | 'unsign' | 'join' | 'leave') {
  ask(what)
  if (what === 'join' || what === 'leave') closeGravewatch()
}

/** Hand the wheel's curse to a party member, or wear it yourself ('' ). */
export function gravewatchCurse(target: string) {
  ask(`curse:${target}`)
}

/** The hall button's second line: what is waiting today. */
export function gravewatchButtonLine(): string {
  const clock = risingClock()
  if (clock.phase === 'fight') return t('The Rising is on. Join!')
  if (clock.phase === 'lobby') return t('The Rising in {m} min', { m: Math.max(1, Math.ceil(clock.seconds / 60)) })
  if (sheet.known && sheet.rounds === 0) return t('Rounds ready')
  if (sheet.known && sheet.spins === 0) return t('Wheel ready')
  if (clock.start > 0) {
    const h = Math.floor(clock.seconds / 3600)
    return h >= 48 ? t('Rising in {d} days', { d: Math.floor(h / 24) }) : t('Rising in {h}h', { h: Math.max(1, h) })
  }
  return t('Embers: {n}', { n: sheet.embers })
}
