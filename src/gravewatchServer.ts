// Gravewatch on the headless host: the ember ledger, the day roll, the Wheel
// of Bones and the Gravewalk board, and the Reliquary's redeem. The server is the
// only clock and the only writer; a client can ask (gwAct, gwSpin, gwRoll,
// gwRedeem) and is answered with its whole sheet (gwState), so a reconnect
// never loses a roll. Guests earn nothing and buy nothing. The Rising itself
// (schedule, sign-ups, the Demon) is src/raid/risingServer.ts; it credits
// embers and flips wearables live through the hooks at the bottom.
//
// Storage: `gw26` per wallet (the ledger below), `gw:live` for the world (the
// wearables the Risings have won and those sold out); the Rising keeps its own
// `gw:rising:<date>` lists.

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { EnvVar, Storage } from '@dcl/sdk/server'
import { isHeadless, onHostStart, heroCharacters } from './multiplayer'
import { onNet, sendNet } from './net'
import { joinRounds, onRunFinished, sameParty } from './partyServer'
import { metricsMark } from './metrics'
import { classAllowsArmor } from './heroClasses'
import { DEVELOPERS } from './shared/developers'
import { newGearUid } from './shared/gearBag'
import {
  etDayKey, GW_BOARD, GW_BOARD_DOUBLE_COST, GW_BOARD_MILESTONES, GW_BOARD_PASS_EMBERS, GW_BOARD_TOKENS, GW_CLEAR_EMBERS, GW_CRYPT_CLEAR_MULT, GW_CURSE_MS,
  GW_EVENT_END, GW_HAT_STEPS, GW_ITEMS, GW_MULT, GW_MULT_MS, GW_PRICES, GW_ROUNDS_EMBERS, GW_SPIN_COST, GW_TILE_MAX_LEVEL, GW_TILE_POINTS, GW_TILE_POINTS_BIG,
  GW_GEAR_LEGENDARY, GW_WHEEL, GW_WHEEL_PITY, GwItem, itemLive, tilePay
} from './shared/gravewatch'
import { BARROW_YARD, LEVELS, RISING_PARTY } from './shared/levels'
import {
  newRunState, RUN_BOARD_SIZE, RUN_END_STEP, RUN_EXTRA_COST, RUN_HOST_DELAY, RUN_LANES, RUN_MILE, RUN_SPD_STEP, RUN_STAMINA, RUN_STATS, RUN_SYNC_SECONDS, RUN_TOKENS,
  RUN_TRAIN_MAX, runTierEmbers, runTrainCost, RunStat, RunState, runWeekKey, stepRun
} from './shared/barrowRun'
import { HUB } from './partyLookup'
import { RARITIES, rollArmorDrop, rollArmorRank } from './weapons'
import { initializeRisingServer, risingAct, risingSnapshot } from './raid/risingServer'

type RedeemState = 'pending' | 'granted' | 'failed'

/** One wallet's event ledger, as saved. */
type Ledger = {
  embers: number
  spent: number
  /** The ET day the daily counters belong to. */
  day: string
  rounds: number
  clears: number
  spins: number
  /** Gravewalk rolls today. */
  rolls: number
  /** Gravewalk: the pawn's tile, each tile's level (1..5), season points and milestones paid. */
  pos?: number
  tiles?: number[]
  points?: number
  miles?: number
  /** The x1.5 multiplier runs until this time (ms), when set. */
  mult?: number
  /** The Pumpkin Head on this hero runs until this time, when set; `held` while the wheel's waits to be handed out; `pity` spins since the wheel last gave gear. */
  curse?: number
  held?: boolean
  heads?: number
  pity?: number
  /** The Barrow Run: runs today, the best distance today (m), mileage points banked. */
  runs?: number
  best?: number
  mileage?: number
  /** Training levels: Endurance, Speed, Luck. */
  train?: [number, number, number]
  redeemed: Partial<Record<GwItem, RedeemState>>
  /** When the pending redeem was started, and for what, so one manual retry is allowed after a while. */
  pendingAt?: number
  pendingItem?: GwItem
}

type Live = { won: GwItem[]; sold: GwItem[] }

const LEDGER_KEY = 'gw26'
const LIVE_KEY = 'gw:live'
const REWARDS_URL = 'https://rewards.decentraland.org/api/rewards'
/** A pending redeem may be tried again by hand after this long (the dispenser dedupes, so a double grant cannot happen). */
const RETRY_AFTER_MS = 10 * 60 * 1000

const ledgers = new Map<string, Ledger>()
const loading = new Map<string, Promise<Ledger>>()
const keys: Partial<Record<GwItem | 'test', string>> = {}
let live: Live = { won: [], sold: [] }
let liveLoaded = false
/** Per wallet: the last spin's segment and the last roll, and a counter so the client can tell a fresh answer. */
const lastSpin = new Map<string, number>()
const lastRoll = new Map<string, number[]>()
/** The last gear prize per hero, "n:item@rank", n counting up so the client knows a new one. */
const lastGear = new Map<string, string>()
let gearCount = 0
const seqs = new Map<string, number>()
let initialized = false

export function initializeGravewatchServer() {
  if (initialized) return
  initialized = true
  onHostStart(bind)
}

function bind() {
  if (!isHeadless()) return
  void loadKeys()
  void loadLive()
  onNet('gwAct', (msg, context) => {
    if (!context) return
    void act(context.from.toLowerCase(), msg.what)
  })
  onNet('gwSpin', (_msg, context) => {
    if (!context) return
    void spin(context.from.toLowerCase())
  })
  onNet('gwRoll', (msg, context) => {
    if (!context) return
    void roll(context.from.toLowerCase(), msg.double)
  })
  onNet('gwRedeem', (msg, context) => {
    if (!context) return
    void redeem(context.from.toLowerCase(), msg.item)
  })
  onNet('gwRunStart', (msg, context) => {
    if (!context) return
    void startRun(context.from.toLowerCase(), msg.name)
  })
  onNet('gwTrain', (msg, context) => {
    if (!context) return
    void train(context.from.toLowerCase(), msg.stat)
  })
  onNet('gwBoard', (_msg, context) => {
    if (!context) return
    void sendBoards(context.from.toLowerCase())
  })
  onNet('gwRunLane', (msg, context) => {
    if (!context) return
    runLane(context.from.toLowerCase(), msg.at, msg.lane)
  })
  engine.addSystem(tickRuns)
  onRunFinished((party, won) => {
    if (!won || party.id === RISING_PARTY) return
    for (const member of party.members) void creditClear(member, party.level)
  })
  initializeRisingServer({
    credit: (id, amount, why) => void credit(id, amount, why).then(() => tell(id, '')),
    won: (item) => void markWon(item),
    isGuest,
    isDev,
    tell: (id) => void tell(id, ''),
    rewardGear: (id, x, z, source) => rewardGear(id, x, z, source)
  })
  console.log('[Gravewatch] the ledger is open')
}

// --- who ------------------------------------------------------------------------------

function isDev(id: string): boolean {
  return DEVELOPERS.has(id)
}

/** A guest (no wallet) earns nothing and buys nothing; a wallet the host cannot see counts as one. */
function isGuest(id: string): boolean {
  if (isDev(id)) return false
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address.toLowerCase() === id) return identity.isGuest
  }
  return true
}

function now(): number {
  return Date.now()
}

function over(): boolean {
  return now() >= GW_EVENT_END
}

// --- storage ----------------------------------------------------------------------------

async function loadKeys() {
  const names: Array<[GwItem | 'test', string]> = [['w1', 'REWARDS_KEY_W1'], ['w2', 'REWARDS_KEY_W2'], ['w3', 'REWARDS_KEY_W3'], ['test', 'REWARDS_KEY_TEST']]
  for (const [item, name] of names) {
    try {
      const value = await EnvVar.get(name)
      if (value) keys[item] = value
    } catch {
      // Unset: the card says "not yet available".
    }
  }
  console.log(`[Gravewatch] dispenser keys: ${names.map(([item]) => `${item}=${keys[item] ? 'set' : 'unset'}`).join(' ')}`)
}

async function loadLive() {
  try {
    const stored = await Storage.get<Live>(LIVE_KEY)
    if (stored && Array.isArray(stored.won)) live = { won: [...stored.won], sold: [...(stored.sold ?? [])] }
  } catch (error) {
    console.log('[Gravewatch] could not read the live flags', error)
  }
  liveLoaded = true
}

async function saveLive() {
  try {
    await Storage.set(LIVE_KEY, live)
  } catch (error) {
    console.log('[Gravewatch] could not save the live flags', error)
  }
}

function freshLedger(): Ledger {
  return { embers: 0, spent: 0, day: etDayKey(now()), rounds: 0, clears: 0, spins: 0, rolls: 0, redeemed: {} }
}

async function ledgerOf(id: string): Promise<Ledger> {
  const cached = ledgers.get(id)
  if (cached) return touch(cached)
  let pending = loading.get(id)
  if (!pending) {
    pending = (async () => {
      let ledger: Ledger | undefined
      try {
        ledger = (await Storage.player.get<Ledger>(id, LEDGER_KEY)) ?? undefined
      } catch (error) {
        console.log(`[Gravewatch] could not read the ledger of ${id}`, error)
      }
      const l = ledger && typeof ledger.embers === 'number' ? { ...freshLedger(), ...ledger, redeemed: ledger.redeemed ?? {} } : freshLedger()
      ledgers.set(id, l)
      loading.delete(id)
      return l
    })()
    loading.set(id, pending)
  }
  return touch(await pending)
}

/** The daily counters belong to one ET day; a new day empties them. */
function touch(l: Ledger): Ledger {
  const t = now()
  const day = etDayKey(t)
  // Hours banked under the old stacking rule (a day a wedge) are cut to the hour.
  if (l.mult && l.mult > t + GW_MULT_MS) l.mult = t + GW_MULT_MS
  if (l.curse && l.curse > t + GW_CURSE_MS) l.curse = t + GW_CURSE_MS
  if (l.day !== day) {
    l.day = day
    l.rounds = 0
    l.clears = 0
    l.spins = 0
    l.rolls = 0
    l.runs = 0
    l.best = 0
  }
  return l
}

async function save(id: string) {
  const l = ledgers.get(id)
  if (!l) return
  try {
    await Storage.player.set(id, LEDGER_KEY, l)
  } catch (error) {
    console.log(`[Gravewatch] could not save the ledger of ${id}`, error)
  }
}

// --- embers ------------------------------------------------------------------------------

/** Embers in, with the multiplier if one runs; nothing to guests, nothing after the end. */
async function credit(id: string, amount: number, why: string): Promise<number> {
  if (amount <= 0 || over() || isGuest(id)) return 0
  const l = await ledgerOf(id)
  const t = now()
  const boosted = boost(l, amount, t)
  l.embers += boosted
  console.log(`[Gravewatch] ${id} +${boosted} embers (${why}), has ${l.embers}`)
  void save(id)
  return boosted
}

/** An ember amount with the x1.5 if it runs: every ember that comes in, the wheel's and the board's too. */
function boost(l: Ledger, amount: number, t: number): number {
  return l.mult && l.mult > t ? Math.round(amount * GW_MULT) : amount
}

/** Start the x1.5 for its hour; while one runs, another does nothing. */
function startMult(l: Ledger, t: number) {
  if (!(l.mult && l.mult > t)) l.mult = t + GW_MULT_MS
}

/** A run's verdict: the Barrow Yard pays Rounds, the ladder pays clears (the Crypt double). */
async function creditClear(id: string, level: number) {
  if (over() || isGuest(id)) return
  const l = await ledgerOf(id)
  if (level === BARROW_YARD.id) {
    const pay = GW_ROUNDS_EMBERS[l.rounds] ?? 0
    l.rounds++
    metricsMark(id, 'gw-rounds')
    if (pay > 0) await credit(id, pay, `rounds ${l.rounds}`)
    else void save(id)
  } else if (level >= 0 && level < LEVELS.length) {
    const base = GW_CLEAR_EMBERS[l.clears] ?? 0
    l.clears++
    const pay = LEVELS[level].realm === 'crypt' ? base * GW_CRYPT_CLEAR_MULT : base
    if (pay > 0) await credit(id, pay, `clear ${l.clears} of ${LEVELS[level].name}`)
    else void save(id)
  }
  void tell(id, '')
}

// --- the sheet ---------------------------------------------------------------------------------

async function act(id: string, what: string) {
  switch (what) {
    case 'state':
      await tell(id, '')
      return
    case 'rounds':
      if (over()) return tell(id, 'over')
      joinRounds(id)
      await tell(id, '')
      return
    case 'signup':
    case 'unsign':
    case 'join':
    case 'leave': {
      if (over()) return tell(id, 'over')
      if (isGuest(id)) return tell(id, 'guest')
      const note = risingAct(id, what)
      await tell(id, note)
      return
    }
    case 'grant': {
      // Developers only: a thousand test embers, never counted as earned.
      if (!isDev(id)) return
      const l = await ledgerOf(id)
      l.embers += 1000
      l.rolls = 0
      l.spins = 0
      void save(id)
      await tell(id, '')
      return
    }
    default:
      if (what.startsWith('curse:')) await curse(id, what.slice('curse:'.length).toLowerCase())
      return
  }
}

/** The wheel's Pumpkin Head handed to a party member (or kept): the grinning mask for an hour, and x1.5 embers while it is worn. */
async function curse(id: string, target: string) {
  const l = await ledgerOf(id)
  if (!l.held) return tell(id, '')
  const to = target || id
  if (to !== id && !sameParty(id, to)) return tell(id, 'party')
  l.heads = Math.max(0, (l.heads ?? 1) - 1)
  l.held = l.heads > 0
  void save(id)
  const victim = await ledgerOf(to)
  const t = now()
  // A head on a hero already wearing one does nothing more; the x1.5 likewise only starts if none runs.
  if (!(victim.curse && victim.curse > t)) victim.curse = t + GW_CURSE_MS
  startMult(victim, t)
  if (to !== id) void save(to)
  metricsMark(id, 'gw-curse')
  await tell(id, 'cursed')
  if (to !== id) await tell(to, 'cursed')
}

/** The whole sheet to one client. */
async function tell(id: string, note: string) {
  const l = await ledgerOf(id)
  const t = now()
  const rising = risingSnapshot(id, t)
  const seq = (seqs.get(id) ?? 0) + 1
  seqs.set(id, seq)
  const redeemed: string[] = []
  for (const item of GW_ITEMS) if (l.redeemed[item]) redeemed.push(`${item}:${l.redeemed[item]}`)
  const keyed: string[] = GW_ITEMS.filter((item) => !!(isDev(id) && keys.test ? keys.test : keys[item]))
  sendNet('gwState', {
    now: t,
    over: over(),
    guest: isGuest(id),
    embers: l.embers,
    rounds: l.rounds,
    clears: l.clears,
    spins: l.spins,
    rolls: l.rolls,
    mult: l.mult && l.mult > t ? l.mult : 0,
    curse: l.curse && l.curse > t ? l.curse : 0,
    held: !!l.held,
    heads: l.held ? Math.max(1, l.heads ?? 1) : 0,
    pity: l.pity ?? 0,
    gear: lastGear.get(id) ?? '',
    live: GW_ITEMS.filter((item) => itemLive(item, live.won, t) || isDev(id)),
    won: [...live.won],
    sold: [...live.sold],
    keyed,
    redeemed,
    rising: rising.start,
    phase: rising.phase,
    signed: rising.signed,
    signedUp: rising.signedUp,
    arena: rising.arena,
    pos: l.pos ?? 0,
    tiles: GW_BOARD.map((_tile, i) => l.tiles?.[i] ?? 1),
    points: l.points ?? 0,
    miles: l.miles ?? 0,
    runs: l.runs ?? 0,
    best: l.best ?? 0,
    mileage: l.mileage ?? 0,
    train: l.train ?? [0, 0, 0],
    spin: lastSpin.get(id) ?? -1,
    roll: lastRoll.get(id) ?? [],
    seq,
    note
  }, { to: [id] })
}

// --- the Wheel of Bones ---------------------------------------------------------------------

async function spin(id: string) {
  if (over()) return tell(id, 'over')
  if (isGuest(id)) return tell(id, 'guest')
  const l = await ledgerOf(id)
  const free = l.spins === 0
  if (!free) {
    if (l.embers < GW_SPIN_COST) return tell(id, 'poor')
    l.embers -= GW_SPIN_COST
    l.spent += GW_SPIN_COST
  }
  l.spins++
  let total = 0
  for (const seg of GW_WHEEL) total += seg.weight
  let pick = Math.random() * total
  let index = 0
  for (let i = 0; i < GW_WHEEL.length; i++) {
    pick -= GW_WHEEL[i].weight
    if (pick <= 0) {
      index = i
      break
    }
  }
  // Pity: the spin that makes GW_WHEEL_PITY without gear lands on it.
  l.pity = (l.pity ?? 0) + 1
  if (l.pity >= GW_WHEEL_PITY) index = GW_WHEEL.findIndex((seg) => seg.kind === 'gear')
  const seg = GW_WHEEL[index]
  if (seg.kind === 'gear') l.pity = 0
  const t = now()
  switch (seg.kind) {
    case 'embers':
      l.embers += boost(l, seg.amount, t)
      break
    case 'coins':
      sendNet('loot', { party: HUB, x: 0, z: 0, coin: seg.amount, heart: 0, item: '', boss: true, up: 0, uid: '' }, { to: [id] })
      break
    case 'gear':
      rewardGear(id, 0, 0)
      break
    case 'mult':
      startMult(l, t)
      break
    case 'curse':
      l.held = true
      l.heads = (l.heads ?? 0) + 1
      break
  }
  lastSpin.set(id, index)
  metricsMark(id, 'gw-spin')
  console.log(`[Gravewatch] ${id} spins (${free ? 'free' : 'paid'}): ${seg.label}`)
  void save(id)
  await tell(id, `spin:${seg.label}`)
}

/**
 * A piece of armor from any open realm, cut for the hero: the wheel's gear
 * prize, the Gear grave and the season chest fall epic (legendary one time
 * in four); the Rising's drop rolls as a Hard boss.
 */
function rewardGear(id: string, x: number, z: number, source: 'elite' | 'boss' = 'elite') {
  const mine = heroCharacters((owner) => owner === id)
  // A prize, not a kill: the first roll (does anything drop?) always passes, the pick is a fair one.
  let first = true
  const sure = () => { if (first) { first = false; return 0 } return Math.random() }
  const armor = rollArmorDrop(source, LEVELS.map((l) => l.realm), sure, (piece) => mine.every((cid) => classAllowsArmor(cid, piece.hero)))
  if (!armor) return
  const party = source === 'boss' ? RISING_PARTY : HUB
  const up = source === 'boss' ? rollArmorRank(source, 2) : Math.random() < GW_GEAR_LEGENDARY ? RARITIES.legendary.rank : RARITIES.epic.rank
  lastGear.set(id, `${++gearCount}:${armor}@${up}`)
  sendNet('loot', { party, x, z, coin: 0, heart: 0, item: armor, boss: true, up, uid: newGearUid() }, { to: [id] })
}

// --- Gravewalk, the board -------------------------------------------------------------------

/**
 * One roll: a die (or two, for a fee), the pawn moves, the tile pays and
 * levels, points and the daily meter climb and pay their milestones. The
 * client gets the dice and both ends of the move to animate, and the pay in
 * the note.
 */
async function roll(id: string, double: boolean) {
  if (over()) return tell(id, 'over')
  if (isGuest(id)) return tell(id, 'guest')
  const l = await ledgerOf(id)
  if (l.rolls >= GW_BOARD_TOKENS) return tell(id, 'capped')
  if (double) {
    if (l.embers < GW_BOARD_DOUBLE_COST) return tell(id, 'poor')
    l.embers -= GW_BOARD_DOUBLE_COST
    l.spent += GW_BOARD_DOUBLE_COST
  }
  const die = () => 1 + Math.floor(Math.random() * 6)
  const d1 = die()
  const d2 = double ? die() : 0
  const from = l.pos ?? 0
  const to = (from + d1 + d2) % GW_BOARD.length
  const passed = from + d1 + d2 >= GW_BOARD.length
  const tiles = l.tiles ?? GW_BOARD.map(() => 1)
  const tile = GW_BOARD[to]
  const level = tiles[to] ?? 1
  const t = now()
  let paid = 0
  let said = tile.label
  if (passed && to !== 0) paid += GW_BOARD_PASS_EMBERS
  switch (tile.kind) {
    case 'start':
      paid += GW_BOARD_PASS_EMBERS * 2
      break
    case 'embers': {
      const pay = tilePay(tile.amount, level)
      paid += pay
      said = `${pay} embers`
      break
    }
    case 'coins': {
      const coins = tilePay(tile.amount, level)
      sendNet('loot', { party: HUB, x: 0, z: 0, coin: coins, heart: 0, item: '', boss: true, up: 0, uid: '' }, { to: [id] })
      said = `${coins} coins`
      break
    }
    case 'chest': {
      // Five to twenty-five, grown by the level.
      const found = tilePay(5 + Math.floor(Math.random() * 21), level)
      paid += found
      said = `Chest: ${found} embers`
      break
    }
    case 'gear':
      rewardGear(id, 0, 0)
      said = 'A piece of gear'
      break
    case 'curse':
      l.held = true
      l.heads = (l.heads ?? 0) + 1
      said = 'A Pumpkin Head to give out'
      break
    case 'mystery': {
      const pick = Math.random()
      if (pick < 0.5) {
        const found = tilePay(20, level)
        paid += found
        said = `${found} embers`
      } else if (pick < 0.85) {
        sendNet('loot', { party: HUB, x: 0, z: 0, coin: 200, heart: 0, item: '', boss: true, up: 0, uid: '' }, { to: [id] })
        said = '200 coins'
      } else {
        startMult(l, t)
        said = 'Embers x1.5 for an hour'
      }
      break
    }
  }
  if (tile.kind !== 'start' && level < GW_TILE_MAX_LEVEL) tiles[to] = level + 1
  l.tiles = tiles
  l.pos = to
  l.rolls++
  // The x1.5, if it runs, on the roll's embers (the client shows the boosted figure).
  paid = boost(l, paid, t)
  l.embers += paid
  // Points and the season chests.
  l.points = (l.points ?? 0) + (tile.kind === 'chest' || tile.kind === 'gear' ? GW_TILE_POINTS_BIG : GW_TILE_POINTS)
  let miles = l.miles ?? 0
  while (miles < GW_BOARD_MILESTONES.length && l.points >= GW_BOARD_MILESTONES[miles].points) {
    const m = GW_BOARD_MILESTONES[miles]
    if (m.kind === 'embers') l.embers += boost(l, m.amount, t)
    else rewardGear(id, 0, 0)
    console.log(`[Gravewatch] ${id} reaches ${m.points} board points: ${m.label}`)
    miles++
  }
  l.miles = miles
  // The daily meter.
  for (const step of GW_HAT_STEPS) if (step.rolls === l.rolls) l.embers += boost(l, step.embers, t)
  lastRoll.set(id, [d1, d2, from, to, passed ? 1 : 0, paid])
  metricsMark(id, 'gw-roll')
  void save(id)
  await tell(id, `board:${said}`)
}

// --- the Barrow Run -----------------------------------------------------------------------

/** A race in progress: the road's seed, when it started, the host's state, and the hero's lane changes in run seconds. */
type HostRun = { seed: number; started: number; state: RunState; lanes: { at: number; lane: number }[]; syncAt: number }
const runs = new Map<string, HostRun>()

async function startRun(id: string, name: string) {
  if (over()) return tell(id, 'over')
  if (isGuest(id)) return tell(id, 'guest')
  if (runs.has(id)) return
  const l = await ledgerOf(id)
  const shown = (name || '').trim().slice(0, 24)
  if (shown) names.set(id, shown)
  const free = (l.runs ?? 0) < RUN_TOKENS
  if (!free) {
    if (l.embers < RUN_EXTRA_COST) return tell(id, 'poor')
    l.embers -= RUN_EXTRA_COST
    l.spent += RUN_EXTRA_COST
  }
  l.runs = (l.runs ?? 0) + 1
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const started = now()
  const [end, spd, lck] = l.train ?? [0, 0, 0]
  const state = newRunState(RUN_STAMINA * (1 + RUN_END_STEP * end), 1 + RUN_SPD_STEP * spd, lck)
  runs.set(id, { seed, started, state, lanes: [{ at: 0, lane: 1 }], syncAt: 0 })
  metricsMark(id, 'gw-run')
  console.log(`[Gravewatch] ${id} runs the barrows (${free ? 'free' : 'paid'}), seed ${seed}`)
  void save(id)
  sendNet('gwRun', { seed, started, staminaMax: state.staminaMax, speedMult: state.speedMult, luck: state.luck }, { to: [id] })
  await tell(id, '')
}

/** A lane change, at the client's run clock; it may not claim a moment already raced, nor one ahead of the host's own clock. */
function runLane(id: string, at: number, lane: number) {
  const run = runs.get(id)
  if (!run || run.state.over || !Number.isFinite(at)) return
  if (lane < 0 || lane >= RUN_LANES || lane !== Math.floor(lane)) return
  const clock = (now() - run.started) / 1000
  const when = Math.max(run.state.t, Math.min(at, clock + 0.05))
  const last = run.lanes[run.lanes.length - 1]
  if (last && when < last.at) return
  run.lanes.push({ at: when, lane })
}

function laneAt(run: HostRun, t: number): number {
  let lane = run.lanes[0]?.lane ?? 1
  for (const change of run.lanes) {
    if (change.at > t) break
    lane = change.lane
  }
  return lane
}

/** The host races each run up to a beat behind the clock, in small steps with the lane the hero had at each. */
function tickRuns() {
  if (!runs.size) return
  const t = now()
  for (const [id, run] of runs) {
    const target = (t - run.started) / 1000 - RUN_HOST_DELAY
    while (!run.state.over && run.state.t < target) {
      run.state.lane = laneAt(run, run.state.t)
      stepRun(run.state, Math.min(0.05, target - run.state.t), run.seed)
    }
    if (run.state.over) {
      runs.delete(id)
      void finishRun(id, run)
    } else if (run.state.t - run.syncAt >= RUN_SYNC_SECONDS) {
      run.syncAt = run.state.t
      const st = run.state
      sendNet('gwRunSync', { t: st.t, s: st.s, stamina: st.stamina, hits: st.hits, embers: st.embers, over: false, paid: 0 }, { to: [id] })
    }
  }
}

/** The race is run: the tiers pay, the embers picked up pay, the best and the mileage are kept. */
async function finishRun(id: string, run: HostRun) {
  const st = run.state
  const metres = Math.floor(st.s)
  const l = await ledgerOf(id)
  const t = now()
  const paid = boost(l, runTierEmbers(metres) + st.embers, t)
  l.embers += paid
  l.best = Math.max(l.best ?? 0, metres)
  l.mileage = (l.mileage ?? 0) + Math.floor(st.s / RUN_MILE)
  console.log(`[Gravewatch] ${id} ran ${metres} m (${st.hits} hits, ${st.picks} pickups): +${paid} embers, has ${l.embers}`)
  void save(id)
  void recordBest(id, metres, t)
  sendNet('gwRunSync', { t: st.t, s: st.s, stamina: 0, hits: st.hits, embers: st.embers, over: true, paid }, { to: [id] })
  await tell(id, '')
}

/** Mileage points into a stat: the next level costs 10, 20, 30… up to ten levels. */
async function train(id: string, stat: string) {
  if (!(RUN_STATS as readonly string[]).includes(stat)) return
  const l = await ledgerOf(id)
  const train: [number, number, number] = l.train ? [...l.train] : [0, 0, 0]
  const i = RUN_STATS.indexOf(stat as RunStat)
  if (train[i] >= RUN_TRAIN_MAX) return tell(id, '')
  const cost = runTrainCost(train[i])
  if ((l.mileage ?? 0) < cost) return tell(id, 'miles')
  l.mileage = (l.mileage ?? 0) - cost
  train[i]++
  l.train = train
  console.log(`[Gravewatch] ${id} trains ${stat} to ${train[i]} for ${cost} mileage`)
  void save(id)
  await tell(id, 'trained')
}

// --- the leaderboards: best distance per wallet, this week and all time ------------------------

type BoardRow = { id: string; name: string; m: number }
type Board = { rows: BoardRow[] }
const BOARD_ALL_KEY = 'gw:run:all'
const boards = new Map<string, Board>()
/** The last name each wallet gave when starting a run. */
const names = new Map<string, string>()

function weekBoardKey(t: number): string {
  return `gw:run:w:${runWeekKey(etDayKey(t))}`
}

async function boardOf(key: string): Promise<Board> {
  const held = boards.get(key)
  if (held) return held
  let board: Board = { rows: [] }
  try {
    const stored = await Storage.get<Board>(key)
    if (stored && Array.isArray(stored.rows)) board = { rows: stored.rows.filter((r) => r && typeof r.id === 'string' && Number.isFinite(r.m)) }
  } catch (error) {
    console.log(`[Gravewatch] could not read ${key}`, error)
  }
  boards.set(key, board)
  return board
}

async function recordBest(id: string, metres: number, t: number) {
  if (metres <= 0) return
  const name = names.get(id) ?? ''
  for (const key of [BOARD_ALL_KEY, weekBoardKey(t)]) {
    const board = await boardOf(key)
    const mine = board.rows.find((r) => r.id === id)
    if (mine) {
      if (metres <= mine.m && (!name || mine.name === name)) continue
      mine.m = Math.max(mine.m, metres)
      if (name) mine.name = name
    } else board.rows.push({ id, name, m: metres })
    board.rows.sort((a, b) => b.m - a.m)
    board.rows = board.rows.slice(0, RUN_BOARD_SIZE)
    try {
      await Storage.set(key, board)
    } catch (error) {
      console.log(`[Gravewatch] could not save ${key}`, error)
    }
  }
}

async function sendBoards(id: string) {
  const week = await boardOf(weekBoardKey(now()))
  const all = await boardOf(BOARD_ALL_KEY)
  sendNet('gwBoardState', { week: week.rows, all: all.rows }, { to: [id] })
}

// --- the Reliquary -----------------------------------------------------------------------------

function isItem(value: string): value is GwItem {
  return (GW_ITEMS as readonly string[]).includes(value)
}

async function markWon(item: GwItem) {
  if (!liveLoaded) await loadLive()
  if (live.won.includes(item)) return
  live.won.push(item)
  await saveLive()
  console.log(`[Gravewatch] ${item} is live in the Reliquary for everyone`)
}

async function markSold(item: GwItem) {
  if (live.sold.includes(item)) return
  live.sold.push(item)
  await saveLive()
}

/**
 * The redeem state machine. Guest, event open, item live, stock, balance and
 * no grant or pending already -> `pending` and the price taken -> the call ->
 * `granted`. A definite refusal -> `failed` and the price back (sold out marks
 * the item for everyone). An unknown outcome stays `pending`: the client says
 * "minting, check your backpack", and one retry by hand is allowed after a
 * while, safe because the dispenser allows one assignment per wallet.
 */
async function redeem(id: string, raw: string) {
  if (!isItem(raw)) return
  const item = raw
  if (over()) return tell(id, 'over')
  if (isGuest(id)) return tell(id, 'guest')
  const l = await ledgerOf(id)
  const t = now()
  const dev = isDev(id)
  const key = dev && keys.test ? keys.test : keys[item]
  if (!key) return tell(id, 'nokey')
  if (!itemLive(item, live.won, t) && !dev) return tell(id, 'locked')
  if (live.sold.includes(item)) return tell(id, 'sold')
  const state = l.redeemed[item]
  if (state === 'granted') return tell(id, 'yours')
  if (state === 'pending') {
    // Still minting, unless it has been long enough for one retry by hand.
    if (!(l.pendingItem === item && l.pendingAt && t - l.pendingAt >= RETRY_AFTER_MS)) return tell(id, 'minting')
  } else {
    if (l.embers < GW_PRICES[item]) return tell(id, 'poor')
    l.embers -= GW_PRICES[item]
    l.spent += GW_PRICES[item]
  }
  l.redeemed[item] = 'pending'
  l.pendingAt = t
  l.pendingItem = item
  await save(id)
  await tell(id, 'minting')

  let outcome: 'granted' | 'failed' | 'unknown' = 'unknown'
  let reason = ''
  try {
    const response = await fetch(REWARDS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_key: key, beneficiary: id })
    })
    let body: { ok?: boolean; error?: string } = {}
    try {
      body = (await response.json()) as { ok?: boolean; error?: string }
    } catch {
      body = {}
    }
    if (response.ok && body.ok !== false) outcome = 'granted'
    else if (response.status >= 400 && response.status < 500) {
      outcome = 'failed'
      reason = String(body.error ?? response.status)
    } else {
      reason = String(body.error ?? response.status)
    }
  } catch (error) {
    reason = String(error)
  }

  if (outcome === 'granted') {
    l.redeemed[item] = 'granted'
    l.pendingAt = undefined
    l.pendingItem = undefined
    metricsMark(id, `gw-redeem:${item}`)
    console.log(`[Gravewatch] ${id} redeemed ${item}`)
    await save(id)
    await tell(id, 'granted')
    return
  }
  if (outcome === 'failed') {
    l.redeemed[item] = 'failed'
    l.pendingAt = undefined
    l.pendingItem = undefined
    l.embers += GW_PRICES[item]
    l.spent -= GW_PRICES[item]
    const soldOut = /stock|supply|out of|no more|exhaust|limit/i.test(reason) && !/per user|already/i.test(reason)
    if (soldOut) await markSold(item)
    console.log(`[Gravewatch] ${id} redeem of ${item} refused: ${reason}`)
    await save(id)
    await tell(id, soldOut ? 'sold' : /already|per user/i.test(reason) ? 'owned' : 'failed')
    return
  }
  // Unknown: the dispenser may have minted it. Stay pending; the retry is the player's, later.
  console.log(`[Gravewatch] ${id} redeem of ${item} unresolved: ${reason}`)
  await tell(id, 'minting')
}

/** For the server logs. */
export function gravewatchStatus(): string {
  return `ledgers ${ledgers.size}, live ${live.won.join('+') || '-'}, sold ${live.sold.join('+') || '-'}, keys ${Object.keys(keys).join('+') || '-'}`
}
