import weaponCatalog from './weaponCatalog.json'
import outfitCatalog from './outfitCatalog.json'
import { classAllowsWeapon } from './heroClasses'

export type EquipmentSlot = 'head' | 'chest' | 'shoulders' | 'hands' | 'legs' | 'boots' | 'weapon'
export type EquipmentLoadout = Record<EquipmentSlot, string>

/** Loot weapons (scripts/build-weapons.py writes src/weaponCatalog.json from the manifest). */
export type WeaponInfo = {
  class: 'sword' | 'dagger' | 'axe' | 'mace' | 'hammer' | 'club' | 'great' | 'bow' | 'staff'
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  /** Which Synty pack the mesh came from, for the inventory line. */
  pack: string
  /** Held in the left hand (bows); the GLB's joint is `hand_l`. Default right. */
  hand?: 'l' | 'r'
}

export interface EquipmentItem {
  id: string
  name: string
  slot: EquipmentSlot
  description: string
  icon: string
  models: string[]
  modelsByCharacter?: Record<string, string[]>
  weapon?: WeaponInfo
}

export const EQUIPMENT_SLOTS: Array<{ id: EquipmentSlot; label: string }> = [
  { id: 'head', label: 'Head' },
  { id: 'chest', label: 'Chest' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'hands', label: 'Hands' },
  { id: 'legs', label: 'Legs' },
  { id: 'boots', label: 'Boots' },
  { id: 'weapon', label: 'Weapon' }
]

type EquipmentAssets = {
  items: EquipmentItem[]
  cores: Record<string, string[]>
  defaults: Record<string, EquipmentLoadout>
}

const ASSETS = {
  "schemaVersion": 1,
  "slots": [
    "head",
    "chest",
    "shoulders",
    "hands",
    "legs",
    "boots",
    "weapon"
  ],
  "clips": [
    "A_MOD_BL_Idle_Standing_Masc",
    "A_MOD_BL_Walk_F_Masc",
    "A_MOD_BL_Run_F_Masc",
    "combat_idle",
    "attack_light",
    "attack_light2",
    "attack_heavy",
    "block",
    "hit",
    "death"
  ],
  "items": [
    {
      "id": "knight-head",
      "name": "Knight Helm",
      "slot": "head",
      "description": "A plumed helm with ivory and gold detailing.",
      "icon": "images/equipment/knight-head-v2.png",
      "models": [
        "models/combat/equipment/knight-head-combat-v2.glb"
      ]
    },
    {
      "id": "knight-chest",
      "name": "Knight Plate",
      "slot": "chest",
      "description": "Classic plate armor with blue and gold detailing.",
      "icon": "images/equipment/knight-chest-v2.png",
      "models": [
        "models/combat/equipment/knight-chest-combat-v2.glb"
      ]
    },
    {
      "id": "knight-shoulders",
      "name": "Knight Pauldrons",
      "slot": "shoulders",
      "description": "Sculpted pauldrons for the complete knight look.",
      "icon": "images/equipment/knight-shoulders-v2.png",
      "models": [
        "models/combat/equipment/knight-shoulders-combat-v2.glb"
      ]
    },
    {
      "id": "knight-hands",
      "name": "Plate Gauntlets",
      "slot": "hands",
      "description": "Plated gauntlets with matching forearm armor.",
      "icon": "images/equipment/knight-hands-v2.png",
      "models": [
        "models/combat/equipment/knight-hands-combat-v2.glb"
      ]
    },
    {
      "id": "knight-legs",
      "name": "Knight Greaves",
      "slot": "legs",
      "description": "Layered plate and cloth with a bold silhouette.",
      "icon": "images/equipment/knight-legs-v2.png",
      "models": [
        "models/combat/equipment/knight-legs-combat-v2.glb"
      ]
    },
    {
      "id": "knight-boots",
      "name": "Armored Boots",
      "slot": "boots",
      "description": "Heavy armored boots to finish the set.",
      "icon": "images/equipment/knight-boots-v2.png",
      "models": [
        "models/combat/equipment/knight-boots-combat-v2.glb"
      ]
    },
    {
      "id": "scout-head",
      "name": "Scout Visor",
      "slot": "head",
      "description": "A striking fox mask for a different identity.",
      "icon": "images/equipment/scout-head-v2.png",
      "models": [
        "models/combat/equipment/scout-head-combat-v2.glb"
      ]
    },
    {
      "id": "scout-chest",
      "name": "Scout Vest",
      "slot": "chest",
      "description": "A lighter utility look with bright accent colors.",
      "icon": "images/equipment/scout-chest-v2.png",
      "models": [
        "models/combat/equipment/scout-chest-combat-v2.glb"
      ]
    },
    {
      "id": "scout-shoulders",
      "name": "Scout Shoulder Guards",
      "slot": "shoulders",
      "description": "Compact shoulder guards with a clean profile.",
      "icon": "images/equipment/scout-shoulders-v2.png",
      "models": [
        "models/combat/equipment/scout-shoulders-combat-v2.glb"
      ]
    },
    {
      "id": "scout-hands",
      "name": "Scout Gloves",
      "slot": "hands",
      "description": "Utility gloves and matching sleeves.",
      "icon": "images/equipment/scout-hands-v2.png",
      "models": [
        "models/combat/equipment/scout-hands-combat-v2.glb"
      ]
    },
    {
      "id": "scout-legs",
      "name": "Scout Legwear",
      "slot": "legs",
      "description": "Utility layers made for an adventurous look.",
      "icon": "images/equipment/scout-legs-v2.png",
      "models": [
        "models/combat/equipment/scout-legs-combat-v2.glb"
      ]
    },
    {
      "id": "scout-boots",
      "name": "Scout Boots",
      "slot": "boots",
      "description": "A streamlined alternative to heavy plate boots.",
      "icon": "images/equipment/scout-boots-v2.png",
      "models": [
        "models/combat/equipment/scout-boots-combat-v2.glb"
      ]
    },
    {
      "id": "striker-head",
      "name": "Striker Mask",
      "slot": "head",
      "description": "A bold headpiece from the Striker outfit.",
      "icon": "images/equipment/striker-head-v2.png",
      "models": [
        "models/combat/equipment/striker-head-combat-v2.glb"
      ]
    },
    {
      "id": "striker-chest",
      "name": "Striker Plate",
      "slot": "chest",
      "description": "Cool blue plate with the Striker color palette.",
      "icon": "images/equipment/striker-chest-v2.png",
      "models": [
        "models/combat/equipment/striker-chest-combat-v2.glb"
      ]
    },
    {
      "id": "striker-shoulders",
      "name": "Striker Pauldrons",
      "slot": "shoulders",
      "description": "Angular shoulder armor with a cool blue finish.",
      "icon": "images/equipment/striker-shoulders-v2.png",
      "models": [
        "models/combat/equipment/striker-shoulders-combat-v2.glb"
      ]
    },
    {
      "id": "striker-hands",
      "name": "Striker Gauntlets",
      "slot": "hands",
      "description": "A matching pair of Striker gauntlets.",
      "icon": "images/equipment/striker-hands-v2.png",
      "models": [
        "models/combat/equipment/striker-hands-combat-v2.glb"
      ]
    },
    {
      "id": "striker-legs",
      "name": "Striker Greaves",
      "slot": "legs",
      "description": "Mixed armor pieces with a distinct silhouette.",
      "icon": "images/equipment/striker-legs-v2.png",
      "models": [
        "models/combat/equipment/striker-legs-combat-v2.glb"
      ]
    },
    {
      "id": "striker-boots",
      "name": "Striker Boots",
      "slot": "boots",
      "description": "Armored boots in the Striker color palette.",
      "icon": "images/equipment/striker-boots-v2.png",
      "models": [
        "models/combat/equipment/striker-boots-combat-v2.glb"
      ]
    },
    {
      "id": "brute-head",
      "name": "Brute Mask",
      "slot": "head",
      "description": "A grinning pumpkin mask. Impossible to miss.",
      "icon": "images/equipment/brute-head-v2.png",
      "models": [
        "models/combat/equipment/brute-head-combat-v2.glb"
      ]
    },
    {
      "id": "none-head",
      "name": "No Armor",
      "slot": "head",
      "description": "Show your character without a headpiece.",
      "icon": "images/equipment/none-head-v2.png",
      "models": []
    },
    {
      "id": "none-chest",
      "name": "No Armor",
      "slot": "chest",
      "description": "Remove chest armor and keep a simple base layer.",
      "icon": "images/equipment/none-chest-v2.png",
      "models": [
        "models/combat/equipment/none-chest-vanguard-combat-v2.glb"
      ],
      "modelsByCharacter": {
        "vanguard": [
          "models/combat/equipment/none-chest-vanguard-combat-v2.glb"
        ],
        "scout": [
          "models/combat/equipment/none-chest-scout-combat-v2.glb"
        ],
        "striker": [
          "models/combat/equipment/none-chest-striker-combat-v2.glb"
        ],
        "brute": [
          "models/combat/equipment/none-chest-brute-combat-v2.glb"
        ]
      }
    },
    {
      "id": "none-shoulders",
      "name": "No Armor",
      "slot": "shoulders",
      "description": "A clean shoulder silhouette without extra armor.",
      "icon": "images/equipment/none-shoulders-v2.png",
      "models": []
    },
    {
      "id": "none-hands",
      "name": "No Armor",
      "slot": "hands",
      "description": "Remove gloves and forearm armor.",
      "icon": "images/equipment/none-hands-v2.png",
      "models": [
        "models/combat/equipment/none-hands-vanguard-combat-v2.glb"
      ],
      "modelsByCharacter": {
        "vanguard": [
          "models/combat/equipment/none-hands-vanguard-combat-v2.glb"
        ],
        "scout": [
          "models/combat/equipment/none-hands-scout-combat-v2.glb"
        ],
        "striker": [
          "models/combat/equipment/none-hands-striker-combat-v2.glb"
        ],
        "brute": [
          "models/combat/equipment/none-hands-brute-combat-v2.glb"
        ]
      }
    },
    {
      "id": "none-legs",
      "name": "No Armor",
      "slot": "legs",
      "description": "Remove leg armor and keep the basic outfit.",
      "icon": "images/equipment/none-legs-v2.png",
      "models": [
        "models/combat/equipment/none-legs-vanguard-combat-v2.glb"
      ],
      "modelsByCharacter": {
        "vanguard": [
          "models/combat/equipment/none-legs-vanguard-combat-v2.glb"
        ],
        "scout": [
          "models/combat/equipment/none-legs-scout-combat-v2.glb"
        ],
        "striker": [
          "models/combat/equipment/none-legs-striker-combat-v2.glb"
        ],
        "brute": [
          "models/combat/equipment/none-legs-brute-combat-v2.glb"
        ]
      }
    },
    {
      "id": "none-boots",
      "name": "No Armor",
      "slot": "boots",
      "description": "Remove footwear for a barefoot look.",
      "icon": "images/equipment/none-boots-v2.png",
      "models": [
        "models/combat/equipment/none-boots-vanguard-combat-v2.glb"
      ],
      "modelsByCharacter": {
        "vanguard": [
          "models/combat/equipment/none-boots-vanguard-combat-v2.glb"
        ],
        "scout": [
          "models/combat/equipment/none-boots-scout-combat-v2.glb"
        ],
        "striker": [
          "models/combat/equipment/none-boots-striker-combat-v2.glb"
        ],
        "brute": [
          "models/combat/equipment/none-boots-brute-combat-v2.glb"
        ]
      }
    },
    {
      "id": "none-weapon",
      "name": "Unarmed",
      "slot": "weapon",
      "description": "Put your sword away. Equip a blade before entering a sword duel.",
      "icon": "",
      "models": []
    }
  ],
  "cores": {
    "vanguard": [
      "models/combat/equipment/core-vanguard-combat-v2.glb"
    ],
    "scout": [
      "models/combat/equipment/core-scout-combat-v2.glb"
    ],
    "striker": [
      "models/combat/equipment/core-striker-combat-v2.glb"
    ],
    "brute": [
      "models/combat/equipment/core-brute-combat-v2.glb"
    ]
  },
  "defaults": {
    "vanguard": {
      "head": "knight-head",
      "chest": "knight-chest",
      "shoulders": "knight-shoulders",
      "hands": "knight-hands",
      "legs": "knight-legs",
      "boots": "knight-boots",
      "weapon": "pride-sword"
    },
    "scout": {
      "head": "scout-head",
      "chest": "scout-chest",
      "shoulders": "scout-shoulders",
      "hands": "scout-hands",
      "legs": "scout-legs",
      "boots": "scout-boots",
      "weapon": "bw-longbow-01"
    },
    "striker": {
      "head": "striker-head",
      "chest": "striker-chest",
      "shoulders": "striker-shoulders",
      "hands": "striker-hands",
      "legs": "striker-legs",
      "boots": "striker-boots",
      "weapon": "dr-staff-01"
    },
    "brute": {
      "head": "brute-head",
      "chest": "none-chest",
      "shoulders": "none-shoulders",
      "hands": "none-hands",
      "legs": "none-legs",
      "boots": "none-boots",
      "weapon": "pride-sword"
    }
  },
  "frame": "All modular GLBs share the supplied models/knight.glb bind frame, scale and origin. Never resize individual slots.",
  "sourcePackage": "SIDEKICK_Starter_Unity_2021_3_v1_0_4.unitypackage",
  "generation": {
    "modelCount": 41,
    "iconCount": 25,
    "clipDurations": {
      "A_MOD_BL_Idle_Standing_Masc": 1.766666702926159,
      "A_MOD_BL_Walk_F_Masc": 1.0333333536982536,
      "A_MOD_BL_Run_F_Masc": 0.6999999806284904
    },
    "rigBoneCount": 137,
    "frameMatrix": [
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0
    ],
    "modesty": "Base chest retains the supplied wrap garment on its source skin. Base legs use opaque dark fabric on the existing hips geometry for underwear, with no overlapping body shell.",
    "animation": "Shared locomotion and sword-combat timelines across armor and weapons.",
    "bindFrame": "Inverse(IBM), using raw shared export frame without an extra canonical wrapper.",
    "geometry": "Existing raw modular geometry reused unchanged."
  }
} as EquipmentAssets

/** Armor and the empty slots from the Sidekick export, the class outfit sets, then every loot weapon. */
export const EQUIPMENT_ITEMS: EquipmentItem[] = [
  ...ASSETS.items, ...(outfitCatalog.items as EquipmentItem[]), ...(weaponCatalog.items as EquipmentItem[])
]
export const EQUIPMENT_CORES: Record<string, string[]> = ASSETS.cores
/** Sidekick defaults, with the armor slots of heroes that have an outfit set (scripts/build-hero-outfits.py) replaced. */
export const DEFAULT_LOADOUTS: Record<string, EquipmentLoadout> = Object.fromEntries(
  Object.entries(ASSETS.defaults).map(([id, loadout]) => [
    id, { ...loadout, ...((outfitCatalog.defaults as Record<string, Partial<EquipmentLoadout>>)[id] ?? {}) }
  ])
)
/** Outfit pieces with bare skin: a per-tone file exists under models/roaming/customization/armor/<tone>/. */
export const SKIN_TONED_ARMOR = new Set<string>(outfitCatalog.skinVariants)

/**
 * Where a loot weapon's GLB stands when nothing animates it: at the hero's
 * T-pose right hand. A drop on the floor parents the GLB under this local
 * transform to show it upright at the drop's origin.
 */
export const WEAPON_DROP_OFFSET: { position: number[]; rotation: number[] } = weaponCatalog.dropOffset
/** The same for left-hand weapons (bows), whose stored pose is the T-pose left hand. */
export const WEAPON_DROP_OFFSET_LEFT: { position: number[]; rotation: number[] } = weaponCatalog.dropOffsetLeft

const byId = new Map<string, EquipmentItem>(EQUIPMENT_ITEMS.map((item) => [item.id, item]))

export function getEquipmentItem(id: string): EquipmentItem {
  const item = byId.get(id)
  if (!item) throw new Error(`Unknown equipment item: ${id}`)
  return item
}

export function getEquipmentItemOrNull(id: string): EquipmentItem | undefined {
  return byId.get(id)
}

/**
 * A loadout from the network or a save may name items this build does not
 * have (another client's newer weapon, a renamed id). Unknown entries fall
 * back to the character's defaults so nothing downstream has to throw.
 */
export function sanitizeLoadout(loadout: EquipmentLoadout, characterId: string): EquipmentLoadout {
  const defaults = DEFAULT_LOADOUTS[characterId] ?? DEFAULT_LOADOUTS.vanguard
  const out = { ...loadout }
  for (const slot of EQUIPMENT_SLOTS) {
    const item = byId.get(out[slot.id])
    if (!item || item.slot !== slot.id) out[slot.id] = defaults[slot.id]
  }
  // A weapon of another class (a save from before the archer had a bow) becomes the class starter.
  const weapon = byId.get(out.weapon)
  if (weapon?.weapon && !classAllowsWeapon(characterId, weapon.weapon.class)) out.weapon = defaults.weapon
  return out
}

export function getUnequippedItem(slot: EquipmentSlot): EquipmentItem {
  return getEquipmentItem(`none-${slot}`)
}
