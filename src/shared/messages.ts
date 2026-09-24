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
  engaged: Schemas.Boolean,
  /** Arrived (gauntlet waves): false while the enemy waits unseen for its wave. */
  a: Schemas.Boolean
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
  /** While `done`: seconds left before the host sends the party back to the hall on its own.
   *  While `open`: seconds until the doors close and the run starts on its own (0: held open). */
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
  /** Server -> all: a downed hero is back on their feet at full health; `inPlace` when an ally raised them where they fell. */
  revive: Schemas.Map({ id: Schemas.String, health: Schemas.Number, inPlace: Schemas.Boolean }),
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
    vol: Schemas.Number,
    /** '' for a hit on a body; 'wood' or 'straw' for a training dummy, which throws chips instead of sparks. */
    material: Schemas.String
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
  // --- skills (src/shared/skills.ts) -----------------------------------------------------
  /**
   * Client -> server -> all: a hero's skill fired at its contact frame; (x, z)
   * is where its effect lands (a zone's centre, the caster for an aura). The
   * server applies auras and zones itself and relays the cast for the FX.
   */
  skillCast: Schemas.Map({ id: Schemas.String, skill: Schemas.String, x: Schemas.Number, z: Schemas.Number, yaw: Schemas.Number }),
  /** Client -> server: a skill's blow (a strike's arc, a shot's body) landed on enemy `i`. */
  hitSkill: Schemas.Map({ id: Schemas.String, i: Schemas.Int, skill: Schemas.String }),
  /** Server -> all: a buff on a hero: multipliers on damage dealt / taken for `seconds`. */
  buff: Schemas.Map({ id: Schemas.String, skill: Schemas.String, might: Schemas.Number, toughness: Schemas.Number, seconds: Schemas.Number }),

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
   * Client -> server: a lobby action. `action` is one of go (a party whose doors
   * close on a timer), create (a party that waits), join, leave, ready, unready,
   * set (level/diff, leader only), hold (leader: stop or restart the timer),
   * start (leader only).
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
    progress: Schemas.Array(Schemas.Int),
    /** Experience per champion as JSON ({ cid: xp }); the server owns and awards it. */
    xp: Schemas.String
  }),
  /** Server -> all: a hero's level progress changed (a run was cleared). */
  progress: Schemas.Map({ id: Schemas.String, progress: Schemas.Array(Schemas.Int) }),
  /**
   * Server -> all: a champion's experience. `gained` is what this message
   * added (0 when only telling the room where someone stands), `why` is
   * 'kill', 'clear' or ''.
   */
  xp: Schemas.Map({ id: Schemas.String, cid: Schemas.String, xp: Schemas.Int, gained: Schemas.Int, why: Schemas.String }),

  // --- the raid (src/raid/) ---------------------------------------------------------
  /**
   * Server -> all, several times a second while anyone is in the Pit: the
   * Colossus. Clients pose the body from `act`/`t` with the same curves the
   * server used to place its blows, so the telegraphs and the stone agree.
   */
  raid: Schemas.Map({
    /** dormant, waking, fighting, stagger, dying, dead. */
    state: Schemas.String,
    hp: Schemas.Number,
    max: Schemas.Number,
    phase: Schemas.Int,
    /** Where the torso faces, radians. */
    yaw: Schemas.Number,
    /** The attack under way ('' between them) and seconds into it. */
    act: Schemas.String,
    t: Schemas.Number,
    /** The act's ground points: a slam's [x, z]; fissures and debris as [x, z, ...]. */
    pts: Schemas.Array(Schemas.Number),
    /** Grounded hands, open to the sword: [left down, x, z, right down, x, z]. */
    hands: Schemas.Array(Schemas.Number),
    /** Burning ground: [x, z, seconds left, ...]. */
    fires: Schemas.Array(Schemas.Number),
    /** Dead: seconds until it stirs again. */
    wait: Schemas.Number,
    /** Downed heroes and how far an ally has raised each (0..1). */
    down: Schemas.Array(Schemas.String),
    downT: Schemas.Array(Schemas.Number),
    /** Heroes in the Pit. */
    n: Schemas.Int
  }),
  /** Client -> server: a hero's blow landed on a part of the Colossus (leg_l, leg_r, hand_l, hand_r, head). */
  hitRaid: Schemas.Map({ id: Schemas.String, part: Schemas.String, motion: Schemas.String, finisher: Schemas.Boolean }),
  /**
   * Server -> all (or one): something the raid HUD announces. `kind` is wake,
   * phase, stagger, fall, kill (to one hero: their reward, `n` the XP) or leave.
   */
  raidEvent: Schemas.Map({ kind: Schemas.String, text: Schemas.String, n: Schemas.Int })
}

/** Register before `main()` so both the headless server and every client share one room. */
export const room = registerMessages(Messages)
