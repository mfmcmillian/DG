// Square icon buttons with a hover tooltip: the HUD's Inventory / Edit character /
// Settings row, and the same three in the dungeon lobby's header.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

const white = Color4.create(0.94, 0.96, 0.98, 1)
const panel = Color4.create(0.04, 0.065, 0.10, 0.82)
const hoverPanel = Color4.create(0.13, 0.17, 0.22, 0.96)
const line = Color4.create(0.52, 0.58, 0.66, 0.6)
const gold = Color4.create(1, 0.82, 0.32, 1)
const goldPanel = Color4.create(0.30, 0.22, 0.06, 0.96)
const ink = Color4.create(0.12, 0.08, 0.02, 1)
let hovered = ''

export type IconButtonProps = {
  id: string; label: string; icon: string; onClick: () => void; scale: number; disabled?: boolean
  /** Tooltip side; the HUD's bottom row shows it above, a header row below. */
  tooltip?: 'above' | 'below'
  /** Something new waits behind this button: a pulsing gold frame and a badge (`badge`, NEW by default) until it is pressed. */
  glow?: boolean
  badge?: string
  /** Side of the square at scale 1; 48 by default. The icon keeps its proportion. */
  size?: number
}

export function IconButton({ id, label, icon, onClick, scale: s, disabled = false, tooltip = 'above', glow = false, badge = 'NEW', size = 48 }: IconButtonProps) {
  const hover = hovered === id
  const lit = glow && !disabled
  // A slow breath, so the eye goes to it without it flashing.
  const pulse = lit ? 0.55 + 0.45 * Math.sin(Date.now() / 260) : 0
  return <UiEntity uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 8 * s,
      borderWidth: lit ? (1.5 + pulse * 1.5) * s : s, borderColor: hover && !disabled ? white : lit ? gold : line,
      justifyContent: 'center', alignItems: 'center', opacity: disabled ? 0.4 : 1, pointerFilter: 'block' }}
      uiBackground={{ color: hover && !disabled ? hoverPanel : lit ? goldPanel : panel }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={disabled ? undefined : () => { hovered = ''; onClick() }}>
      <UiEntity uiTransform={{ width: size * 0.54 * s, height: size * 0.54 * s, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
    </UiEntity>
    {lit && <UiEntity uiTransform={{ positionType: 'absolute', position: { right: -8 * s, top: -9 * s },
      width: 34 * s, height: 17 * s, borderRadius: 8 * s, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
      uiBackground={{ color: gold }}>
      <Label value={badge} color={ink} font="sans-serif" fontSize={9.5 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
    {hover && <UiEntity uiTransform={{ positionType: 'absolute',
      position: tooltip === 'above' ? { right: 0, bottom: (size + 9) * s } : { right: 0, top: (size + 9) * s },
      width: 142 * s, height: 30 * s, borderRadius: 5 * s, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
      <Label value={label} color={white} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
  </UiEntity>
}

const green = Color4.create(0.36, 0.72, 0.40, 1)
const greenHover = Color4.create(0.48, 0.82, 0.50, 1)
const greenLine = Color4.create(0.44, 0.78, 0.46, 1)
const goldFill = Color4.create(0.78, 0.65, 0.40, 1)
const goldFillHover = Color4.create(0.89, 0.78, 0.53, 1)

export type StackButtonProps = {
  id: string; label: string; onClick: () => void; scale: number; disabled?: boolean
  /** A small icon left of the label. */
  icon?: string
  /** dark: the panel with a gold line; gold: a filled gold slab; green: the one primary action. */
  tone?: 'dark' | 'gold' | 'green'
  width?: number
  height?: number
  fontSize?: number
  /** Something new waits behind this button: a badge (`badge`, NEW by default) until it is pressed. */
  glow?: boolean
  badge?: string
}

/**
 * The hall's labelled buttons, stacked bottom-right: Character, Inventory and
 * Play. Wide enough to read without a tooltip, so none is shown.
 */
export function StackButton({ id, label, icon, onClick, scale: s, disabled = false, tone = 'dark', width = 190, height = 50, fontSize = 17, glow = false, badge = 'NEW' }: StackButtonProps) {
  const hover = hovered === id && !disabled
  const lit = glow && !disabled
  const fill = tone === 'green' ? (hover ? greenHover : green) : tone === 'gold' ? (hover ? goldFillHover : goldFill) : (hover ? hoverPanel : panel)
  const edge = tone === 'green' ? greenLine : tone === 'gold' ? goldFillHover : lit ? gold : hover ? white : line
  const text = tone === 'dark' ? white : ink
  return <UiEntity uiTransform={{ width: width * s, height: height * s, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 6 * s, borderWidth: s, borderColor: edge,
      flexDirection: 'row', alignItems: 'center', padding: { left: icon ? 16 * s : 0, right: icon ? 12 * s : 0 },
      opacity: disabled ? 0.4 : 1, pointerFilter: 'block' }}
      uiBackground={{ color: fill }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={disabled ? undefined : () => { hovered = ''; onClick() }}>
      {icon && <UiEntity uiTransform={{ width: 22 * s, height: 22 * s, margin: { right: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />}
      <Label value={label} color={text} font={tone === 'green' ? 'serif' : 'sans-serif'} fontSize={fontSize * s} textWrap="nowrap"
        textAlign={icon ? 'middle-left' : 'middle-center'}
        uiTransform={{ width: icon ? (width - 62) * s : '100%', height: '100%', flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    {lit && <UiEntity uiTransform={{ positionType: 'absolute', position: { right: -8 * s, top: -9 * s },
      width: 34 * s, height: 17 * s, borderRadius: 8 * s, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
      uiBackground={{ color: gold }}>
      <Label value={badge} color={ink} font="sans-serif" fontSize={9.5 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
  </UiEntity>
}
