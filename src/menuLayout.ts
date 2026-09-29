import { uiViewport } from './uiScale'

export type MenuView = 'picker' | 'inventory'

const FRAME = { width: 1280, height: 760 }
const PREVIEW = {
  picker: { left: 254, top: 114, width: 476, height: 540 },
  inventory: { left: 120, top: 130, width: 390, height: 540 }
}

/**
 * Where the menu frame sits, in virtual pixels of the UI root (uiScale.ts). The
 * frame keeps its drawn proportions and fits the room left beside the explorer's
 * HUD; `scale` is that fit, not a screen scale, which the SDK applies on top.
 * `preview` and `screenWidth/Height` are on the whole canvas in the same pixels,
 * for the live character stage that projects the frame's window into the 3D view.
 */
export function getMenuLayout(view: MenuView) {
  const viewport = uiViewport()
  const { width: screenWidth, height: screenHeight, reserved } = viewport
  const padding = Math.max(12, Math.min(24, screenWidth * 0.01))
  // Explorer reports reserved edge widths. Keep the expanded chat column free
  // even when closed, so opening chat never shifts or covers menu controls.
  const left = Math.max(screenWidth * 0.25, reserved.left) + padding
  const right = reserved.right + padding
  const top = Math.max(screenHeight * 0.15, 144, reserved.top) + padding
  const bottom = reserved.bottom + padding
  const availableWidth = Math.max(1, screenWidth - left - right)
  const availableHeight = Math.max(1, screenHeight - top - bottom)
  const scale = Math.min(availableWidth / FRAME.width, availableHeight / FRAME.height)
  const width = FRAME.width * scale
  const height = FRAME.height * scale
  const x = left + (availableWidth - width) / 2
  const y = top + (availableHeight - height) / 2
  const hero = PREVIEW[view]
  return {
    x, y, scale, width, height,
    screenWidth: viewport.canvas.width, screenHeight: viewport.canvas.height,
    preview: {
      left: viewport.canvas.originX + x + hero.left * scale, top: viewport.canvas.originY + y + hero.top * scale,
      width: hero.width * scale, height: hero.height * scale
    }
  }
}
