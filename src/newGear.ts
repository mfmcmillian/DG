// Gear the hero has found but not yet looked at, by the copy's uid
// (src/shared/gearBag.ts). A drop that lands in the bag marks its copy new
// (src/loot.ts); the HUD's Inventory button wears a NEW badge while any
// remain, and each such card wears one in the backpack until it is clicked
// (src/inventoryUi.tsx). The list rides in the saved prefs (src/settings.ts),
// so it survives a session and the pit alike.

import { bagRow } from './shared/gearBag'

const fresh = new Set<string>()

export function markGearNew(uid: string) {
  fresh.add(uid)
}

/** Returns true when the item was new until now. */
export function markGearSeen(uid: string): boolean {
  return fresh.delete(uid)
}

export function isGearNew(uid: string): boolean {
  return fresh.has(uid)
}

export function newGearCount(): number {
  return fresh.size
}

/** For the saved prefs. */
export function newGearIds(): string[] {
  return [...fresh]
}

/** Copies the bag no longer holds (sold, or a save from before uids) are dropped. */
export function loadNewGear(list: unknown) {
  fresh.clear()
  if (!Array.isArray(list)) return
  for (const uid of list) if (typeof uid === 'string' && bagRow(uid)) fresh.add(uid)
}

/** A copy left the bag: nothing to look at any more. */
export function forgetGear(uid: string) {
  fresh.delete(uid)
}
