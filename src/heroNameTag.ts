import {
  AvatarBase, Billboard, BillboardMode, engine, Entity, PlayerIdentityData,
  TextAlignMode, TextShape, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { CRAWLER_CAMERA, isCrawlerCameraOn } from './dungeon/crawlerCamera'

/** Above the head: enough to clear hair and helmets, still readable from the crawler camera. */
const HEIGHT = 2.22
const GOLD = Color4.create(0.93, 0.82, 0.52, 1)

/**
 * Far-away stand-in for the crawler camera. Under that camera the tag sits
 * almost straight below the lens, and a billboard aimed at the real camera
 * re-derives its yaw every frame from a near-vertical direction, which is what
 * made the name shiver as the player moved. The camera's direction from the
 * player is a constant in rigid mode, so the tag faces a point 50 km along
 * it instead: the same orientation, and nothing left to jitter.
 */
let farCamera: Entity | undefined

function farCameraTarget(): Entity {
  if (farCamera !== undefined) return farCamera
  const { pitch, height, yaw } = CRAWLER_CAMERA
  const rad = (yaw * Math.PI) / 180
  const back = height / Math.tan((pitch * Math.PI) / 180)
  const toCamera = Vector3.normalize(Vector3.create(-Math.sin(rad) * back, height - HEIGHT, -Math.cos(rad) * back))
  farCamera = engine.addEntity()
  Transform.create(farCamera, { position: Vector3.scale(toCamera, 50000) })
  return farCamera
}

export function createHeroNameTag(parent: Entity): Entity {
  const tag = engine.addEntity()
  Transform.create(tag, { parent, position: Vector3.create(0, HEIGHT, 0) })
  Billboard.create(tag, { billboardMode: BillboardMode.BM_ALL })
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

/**
 * Look up the Decentraland display name for this address. Empty until the
 * renderer has it. The name is taken as given: "Undefined" is somebody's
 * actual name, so nothing is second-guessed except an empty string or the
 * wallet echoed back as the name.
 */
export function playerDisplayName(address: string): string {
  const want = address.toLowerCase()
  if (!want) return ''
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if ((identity.address || '').toLowerCase() !== want) continue
    const name = (AvatarBase.getOrNull(entity)?.name || '').trim()
    // A guest, or a profile the renderer has not resolved, comes through as a placeholder word.
    if (name.toLowerCase() === want || /^(undefined|unknown|null|guest)$/i.test(name)) return ''
    return name
  }
  return ''
}

/** What the tag shows: the display name, or a short wallet when the renderer has none worth showing. */
export function heroTagText(address: string): string {
  const name = playerDisplayName(address)
  if (name) return name
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function updateHeroNameTag(tag: Entity, address: string, visible: boolean, level = 0) {
  const base = heroTagText(address)
  const name = base && level > 1 ? `${base}  ${level}` : base
  const show = visible && !!name
  const shape = TextShape.getMutable(tag)
  if (shape.text !== name) shape.text = name
  const vis = VisibilityComponent.getMutable(tag)
  if (vis.visible !== show) vis.visible = show
  // Rigid crawler camera: face its fixed direction. Any other camera: face the camera itself.
  const target = isCrawlerCameraOn() && CRAWLER_CAMERA.mode === 'rigid' ? farCameraTarget() : undefined
  const billboard = Billboard.getMutable(tag)
  if (billboard.targetEntity !== target) billboard.targetEntity = target
}

export function destroyHeroNameTag(tag: Entity) {
  engine.removeEntity(tag)
}
