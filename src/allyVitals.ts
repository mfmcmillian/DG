// What the host has said about every other hero's health, for the party
// readout under our own bars in a run. The host is the only ledger: every
// `hitPlayer`, `heal`, `revive` and periodic `vitals` message carries the
// hero's health after the event, and `vitals` carries their ceiling too, so a
// client that never saw an ally's level or armor still draws the right bar.

import { CHARACTERS } from './characterPicker'
import { heroTagText } from './heroNameTag'
import { heroes, heroOwner, localAddress } from './multiplayer'
import { myParty } from './party'

type Known = { health: number; max: number }

const known = new Map<string, Known>()

/** A statement of `id`'s health from the host; `max` only when the message carries it. */
export function noteAllyHealth(id: string, health: number, max?: number) {
  const prior = known.get(id)
  const ceiling = max !== undefined && max > 0 ? max : Math.max(prior?.max ?? 0, health)
  known.set(id, { health: Math.max(0, health), max: Math.max(1, ceiling) })
}

export function forgetAlly(id: string) {
  known.delete(id)
}

export type PartyVital = {
  id: string
  name: string
  /** The character's name ("Scout"); empty until their hero body is seen. */
  cls: string
  health: number
  max: number
  down: boolean
}

/** Everyone else in our party, in the party's order, with what we last heard of their health. */
export function partyVitals(): PartyVital[] {
  const me = localAddress()
  const party = myParty()
  if (!party) return []
  const cids = new Map<string, string>()
  for (const [entity, hero] of heroes()) {
    const owner = heroOwner(entity, hero)
    if (!cids.has(owner) && hero.cid) cids.set(owner, hero.cid)
  }
  const out: PartyVital[] = []
  for (const id of party.members) {
    if (id === me) continue
    const v = known.get(id)
    const cid = cids.get(id)
    // Until the host's first word, a full bar: a fresh hero starts full, and the vitals arrive within seconds.
    out.push({
      id,
      name: heroTagText(id),
      cls: CHARACTERS.find((c) => c.id === cid)?.name ?? '',
      health: v?.health ?? 1,
      max: v?.max ?? 1,
      down: !!v && v.health <= 0
    })
  }
  return out
}
