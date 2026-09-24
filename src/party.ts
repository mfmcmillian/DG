// Client mirror of the host's parties, and the lobby actions. The host's
// `parties` broadcast is the truth; this module keeps the latest copy, works
// out which phase we are in (our running party, or the hub) and, when that
// changes, rebuilds the dungeon for it and puts the player on the entrance.

import { engine, InputModifier, PointerLock, Transform } from '@dcl/sdk/ecs'
import { getDungeonState, loadDungeon } from './dungeon'
import { PIT_GATE_REACH, PIT_GATE_TAG, WAR_TABLE_TAG } from './dungeon/hub'
import { setClientRun } from './dungeonEnemies'
import { getLootState, getRunLoot, resetRunLoot } from './loot'
import { isClientSynced, localAddress } from './multiplayer'
import { onNet, sendNet } from './net'
import { HUB, setPartyLookup } from './partyLookup'
import { movePlayerToSpawn } from './playerPlacement'
import { applyCameraSetting } from './settings'
import { isRealmPreloaded } from './preloadPlan'
import { t } from './i18n'
import { getPickerState } from './characterPicker'
import { getPlayerCharacterState } from './playerCharacter'
import { DIFFICULTIES, difficultyById, HUB_LEVEL, levelById, LEVELS, RAID_PARTY } from './shared/levels'

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
  /** Seconds left on the results before the host sends the party to the hall; while open, seconds until the doors close (0: held). */
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
  /** Weapon ids this hero unlocked during the run, in the order they were picked up. */
  found: string[]
  /** Duplicates picked up and turned into coin. */
  salvaged: number
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
  /** A line over the hall for a few seconds: the welcome, or what the last run changed. */
  notice: string
  noticeFor: number
}

const state: LobbyState = { parties: [], open: false, silence: 0, progress: [], result: undefined, levelId: HUB_LEVEL.id, banner: '', notice: '', noticeFor: 0 }
/** The phase the built dungeon is for, and the party's run counter it was built for. */
let appliedPhase = HUB
let appliedRun = -1
let appliedState: PartyInfo['state'] | undefined = undefined
/** How long a hall notice stays up. */
const NOTICE_SECONDS = 9
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

function act(action: string, party = '', level = 0, diff = 0): boolean {
  if (!isClientSynced()) return false
  sendNet('party', { action, party, level, diff })
  return true
}

/**
 * Seconds left in which our `leave` is in flight. If the leader's descend is
 * handled first, the next snapshot still lists us in the party with a new run;
 * without this we would build the next fortress and teleport into it for a
 * frame before the snapshot that drops us sends us to the hall.
 */
let leaving = 0
const LEAVE_IN_FLIGHT_SECONDS = 4

/**
 * The one button. A party of one whose doors close in a few seconds; anyone in
 * the hall can step in before they do, and the leader can close them at once
 * (startRun) or hold them (holdDoors).
 */
export function goRun(level = 0, diff = 0) {
  act('go', '', level, diff)
}

/** Leader: stop the doors closing, or start the timer again. */
export function holdDoors() {
  act('hold')
}

/** Seconds until an open party's doors close, counted down between broadcasts; 0 when held. */
export function doorsWait(party: PartyInfo): number {
  if (party.state !== 'open' || party.wait <= 0) return 0
  return Math.max(0, party.wait - state.silence)
}

export function joinParty(id: string) {
  act('join', id)
}

export function leaveParty() {
  if (act('leave') && myParty()) leaving = LEAVE_IN_FLIGHT_SECONDS
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

/** Down the summoning circle into the Pit of Chains, whoever is already there. */
export function joinRaid() {
  act('raid')
}

/** Standing in the arena with the raid party. */
export function inRaid(): boolean {
  return myParty()?.id === RAID_PARTY
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

// --- the hall ---------------------------------------------------------------------------

/**
 * Standing at the war table (within reach of the hall's centrepiece), which is
 * where the in-world prompt to choose a dungeon appears. The HUD's Dungeons
 * button works from anywhere in the hall.
 */
export function atWarTable(): boolean {
  if (myPhase() !== HUB) return false
  const table = getDungeonState().instance?.tagged[WAR_TABLE_TAG]
  if (table === undefined) return false
  const t = Transform.getOrNull(table)
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!t || !p) return false
  const dx = p.position.x - t.position.x
  const dz = p.position.z - t.position.z
  return dx * dx + dz * dz <= WAR_TABLE_REACH * WAR_TABLE_REACH
}
const WAR_TABLE_REACH = 4.5

/**
 * Standing on the summoning circle: in the hall it leads down to the Pit, in
 * the arena's gate room it leads home. Both layouts tag the piece the same.
 */
export function atPitGate(): boolean {
  const phase = myPhase()
  if (phase !== HUB && phase !== RAID_PARTY) return false
  const gate = getDungeonState().instance?.tagged[PIT_GATE_TAG]
  if (gate === undefined) return false
  const t = Transform.getOrNull(gate)
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!t || !p) return false
  const dx = p.position.x - t.position.x
  const dz = p.position.z - t.position.z
  return dx * dx + dz * dz <= PIT_GATE_REACH * PIT_GATE_REACH
}

/** Put a line over the hall for a while. */
function notice(text: string) {
  state.notice = text
  state.noticeFor = text ? NOTICE_SECONDS : 0
}

// --- following the host ---------------------------------------------------------------

/** The hall says hello the first time the hero stands in it; the lobby waits to be asked. */
let greeted = false
let standingFor = 0
const GREET_AFTER_SECONDS = 0.8

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? dt : 0
  state.silence += span
  if (state.noticeFor > 0) {
    state.noticeFor -= span
    if (state.noticeFor <= 0) state.notice = ''
  }
  const party = myParty()
  const phase = myPhase()
  if (!greeted && phase === HUB && !party) {
    // `visible` is false while a menu camera has the hero suspended, so this
    // only counts once the title or creator has actually let the player in.
    standingFor = getPlayerCharacterState().visible ? standingFor + span : 0
    if (standingFor >= GREET_AFTER_SECONDS) {
      greeted = true
      notice(t('Welcome to the Hall of Antrom. The war table, or the Dungeons button, leads to the fortresses.'))
    }
  }
  if (leaving > 0) leaving = phase === HUB ? 0 : leaving - span
  syncReadiness(party, span)
  if (phase !== appliedPhase) {
    if (phase === HUB) enterHub()
    else if (party) enterRun(party)
  } else if (party && phase !== HUB && party.run !== appliedRun) {
    // Same party, new run: the leader chose to descend or retry from the results.
    // Not for us if we have just asked to leave: the hall is a snapshot away
    // (and if that snapshot never comes, the wait runs out and we follow after all).
    if (leaving <= 0) enterRun(party)
  }
  if (party && phase !== HUB && party.state === 'done' && appliedState !== 'done') {
    state.result = {
      won: party.won, level: party.level, diff: party.diff, time: party.time,
      slain: party.slain, total: party.total, coins: getLootState().coins - coinsAtStart,
      found: [...getRunLoot().found], salvaged: getRunLoot().salvaged
    }
  }
  appliedState = party?.state
  if (state.open && phase !== HUB) closeLobby()
}

/**
 * Readiness the player never has to press. As leader of an open party we are
 * ready when the realm is on disk (the host holds the doors while we are not,
 * and Go now is refused until then). As a member on the results, we are ready as soon as they show: the
 * leader decides, and anyone who has had enough leaves for the hall instead.
 */
let readinessAge = 0
let autoReadyRun = -1
function syncReadiness(party: PartyInfo | undefined, span: number) {
  readinessAge += span
  if (!party || readinessAge < 1) return
  const me = localAddress()
  const leader = party.leader === me
  const ready = party.ready.includes(me)
  if (party.state === 'open' && leader) {
    const want = isRealmPreloaded(levelById(party.level).style)
    if (want !== ready) {
      readinessAge = 0
      act(want ? 'ready' : 'unready')
    }
  } else if (party.state === 'done' && !leader && !ready && autoReadyRun !== party.run) {
    autoReadyRun = party.run
    readinessAge = 0
    act('ready')
  }
}

function enterRun(party: PartyInfo) {
  appliedPhase = party.id
  appliedRun = party.run
  state.result = undefined
  state.banner = ''
  notice('')
  coinsAtStart = getLootState().coins
  resetRunLoot()
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
    // Back from a fortress: say what it changed, over the hall now and again in
    // the lobby's header when it is next opened (with the party's advanced pick lit).
    state.banner = bannerFor(state.result)
    notice(state.banner)
    state.result = undefined
  }
  console.log('[DG] back in the hall')
}

/** The line under the lobby title after a run. */
function bannerFor(result: RunResult | undefined): string {
  if (!result) return ''
  const level = LEVELS[result.level]
  const outOfTime = (level?.seconds ?? 0) > 0 && result.time >= (level?.seconds ?? 0)
  if (!result.won) return outOfTime ? t('Time ran out in {level}. Go again.', { level: level?.name ?? t('the fortress') }) : t('The party fell in {level}. Go again.', { level: level?.name ?? t('the fortress') })
  const diff = difficultyById(result.diff)
  return t('{level} cleared on {difficulty}.', { level: level?.name ?? t('The fortress'), difficulty: t(diff.name) })
}

export function levelName(id: number): string {
  return LEVELS[id]?.name ?? 'Unknown'
}
