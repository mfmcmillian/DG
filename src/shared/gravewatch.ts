// Gravewatch: the Halloween event (2.10.0). Pure data shared by the headless
// server (src/gravewatchServer.ts, src/raid/risingServer.ts), which is the
// only clock and the only ledger, and the clients (src/gravewatch.ts,
// src/gravewatchUi.tsx), which draw countdowns from the server's `now`.
//
// The loop: daily Rounds in the Barrow Yard, dungeon clears, the Wheel of
// Bones and Knucklebones earn and gamble embers; Saturday night Risings
// against the Demon unlock the week's wearable for the whole server; the
// Reliquary turns embers into the three wearables through the Rewards API.

/** The three wearables, in the order the Reliquary shows them. */
export type GwItem = 'w1' | 'w2' | 'w3'
export const GW_ITEMS: readonly GwItem[] = ['w1', 'w2', 'w3']

/** Ember prices: common/uncommon, legendary, mythic. Retuned after the first week. */
export const GW_PRICES: Record<GwItem, number> = { w1: 300, w2: 1500, w3: 3000 }

/** What the cards say about each item (thumbnails are placeholders until the URNs arrive). */
export const GW_ITEM_INFO: Record<GwItem, { name: string; rarity: string; picture: string }> = {
  w1: { name: 'Gravewatch Lantern', rarity: 'Uncommon', picture: 'images/gravewatch/w1.png' },
  w2: { name: 'Lich\'s Mantle', rarity: 'Legendary', picture: 'images/gravewatch/w2.png' },
  w3: { name: 'Crown of the Rising', rarity: 'Mythic', picture: 'images/gravewatch/w3.png' }
}

// --- embers: sources and caps, all per ET day -----------------------------------------

/** Barrow Yard clears: the first of the day, then the second and third; nothing after. */
export const GW_ROUNDS_EMBERS = [100, 20, 20] as const
/** Dungeon clears on the ladder: the first, then two more; the Crypt pays double. */
export const GW_CLEAR_EMBERS = [25, 10, 10] as const
export const GW_CRYPT_CLEAR_MULT = 2
/** The Rising: for being in the arena when it ends, and on top of that for a win. */
export const GW_RISING_FIGHT_EMBERS = 100
export const GW_RISING_WIN_EMBERS = 300
/** The Wheel: one free spin a day, more at this price. */
export const GW_SPIN_COST = 50
/** Gravewalk, the board: free rolls a day, the ember fee for two dice, what passing Start pays, and how high a tile levels. */
export const GW_BOARD_TOKENS = 10
export const GW_BOARD_DOUBLE_COST = 10
export const GW_BOARD_PASS_EMBERS = 20
export const GW_TILE_MAX_LEVEL = 5
/** Points per landing, and on the chest and gear tiles. */
export const GW_TILE_POINTS = 5
export const GW_TILE_POINTS_BIG = 10

/**
 * The twenty tiles clockwise from Start (top-left corner). Every landing pays
 * something; `amount` is the base, grown by the tile's level for that player.
 */
export type GwTileKind = 'start' | 'embers' | 'coins' | 'chest' | 'gear' | 'curse' | 'mystery'
export type GwTile = { kind: GwTileKind; amount: number; label: string }
export const GW_BOARD: readonly GwTile[] = [
  { kind: 'start', amount: GW_BOARD_PASS_EMBERS, label: 'Start' },
  { kind: 'embers', amount: 3, label: '3 embers' },
  { kind: 'coins', amount: 100, label: '100 coins' },
  { kind: 'embers', amount: 5, label: '5 embers' },
  { kind: 'chest', amount: 15, label: 'Chest' },
  { kind: 'embers', amount: 3, label: '3 embers' },
  { kind: 'curse', amount: 1, label: 'Pumpkin' },
  { kind: 'embers', amount: 8, label: '8 embers' },
  { kind: 'coins', amount: 150, label: '150 coins' },
  { kind: 'embers', amount: 3, label: '3 embers' },
  { kind: 'gear', amount: 1, label: 'Gear' },
  { kind: 'embers', amount: 5, label: '5 embers' },
  { kind: 'chest', amount: 15, label: 'Chest' },
  { kind: 'embers', amount: 3, label: '3 embers' },
  { kind: 'coins', amount: 100, label: '100 coins' },
  { kind: 'embers', amount: 10, label: '10 embers' },
  { kind: 'mystery', amount: 1, label: '?' },
  { kind: 'embers', amount: 3, label: '3 embers' },
  { kind: 'coins', amount: 150, label: '150 coins' },
  { kind: 'embers', amount: 5, label: '5 embers' }
]

/** A tile's pay at a level: a quarter more per level, so level 5 pays double. */
export function tilePay(base: number, level: number): number {
  return Math.round(base * (1 + 0.25 * (Math.max(1, Math.min(GW_TILE_MAX_LEVEL, level)) - 1)))
}

/** Season milestones on board points, paid once each as they are crossed. */
export type GwMilestone = { points: number; kind: 'embers' | 'gear'; amount: number; label: string }
export const GW_BOARD_MILESTONES: readonly GwMilestone[] = [
  { points: 250, kind: 'embers', amount: 50, label: '50 embers' },
  { points: 600, kind: 'embers', amount: 100, label: '100 embers' },
  { points: 1200, kind: 'gear', amount: 1, label: 'A piece of gear' },
  { points: 2500, kind: 'embers', amount: 250, label: '250 embers' },
  { points: 5000, kind: 'embers', amount: 500, label: '500 embers' }
]
/** The daily meter: rolls made today, paid once each day as they are reached. */
export const GW_HAT_STEPS: readonly { rolls: number; embers: number }[] = [
  { rolls: 3, embers: 10 },
  { rolls: 6, embers: 15 },
  { rolls: 10, embers: 25 }
]
/** The Wheel's ember multiplier prize: this much, for this long. */
export const GW_MULT = 1.5
export const GW_MULT_MS = 24 * 3600 * 1000
/** The Pumpkin Head: how long the wearer has it on, earning x1.5 embers the while. */
export const GW_CURSE_MS = 3600 * 1000
/** The Wheel's pity: this many spins without gear and the next one lands on it. */
export const GW_WHEEL_PITY = 10

/**
 * The Wheel of Bones, in segment order. The server picks by weight and tells
 * the client the index; the client spins to it. No wearables on the wheel.
 */
export type GwWheelKind = 'embers' | 'coins' | 'gear' | 'mult' | 'curse'
export type GwSegment = { kind: GwWheelKind; amount: number; weight: number; label: string }
export const GW_WHEEL: readonly GwSegment[] = [
  { kind: 'embers', amount: 10, weight: 24, label: '10 embers' },
  { kind: 'coins', amount: 150, weight: 12, label: '150 coins' },
  { kind: 'embers', amount: 25, weight: 18, label: '25 embers' },
  { kind: 'curse', amount: 1, weight: 8, label: 'Pumpkin Head' },
  { kind: 'embers', amount: 50, weight: 10, label: '50 embers' },
  { kind: 'gear', amount: 1, weight: 9, label: 'A piece of gear' },
  { kind: 'embers', amount: 100, weight: 4, label: '100 embers' },
  { kind: 'mult', amount: 1, weight: 7, label: 'Embers x1.5 for a day' },
  { kind: 'coins', amount: 400, weight: 6, label: '400 coins' },
  { kind: 'embers', amount: 10, weight: 2, label: '10 embers' }
]

// --- the clock --------------------------------------------------------------------------

const HOUR = 3600 * 1000
/** Daylight time ends Nov 1, 2026 at 2 AM EDT (06:00 UTC): ET is UTC-4 before, UTC-5 after. */
const DST_ENDS = Date.UTC(2026, 10, 1, 6)

/** Milliseconds to add to a UTC instant to read it as Eastern Time. */
export function etOffset(now: number): number {
  return now < DST_ENDS ? -4 * HOUR : -5 * HOUR
}

/** The ET calendar day an instant falls on, as YYYY-MM-DD: days roll at midnight ET. */
export function etDayKey(now: number): string {
  return new Date(now + etOffset(now)).toISOString().slice(0, 10)
}

/**
 * The Risings: Saturdays 9:15 PM ET, which is 01:15 UTC Sunday (Oct 31 is
 * still daylight time at 9:15 PM). Oct 10 only matters if the event is live.
 */
export const GW_RISINGS: readonly number[] = [
  Date.UTC(2026, 9, 11, 1, 15),
  Date.UTC(2026, 9, 18, 1, 15),
  Date.UTC(2026, 9, 25, 1, 15),
  Date.UTC(2026, 10, 1, 1, 15)
]
/** Sign-ups open this long before a Rising; the tab becomes the lobby this long before; the fight closes this long after the start (10 PM ET). */
export const GW_SIGNUP_MS = 24 * HOUR
export const GW_LOBBY_MS = 15 * 60 * 1000
export const GW_RISING_OPEN_MS = 45 * 60 * 1000

/** Which Rising unlocks which wearable when won: the Oct 17 fight the legendary, the Oct 31 fight the mythic. */
export const GW_RISING_UNLOCKS: Record<number, GwItem> = {
  [Date.UTC(2026, 9, 18, 1, 15)]: 'w2',
  [Date.UTC(2026, 10, 1, 1, 15)]: 'w3'
}
/** Backstops, in case nobody wins: W2 Oct 20 9 PM ET, W3 Oct 31 9 PM ET. */
export const GW_BACKSTOPS: Record<GwItem, number> = { w1: 0, w2: 1792544400000, w3: 1793494800000 }
/** Earning and redeeming both stop here: Nov 7, 9 PM EST. */
export const GW_EVENT_END = 1794103200000

export type GwRisingPhase = 'idle' | 'signup' | 'lobby' | 'fight' | 'closed'

/** The Rising whose window `now` is in or ahead of: its start, and where the clock stands against it. */
export function risingAt(now: number): { start: number; phase: GwRisingPhase } {
  for (const start of GW_RISINGS) {
    if (now >= start + GW_RISING_OPEN_MS) continue
    if (now >= start) return { start, phase: 'fight' }
    if (now >= start - GW_LOBBY_MS) return { start, phase: 'lobby' }
    if (now >= start - GW_SIGNUP_MS) return { start, phase: 'signup' }
    return { start, phase: 'idle' }
  }
  return { start: 0, phase: 'closed' }
}

/** The ET date a Rising belongs to, as the Storage key suffix (the Saturday, not the UTC Sunday). */
export function risingKey(start: number): string {
  return `gw:rising:${etDayKey(start)}`
}

/** A wearable is live in the Reliquary once its Rising was won or its backstop has passed (W1 from the start). */
export function itemLive(item: GwItem, won: readonly GwItem[], now: number): boolean {
  if (item === 'w1') return true
  return won.includes(item) || (GW_BACKSTOPS[item] > 0 && now >= GW_BACKSTOPS[item])
}

/** The Demon grows with the crowd: `n` heroes in the arena. */
export function risingBossHp(n: number): number {
  return Math.round(1200 * Math.pow(Math.max(4, n), 0.9))
}
export function risingDamageMult(n: number): number {
  return Math.min(2, 1 + 0.04 * Math.max(4, n))
}
export function risingAddsPerRaise(n: number): number {
  return Math.min(12, 2 + Math.floor(Math.max(4, n) / 4))
}
/** The Rising phase draws this many other heroes in full; the rest are name tags. */
export const GW_REMOTE_BODY_CAP = 12
