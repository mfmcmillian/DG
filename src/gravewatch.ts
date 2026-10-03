// Gravewatch on the client: the sheet's state, what the server last said, and
// the small animations (the wheel's turn, the board's dice and pawn). Everything the
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
import { GW_BOARD, GW_BOARD_MILESTONES, GW_BOARD_TOKENS, GW_EVENT_END, GW_WHEEL, GwItem, GwRisingPhase, risingAt } from './shared/gravewatch'
import { RISING_PARTY } from './shared/levels'
import { fxSound } from './combatFx'
import { t } from './i18n'

export type GwTab = 'rounds' | 'wheel' | 'board' | 'rising' | 'reliquary'
export const GW_TABS: readonly GwTab[] = ['rounds', 'wheel', 'board', 'rising', 'reliquary']

export type GwSheet = {
  /** Something has arrived from the host at least once. */
  known: boolean
  over: boolean
  guest: boolean
  embers: number
  rounds: number
  clears: number
  spins: number
  /** Gravewalk: rolls today, the pawn's tile, tile levels, season points, milestones paid. */
  rolls: number
  pos: number
  tiles: number[]
  points: number
  miles: number
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
type Board = { dice: [number, number]; from: number; to: number; passed: boolean; paid: number; said: string; t: number }
type Gain = { amount: number; age: number }

/** The wheel sheet: 10 x 10 frames, frame k turned k * 3.6 degrees clockwise; segment 0 under the pointer at frame 0. */
export const WHEEL_FRAMES = 100
export const WHEEL_SHEET = 'images/gravewatch/wheel-sheet.png'
export const WHEEL_POINTER = 'images/gravewatch/wheel-pointer.png'
export const DICE_STRIP = 'images/gravewatch/dice.png'
/** A "+n embers" toast stays this long. */
export const GAIN_SECONDS = 3.5

const WHEEL_SECONDS = 3.2
const WHEEL_TURNS = 3
const DICE_SECONDS = 0.9
/** The pawn takes this long per tile after the dice settle. */
const STEP_SECONDS = 0.16
const NOTE_SECONDS = 4
const POLL_SECONDS = 10
/** The flyer waits this long after the hero stands in the hall. */
const FLYER_AFTER_SECONDS = 1.5

const sheet: GwSheet = {
  known: false, over: false, guest: false, embers: 0, rounds: 0, clears: 0, spins: 0, rolls: 0, pos: 0, tiles: GW_BOARD.map(() => 1), points: 0, miles: 0, mult: 0, curse: 0, held: false,
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
let board: Board | undefined
/** How far the pawn had hopped when we last made a sound, and the wheel's last lit wedge, so each gets one tick. */
let hopsHeard = 0
let landingHeard = false
let wedgeHeard = -1
/** Auto-roll: keep rolling one die while rolls remain. */
let autoRoll = false
/** The ember count the header shows, ticking toward the real one. */
let shownEmbersValue = 0
/** Waiting on the host's answer to a spin, a roll or a redeem. */
let busy = ''
let confirmItem: GwItem | '' = ''
let screenNote = ''
let screenNoteFor = 0
let initialized = false
const gains: Gain[] = []
/** Embers earned since the hero last left the hall (the results card shows it). */
let runGain = 0
let lastPhase = ''

export function initializeGravewatch() {
  if (initialized) return
  initialized = true
  onNet('gwState', (msg) => {
    clockOffset = msg.now - Date.now()
    const before = sheet.embers
    const known = sheet.known
    sheet.known = true
    sheet.over = msg.over
    sheet.guest = msg.guest
    sheet.embers = msg.embers
    sheet.rounds = msg.rounds
    sheet.clears = msg.clears
    sheet.spins = msg.spins
    sheet.rolls = msg.rolls
    sheet.pos = msg.pos
    sheet.tiles = msg.tiles
    sheet.points = msg.points
    // A season chest crossed: say which.
    if (known && msg.miles > sheet.miles && msg.miles <= GW_BOARD_MILESTONES.length) {
      sheet.note = `${t('Season chest')}: ${t(GW_BOARD_MILESTONES[msg.miles - 1].label)}`
      sheet.noteFor = NOTE_SECONDS * 1.5
    }
    sheet.miles = msg.miles
    if (!known) shownEmbersValue = msg.embers
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
    // Embers coming in (a Round, a clear, the Rising): say so on screen. The wheel and the board tell their own result when they stop.
    if (known && msg.embers > before && !msg.note.startsWith('spin:') && !msg.note.startsWith('board:')) {
      const gain = msg.embers - before
      gains.push({ amount: gain, age: 0 })
      if (gains.length > 3) gains.shift()
      runGain += gain
      fxSound('coin', 0.7)
    }
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
  if (note.startsWith('board:')) {
    const r = msg.roll
    if (r.length >= 6) board = { dice: [r[0], r[1]], from: r[2], to: r[3], passed: r[4] === 1, paid: r[5], said: note.slice('board:'.length), t: 0 }
    hopsHeard = 0
    landingHeard = false
    fxSound('dice', 0.8)
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
    case 'capped': return t('No rolls left today. Come back tomorrow.')
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
      fxSound('bell', 0.6)
    } else {
      // A tick as each wedge passes the pointer.
      const lit = wheelState()?.lit ?? -1
      if (lit !== wedgeHeard) {
        wedgeHeard = lit
        fxSound('hop', 0.35)
      }
    }
  }
  if (board && board.t < boardSeconds(board)) board.t += span
  if (board) {
    const play = boardState()
    // One knock per hop, then the landing: a chime, a reveal on the chest, gear and mystery tiles, the fire when Start is passed.
    const hopped = play.settled ? ((play.pawn - board.from) + GW_BOARD.length) % GW_BOARD.length : 0
    if (hopped > hopsHeard) {
      hopsHeard = hopped
      fxSound('hop', 0.6)
    }
    if (play.landed && !landingHeard) {
      landingHeard = true
      const kind = GW_BOARD[board.to].kind
      if (board.passed) fxSound('fire_flare', 0.5)
      if (kind === 'chest' || kind === 'gear' || kind === 'mystery') fxSound('reveal', 0.8)
      else if (board.paid > 0) fxSound('coin', 0.8)
      else fxSound('bell', 0.4)
    }
  }
  // The header's ember count walks toward the truth rather than jumping.
  if (shownEmbersValue !== sheet.embers) {
    const gap = sheet.embers - shownEmbersValue
    const step = Math.max(1, Math.ceil(Math.abs(gap) * Math.min(1, span * 6)))
    shownEmbersValue += Math.sign(gap) * Math.min(Math.abs(gap), step)
  }
  // Auto-roll: one die after another while rolls remain and the sheet is on the board.
  if (autoRoll) {
    if (!open || tab !== 'board' || sheet.rolls >= GW_BOARD_TOKENS || sheet.guest || sheet.over) autoRoll = false
    else if (!busy && !boardRolling() && (!board || board.t >= boardSeconds(board) + 0.8)) gravewatchRoll(false)
  }
  for (const g of gains) g.age += span
  while (gains.length && gains[0].age >= GAIN_SECONDS) gains.shift()
  const phase = myPhase()
  if (phase !== lastPhase) {
    // Out of the hall into a run: the run's tally starts at nothing.
    if (lastPhase === HUB || !lastPhase) runGain = 0
    lastPhase = phase
  }
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

/**
 * The wheel as it turns: the sheet frame to show (its angle), the segment
 * under the pointer right now, and whether it has stopped. Turning clockwise
 * by 36 * i degrees brings segment i under the pointer, so the landing angle
 * is 360 - 36 * target plus the full turns.
 */
export function wheelState(): { frame: number; lit: number; done: boolean; target: number } | undefined {
  if (!wheel) return undefined
  const landing = WHEEL_TURNS * 360 + ((360 - wheel.target * 36) % 360)
  if (wheel.done) return { frame: frameAt(landing), lit: wheel.target, done: true, target: wheel.target }
  const k = Math.min(1, wheel.t / WHEEL_SECONDS)
  const eased = 1 - Math.pow(1 - k, 3)
  const angle = eased * landing
  const lit = ((GW_WHEEL.length - Math.round(angle / 36)) % GW_WHEEL.length + GW_WHEEL.length) % GW_WHEEL.length
  return { frame: frameAt(angle), lit, done: false, target: wheel.target }
}

function frameAt(angle: number): number {
  const step = 360 / WHEEL_FRAMES
  return ((Math.round(angle / step) % WHEEL_FRAMES) + WHEEL_FRAMES) % WHEEL_FRAMES
}

function boardSteps(b: Board): number {
  return ((b.to - b.from) + GW_BOARD.length) % GW_BOARD.length || (b.dice[0] + b.dice[1] > 0 ? GW_BOARD.length : 0)
}

function boardSeconds(b: Board): number {
  return DICE_SECONDS + boardSteps(b) * STEP_SECONDS
}

/**
 * The last roll as it plays: the dice tumble for a beat and settle, then the
 * pawn hops tile by tile to where the host put it; `landed` once it is there.
 * Without a roll in play the pawn stands where the sheet says.
 */
export function boardState(): { faces: [number, number]; settled: boolean; pawn: number; landed: boolean; roll?: Board } {
  if (!board) return { faces: [0, 0], settled: true, pawn: sheet.pos, landed: true }
  const settled = board.t >= DICE_SECONDS
  const steps = boardSteps(board)
  const walked = settled ? Math.min(steps, Math.floor((board.t - DICE_SECONDS) / STEP_SECONDS)) : 0
  const pawn = (board.from + walked) % GW_BOARD.length
  const tick = Math.floor(board.t * 12)
  const face = (salt: number) => 1 + ((tick * 7 + salt * 5) % 6)
  const faces: [number, number] = settled ? board.dice : [face(1), board.dice[1] ? face(2) : 0]
  return { faces, settled, pawn, landed: walked >= steps, roll: board }
}

export function boardRolling(): boolean {
  return !!board && board.t < boardSeconds(board)
}

/** Within the current hop, 0..1 (the pawn's arc), and seconds since the pawn landed (negative until then). */
export function boardTiming(): { hop: number; sinceLanded: number } {
  if (!board || board.t < DICE_SECONDS) return { hop: 0, sinceLanded: -1 }
  const steps = boardSteps(board)
  const walked = (board.t - DICE_SECONDS) / STEP_SECONDS
  return { hop: walked < steps ? walked % 1 : 0, sinceLanded: board.t - boardSeconds(board) }
}

export function isAutoRoll(): boolean {
  return autoRoll
}

export function toggleAutoRoll() {
  autoRoll = !autoRoll
}

/** The ember count as the header shows it, ticking toward the real one. */
export function shownEmbers(): number {
  return shownEmbersValue
}

/** The "+n embers" toasts, newest last, with how long each has shown. */
export function emberGains(): readonly Gain[] {
  return gains
}

/** Embers earned on this trip out of the hall. */
export function runEmberGain(): number {
  return runGain
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
  autoRoll = false
  flyer = false
  confirmItem = ''
  InputModifier.deleteFrom(engine.PlayerEntity)
}

export function setGravewatchTab(which: GwTab) {
  tab = which
  autoRoll = false
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

export function gravewatchRoll(double: boolean) {
  if (busy) return
  if (boardRolling()) return
  busy = 'roll'
  sendNet('gwRoll', { double })
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

/** Developers only: test embers from the host. */
export function gravewatchGrant() {
  ask('grant')
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
  if (sheet.known && sheet.rolls === 0) return t('Board ready')
  if (clock.start > 0) {
    const h = Math.floor(clock.seconds / 3600)
    return h >= 48 ? t('Rising in {d} days', { d: Math.floor(h / 24) }) : t('Rising in {h}h', { h: Math.max(1, h) })
  }
  return t('Embers: {n}', { n: sheet.embers })
}
