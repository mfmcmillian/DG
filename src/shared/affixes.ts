// Affixes: the one small bonus a Rare or better drop carries, rolled where it
// falls and kept on the bag row like its rarity and forge level (gearBag.ts).
// A short list on purpose: two Rare swords can differ, a player can learn the
// six words, and Commons stay plain. Pure data, loaded by the server too.
//
// The synced look carries the affix of what is worn (src/multiplayer.ts): the
// weapon's in `HeroBody.weaponUp` above the rank and level, each armor piece's
// as a digit after the ranks and levels in `armorUp`, so the host scores blows
// with the copy everybody can see.

export type AffixKind = 'weapon' | 'armor'

export type Affix = {
  id: string
  /** Shown before the item's name: "Keen Broadsword". */
  name: string
  kind: AffixKind
  /** One line for the card. */
  blurb: string
  /** Weapon: multipliers on the class's, and flat damage. */
  damage?: number
  stagger?: number
  knockback?: number
  bonus?: number
  /** Armor: percent points and flat points added to the piece. */
  might?: number
  toughness?: number
  stamina?: number
  health?: number
}

/** Index 0 is "no affix"; the rest are what a drop can carry. Never reorder: saves and the synced look hold the index. */
export const AFFIXES: readonly (Affix | undefined)[] = [
  undefined,
  { id: 'keen', name: 'Keen', kind: 'weapon', blurb: 'An edge that bites deeper.', damage: 1.08 },
  { id: 'heavy', name: 'Heavy', kind: 'weapon', blurb: 'Weight that leaves them reeling.', stagger: 1.25 },
  { id: 'sure', name: 'Sure', kind: 'weapon', blurb: 'Every blow lands a little harder.', bonus: 2 },
  { id: 'vital', name: 'Vital', kind: 'armor', blurb: 'Worn close: more to lose before you fall.', health: 4 },
  { id: 'fleet', name: 'Fleet', kind: 'armor', blurb: 'Cut light: more breath for the heavy and the roll.', stamina: 3 },
  { id: 'stout', name: 'Stout', kind: 'armor', blurb: 'Thick where it counts.', toughness: 1 }
]

/** Drops at this rank (2 = Rare) and above carry an affix; below it they never do. */
export const AFFIX_FROM_RANK = 2

export const MAX_AFFIX = AFFIXES.length - 1

export function clampAffix(affix: number | undefined): number {
  const n = Math.floor(Number.isFinite(affix as number) ? (affix as number) : 0)
  return Math.max(0, Math.min(MAX_AFFIX, n))
}

export function affixOf(index: number | undefined): Affix | undefined {
  return AFFIXES[clampAffix(index)]
}

/** Which affixes a kind of gear can carry, as indices. */
export function affixesFor(kind: AffixKind): number[] {
  const out: number[] = []
  AFFIXES.forEach((affix, i) => { if (affix && affix.kind === kind) out.push(i) })
  return out
}

/** A small stable hash of a string, for rolls every client makes alike from the drop's uid. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * The affix a fresh drop carries: none below Rare, else one of its kind's,
 * drawn from the drop's uid so every party member's client agrees with the
 * host without another field on the wire.
 */
export function rollAffix(kind: AffixKind, rank: number, uid: string): number {
  if (rank < AFFIX_FROM_RANK || !uid) return 0
  const pool = affixesFor(kind)
  if (!pool.length) return 0
  return pool[hash(`${uid}:${kind}`) % pool.length]
}
