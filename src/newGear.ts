// Gear the hero has found but not yet looked at. A drop that unlocks an item
// marks it new (src/loot.ts); the HUD's Inventory button wears a NEW badge
// while any remain, and each such item wears one in the backpack until it is
// clicked (src/inventoryUi.tsx). The list rides in the saved prefs
// (src/settings.ts), so it survives a session and the pit alike.

import { getEquipmentItemOrNull } from './equipmentCatalog'

const fresh = new Set<string>()

export function markGearNew(id: string) {
  fresh.add(id)
}

/** Returns true when the item was new until now. */
export function markGearSeen(id: string): boolean {
  return fresh.delete(id)
}

export function isGearNew(id: string): boolean {
  return fresh.has(id)
}

export function newGearCount(): number {
  return fresh.size
}

/** For the saved prefs. */
export function newGearIds(): string[] {
  return [...fresh]
}

export function loadNewGear(list: unknown) {
  fresh.clear()
  if (!Array.isArray(list)) return
  for (const id of list) if (typeof id === 'string' && getEquipmentItemOrNull(id)) fresh.add(id)
}
