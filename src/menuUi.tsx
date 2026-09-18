import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { kitTexture, UI_KIT } from './uiKit'

export const menuColors = {
  white: Color4.create(0.96, 0.955, 0.91, 1),
  muted: Color4.create(0.64, 0.70, 0.77, 1),
  gold: Color4.create(0.78, 0.65, 0.40, 1),
  goldHover: Color4.create(0.89, 0.78, 0.53, 1),
  cyan: Color4.create(0.40, 0.84, 0.83, 1),
  ink: Color4.create(0.025, 0.045, 0.07, 1),
  panel: Color4.create(0.025, 0.045, 0.07, 0.94),
  card: Color4.create(0.075, 0.105, 0.14, 0.90),
  selectedCard: Color4.create(0.07, 0.18, 0.21, 0.95),
  selectedGold: Color4.create(0.16, 0.12, 0.06, 0.96),
  line: Color4.create(0.32, 0.39, 0.44, 0.50),
  goldLine: Color4.create(0.78, 0.65, 0.40, 0.85),
  coral: Color4.create(1, 0.60, 0.50, 1)
}

export type MenuActionProps = {
  key?: string
  id: string
  text: string
  onClick: () => void
  width: number
  height?: number
  scale: number
  active?: boolean
  primary?: boolean
  disabled?: boolean
  fontSize?: number
  /** Active highlight. Gold matches the hall banners; cyan is the inventory accent. */
  accent?: 'gold' | 'cyan'
}

let hoveredAction = ''

/** Shared menu control styling and interaction; scene actions stay with each menu. */
export function MenuAction({ id, text, onClick, width, height = 42, scale: s,
  active, primary, disabled, fontSize = 16, accent = 'cyan' }: MenuActionProps) {
  const hover = hoveredAction === id && !disabled
  const { white, muted, gold, goldHover, cyan, ink, panel, card, selectedCard, selectedGold, line } = menuColors
  const mark = accent === 'gold' ? gold : cyan
  const fill = accent === 'gold' ? selectedGold : selectedCard
  return <UiEntity key={id}
    uiTransform={{ width: width * s, minWidth: width * s, height: height * s, flexShrink: 0,
      borderRadius: 4 * s, borderWidth: s, borderColor: primary ? gold : active ? mark : hover ? gold : line,
      alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.42 : 1,
      pointerFilter: disabled ? 'none' : 'block' }}
    uiBackground={{ color: primary ? (hover ? goldHover : gold) : active ? fill : hover ? card : panel }}
    onMouseEnter={disabled ? undefined : () => { hoveredAction = id }}
    onMouseLeave={() => { if (hoveredAction === id) hoveredAction = '' }}
    onMouseDown={disabled ? undefined : onClick}>
    <Label value={primary ? `<b>${text}</b>` : text} color={primary ? ink : active ? mark : hover ? white : muted}
      fontSize={fontSize * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

/** Ornate Synty menu button: fill + gold frame, label in the middle. */
export function KitButton({ id, text, onClick, width, height = 72, scale: s,
  disabled, fontSize = 22, variant = 'hex' }: {
  id: string; text: string; onClick: () => void; width: number; height?: number
  scale: number; disabled?: boolean; fontSize?: number; variant?: 'hex' | 'banner'
}) {
  const hover = hoveredAction === id && !disabled
  const { white, ink } = menuColors
  const fill = variant === 'banner' ? UI_KIT.btnFill : UI_KIT.btnGoldFill
  const frame = variant === 'banner' ? UI_KIT.btnFrame : UI_KIT.btnGoldFrame
  return <UiEntity key={id}
    uiTransform={{ width: width * s, minWidth: width * s, height: height * s, flexShrink: 0,
      alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : 1,
      pointerFilter: disabled ? 'none' : 'block' }}
    onMouseEnter={disabled ? undefined : () => { hoveredAction = id }}
    onMouseLeave={() => { if (hoveredAction === id) hoveredAction = '' }}
    onMouseDown={disabled ? undefined : onClick}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
      uiBackground={{ ...kitTexture(fill), color: hover ? Color4.create(1, 0.94, 0.72, 1) : Color4.create(0.22, 0.2, 0.16, 0.92) }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
      uiBackground={kitTexture(frame)} />
    <Label value={`<b>${text}</b>`} color={hover ? ink : white} fontSize={fontSize * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}
