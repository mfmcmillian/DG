// The title's moving backdrop: the castle at dusk with its banners, wheel and
// fires going, streamed as a looping video. Screen-space UI cannot show a video
// texture, so the clip plays on a plane hung in front of the camera. The plane
// is a child of the camera entity rather than a fixed spot in the world: the
// Explorer's camera is never perfectly still, and on a full-screen plane a few
// metres out every tremor read as the picture shaking. Riding with the camera,
// the picture holds. The UI keeps drawing the still title-bg.jpg over it until
// the stream reports it is really playing, and goes back to the still if it
// fails, so a slow or dead host only ever costs the motion.

import {
  engine, Entity, Material, MeshRenderer, Transform, VideoPlayer, VideoState, videoEventsSystem, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { MENU_CAMERA_POSITION } from './menuPreviewStage'
import { isTitleOpen } from './titleScreen'
import { hasMoved } from './home'
import { uiViewport } from './uiScale'
import { isHeadless } from './multiplayer'

/**
 * 1280x720, 10 s, locked-off camera, made to loop; hosted with open CORS and
 * range requests. The native 720p render: the generator's 1080p is an upscale
 * that adds a frame-to-frame shimmer, which on a full-screen plane reads as
 * camera shake. images/ui/kit/title-bg.jpg is this clip's first frame, so the
 * still-to-video handover shows nothing.
 */
const TITLE_VIDEO_URL = 'https://media.decentraland-dashboard.org/v/21c86d39-03cc-4f5e-bb3b-60efb64c1758/c840e5f7-62e7-4b1a-a97b-58e5d26ea987.mp4'
const VIDEO_ASPECT = 16 / 9

const TAN_HALF_FOV = Math.tan(Math.PI / 6)
/** Where the picker's backdrop sits too: the room in front of the title camera is known clear this far. */
const DEPTH = 6
/** A hair larger than the view so the plane's edge never shows against a stray pixel of the scene. */
const OVERSCAN = 1.02
/**
 * The camera entity is only trusted to carry the plane while it reports the
 * title rig's own position; were it to report another camera, the plane would
 * hang out of view and the still stays up instead.
 */
const ON_RIG_DISTANCE = 1.5

let screen: Entity | undefined
let layoutKey = ''
let state: VideoState = VideoState.VS_NONE
let showing = false

/** True while the clip is really on screen: the UI then leaves out its still. */
export function isTitleVideoShowing(): boolean {
  return showing
}

export function initializeTitleVideo() {
  if (isHeadless()) return
  engine.addSystem(titleVideoSystem)
}

function ensureScreen(): Entity {
  if (screen) return screen
  screen = engine.addEntity()
  // Straight ahead of the camera, facing it, the same geometry as the picker's
  // backdrop seen from its rig.
  Transform.create(screen, { parent: engine.CameraEntity, position: Vector3.create(0, 0, DEPTH) })
  MeshRenderer.setPlane(screen)
  VideoPlayer.create(screen, { src: TITLE_VIDEO_URL, playing: false, loop: true, volume: 0 })
  // Unlit: the clip carries its own light, the courtyard's must not tint it.
  Material.setBasicMaterial(screen, {
    texture: Material.Texture.Video({ videoPlayerEntity: screen }),
    castShadows: false
  })
  VisibilityComponent.create(screen, { visible: false })
  videoEventsSystem.registerVideoEventsEntity(screen, (event) => {
    state = event.state
    if (state === VideoState.VS_ERROR) console.log('Title video failed; the still stays up')
  })
  return screen
}

/** Cover the view: fit the clip's 16:9 over the camera's frame, cropping whichever way the screen does not match. */
function fitScreen(entity: Entity) {
  const { canvas } = uiViewport()
  const aspect = Math.max(0.5, canvas.width / Math.max(1, canvas.height))
  const key = aspect.toFixed(3)
  if (key === layoutKey) return
  layoutKey = key
  const viewHeight = 2 * DEPTH * TAN_HALF_FOV * OVERSCAN
  const viewWidth = viewHeight * aspect
  const width = aspect >= VIDEO_ASPECT ? viewWidth : viewHeight * VIDEO_ASPECT
  const height = width / VIDEO_ASPECT
  Transform.getMutable(entity).scale = Vector3.create(width, height, 1)
}

function cameraOnRig(): boolean {
  const camera = Transform.getOrNull(engine.CameraEntity)
  return !!camera && Vector3.distance(camera.position, MENU_CAMERA_POSITION) < ON_RIG_DISTANCE
}

function titleVideoSystem() {
  // The LAND's moved screen keeps its still: that title has one job and no dependencies.
  const wanted = isTitleOpen() && !hasMoved()
  if (!wanted) {
    if (screen) {
      const player = VideoPlayer.getMutable(screen)
      if (player.playing) player.playing = false
      VisibilityComponent.getMutable(screen).visible = false
    }
    showing = false
    return
  }
  const entity = ensureScreen()
  fitScreen(entity)
  const player = VideoPlayer.getMutable(entity)
  if (!player.playing) player.playing = true
  // Once it has a frame up, a stall to rebuffer or the seek back to the start
  // of the loop keeps the frame rather than cutting to the still and back.
  const holding = showing && (state === VideoState.VS_BUFFERING || state === VideoState.VS_SEEKING)
  const playing = (state === VideoState.VS_PLAYING || holding) && cameraOnRig()
  const visibility = VisibilityComponent.getMutable(entity)
  if (visibility.visible !== playing) visibility.visible = playing
  showing = playing
}
