import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

const Loadout = Schemas.Map({
  head: Schemas.String,
  chest: Schemas.String,
  shoulders: Schemas.String,
  hands: Schemas.String,
  legs: Schemas.String,
  boots: Schemas.String,
  weapon: Schemas.String
})

const Player = Schemas.Map({
  id: Schemas.String,
  x: Schemas.Number,
  y: Schemas.Number,
  z: Schemas.Number,
  f: Schemas.Number,
  motion: Schemas.String,
  cid: Schemas.String,
  body: Schemas.String,
  hair: Schemas.String,
  hc: Schemas.String,
  skin: Schemas.String,
  loadout: Loadout,
  block: Schemas.Boolean,
  dodge: Schemas.Boolean,
  health: Schemas.Number
})

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
  player: Player,
  swing: Schemas.Map({ id: Schemas.String, motion: Schemas.String, facing: Schemas.Number }),
  hitEnemy: Schemas.Map({ id: Schemas.String, i: Schemas.Int, motion: Schemas.String, finisher: Schemas.Boolean }),
  hitPlayer: Schemas.Map({ id: Schemas.String, damage: Schemas.Number, stagger: Schemas.Number, yaw: Schemas.Number }),
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
  leave: Schemas.Map({ id: Schemas.String })
}

/** Register before `main()` so both the headless server and every client share one room. */
export const room = registerMessages(Messages)
