import { engine, Entity, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { getMenuLayout } from './menuLayout'

type MenuView = 'picker' | 'inventory'
export type MenuPreviewStage = {
  view: MenuView
  anchor: Entity
  background: Entity
  shadow: Entity
  lights: Entity[]
  layoutKey: string
}

export const MENU_CAMERA_POSITION = Vector3.create(46, 13.6, 46)
export const MENU_CAMERA_TARGET = Vector3.create(46, 13, 49)
export const MENU_PREVIEW_FACING = 165

const FORWARD = Vector3.normalize(Vector3.subtract(MENU_CAMERA_TARGET, MENU_CAMERA_POSITION))
const RIGHT = Vector3.create(1, 0, 0)
const UP = Vector3.cross(FORWARD, RIGHT)
const TAN_HALF_FOV = Math.tan(Math.PI / 6)
const MODEL_HEIGHT = 2.1
const BACKGROUND_ASPECT = 1024 / 576
const BACKGROUND_OVERSCAN = 1.015
// Studio lighting against a dark backdrop: warm key from the front-left, cool
// fill from the right, and a cool rim from behind so the hero's outline
// separates from the near-black.
const LIGHTS = [
  { position: Vector3.create(-1.5, 2.7, -1.6), color: Color3.create(1, 0.94, 0.86), intensity: 900 },
  { position: Vector3.create(1.5, 1.9, -0.8), color: Color3.create(0.84, 0.91, 1), intensity: 500 },
  { position: Vector3.create(0.6, 2.4, 1.8), color: Color3.create(0.7, 0.82, 1), intensity: 650 }
]

/** A temporary presentation space; the existing scene-camera owner handles entry and return. */
export function createMenuPreviewStage(view: MenuView): MenuPreviewStage {
  const anchor = engine.addEntity()
  Transform.create(anchor, {})
  const background = engine.addEntity()
  Transform.create(background, { rotation: Quaternion.lookRotation(FORWARD, UP) })
  MeshRenderer.setPlane(background)

  const shadow = engine.addEntity()
  Transform.create(shadow, {
    parent: anchor,
    position: Vector3.create(0, -0.018, 0),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(0.95, 0.65, 1)
  })
  MeshRenderer.setPlane(shadow)
  // Feathered alpha blends into the illustrated floor instead of obscuring it
  // with a solid podium. Black albedo keeps this decal independent of lighting.
  Material.setPbrMaterial(shadow, {
    texture: Material.Texture.Common({ src: 'images/ui/contact-shadow.png' }),
    albedoColor: Color4.create(0, 0, 0, 1),
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    alphaTest: 0, metallic: 0, roughness: 1, specularIntensity: 0, castShadows: false
  })

  const lights = LIGHTS.map((settings) => {
    const light = engine.addEntity()
    Transform.create(light, { parent: anchor, position: settings.position })
    LightSource.create(light, {
      type: LightSource.Type.Point({}), color: settings.color,
      intensity: settings.intensity, range: 6, shadow: false
    })
    return light
  })
  const stage: MenuPreviewStage = { view, anchor, background, shadow, lights, layoutKey: '' }
  updateMenuPreviewStage(stage)
  return stage
}

export function updateMenuPreviewStage(stage: MenuPreviewStage) {
  const layout = getMenuLayout(stage.view)
  const { preview } = layout
  const screenWidth = Math.max(1, layout.screenWidth)
  const screenHeight = Math.max(1, layout.screenHeight)
  const key = [screenWidth, screenHeight, preview.left, preview.top, preview.width, preview.height].join(':')
  if (stage.layoutKey === key) return
  stage.layoutKey = key

  const aspect = screenWidth / screenHeight
  // Keep even very wide backgrounds inside scene bounds. The actor's projection
  // uses the same shortened depth, so resizing never moves the actual camera.
  const horizontalRoom = Math.min(MENU_CAMERA_POSITION.x - 1, COURTYARD.sceneSize - MENU_CAMERA_POSITION.x - 1)
  const backgroundDepth = Math.min(6, horizontalRoom / (TAN_HALF_FOV * aspect * BACKGROUND_OVERSCAN))
  const actorDepth = backgroundDepth * (3.2 / 6)
  const centerX = preview.left + preview.width / 2
  // Lift the feet off the control strip while keeping the same top clearance
  // for helmets and the taller, relaxed standing pose.
  const footY = preview.top + preview.height * 0.88
  const headY = preview.top + preview.height * 0.05
  const cameraX = (centerX / screenWidth * 2 - 1) * TAN_HALF_FOV * aspect * actorDepth
  const cameraY = (1 - footY / screenHeight * 2) * TAN_HALF_FOV * actorDepth
  const topSlope = (1 - headY / screenHeight * 2) * TAN_HALF_FOV
  // The model stays upright. Solve its height in world-up, accounting for the
  // camera's downward pitch rather than tilting the character toward the screen.
  const worldHeight = (topSlope * actorDepth - cameraY) / (UP.y - topSlope * FORWARD.y)
  const scale = Math.max(0.001, worldHeight / MODEL_HEIGHT)
  const anchor = Transform.getMutable(stage.anchor)
  anchor.position = cameraSpacePoint(cameraX, cameraY, actorDepth)
  anchor.scale = Vector3.create(scale, scale, scale)

  const backgroundHeight = 2 * backgroundDepth * TAN_HALF_FOV * BACKGROUND_OVERSCAN
  const background = Transform.getMutable(stage.background)
  background.position = cameraSpacePoint(0, 0, backgroundDepth)
  background.scale = Vector3.create(backgroundHeight * aspect, backgroundHeight, 1)
  const cropX = Math.min(1, aspect / BACKGROUND_ASPECT)
  const cropY = Math.min(1, BACKGROUND_ASPECT / aspect)
  Material.setBasicMaterial(stage.background, {
    texture: Material.Texture.Common({
      src: 'images/ui/armory-backdrop.png',
      tiling: { x: cropX, y: cropY }, offset: { x: (1 - cropX) / 2, y: (1 - cropY) / 2 }
    }),
    diffuseColor: Color4.White(), castShadows: false
  })
  // Preserve the same local lighting when the layout changes the model's scale.
  stage.lights.forEach((entity, index) => {
    const light = LightSource.getMutable(entity)
    light.intensity = LIGHTS[index].intensity * scale * scale
    light.range = 6 * scale
  })
}

/** Call after removing previews, whose own roots are children of the anchor. */
export function destroyMenuPreviewStage(stage: MenuPreviewStage) {
  for (const entity of [stage.shadow, ...stage.lights, stage.background, stage.anchor]) engine.removeEntity(entity)
}

function cameraSpacePoint(x: number, y: number, depth: number): Vector3 {
  return Vector3.create(
    MENU_CAMERA_POSITION.x + RIGHT.x * x + UP.x * y + FORWARD.x * depth,
    MENU_CAMERA_POSITION.y + RIGHT.y * x + UP.y * y + FORWARD.y * depth,
    MENU_CAMERA_POSITION.z + RIGHT.z * x + UP.z * y + FORWARD.z * depth
  )
}
