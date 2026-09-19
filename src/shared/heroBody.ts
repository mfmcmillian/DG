import { engine, Schemas } from '@dcl/sdk/ecs'

/**
 * One synced entity per hero, owned by that hero's client. It carries what
 * everyone else needs to stand a custom body in for the player: who they are,
 * what they look like and which clip they are playing. The SDK's CRDT sync does
 * the rest: the server relays it, a joiner receives every hero in the initial
 * state dump, and a change reaches all clients as a component update.
 *
 * The position is for the headless server only (enemy targeting when the
 * runtime hands it no transform for the player). Clients never place bodies
 * from it: they ride the renderer's avatar through AvatarAttach.
 *
 * Health is deliberately absent. The server owns it and announces changes with
 * `hitPlayer`, `heal`, `revive` and `vitals`.
 */
export const HeroBody = engine.defineComponent('dg::HeroBody', {
  /** Owner's address, lower-case. */
  id: Schemas.String,
  x: Schemas.Float,
  y: Schemas.Float,
  z: Schemas.Float,
  /** World yaw of the body (radians); may differ from the native controller during lock-on. */
  f: Schemas.Float,
  motion: Schemas.String,
  /** Bumped when a one-shot clip (swing, roll, hit, fall) starts, so watchers restart it. */
  seq: Schemas.Int,
  cid: Schemas.String,
  body: Schemas.String,
  hair: Schemas.String,
  hc: Schemas.String,
  skin: Schemas.String,
  loadout: Schemas.Map({
    head: Schemas.String,
    chest: Schemas.String,
    shoulders: Schemas.String,
    hands: Schemas.String,
    legs: Schemas.String,
    boots: Schemas.String,
    weapon: Schemas.String
  }),
  block: Schemas.Boolean,
  /** The roll's invulnerable window is open: blows pass through. */
  dodge: Schemas.Boolean,
  /** Ticks about once a second while the owner is alive, so a stale hero can be told apart. */
  beat: Schemas.Int
})

export type HeroBodyValue = ReturnType<typeof HeroBody.get>
