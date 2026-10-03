/**
 * The Barrow Run's screen: a distance counter, the stamina meter, the embers
 * picked up and the lantern/ward timers while running; a card with the result
 * once the hero drops. Everything it shows comes from barrowRunView().
 */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport } from './uiScale'
import { menuColors, MenuAction as Action } from './menuUi'
import { barrowRunView, canLeaveBarrowRun, CARD_DELAY, leaveBarrowRun, restartBarrowRun } from './barrowRun'
import { RUN_EXTRA_COST, RUN_STUMBLE_SECONDS, RUN_TIERS, RUN_TOKENS } from './shared/barrowRun'
import { getGravewatch } from './gravewatch'
import { t } from './i18n'

const EMBER = Color4.create(0.98, 0.62, 0.22, 1)
const LANTERN = Color4.create(1.0, 0.85, 0.45, 1)
const WARD = Color4.create(0.72, 0.55, 1.0, 1)
const LOW = Color4.create(0.92, 0.30, 0.22, 1)

export function BarrowRunUi() {
  const view = barrowRunView()
  const { width, height, reserved } = uiViewport()
  const scale = Math.min(1, width / 1280)
  // A stumble flashes the edges of the screen red, fading as the hero recovers.
  const flash = view.phase === 'running' ? Math.min(1, view.stumble / RUN_STUMBLE_SECONDS) : 0
  const edge = 70 * scale
  return (
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: 0, top: 0 } }}>
      {flash > 0 && <UiEntity uiTransform={{ width, height: edge, positionType: 'absolute', position: { left: 0, top: 0 } }} uiBackground={{ color: Color4.create(0.7, 0.08, 0.04, 0.45 * flash) }} />}
      {flash > 0 && <UiEntity uiTransform={{ width, height: edge, positionType: 'absolute', position: { left: 0, top: height - edge } }} uiBackground={{ color: Color4.create(0.7, 0.08, 0.04, 0.45 * flash) }} />}
      {flash > 0 && <UiEntity uiTransform={{ width: edge, height, positionType: 'absolute', position: { left: 0, top: 0 } }} uiBackground={{ color: Color4.create(0.7, 0.08, 0.04, 0.35 * flash) }} />}
      {flash > 0 && <UiEntity uiTransform={{ width: edge, height, positionType: 'absolute', position: { left: width - edge, top: 0 } }} uiBackground={{ color: Color4.create(0.7, 0.08, 0.04, 0.35 * flash) }} />}
      {view.phase === 'running' && <Hud scale={scale} width={width} top={reserved.top} />}
      {view.phase === 'running' && view.s < 60 && <Hint scale={scale} width={width} height={height} bottom={reserved.bottom} />}
      {view.phase !== 'running' && (view.phase === 'waiting' || view.sinceOver >= CARD_DELAY) && <EndCard scale={scale} width={width} height={height} />}
    </UiEntity>
  )
}

function Hud({ scale, width, top }: { scale: number; width: number; top: number }) {
  const view = barrowRunView()
  const { white, muted, panel, line } = menuColors
  const barW = 360 * scale
  const fill = Math.max(0, Math.min(1, view.stamina / view.staminaMax))
  const low = fill < 0.25
  const colour = low || view.stumble > 0 ? LOW : view.lantern > 0 ? LANTERN : EMBER
  const metres = Math.floor(view.s)
  const next = RUN_TIERS.find((tier) => tier.m > metres)
  return (
    <UiEntity uiTransform={{ width, positionType: 'absolute', position: { left: 0, top: top + 14 * scale }, flexDirection: 'column', alignItems: 'center' }}>
      <Label value={`${metres} m`} fontSize={44 * scale} color={white} font="serif" textAlign="middle-center" uiTransform={{ height: 50 * scale }} />
      <UiEntity uiTransform={{ width: barW, height: 14 * scale, margin: { top: 2 * scale } }} uiBackground={{ color: panel }}>
        <UiEntity uiTransform={{ width: barW * fill, height: '100%' }} uiBackground={{ color: colour }} />
        <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 } }} uiBackground={{ color: Color4.create(0, 0, 0, 0) }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: barW, height: 1, margin: { top: 2 * scale } }} uiBackground={{ color: line }} />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: 4 * scale } }}>
        <Label value={low ? t('Stamina low') : t('Stamina')} fontSize={13 * scale} color={low ? LOW : muted} textAlign="middle-center" uiTransform={{ height: 18 * scale }} />
        <Label value={`   ${t('+{n} embers', { n: view.embers })}`} fontSize={13 * scale} color={EMBER} textAlign="middle-center" uiTransform={{ height: 18 * scale }} />
        {next && <Label value={`   ${t('{n} m: +{e} embers', { n: next.m, e: next.embers })}`} fontSize={13 * scale} color={muted} textAlign="middle-center" uiTransform={{ height: 18 * scale }} />}
      </UiEntity>
      {(view.lantern > 0 || view.ward > 0) && (
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: 4 * scale } }}>
          {view.lantern > 0 && <Chip text={t('Lantern: fast {n}s', { n: Math.ceil(view.lantern) })} colour={LANTERN} scale={scale} />}
          {view.ward > 0 && <Chip text={t('Ward: {n}s', { n: Math.ceil(view.ward) })} colour={WARD} scale={scale} />}
        </UiEntity>
      )}
    </UiEntity>
  )
}

function Chip({ text, colour, scale }: { text: string; colour: Color4; scale: number }) {
  return (
    <UiEntity uiTransform={{ height: 22 * scale, padding: { left: 10 * scale, right: 10 * scale }, margin: { left: 4 * scale, right: 4 * scale }, alignItems: 'center' }}
      uiBackground={{ color: Color4.create(colour.r, colour.g, colour.b, 0.18) }}>
      <Label value={text} fontSize={12 * scale} color={colour} textAlign="middle-center" />
    </UiEntity>
  )
}

function Hint({ scale, width, height, bottom }: { scale: number; width: number; height: number; bottom: number }) {
  const { muted } = menuColors
  return (
    <UiEntity uiTransform={{ width, positionType: 'absolute', position: { left: 0, top: height - bottom - 70 * scale }, alignItems: 'center', justifyContent: 'center' }}>
      <Label value={t('A / D: change lane.  Embers refill your stamina; stones and ghouls drain it.')} fontSize={14 * scale} color={muted} textAlign="middle-center" />
    </UiEntity>
  )
}

function EndCard({ scale, width, height }: { scale: number; width: number; height: number }) {
  const view = barrowRunView()
  const gw = getGravewatch()
  const { white, muted, gold, panel, line } = menuColors
  const w = 420 * scale
  const waiting = view.phase === 'waiting'
  const ready = canLeaveBarrowRun() && !waiting
  const runsLeft = Math.max(0, RUN_TOKENS - gw.runs)
  const again = runsLeft > 0 ? t('Run again') : t('Run again ({n} embers)', { n: RUN_EXTRA_COST })
  const canAgain = ready && !gw.over && (runsLeft > 0 || gw.embers >= RUN_EXTRA_COST)
  return (
    <UiEntity uiTransform={{ width: w, positionType: 'absolute', position: { left: (width - w) / 2, top: height * 0.22 }, flexDirection: 'column', alignItems: 'center', padding: 18 * scale }}
      uiBackground={{ color: panel }}>
      <Label value={waiting ? t('THE BARROW RUN') : t('THE RUN IS OVER')} fontSize={22 * scale} color={gold} font="serif" textAlign="middle-center" uiTransform={{ height: 30 * scale }} />
      {waiting ? (
        <Label value={t('Waiting on the host…')} fontSize={15 * scale} color={muted} textAlign="middle-center" uiTransform={{ height: 40 * scale }} />
      ) : (
        <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <Label value={`${view.metres} m`} fontSize={52 * scale} color={white} font="serif" textAlign="middle-center" uiTransform={{ height: 60 * scale }} />
          <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center', margin: { top: 4 * scale } }}>
            {RUN_TIERS.map((tier) => (
              <Tier metres={tier.m} embers={tier.embers} lit={view.metres >= tier.m} scale={scale} />
            ))}
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 1, margin: { top: 12 * scale, bottom: 10 * scale } }} uiBackground={{ color: line }} />
          <Label value={t('+{n} embers', { n: view.paid })} fontSize={24 * scale} color={EMBER} textAlign="middle-center" uiTransform={{ height: 30 * scale }} />
          <Label value={t('{a} for the distance, {b} picked up on the road', { a: view.tierEmbers, b: Math.max(0, view.paid - view.tierEmbers) })}
            fontSize={12 * scale} color={muted} textAlign="middle-center" uiTransform={{ height: 18 * scale }} />
          {view.metres >= gw.best && view.metres > 0 && (
            <Label value={t('Your best today.')} fontSize={13 * scale} color={gold} textAlign="middle-center" uiTransform={{ height: 20 * scale }} />
          )}
          {gw.noteFor > 0 && <Label value={gw.note} fontSize={13 * scale} color={gold} textAlign="middle-center" uiTransform={{ height: 20 * scale }} />}
        </UiEntity>
      )}
      <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'center', margin: { top: 14 * scale } }}>
        <Action id="run-again" text={again} onClick={restartBarrowRun} width={190 * scale} height={40 * scale} scale={scale} fontSize={15 * scale} primary accent="gold" disabled={!canAgain} />
        <UiEntity uiTransform={{ width: 10 * scale }} />
        <Action id="run-leave" text={t('Back to the hall')} onClick={leaveBarrowRun} width={170 * scale} height={40 * scale} scale={scale} fontSize={15 * scale} disabled={!ready} />
      </UiEntity>
      <Label value={t('Runs today: {a} of {b}', { a: Math.min(gw.runs, RUN_TOKENS), b: RUN_TOKENS })} fontSize={12 * scale} color={muted} textAlign="middle-center" uiTransform={{ height: 20 * scale, margin: { top: 8 * scale } }} />
    </UiEntity>
  )
}

function Tier({ metres, embers, lit, scale }: { metres: number; embers: number; lit: boolean; scale: number }) {
  const { muted, card } = menuColors
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', width: 86 * scale, height: 44 * scale, margin: { left: 3 * scale, right: 3 * scale }, justifyContent: 'center' }}
      uiBackground={{ color: lit ? Color4.create(EMBER.r, EMBER.g, EMBER.b, 0.22) : card }}>
      <Label value={`${metres} m`} fontSize={13 * scale} color={lit ? EMBER : muted} textAlign="middle-center" uiTransform={{ height: 18 * scale }} />
      <Label value={`+${embers}`} fontSize={12 * scale} color={lit ? EMBER : muted} textAlign="middle-center" uiTransform={{ height: 16 * scale }} />
    </UiEntity>
  )
}
