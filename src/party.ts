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
import { getPickerState } from './characterPicker'
import { getPlayerCharacterState } from './playerCharacter'
import { difficultyById, HUB_LEVEL, levelById, LEVELS } from './shared/levels'

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
  /** The level the player is standing in (hub = the first fortress, empty). */
  levelId: number
}

const state: LobbyState = { parties: [], open: false, silence: 0, progress: [], result: undefined, levelId: HUB_LEVEL.id }
/** The phase the built dungeon is for. */
let appliedPhase = HUB
let appliedState: PartyInfo['state'] | undefined = undefined
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
      time: p.time, slain: p.slain, total: p.total, won: p.won
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

// --- following the host ---------------------------------------------------------------

/** The lobby opens by itself the first time the hero stands ready in the hall. */
let greeted = false
let standingFor = 0
const GREET_AFTER_SECONDS = 0.8

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
  }
  if (party && phase !== HUB && party.state === 'done' && appliedState !== 'done') {
    state.result = {
      won: party.won, level: party.level, diff: party.diff, time: party.time,
      slain: party.slain, total: party.total, coins: getLootState().coins - coinsAtStart
    }
  }
  appliedState = party?.state
  if (state.open && phase !== HUB) closeLobby()
}

function enterRun(party: PartyInfo) {
  appliedPhase = party.id
  state.result = undefined
  coinsAtStart = getLootState().coins
  const level = levelById(party.level)
  state.levelId = level.id
  closeLobby()
  setClientRun({ party: party.id, level: party.level, diff: party.diff })
  loadDungeon(level.seed, level.style)
  movePlayerToSpawn()
  console.log(`[DG] entering ${level.name} (${difficultyById(party.diff).name}) with party ${party.id}`)
}

function enterHub() {
  appliedPhase = HUB
  state.levelId = HUB_LEVEL.id
  setClientRun(undefined)
  loadDungeon(HUB_LEVEL.seed, HUB_LEVEL.style)
  movePlayerToSpawn()
  console.log('[DG] back in the hub')
}

export function levelName(id: number): string {
  return LEVELS[id]?.name ?? 'Unknown'
}
