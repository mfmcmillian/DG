// Who is in the realm right now, for the hall's roster: every hero body in
// the room (ours first) plus anyone the renderer reports who has not made a
// champion yet, with where each of them is.

import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { CHARACTERS } from './characterPicker'
import { heroTagText } from './heroNameTag'
import { heroLevel } from './heroXp'
import { heroes, heroOwner, localAddress } from './multiplayer'
import { getLobbyState } from './party'
import { HUB, partyOf } from './partyLookup'
import { levelNameOf, RAID_PARTY } from './shared/levels'

export type Presence = {
  id: string
  name: string
  /** Character name and level ("Scout 7"); empty for a player still at the title. */
  cls: string
  /** "in the hall", "party · The Vaults", "in The Deep Keep", "at the results", "at the gate". */
  where: string
  me: boolean
  /** Standing in the hall (not off in a fortress). */
  inHall: boolean
}

function whereabouts(id: string): { where: string; inHall: boolean } {
  const phase = partyOf(id)
  const party = getLobbyState().parties.find((p) => p.members.includes(id))
  if (phase === HUB) {
    return party ? { where: `party · ${levelNameOf(party.level)}`, inHall: true } : { where: 'in the hall', inHall: true }
  }
  if (party?.state === 'done') return { where: 'at the results', inHall: false }
  if (party?.id === RAID_PARTY) return { where: 'in the Pit of Chains', inHall: false }
  return { where: `in ${levelNameOf(party?.level ?? 0)}`, inHall: false }
}

/** Everyone connected, ourselves first, then by name. */
export function presence(): Presence[] {
  const me = localAddress()
  const seen = new Map<string, Presence>()
  for (const [entity, hero] of heroes()) {
    const id = heroOwner(entity, hero)
    if (seen.has(id)) continue
    const name = CHARACTERS.find((c) => c.id === hero.cid)?.name ?? ''
    const cls = name ? `${name} ${heroLevel(id, hero.cid)}` : ''
    seen.set(id, { id, name: heroTagText(id), cls, me: id === me, ...whereabouts(id) })
  }
  // Players in the scene without a hero body yet: on the title or making a champion.
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const id = identity.address?.toLowerCase()
    if (!id || seen.has(id)) continue
    seen.set(id, { id, name: heroTagText(id), cls: '', where: 'at the gate', me: id === me, inHall: false })
  }
  return [...seen.values()].sort((a, b) => (a.me === b.me ? a.name.localeCompare(b.name) : a.me ? -1 : 1))
}
