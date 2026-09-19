import {
  AvatarBase, Billboard, BillboardMode, engine, Entity, PlayerIdentityData,
  TextAlignMode, TextShape, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

/** Above the head: enough to clear hair and helmets, still readable from the crawler camera. */
const HEIGHT = 2.22
const GOLD = Color4.create(0.93, 0.82, 0.52, 1)

export function createHeroNameTag(parent: Entity): Entity {
  const tag = engine.addEntity()
  Transform.create(tag, { parent, position: Vector3.create(0, HEIGHT, 0) })
  Billboard.create(tag, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(tag, {
    text: '',
    fontSize: 2.6,
    textColor: GOLD,
    outlineColor: Color4.create(0.06, 0.05, 0.03, 1),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_BOTTOM_CENTER
  })
  VisibilityComponent.create(tag, { visible: false })
  return tag
}

/** Look up the Decentraland display name for this address. Empty until the renderer has it. */
export function playerDisplayName(address: string): string {
  const want = address.toLowerCase()
  if (!want) return ''
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if ((identity.address || '').toLowerCase() !== want) continue
    return (AvatarBase.getOrNull(entity)?.name || '').trim()
  }
  return ''
}

export function updateHeroNameTag(tag: Entity, address: string, visible: boolean) {
  const name = playerDisplayName(address)
  const show = visible && !!name
  const shape = TextShape.getMutable(tag)
  if (shape.text !== name) shape.text = name
  const vis = VisibilityComponent.getMutable(tag)
  if (vis.visible !== show) vis.visible = show
}

export function destroyHeroNameTag(tag: Entity) {
  engine.removeEntity(tag)
}
