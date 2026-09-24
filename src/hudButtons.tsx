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
}

export function IconButton({ id, label, icon, onClick, scale: s, disabled = false, tooltip = 'above', glow = false, badge = 'NEW' }: IconButtonProps) {
  const hover = hovered === id
  const lit = glow && !disabled
  // A slow breath, so the eye goes to it without it flashing.
  const pulse = lit ? 0.55 + 0.45 * Math.sin(Date.now() / 260) : 0
  return <UiEntity uiTransform={{ width: 48 * s, height: 48 * s, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 8 * s,
      borderWidth: lit ? (1.5 + pulse * 1.5) * s : s, borderColor: hover && !disabled ? white : lit ? gold : line,
      justifyContent: 'center', alignItems: 'center', opacity: disabled ? 0.4 : 1, pointerFilter: 'block' }}
      uiBackground={{ color: hover && !disabled ? hoverPanel : lit ? goldPanel : panel }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={disabled ? undefined : () => { hovered = ''; onClick() }}>
      <UiEntity uiTransform={{ width: 26 * s, height: 26 * s, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
    </UiEntity>
    {lit && <UiEntity uiTransform={{ positionType: 'absolute', position: { right: -8 * s, top: -9 * s },
      width: 34 * s, height: 17 * s, borderRadius: 8 * s, justifyContent: 'center', alignItems: 'center', pointerFilter: 'none' }}
      uiBackground={{ color: gold }}>
      <Label value={badge} color={ink} font="sans-serif" fontSize={9.5 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
    {hover && <UiEntity uiTransform={{ positionType: 'absolute',
      position: tooltip === 'above' ? { right: 0, bottom: 57 * s } : { right: 0, top: 57 * s },
      width: 142 * s, height: 30 * s, borderRadius: 5 * s, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
      <Label value={label} color={white} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
  </UiEntity>
}
