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
  enemies: Schemas.Map({ list: Schemas.Array(EnemySnap) }),
  loot: Schemas.Map({
    x: Schemas.Number,
    z: Schemas.Number,
    coin: Schemas.Int,
    heart: Schemas.Int,
    dusk: Schemas.Boolean
  }),
  /** Client -> server: a one-line status the server prints, so client state shows in `server-logs`. */
  diag: Schemas.Map({ note: Schemas.String })
}

/** Register before `main()` so both the headless server and every client share one room. */
export const room = registerMessages(Messages)
