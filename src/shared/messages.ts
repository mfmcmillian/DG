import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'
// The hero bodies travel as a synced component, not as messages; defining it
// here keeps every runtime (server and clients) registering it before main().
import './heroBody'

const EnemySnap = Schemas.Map({
  i: Schemas.Int,
  x: Schemas.Number,
  z: Schemas.Number,
  f: Schemas.Number,
  h: Schemas.Number,
  m: Schemas.String,
  dead: Schemas.Boolean,
  engaged: Schemas.Boolean
})

const PartySnap = Schemas.Map({
  id: Schemas.String,
  leader: Schemas.String,
  level: Schemas.Int,
  diff: Schemas.Int,
  /** open (in the hub), running, done. */
  state: Schemas.String,
  members: Schemas.Array(Schemas.String),
  ready: Schemas.Array(Schemas.String),
  /** Run bookkeeping: seconds since the start, enemies slain / total, and the verdict once done. */
  time: Schemas.Number,
  slain: Schemas.Int,
  total: Schemas.Int,
  won: Schemas.Boolean,
  /** Counts up with every run the party starts, so a client can tell a new run in the same party. */
  run: Schemas.Int,
  /** While `done`: seconds left before the host sends the party back to the hall on its own. */
  wait: Schemas.Number
})

export const Messages = {
  hitEnemy: Schemas.Map({ id: Schemas.String, i: Schemas.Int, motion: Schemas.String, finisher: Schemas.Boolean }),
  /**
   * Server -> all: an enemy blow resolved against a hero. `health` is the
   * authoritative value after the blow; `blocked`/`dodged` carry no damage and
   * exist so every client can play the right feedback on that hero.
   */
  hitPlayer: Schemas.Map({
    id: Schemas.String,
    damage: Schemas.Number,
    stagger: Schemas.Number,
    yaw: Schemas.Number,
    health: Schemas.Number,
    blocked: Schemas.Boolean,
    dodged: Schemas.Boolean
  }),
  /** Server -> all: a hero regained health (heart pickup today; spells later). */
  heal: Schemas.Map({ id: Schemas.String, amount: Schemas.Number, health: Schemas.Number }),
  /** Server -> all: a downed hero is back on their feet at full health. */
  revive: Schemas.Map({ id: Schemas.String, health: Schemas.Number }),
  /**
   * Server -> all: the ledger's current health for one hero. Sent when the
   * server first meets a hero and every couple of seconds after, so a client
   * that missed a `hitPlayer`, `heal` or `revive` pulls back in line.
   */
  vitals: Schemas.Map({ id: Schemas.String, health: Schemas.Number }),
  /** Client -> server: the hero walked over a heart it saw at (x, z). */
  pickup: Schemas.Map({ x: Schemas.Number, z: Schemas.Number }),
  /** Client -> server: the local recover countdown ran out without a revive. */
  respawn: Schemas.Map({ id: Schemas.String }),
  impact: Schemas.Map({
    id: Schemas.String,
    x: Schemas.Number,
    y: Schemas.Number,
    z: Schemas.Number,
    heavy: Schemas.Boolean,
    blocked: Schemas.Boolean,
    label: Schemas.String,
    kind: Schemas.String,
    sound: Schemas.String,
    vol: Schemas.Number
  }),
  /**
   * Client -> server -> other clients: a hero fired a shot (archer arrow,
   * spellblade bolt). Visual only: the hit it lands travels as `hitEnemy` and
   * the host's enemy snapshot. `yaw`/`pitch` are the flight direction in radians.
   */
  shot: Schemas.Map({
    id: Schemas.String,
    motion: Schemas.String,
    x: Schemas.Number,
    y: Schemas.Number,
    z: Schemas.Number,
    yaw: Schemas.Number,
    pitch: Schemas.Number
  }),
  /** Server -> all: one party's enemies. Clients apply only the snapshot for the party they are in. */
  enemies: Schemas.Map({ party: Schemas.String, list: Schemas.Array(EnemySnap) }),
  loot: Schemas.Map({
    party: Schemas.String,
    x: Schemas.Number,
    z: Schemas.Number,
    coin: Schemas.Int,
    heart: Schemas.Int,
    /** Weapon id dropped with the kill, '' for none. */
    item: Schemas.String,
    /** The Warlord's drop: presented with a beam. */
    boss: Schemas.Boolean
  }),
  /** Client -> server: a one-line status the server prints, so client state shows in `server-logs`. */
  diag: Schemas.Map({ note: Schemas.String }),

  // --- parties and runs -------------------------------------------------------
  /**
   * Client -> server: a lobby action. `action` is one of create, join, leave,
   * ready, unready, set (level/diff, leader only), start (leader only).
   */
  party: Schemas.Map({ action: Schemas.String, party: Schemas.String, level: Schemas.Int, diff: Schemas.Int }),
  /** Server -> all: every party in the room. Sent on each change and every few seconds. */
  parties: Schemas.Map({ list: Schemas.Array(PartySnap) }),

  // --- saved heroes -------------------------------------------------------------
  /** Client -> server: persist this hero (appearance, gear, coins, unlocks) under the sender's wallet. */
  saveHero: Schemas.Map({
    cid: Schemas.String,
    body: Schemas.String,
    hair: Schemas.String,
    hc: Schemas.String,
    skin: Schemas.String,
    /** The loadout as JSON, so new slots never need a schema change. */
    loadout: Schemas.String,
    coins: Schemas.Int,
    unlocks: Schemas.Array(Schemas.String),
    /** Player settings as JSON (camera, dev panel), same reasoning as loadout. */
    prefs: Schemas.String
  }),
  /** Client -> server: send me what you have saved for my wallet. */
  loadHero: Schemas.Map({ v: Schemas.Int }),
  /** Server -> one client: the saved hero, or `found: false`. */
  savedHero: Schemas.Map({
    id: Schemas.String,
    found: Schemas.Boolean,
    cid: Schemas.String,
    body: Schemas.String,
    hair: Schemas.String,
    hc: Schemas.String,
    skin: Schemas.String,
    loadout: Schemas.String,
    coins: Schemas.Int,
    unlocks: Schemas.Array(Schemas.String),
    prefs: Schemas.String,
    progress: Schemas.Array(Schemas.Int)
  }),
  /** Server -> all: a hero's level progress changed (a run was cleared). */
  progress: Schemas.Map({ id: Schemas.String, progress: Schemas.Array(Schemas.Int) })
}

/** Register before `main()` so both the headless server and every client share one room. */
export const room = registerMessages(Messages)
