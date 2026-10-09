import {
  DEFAULT_LOADOUTS,
  EQUIPMENT_ITEMS,
  EQUIPMENT_SLOTS,
  EquipmentLoadout,
  EquipmentSlot,
  getUnequippedItem
} from './equipmentCatalog'
import { bagRow, bagRowsOf, setActiveGear } from './shared/gearBag'

export type EquipmentCopies = Partial<Record<EquipmentSlot, string>>

// Equipment and the unique bag copy filling each slot are kept per champion.
const committedLoadouts = new Map<string, EquipmentLoadout>()
const committedCopies = new Map<string, EquipmentCopies>()
const VIRTUAL_COPY = 's:'

function validItemId(id: string | undefined, slot: EquipmentSlot): string | undefined {
  return EQUIPMENT_ITEMS.find((item) => item.id === id && item.slot === slot)?.id
}

function copyItem(uid: string | undefined, slot: EquipmentSlot): string | undefined {
  const row = bagRow(uid)
  if (row) return validItemId(row.item, slot)
  return uid?.startsWith(VIRTUAL_COPY) ? validItemId(uid.slice(VIRTUAL_COPY.length), slot) : undefined
}

export function getCommittedLoadout(characterId: string): EquipmentLoadout {
  let loadout = committedLoadouts.get(characterId)
  if (!loadout) {
    const defaults = DEFAULT_LOADOUTS[characterId]
    loadout = {} as EquipmentLoadout
    for (const slot of EQUIPMENT_SLOTS) {
      loadout[slot.id] = validItemId(defaults?.[slot.id], slot.id) ?? getUnequippedItem(slot.id).id
    }
    committedLoadouts.set(characterId, loadout)
  }
  return { ...loadout }
}

export function getCommittedCopies(characterId: string): EquipmentCopies {
  return { ...(committedCopies.get(characterId) ?? {}) }
}

export function getCommittedCopy(characterId: string, slot: EquipmentSlot): string | undefined {
  return committedCopies.get(characterId)?.[slot]
}

/** A particular bag copy can be worn by only one champion. */
export function isCopyCommitted(uid: string): boolean {
  return !!copyCommittedBy(uid)
}

export function copyCommittedBy(uid: string): { characterId: string; slot: EquipmentSlot } | undefined {
  for (const [characterId, copies] of committedCopies) {
    for (const slot of EQUIPMENT_SLOTS) if (copies[slot.id] === uid) return { characterId, slot: slot.id }
  }
  return undefined
}

export function setCommittedLoadout(characterId: string, next: EquipmentLoadout): void {
  const loadout = getCommittedLoadout(characterId)
  const copies = committedCopies.get(characterId) ?? {}
  for (const slot of EQUIPMENT_SLOTS) {
    const validId = validItemId(next[slot.id], slot.id)
    if (!validId) continue
    loadout[slot.id] = validId
    if (copyItem(copies[slot.id], slot.id) !== validId) delete copies[slot.id]
  }
  committedLoadouts.set(characterId, loadout)
  committedCopies.set(characterId, copies)
}

/**
 * Put one owned copy into a champion's slot. If another champion wore that exact
 * copy, it comes off there first; duplicate copies remain independently usable.
 */
export function setCommittedCopy(characterId: string, slot: EquipmentSlot, uid: string | undefined): boolean {
  const row = bagRow(uid)
  const loadout = getCommittedLoadout(characterId)
  const unequipped = getUnequippedItem(slot).id
  if (loadout[slot] === unequipped) uid = undefined
  if (uid && copyItem(uid, slot) !== loadout[slot]) return false
  if (uid) {
    for (const [otherId, copies] of committedCopies) {
      for (const entry of EQUIPMENT_SLOTS) {
        if (copies[entry.id] !== uid || (otherId === characterId && entry.id === slot)) continue
        delete copies[entry.id]
        const other = getCommittedLoadout(otherId)
        other[entry.id] = getUnequippedItem(entry.id).id
        committedLoadouts.set(otherId, other)
      }
    }
  }
  const copies = committedCopies.get(characterId) ?? {}
  if (uid) copies[slot] = uid
  else delete copies[slot]
  committedCopies.set(characterId, copies)
  if (row) setActiveGear(row.uid)
  return true
}

/** Restore saved assignments, then fill legacy item-only loadouts with distinct owned copies where possible. */
export function reconcileCommittedCopies(characterIds: readonly string[]) {
  const used = new Set<string>()
  for (const characterId of characterIds) {
    const loadout = getCommittedLoadout(characterId)
    const copies = committedCopies.get(characterId) ?? {}
    for (const slot of EQUIPMENT_SLOTS) {
      const uid = copies[slot.id]
      if (!uid || copyItem(uid, slot.id) !== loadout[slot.id] || used.has(uid)) delete copies[slot.id]
      else used.add(uid)
    }
    committedCopies.set(characterId, copies)
  }
  for (const characterId of characterIds) {
    const loadout = getCommittedLoadout(characterId)
    const copies = committedCopies.get(characterId) ?? {}
    for (const slot of EQUIPMENT_SLOTS) {
      if (copies[slot.id]) continue
      const rows = bagRowsOf(loadout[slot.id])
      const free = rows.find((row) => !used.has(row.uid))
      if (free) {
        copies[slot.id] = free.uid
        used.add(free.uid)
        continue
      }
      const unequipped = getUnequippedItem(slot.id).id
      if (loadout[slot.id] === unequipped) continue
      const virtual = VIRTUAL_COPY + loadout[slot.id]
      if (!rows.length && !used.has(virtual)) {
        copies[slot.id] = virtual
        used.add(virtual)
      } else {
        loadout[slot.id] = getUnequippedItem(slot.id).id
      }
    }
    committedLoadouts.set(characterId, loadout)
    committedCopies.set(characterId, copies)
  }
}

/** Make the selected champion's assigned copies drive combat stats and synced appearance. */
export function activateCommittedCopies(characterId: string) {
  const copies = committedCopies.get(characterId)
  if (!copies) return
  for (const slot of EQUIPMENT_SLOTS) {
    const uid = copies[slot.id]
    if (uid) setActiveGear(uid)
  }
}
