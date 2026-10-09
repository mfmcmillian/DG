import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { holdTouchCombatAction, holdTouchGuard, tapTouchDodge } from './combatControls'
import { uiViewport } from './uiScale'

type ButtonProps = {
  id: string
  keyText: string
  actionText: string
  size: number
  right: number
  bottom: number
  primary?: boolean
  onDown: () => void
  onUp?: () => void
}

const face = Color4.create(0.035, 0.03, 0.07, 0.86)
const facePressed = Color4.create(0.18, 0.12, 0.28, 0.96)
const rim = Color4.create(0.55, 0.38, 0.82, 0.92)
const white = Color4.create(0.94, 0.92, 1, 1)
let pressed = ''

function CombatButton({ id, keyText, actionText, size, right, bottom, primary, onDown, onUp }: ButtonProps) {
  const down = pressed === id
  const release = () => {
    if (pressed === id) pressed = ''
    onUp?.()
  }
  return <UiEntity
    uiTransform={{
      positionType: 'absolute', position: { right, bottom }, width: size, height: size,
      borderRadius: size / 2, borderWidth: primary ? 3 : 2, borderColor: rim,
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'block'
    }}
    uiBackground={{ color: down ? facePressed : face }}
    onMouseDown={() => { pressed = id; onDown() }}
    onMouseUp={release}
    onMouseLeave={release}>
    <Label value={keyText} color={white} font="sans-serif" fontSize={primary ? 45 : 31}
      textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: primary ? 56 : 40, pointerFilter: 'none' }} />
    <Label value={actionText} color={white} font="sans-serif" fontSize={primary ? 17 : 14}
      textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24, pointerFilter: 'none' }} />
  </UiEntity>
}

/** Mobile-only right-thumb controls. Native mobile action buttons stay hidden. */
export function MobileCombatUi() {
  if (!uiViewport().mobile) return null
  return <UiEntity uiTransform={{
    positionType: 'absolute', position: { right: 18, bottom: 58 },
    width: 350, height: 300, pointerFilter: 'none'
  }}>
    <CombatButton id="touch-light" keyText="E" actionText="LIGHT" size={150} right={0} bottom={0} primary
      onDown={() => holdTouchCombatAction('light')} onUp={() => holdTouchCombatAction(undefined)} />
    <CombatButton id="touch-dodge" keyText="↯" actionText="DODGE" size={96} right={170} bottom={0}
      onDown={tapTouchDodge} />
    <CombatButton id="touch-heavy" keyText="F" actionText="HEAVY" size={96} right={160} bottom={108}
      onDown={() => holdTouchCombatAction('heavy')} onUp={() => holdTouchCombatAction(undefined)} />
    <CombatButton id="touch-guard" keyText="◈" actionText="GUARD" size={96} right={12} bottom={172}
      onDown={() => holdTouchGuard(true)} onUp={() => holdTouchGuard(false)} />
  </UiEntity>
}
