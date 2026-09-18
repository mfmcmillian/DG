import {
  DEFAULT_LOADOUTS,
  EQUIPMENT_ITEMS,
  EQUIPMENT_SLOTS,
  EquipmentLoadout,
  EquipmentSlot,
  getUnequippedItem
} from './equipmentCatalog'

// Equipment is kept for each character for the lifetime of this scene session.
const committedLoadouts = new Map<string, EquipmentLoadout>()

function validItemId(id: string | undefined, slot: EquipmentSlot): string | undefined {
  return EQUIPMENT_ITEMS.find((item) => item.id === id && item.slot === slot)?.id
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

export function setCommittedLoadout(characterId: string, next: EquipmentLoadout): void {
  const loadout = getCommittedLoadout(characterId)
  for (const slot of EQUIPMENT_SLOTS) {
    const validId = validItemId(next[slot.id], slot.id)
    if (validId) loadout[slot.id] = validId
  }
  committedLoadouts.set(characterId, loadout)
}
