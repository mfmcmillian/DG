// Client mirror of the host's parties, and the lobby actions. The host's
// `parties` broadcast is the truth; this module keeps the latest copy, works
// out which phase we are in (our running party, or the hub) and, when that
// changes, rebuilds the dungeon for it and puts the player on the entrance.

import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { loadDungeon } from './dungeon'
import { setClientRun } from './dungeonEnemies'
import { getLootState } from './loot'
import { isClientSynced, localAddress } from './multiplayer'
import { onNet, sendNet } from './net'
import { HUB, setPartyLookup } from './partyLookup'
import { movePlayerToSpawn } from './playerPlacement'
import { applyCameraSetting } from './settings'
import { getPickerState } from './characterPicker'
import { getPlayerCharacterState } from './playerCharacter'
import { DIFFICULTIES, difficultyById, HUB_LEVEL, levelById, LEVELS, nextLevel, realmOfLevel } from './shared/levels'

/** What the player has picked in the lobby before they have a party of their own. */
let pickLevel = 0
let pickDiff = 0

export function getLobbyPick(): { level: number; diff: number } {
  const party = myParty()
  return { level: party ? party.level : pickLevel, diff: party ? party.diff : pickDiff }
}

export function setLobbyPickLevel(level: number) {
  pickLevel = Math.max(0, Math.min(LEVELS.length - 1, Math.floor(level)))
  const party = myParty()
  if (party && isLeader()) setPartyLevel(pickLevel)
}

export function cycleLobbyPickLevel(dir: number) {
  const current = getLobbyPick().level
  setLobbyPickLevel((current + dir + LEVELS.length) % LEVELS.length)
}

export function setLobbyPickDiff(diff: number) {
  pickDiff = Math.max(0, Math.min(DIFFICULTIES.length - 1, Math.floor(diff)))
  const party = myParty()
  if (party && isLeader()) setPartyDifficulty(pickDiff)
}

export type PartyInfo = {
  id: string
  leader: string
  level: number
  diff: number
  state: 'open' | 'running' | 'done'
  members: string[]
  ready: string[]
  time: number
  slain: number
  total: number
  won: boolean
  run: number
  /** Seconds left on the results before the host sends the party to the hall. */
  wait: number
}

export type RunResult = {
  won: boolean
  level: number
  diff: number
  time: number
  slain: number
  total: number
  coins: number
}

type LobbyState = {
  parties: PartyInfo[]
  /** The lobby panel is up (hub only). */
  open: boolean
  /** Seconds since the last `parties` broadcast; large means the host is not talking. */
  silence: number
  /** Our level progress: one number per level, 0 = never cleared, n = cleared up to difficulty n-1. */
  progress: number[]
  /** The verdict of the run we just finished, while the party shows results. */
  result: RunResult | undefined
  /** The level the player is standing in (HUB_LEVEL.id in the hall). */
  levelId: number
  /** One line for the lobby's header after a run: what the last fight opened, or took. */
  banner: string
}

const state: LobbyState = { parties: [], open: false, silence: 0, progress: [], result: undefined, levelId: HUB_LEVEL.id, banner: '' }
/** The phase the built dungeon is for, and the party's run counter it was built for. */
let appliedPhase = HUB
let appliedRun = -1
let appliedState: PartyInfo['state'] | undefined = undefined
/** Back from a fortress: the lobby reopens on its own once the hero is standing in the hall. */
let reopenLobbyIn = 0
/** Coins when the run began, to show what the run paid. */
let coinsAtStart = 0
let initialized = false

export function initializeParty() {
  if (initialized) return
  initialized = true
  setPartyLookup(phaseOfAddress)
  onNet('parties', (msg) => {
    state.silence = 0
    state.parties = msg.list.map((p) => ({
      id: p.id, leader: p.leader.toLowerCase(), level: p.level, diff: p.diff,
      state: (p.state === 'running' || p.state === 'done' ? p.state : 'open'),
      members: p.members.map((m) => m.toLowerCase()), ready: p.ready.map((m) => m.toLowerCase()),
      time: p.time, slain: p.slain, total: p.total, won: p.won, run: p.run, wait: p.wait
    }))
  })
  onNet('progress', (msg) => {
    if (msg.id.toLowerCase() === localAddress()) state.progress = [...msg.progress]
  })
  engine.addSystem(update)
}

export function getLobbyState(): Readonly<LobbyState> {
  return state
}

export function setProgress(progress: readonly number[]) {
  state.progress = [...progress]
}

export function myParty(): PartyInfo | undefined {
  const me = localAddress()
  if (!me) return undefined
  return state.parties.find((p) => p.members.includes(me))
}

export function isLeader(): boolean {
  const party = myParty()
  return !!party && party.leader === localAddress()
}

/** The phase we are in: our party while it fights or shows results, else the hub. */
export function myPhase(): string {
  return phaseOfAddress(localAddress())
}

export function inRun(): boolean {
  return myParty()?.state === 'running'
}

function phaseOfAddress(address: string): string {
  const id = address.toLowerCase()
  const party = state.parties.find((p) => p.members.includes(id))
  return party && party.state !== 'open' ? party.id : HUB
}

/** Parties in the hub that can still be joined. */
export function openParties(): PartyInfo[] {
  const mine = myParty()
  return state.parties.filter((p) => p.state === 'open' && p !== mine)
}

// --- lobby panel ------------------------------------------------------------------

export function openLobby() {
  if (state.open || !getPickerState().hasCreatedCharacter || myPhase() !== HUB) return
  state.open = true
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
}

export function closeLobby() {
  if (!state.open) return
  state.open = false
  state.banner = ''
  InputModifier.deleteFrom(engine.PlayerEntity)
}

// --- actions --------------------------------------------------------------------------

function act(action: string, party = '', level = 0, diff = 0) {
  if (!isClientSynced()) return
  sendNet('party', { action, party, level, diff })
}

export function createParty(level = 0, diff = 0) {
  act('create', '', level, diff)
}

export function joinParty(id: string) {
  act('join', id)
}

export function leaveParty() {
  act('leave')
}

export function setReady(ready: boolean) {
  act(ready ? 'ready' : 'unready')
}

export function setPartyLevel(level: number) {
  const party = myParty()
  if (!party) return
  act('set', party.id, level, party.diff)
}

export function setPartyDifficulty(diff: number) {
  const party = myParty()
  if (!party) return
  act('set', party.id, party.level, diff)
}

export function startRun() {
  act('start')
}

/** A party of one, straight into the fight. */
export function soloRun(level: number, diff: number) {
  act('create', '', level, diff)
  act('start')
}

// The results screen's ways out (leader only; members mark themselves ready).

export function descend() {
  act('descend')
}

export function retryRun() {
  act('retry')
}

export function returnToHall() {
  act('hall')
}

/** Seconds the party has left on the results before the host walks it back to the hall. */
export function resultsWait(): number {
  const party = myParty()
  if (!party || party.state !== 'done') return 0
  return Math.max(0, party.wait - state.silence)
}

// --- following the host ---------------------------------------------------------------

/** The lobby opens by itself the first time the hero stands ready in the hall. */
let greeted = false
let standingFor = 0
const GREET_AFTER_SECONDS = 0.8
/** Long enough for the hall to build and the hero to land on its entrance. */
const REOPEN_AFTER_SECONDS = 1.2

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  state.silence += span
  const party = myParty()
  const phase = myPhase()
  if (!greeted && phase === HUB && !party) {
    // `visible` is false while a menu camera has the hero suspended, so this
    // only counts once the title or creator has actually let the player in.
    standingFor = getPlayerCharacterState().visible ? standingFor + span : 0
    if (standingFor >= GREET_AFTER_SECONDS) {
      greeted = true
      openLobby()
    }
  }
  if (phase !== appliedPhase) {
    if (phase === HUB) enterHub()
    else if (party) enterRun(party)
  } else if (party && phase !== HUB && party.run !== appliedRun) {
    // Same party, new run: the leader chose to descend or retry from the results.
    enterRun(party)
  }
  if (party && phase !== HUB && party.state === 'done' && appliedState !== 'done') {
    state.result = {
      won: party.won, level: party.level, diff: party.diff, time: party.time,
      slain: party.slain, total: party.total, coins: getLootState().coins - coinsAtStart
    }
  }
  appliedState = party?.state
  if (state.open && phase !== HUB) closeLobby()
  if (reopenLobbyIn > 0 && phase === HUB) {
    reopenLobbyIn -= span
    if (reopenLobbyIn <= 0) openLobby()
  }
}

function enterRun(party: PartyInfo) {
  appliedPhase = party.id
  appliedRun = party.run
  state.result = undefined
  state.banner = ''
  reopenLobbyIn = 0
  coinsAtStart = getLootState().coins
  const level = levelById(party.level)
  state.levelId = level.id
  closeLobby()
  setClientRun({ party: party.id, level: party.level, diff: party.diff })
  applyCameraSetting()
  loadDungeon(level.seed, level.style)
  movePlayerToSpawn()
  console.log(`[DG] entering ${level.name} (${difficultyById(party.diff).name}) with party ${party.id}, run ${party.run}`)
}

function enterHub() {
  const fromRun = appliedPhase !== HUB
  appliedPhase = HUB
  appliedRun = -1
  state.levelId = HUB_LEVEL.id
  setClientRun(undefined)
  applyCameraSetting()
  loadDungeon(HUB_LEVEL.seed, HUB_LEVEL.style)
  movePlayerToSpawn()
  if (fromRun) {
    // Back from a fortress: say what it changed and put the lobby straight up,
    // with the party's (already advanced) pick lit, so the next fight is one click.
    state.banner = bannerFor(state.result)
    state.result = undefined
    reopenLobbyIn = REOPEN_AFTER_SECONDS
  }
  console.log('[DG] back in the hall')
}

/** The line under the lobby title after a run. */
function bannerFor(result: RunResult | undefined): string {
  if (!result) return ''
  const level = LEVELS[result.level]
  if (!result.won) return `The party fell in ${level?.name ?? 'the fortress'}. Pick your next fight.`
  const next = nextLevel(result.level)
  if (next) return `${level?.name ?? 'The fortress'} cleared. ${next.name} is open to you.`
  const diff = difficultyById(result.diff)
  return `${level?.name ?? 'The last fortress'} cleared on ${diff.name}. All of ${realmOfLevel(result.level).name} has fallen to you.`
}

export function levelName(id: number): string {
  return LEVELS[id]?.name ?? 'Unknown'
}
