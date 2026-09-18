import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  getCombatState, closeCombat, rematchCombat, retryCombat,
  requestLightAttack, requestHeavyAttack, requestCombatJump
} from './combat'

const ink = Color4.create(0.025, 0.075, 0.09, 1)
const white = Color4.create(0.97, 0.965, 0.94, 1)
const muted = Color4.create(0.67, 0.74, 0.86, 1)
const mint = Color4.create(0.31, 0.96, 0.81, 1)
const brass = Color4.create(0.69, 0.51, 0.35, 1)
const line = Color4.create(0.28, 0.34, 0.45, 0.92)
const panel = Color4.create(0.055, 0.079, 0.12, 0.97)
const card = Color4.create(0.09, 0.115, 0.165, 0.96)
const coral = Color4.create(1, 0.60, 0.50, 1)
let hovered = ''

type CombatState = ReturnType<typeof getCombatState>

function layout() {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const width = canvas?.width || 1600
  const height = canvas?.height || 900
  const scale = Math.min(width / 1600, height / 900)
  return { scale, x: (width - 1600 * scale) / 2, y: (height - 900 * scale) / 2 }
}

type ActionProps = {
  id: string
  text: string
  hint?: string
  onClick: () => void
  width: number
  height?: number
  scale: number
  primary?: boolean
  active?: boolean
  disabled?: boolean
}

function Action({ id, text, hint, onClick, width, height = 42, scale: s, primary, active, disabled }: ActionProps) {
  const lit = primary || active
  const hover = hovered === id && !disabled
  return <UiEntity
    uiTransform={{ width: width * s, minWidth: width * s, height: height * s, flexShrink: 0,
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: height * s / 2,
      borderWidth: lit ? 0 : s, borderColor: hover ? mint : line, opacity: disabled ? 0.42 : 1, pointerFilter: 'block' }}
    uiBackground={{ color: lit ? (hover ? Color4.create(0.54, 1, 0.87, 1) : mint) : (hover ? card : panel) }}
    onMouseEnter={() => { hovered = id }}
    onMouseLeave={() => { if (hovered === id) hovered = '' }}
    onMouseDown={disabled ? undefined : onClick}>
    <Label value={`<b>${text}</b>`} color={lit ? ink : white} fontSize={(hint ? 17 : 15) * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: (hint ? 25 : height) * s, flexShrink: 0, pointerFilter: 'none' }} />
    {hint && <Label value={hint} color={lit ? ink : muted} fontSize={12 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

function actionLabel(action: string) {
  if (action === 'attack_light' || action === 'attack_light2' || action === 'light') return 'Light attack'
  if (action === 'attack_heavy' || action === 'heavy') return 'Heavy attack'
  if (action === 'block' || action === 'guard') return 'Guarding'
  if (action === 'hit') return 'Recovering'
  if (action === 'death') return 'Down'
  return action || 'Ready'
}

function HealthCard({ name, health, maxHealth, status, rival, scale: s }: {
  name: string, health: number, maxHealth: number, status: string, rival?: boolean, scale: number
}) {
  const maximum = Number.isFinite(maxHealth) && maxHealth > 0 ? maxHealth : 1
  const current = Math.max(0, Math.min(maximum, Number.isFinite(health) ? health : 0))
  const fraction = current / maximum
  const accent = rival ? coral : mint
  return <UiEntity uiTransform={{ width: 360 * s, height: 108 * s, flexShrink: 0, borderRadius: 25 * s,
    borderWidth: s, borderColor: line, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
    <Label value={`<b>${name}</b>`} font="serif" color={white} fontSize={22 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 19 * s, top: 9 * s }, width: 240 * s, height: 34 * s, pointerFilter: 'none' }} />
    <Label value={rival ? 'RIVAL' : 'YOU'} color={accent} fontSize={11 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { right: 19 * s, top: 14 * s }, width: 66 * s, height: 24 * s, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 20 * s, top: 48 * s }, width: 320 * s,
      height: 13 * s, borderRadius: 7 * s, pointerFilter: 'none' }} uiBackground={{ color: Color4.create(0.025, 0.04, 0.065, 1) }}>
      {fraction > 0 && <UiEntity uiTransform={{ width: 320 * fraction * s, height: 13 * s, borderRadius: 7 * s,
        pointerFilter: 'none' }} uiBackground={{ color: accent }} />}
    </UiEntity>
    <Label value={status} color={status === 'Guarding' ? mint : muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 20 * s, top: 69 * s }, width: 196 * s, height: 23 * s, pointerFilter: 'none' }} />
    <Label value={`${Math.ceil(current)} / ${Math.ceil(maximum)}`} color={white} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { right: 20 * s, top: 69 * s }, width: 115 * s, height: 23 * s, pointerFilter: 'none' }} />
  </UiEntity>
}

function StatePanel({ state, scale: s }: { state: CombatState, scale: number }) {
  const victory = state.phase === 'victory'
  const defeat = state.phase === 'defeat'
  const result = victory || defeat
  const error = state.phase === 'error'
  const ready = state.phase === 'ready'
  const title = victory ? 'Victory' : defeat ? 'Defeat' : error ? 'Duel unavailable' : ready ? 'Ready to fight' : 'Preparing your duel'
  const accent = defeat || error ? coral : mint
  const message = result ? `${victory ? state.playerName : state.rivalName} wins this round.` :
    state.notice || (error ? 'The duel could not load. Try again.' : ready ? 'Both fighters are ready. Your duel starts in a moment.' : 'Equipping both fighters and their weapons…')
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 510 * s, top: 278 * s }, width: 580 * s,
    height: 332 * s, borderRadius: 32 * s, borderWidth: 2 * s, borderColor: result ? brass : line,
    pointerFilter: 'block' }} uiBackground={{ color: panel }}>
    <Label value={result ? 'DUEL COMPLETE' : error ? 'ARENA NOTICE' : 'ENTERING THE ARENA'} color={brass} fontSize={13 * s} textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 40 * s, top: 26 * s }, width: 500 * s, height: 25 * s, pointerFilter: 'none' }} />
    <Label value={`<b>${title}</b>`} font="serif" color={accent} fontSize={43 * s} textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 35 * s, top: 64 * s }, width: 510 * s, height: 59 * s, pointerFilter: 'none' }} />
    <Label value={message} color={white} fontSize={18 * s}
      uiTransform={{ positionType: 'absolute', position: { left: 48 * s, top: 139 * s }, width: 484 * s, height: 64 * s, pointerFilter: 'none' }} />
    {result && <Label value="Another round is one click away." color={muted} fontSize={14 * s} textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 48 * s, top: 205 * s }, width: 484 * s, height: 26 * s, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (result || error ? 48 : 174) * s, top: 256 * s },
      width: (result || error ? 484 : 232) * s, height: 46 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {(result || error) && <Action id="combat-retry" text={result ? 'Rematch' : 'Try again'}
        onClick={result ? rematchCombat : retryCombat} width={232} height={46} scale={s} primary />}
      <Action id="combat-return" text="Return" onClick={closeCombat} width={232} height={46} scale={s} />
    </UiEntity>
  </UiEntity>
}

export function CombatUi() {
  const state = getCombatState()
  if (!state.open) return null
  const { scale: s, x, y } = layout()
  const fighting = state.phase === 'fighting'
  const result = state.phase === 'victory' || state.phase === 'defeat'
  const showPanel = !fighting && (!result || state.resultElapsedSeconds >= 1.6)
  const pointerLocked = state.inputLocked
  const playerStatus = state.playerBlocking ? 'Guarding' : actionLabel(state.playerAction)
  const rivalStatus = state.rivalBlocking ? 'Guarding' : actionLabel(state.rivalAction)
  const telegraph = typeof state.rivalTelegraph === 'string' ? state.rivalTelegraph : ''

  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}
    uiBackground={{ color: Color4.create(0.015, 0.025, 0.045, showPanel ? 0.28 : 0) }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: x, top: y }, width: 1600 * s, height: 900 * s, pointerFilter: 'none' }}>
      {/* The top-center HUD leaves Decentraland's corner controls clear. */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 380 * s, top: 104 * s }, width: 840 * s,
        height: 108 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
        <HealthCard name={state.playerName} health={state.playerHealth} maxHealth={state.maxHealth} status={playerStatus} scale={s} />
        <HealthCard name={state.rivalName} health={state.rivalHealth} maxHealth={state.maxHealth} status={rivalStatus} rival scale={s} />
      </UiEntity>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 773 * s, top: 129 * s }, width: 54 * s,
        height: 54 * s, borderRadius: 27 * s, borderWidth: s, borderColor: brass, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: panel }}>
        <Label value="<b>VS</b>" font="serif" color={white} fontSize={20 * s} textWrap="nowrap"
          uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>

      {fighting && !!telegraph && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 565 * s, top: 239 * s },
        width: 470 * s, height: 46 * s, borderRadius: 23 * s, borderWidth: 2 * s, borderColor: coral,
        alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: Color4.create(0.16, 0.065, 0.07, 0.96) }}>
        <Label value={`<b>${telegraph}</b>`} color={coral} fontSize={17 * s} textWrap="nowrap"
          uiTransform={{ width: 440 * s, height: 39 * s, pointerFilter: 'none' }} />
      </UiEntity>}

      {fighting && !!state.notice && <Label value={state.notice} color={white} fontSize={15 * s}
        uiTransform={{ positionType: 'absolute', position: { left: 450 * s, top: 692 * s }, width: 700 * s, height: 34 * s, pointerFilter: 'none' }} />}
      {fighting && !pointerLocked && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 479 * s, top: 731 * s }, width: 642 * s,
        height: 30 * s, borderRadius: 15 * s, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
        <Label value="WASD move · Space jump · E / F attack · Click arena for mouse attacks" color={mint} fontSize={14 * s} textWrap="nowrap"
          uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>}

      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 410 * s, top: 774 * s }, width: 780 * s,
        height: 82 * s, borderRadius: 30 * s, borderWidth: s, borderColor: line, pointerFilter: 'block' }} uiBackground={{ color: panel }}>
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 18 * s, top: 13 * s }, width: 744 * s,
          height: 56 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
          <Action id="combat-light" text="Light attack" hint="E / left click" onClick={requestLightAttack}
            width={232} height={56} scale={s} primary disabled={!fighting} />
          <Action id="combat-heavy" text="Heavy attack" hint="F" onClick={requestHeavyAttack}
            width={232} height={56} scale={s} disabled={!fighting} />
          <Action id="combat-jump" text={state.playerJumping ? 'Jumping' : 'Jump'} hint="Space"
            onClick={requestCombatJump} width={232} height={56} scale={s} active={state.playerJumping} disabled={!fighting || state.playerJumping} />
        </UiEntity>
      </UiEntity>
      <Label value="WASD  move     ·     E  light     ·     F  heavy     ·     Space  jump     ·     Esc  cursor" color={muted} fontSize={13 * s} textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 320 * s, top: 864 * s }, width: 960 * s, height: 25 * s, pointerFilter: 'none' }} />

      {showPanel && <StatePanel state={state} scale={s} />}
      {/* Keep exit available throughout loading, combat, and results. */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 733 * s, top: 55 * s }, width: 134 * s, height: 36 * s, pointerFilter: 'none' }}>
        <Action id="combat-close" text="Leave duel" onClick={closeCombat} width={134} height={36} scale={s} />
      </UiEntity>
    </UiEntity>
  </UiEntity>
}
