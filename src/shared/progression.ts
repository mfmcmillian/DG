// Hero levels. Pure numbers shared by the server, which awards experience
// from its own kills and clears, and the clients, which show the bar and
// apply the same bonuses the server does. Experience is kept per wallet and
// per champion, so each class climbs on its own.
//
// The curve is quadratic: the first levels fall in the first run, the last
// ones take several clears of the hardest fortress. Bonuses are small and
// flat per level so a weapon still matters more than a level.

import { DifficultyDefinition, LevelDefinition } from './levels'

export const MAX_LEVEL = 30

/** Total experience needed to stand at `level` (level 1 needs none). */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1
  return 40 * l * l + 30 * l
}

export function levelForXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++
  return level
}

/** Where a total sits on its level: the level, experience into it and the size of the step. */
export function levelProgress(xp: number): { level: number; into: number; span: number } {
  const level = levelForXp(xp)
  const floor = xpForLevel(level)
  const span = level >= MAX_LEVEL ? 0 : xpForLevel(level + 1) - floor
  return { level, into: Math.max(0, xp - floor), span }
}

/** Difficulty's weight on experience: harder fortresses pay better than they pay in coin. */
function diffXp(diff: DifficultyDefinition): number {
  return 1 + (diff.id) * 0.7
}

/** Every member of the party earns this for each enemy slain, whoever landed the blow. */
export function killXp(level: LevelDefinition, diff: DifficultyDefinition): number {
  return Math.round(8 * level.coins * diffXp(diff))
}

/** Clearing the fortress; the first clear at that difficulty pays double. */
export function clearXp(level: LevelDefinition, diff: DifficultyDefinition, first: boolean): number {
  return Math.round(80 * level.coins * diffXp(diff)) * (first ? 2 : 1)
}

/**
 * What a level is worth in a fight. `might` multiplies damage dealt,
 * `toughness` multiplies damage taken, `stamina` is added to the bar.
 */
export type HeroBonuses = { might: number; toughness: number; stamina: number }

/** Per level gains by champion: the two who fight in reach harden, the berserker hits harder too, the scout runs longer. */
const GAINS: Record<string, { might: number; toughness: number; stamina: number }> = {
  vanguard: { might: 0.007, toughness: 0.01, stamina: 1 },
  brute: { might: 0.015, toughness: 0.01, stamina: 1 },
  scout: { might: 0.01, toughness: 0.005, stamina: 2 },
  striker: { might: 0.012, toughness: 0.005, stamina: 1 }
}
const DEFAULT_GAINS = { might: 0.01, toughness: 0.005, stamina: 1 }

export function heroBonuses(cid: string, level: number): HeroBonuses {
  const g = GAINS[cid] ?? DEFAULT_GAINS
  const steps = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)) - 1)
  return { might: 1 + g.might * steps, toughness: 1 - g.toughness * steps, stamina: g.stamina * steps }
}

/** What this champion gains per level, for the level-up notice to put into words. */
export function levelGains(cid: string): { might: number; toughness: number; stamina: number } {
  return GAINS[cid] ?? DEFAULT_GAINS
}

/** Experience per champion for one wallet, as stored and as sent. */
export type XpRecord = Record<string, number>

export function parseXp(json: string): XpRecord {
  if (!json) return {}
  try {
    const value = JSON.parse(json) as unknown
    if (!value || typeof value !== 'object') return {}
    const out: XpRecord = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'number' && v >= 0) out[k] = Math.floor(v)
    return out
  } catch {
    return {}
  }
}
