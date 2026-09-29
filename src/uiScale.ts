// One screen to lay the UI out for. The SDK scales every pixel value the UI
// gives it (sizes, positions, margins, numeric font sizes) by the contain-fit
// of this virtual screen in the real canvas, and positions the UI's root inside
// the device's safe margins (notch, home bar, rounded corners). So the layouts
// think in virtual pixels of a 1600x900 screen and never compute a scale of
// their own: on a 1080p monitor that is x1.2, on a phone the SDK swaps the
// virtual screen for 1600x720 (a phone is wider than 16:9) and the same layout
// shrinks to fit. What the layouts still need to know is how big the root area
// is in those pixels, and which of its edges the explorer's own HUD (minimap,
// chat, joystick) sits on: that is what uiViewport() answers.

import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'
import type { UiTransformProps } from '@dcl/sdk/react-ecs'

/** The screen the layouts are drawn for; passed to the renderer as the virtual screen. */
export const VIRTUAL_SCREEN = { width: 1600, height: 900 }
/** What the SDK uses in place of any 16:9 virtual screen on a phone. */
const MOBILE_VIRTUAL_SCREEN = { width: 1600, height: 720 }

export type UiEdges = { left: number; right: number; top: number; bottom: number }

export type UiViewport = {
  /** The UI root's size in virtual pixels: the canvas inside the device's safe margins. */
  width: number
  height: number
  /** The whole canvas in virtual pixels, and where the root starts on it: for mapping UI onto the 3D view. */
  canvas: { width: number; height: number; originX: number; originY: number }
  /** How far the explorer's own HUD reaches into the root from each edge, in virtual pixels. */
  reserved: UiEdges
  /** A phone is drawing this. */
  mobile: boolean
}

/** The virtual screen in use right now (the SDK's mobile swap included). */
export function virtualScreen(): { width: number; height: number } {
  return isMobile() ? MOBILE_VIRTUAL_SCREEN : VIRTUAL_SCREEN
}

function edge(value: number | undefined, factor: number): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) / factor : 0
}

export function uiViewport(): UiViewport {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screen = virtualScreen()
  const canvasWidth = canvas?.width || screen.width
  const canvasHeight = canvas?.height || screen.height
  // The same contain-fit the SDK applies to every pixel value.
  const factor = Math.min(canvasWidth / screen.width, canvasHeight / screen.height) || 1
  const inset = canvas?.screenInsetArea
  const device: UiEdges = {
    left: edge(inset?.left, factor), right: edge(inset?.right, factor), top: edge(inset?.top, factor), bottom: edge(inset?.bottom, factor)
  }
  // The explorer reports its HUD's reach from the screen's edge; the root already starts inside the device margin.
  const hud = canvas?.interactableArea
  const reserved: UiEdges = {
    left: Math.max(0, edge(hud?.left, factor) - device.left),
    right: Math.max(0, edge(hud?.right, factor) - device.right),
    top: Math.max(0, edge(hud?.top, factor) - device.top),
    bottom: Math.max(0, edge(hud?.bottom, factor) - device.bottom)
  }
  const fullWidth = canvasWidth / factor
  const fullHeight = canvasHeight / factor
  return {
    width: Math.max(1, fullWidth - device.left - device.right),
    height: Math.max(1, fullHeight - device.top - device.bottom),
    canvas: { width: fullWidth, height: fullHeight, originX: device.left, originY: device.top },
    reserved,
    mobile: isMobile()
  }
}

/**
 * A transform for a backdrop that covers the whole canvas rather than the root:
 * the root stops at the device's safe margins, and a title or a veil should not
 * leave the scene showing round the notch and the home bar. Put it on a layer
 * of its own, drawn under the content, which stays laid out inside the root.
 */
export function wholeCanvas(): UiTransformProps {
  const { canvas } = uiViewport()
  return {
    positionType: 'absolute', position: { left: -canvas.originX, top: -canvas.originY },
    width: canvas.width, height: canvas.height, pointerFilter: 'none'
  }
}
