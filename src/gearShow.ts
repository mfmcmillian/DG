// A piece of gear stood up on its own to be looked at: the weapon GLB the way
// it lies as loot (the hand-authored model on a child carrying the drop offset),
// armor as its wardrobe icon on a card facing the camera, since a skinned body
// part has nothing to stand on. The pit's offering and the legendary reveal
// (src/pitCinematic.ts, src/cinematics.ts) both show gear this way.

import { Billboard, engine, Entity, GltfContainer, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getEquipmentItemOrNull, WEAPON_DROP_OFFSET, WEAPON_DROP_OFFSET_LEFT } from './equipmentCatalog'

/** Build the shown piece at `at`; the root is what the caller moves and, when done, removes with its children. */
export function showGear(id: string, at: Vector3): Entity {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(at) })
  const gear = getEquipmentItemOrNull(id)
  if (gear && !gear.weapon) {
    const card = engine.addEntity()
    Transform.create(card, { parent: root, position: Vector3.create(0, 0.31, 0), scale: Vector3.create(0.62, 0.62, 1) })
    MeshRenderer.setPlane(card)
    Material.setPbrMaterial(card, {
      texture: Material.Texture.Common({ src: gear.icon }),
      emissiveTexture: Material.Texture.Common({ src: gear.icon }),
      emissiveColor: Color4.create(0.6, 0.6, 0.6, 1), emissiveIntensity: 1,
      transparencyMode: 2, alphaTest: 0.5, castShadows: false
    })
    Billboard.create(card)
  } else if (gear?.models[0]) {
    const model = engine.addEntity()
    const offset = gear.weapon?.hand === 'l' ? WEAPON_DROP_OFFSET_LEFT : WEAPON_DROP_OFFSET
    Transform.create(model, {
      parent: root,
      position: Vector3.create(offset.position[0], offset.position[1], offset.position[2]),
      rotation: Quaternion.create(offset.rotation[0], offset.rotation[1], offset.rotation[2], offset.rotation[3])
    })
    GltfContainer.create(model, { src: gear.models[0], visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  }
  return root
}
