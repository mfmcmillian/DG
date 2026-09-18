import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'

export type MenuView = 'picker' | 'inventory'

const FRAME = { width: 1280, height: 760 }
const PREVIEW = {
  picker: { left: 254, top: 114, width: 476, height: 540 },
  inventory: { left: 120, top: 130, width: 390, height: 540 }
}

function inset(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Canvas-pixel coordinates shared by the UI and the live character stage. */
export function getMenuLayout(view: MenuView) {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = canvas?.width || 1600
  const screenHeight = canvas?.height || 900
  const padding = Math.max(12, Math.min(24, screenWidth * 0.01))
  const device = canvas?.screenInsetArea
  const native = canvas?.interactableArea
  // Explorer reports reserved edge widths. Keep the expanded chat column free
  // even when closed, so opening chat never shifts or covers menu controls.
  const left = Math.max(screenWidth * 0.25, inset(native?.left), inset(device?.left)) + padding
  const right = Math.max(inset(native?.right), inset(device?.right)) + padding
  const top = Math.max(screenHeight * 0.15, 144, inset(native?.top), inset(device?.top)) + padding
  const bottom = Math.max(inset(native?.bottom), inset(device?.bottom)) + padding
  const availableWidth = Math.max(1, screenWidth - left - right)
  const availableHeight = Math.max(1, screenHeight - top - bottom)
  const scale = Math.min(availableWidth / FRAME.width, availableHeight / FRAME.height)
  const width = FRAME.width * scale
  const height = FRAME.height * scale
  const x = left + (availableWidth - width) / 2
  const y = top + (availableHeight - height) / 2
  const hero = PREVIEW[view]
  return {
    x, y, scale, width, height, screenWidth, screenHeight,
    preview: {
      left: x + hero.left * scale, top: y + hero.top * scale,
      width: hero.width * scale, height: hero.height * scale
    }
  }
}
