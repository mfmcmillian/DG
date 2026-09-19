import { SKIN_TONED_ARMOR } from './equipmentCatalog'

export type BodyType = 'male' | 'female'
export type CharacterAppearance = {
  bodyType: BodyType
  hairStyle: string
  hairColor: string
  skinTone: string
}

export const BODY_TYPES: Array<{ id: BodyType; name: string }> = [
  { id: 'male', name: 'Male' }, { id: 'female', name: 'Female' }
]
export const HAIR_STYLES = [
  { id: 'short', name: 'Short' }, { id: 'tied', name: 'Tied back' },
  { id: 'long', name: 'Long' }, { id: 'none', name: 'Bald' }
]
export const HAIR_COLORS = [
  { id: 'black', name: 'Black', color: '#25202b' },
  { id: 'brown', name: 'Brown', color: '#6b3c28' },
  { id: 'blonde', name: 'Blonde', color: '#e4bd6b' },
  { id: 'auburn', name: 'Auburn', color: '#a6432d' },
  { id: 'silver', name: 'Silver', color: '#cdd4e3' },
  { id: 'violet', name: 'Violet', color: '#8865bb' }
]
export const SKIN_TONES = [
  { id: 'light', name: 'Light', color: '#eac3a5' },
  { id: 'warm', name: 'Warm', color: '#cf946d' },
  { id: 'tan', name: 'Tan', color: '#a96b4d' },
  { id: 'deep', name: 'Deep', color: '#654334' }
]

const DEFAULT_APPEARANCE: CharacterAppearance = {
  bodyType: 'male', hairStyle: 'short', hairColor: 'brown', skinTone: 'warm'
}
const appearances = new Map<string, CharacterAppearance>()

export function normalizeAppearance(value: Partial<CharacterAppearance>): CharacterAppearance {
  return {
    bodyType: BODY_TYPES.find((entry) => entry.id === value.bodyType)?.id ?? DEFAULT_APPEARANCE.bodyType,
    hairStyle: HAIR_STYLES.find((entry) => entry.id === value.hairStyle)?.id ?? DEFAULT_APPEARANCE.hairStyle,
    hairColor: HAIR_COLORS.find((entry) => entry.id === value.hairColor)?.id ?? DEFAULT_APPEARANCE.hairColor,
    skinTone: SKIN_TONES.find((entry) => entry.id === value.skinTone)?.id ?? DEFAULT_APPEARANCE.skinTone
  }
}

export function getCommittedAppearance(characterId: string): CharacterAppearance {
  return { ...(appearances.get(characterId) ?? DEFAULT_APPEARANCE) }
}

export function setCommittedAppearance(characterId: string, appearance: CharacterAppearance) {
  appearances.set(characterId, normalizeAppearance(appearance))
}

export function appearancePart(appearance: CharacterAppearance, part: 'core' | 'chest' | 'hands' | 'legs' | 'boots'): string {
  return `models/customization/${appearance.bodyType}/${appearance.skinTone}/${part}.glb`
}

export function appearanceHair(appearance: CharacterAppearance, showHair: boolean): string {
  // The bald variant retains the brows, so hair color still applies under a helmet.
  return `models/customization/${appearance.bodyType}/hair/${showHair ? appearance.hairStyle : 'none'}-${appearance.hairColor}.glb`
}

/** Starter pieces with exposed skin; their per-tone files predate the roaming remap, so they sit under models/. */
const STARTER_SKIN_ARMOR = new Set(['scout-chest', 'scout-hands', 'striker-hands'])

export function appearanceArmor(appearance: CharacterAppearance, itemId: string): string | undefined {
  // Armor pieces that contain exposed skin as well as fabric/metal come in the four tones.
  if (STARTER_SKIN_ARMOR.has(itemId)) return `models/customization/armor/${appearance.skinTone}/${itemId}.glb`
  if (SKIN_TONED_ARMOR.has(itemId)) return `models/roaming/customization/armor/${appearance.skinTone}/${itemId}.glb`
  return undefined
}
