// The Gravewatch sheet (the Settings/Inventory pattern): embers and today's
// progress in the header, five tabs below: Rounds, the Wheel of Bones,
// the Gravewalk board, the Rising and the Reliquary. Nothing here decides anything;
// every button is a message to the host and the sheet redraws from its answer.
// Also the hall's big button and the strip of text the Rising puts on screen.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport, wholeCanvas } from './uiScale'
import { menuColors, MenuAction as Action } from './menuUi'
import {
  available, boardRolling, boardState, boardTiming, closeGravewatch, DICE_STRIP, dismissGearCard, emberGains, GAIN_SECONDS, gearCard, getGravewatch, gravewatchBusy, gravewatchButtonLine, gravewatchConfirm,
  gravewatchCurse, gravewatchGrant, gravewatchRedeem, gravewatchRising, gravewatchRoll, gravewatchRun, gravewatchScreenNote, gravewatchSpin, gravewatchTab, gravewatchTrain, GW_TABS, GwTab,
  runBoard, RunBoardRow, toggleRunBoard,
  emberTickLeft, inRisingArena, isAutoRoll, isFlyer, openGravewatch, risingClock, runEmberGain, serverNow, setGravewatchTab, shownEmbers, toggleAutoRoll, WHEEL_POINTER, WHEEL_SHEET_COLS, WHEEL_SHEET_FRAMES, wheelSheet, wheelState
} from './gravewatch'
import { heroLabel } from './lobbyUi'
import { myParty } from './party'
import { localAddress } from './multiplayer'
import { isDeveloper } from './devAccess'
import { t } from './i18n'
import {
  etOffset, GW_BACKSTOPS, GW_BOARD, GW_BOARD_DOUBLE_COST, GW_BOARD_MILESTONES, GW_BOARD_PASS_EMBERS, GW_BOARD_TOKENS, GW_EVENT_END,
  GW_HAT_STEPS, GW_ITEM_INFO, GW_ITEMS, GW_MULT, GW_PRICES, GW_RISING_FIGHT_EMBERS, GW_RISING_UNLOCKS, GW_RISING_WIN_EMBERS, GW_SPIN_COST,
  GW_TILE_MAX_LEVEL, GW_WHEEL, GW_WHEEL_PITY, GwItem, GwSegment, GwTileKind, tilePay
} from './shared/gravewatch'
import { StackButton } from './hudButtons'
import { RUN_END_STEP, RUN_EXTRA_COST, RUN_MILE, RUN_SPD_STEP, RUN_STATS, RUN_TIERS, RUN_TOKENS, RUN_TRAIN_MAX, runTrainCost, RunStat } from './shared/barrowRun'
import { getEquipmentItemOrNull } from './equipmentCatalog'
import { RARITIES, rarityOf } from './weapons'

const { white, muted, gold, panel: panelColor, card, line, goldLine, green, coral, cyan } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheetColor = Color4.create(0.025, 0.045, 0.07, 0.97)
const ember = Color4.create(1, 0.55, 0.2, 1)
const emberDark = Color4.create(0.22, 0.09, 0.03, 0.96)
const FRAME = { width: 640, height: 600 }
const TAB_NAMES: Record<GwTab, string> = { rounds: 'The Run', wheel: 'Wheel of Bones', board: 'Gravewalk', rising: 'The Rising', reliquary: 'Reliquary' }
const BOARD_IMAGE = 'images/gravewatch/board.png'
const PAWN_IMAGE = 'images/gravewatch/pumpkin.png'
const STAR_IMAGE = 'images/gravewatch/star.png'
const CHEST_IMAGE = 'images/gravewatch/chest.png'
const GEAR_BADGE_IMAGE = 'images/gravewatch/gear-badge.png'
const RUN_BANNER = 'images/gravewatch/run-banner.png'
const RUN_ICONS = 'images/gravewatch/run-icons.png'
const GW_ICONS = 'images/gravewatch/icons.png'
const RISING_BANNER = 'images/gravewatch/rising-banner.png'
const WHEEL_STRIP = 'images/gravewatch/wheel-strip.png'
const RELIQUARY_STRIP = 'images/gravewatch/reliquary-strip.png'
/** Tiles of the prize icon sheet. */
const ICON = { ember: 0, coins: 1, gear: 2, mult: 3, dice: 4, demon: 5 } as const
const RARITY_COLORS: Record<GwItem, Color4> = { w1: cyan, w2: gold, w3: coral }
let rulesOpen = false
/** Dev-only +1000 embers button; hidden for now, flip to true when testing payouts. */
const SHOW_GRANT = false
/** The wheel's prize stays popped over it this long. */
const RESULT_SECONDS = 4
/** Six tiles a side; twenty around the edge. */
const BOARD_SIDE = 6
const TILE_COLORS: Record<GwTileKind, Color4> = {
  start: Color4.create(0.2, 0.15, 0.05, 0.92),
  embers: Color4.create(0.2, 0.08, 0.03, 0.9),
  coins: Color4.create(0.18, 0.14, 0.03, 0.9),
  chest: Color4.create(0.14, 0.07, 0.2, 0.92),
  gear: Color4.create(0.04, 0.14, 0.18, 0.92),
  curse: Color4.create(0.22, 0.06, 0.05, 0.92),
  mystery: Color4.create(0.08, 0.08, 0.1, 0.92)
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
let hovered = ''

function layout() {
  const { width: screenWidth, height: screenHeight } = uiViewport()
  const left = 24
  const right = 24
  const top = 48
  const bottom = 24
  const scale = Math.min((screenWidth - left - right) / FRAME.width, (screenHeight - top - bottom) / FRAME.height, 1.45)
  const width = FRAME.width * scale
  const height = FRAME.height * scale
  return { scale, width, height, x: left + (screenWidth - left - right - width) / 2, y: top + (screenHeight - top - bottom - height) / 2 }
}

/** "Sat Oct 17, 9:15 PM ET" from a UTC instant. */
export function etLabel(at: number, withTime = true): string {
  const d = new Date(at + etOffset(at))
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const clock = `${((h + 11) % 12) + 1}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'} ET`
  const day = `${t(DAYS[d.getUTCDay()])} ${t(MONTHS[d.getUTCMonth()])} ${d.getUTCDate()}`
  return withTime ? `${day}, ${clock}` : day
}

/** Seconds until the day's counters reset: midnight ET, by the host's clock. */
function untilReset(): number {
  const now = serverNow()
  const local = now + etOffset(now)
  const day = 24 * 3600 * 1000
  return (Math.floor(local / day) * day + day - local) / 1000
}

function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${sec < 10 ? '0' : ''}${sec}s`
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}

/** "42m 07s" for the boost's remaining hour (hours shown only if ever past one). */
function minutesLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h > 0 ? `${h}h ` : ''}${m}m ${sec < 10 ? '0' : ''}${sec}s`
}

function Line({ text, scale: s, color = muted, size = 15, height = 26 }: { text: string; scale: number; color?: Color4; size?: number; height?: number }) {
  return <Label value={text} color={color} fontSize={size * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: height * s, flexShrink: 0, pointerFilter: 'none' }} />
}

function Gap({ h, scale: s }: { h: number; scale: number }) {
  return <UiEntity uiTransform={{ height: h * s, flexShrink: 0, pointerFilter: 'none' }} />
}

export function GravewatchUi() {
  const gw = getGravewatch()
  const { scale: s, width, height, x, y } = layout()
  const inner = FRAME.width - 80
  const tab = gravewatchTab()
  const flyer = isFlyer()
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={wholeCanvas()} uiBackground={{ color: veil }} />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheetColor }}>
      <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, margin: { right: 12 * s }, pointerFilter: 'none' }}>
          <Label value={`${flyer ? t('WELCOME TO').toUpperCase() : `${t('UNTIL')} ${etLabel(GW_EVENT_END, false).toUpperCase()}`}  ·  ${t('DAILY RESET IN')} ${countdown(untilReset())}`} color={gold} fontSize={10.5 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={t('Gravewatch')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
          {emberTickLeft() > 0 && <Label value={`+${emberTickLeft()}`} color={gold} font="serif" fontSize={20 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 80 * s, height: 38 * s, margin: { right: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
          <UiEntity uiTransform={{ height: 38 * s, padding: { left: 14 * s, right: 14 * s }, margin: { right: 10 * s }, borderRadius: 4 * s, borderWidth: shownEmbers() !== gw.embers ? 2 * s : s, borderColor: shownEmbers() !== gw.embers ? gold : ember,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: emberDark }}>
            <Label value={`${shownEmbers()}  ${t('embers')}`} color={shownEmbers() !== gw.embers ? gold : ember} font="serif" fontSize={17 * s} textWrap="nowrap"
              uiTransform={{ height: '100%', pointerFilter: 'none' }} />
            {gw.mult > serverNow() && <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', margin: { left: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}>
              <Label value={`×${GW_MULT}`} color={gold} font="serif" fontSize={15 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: 18 * s, pointerFilter: 'none' }} />
              <Label value={minutesLeft((gw.mult - serverNow()) / 1000)} color={gold} fontSize={10 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: 14 * s, pointerFilter: 'none' }} />
            </UiEntity>}
          </UiEntity>
          {SHOW_GRANT && isDeveloper() && <Action id="gw-grant" text="+1000" onClick={gravewatchGrant} width={64} height={38} scale={s} fontSize={13} accent="gold" />}
          {SHOW_GRANT && isDeveloper() && <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />}
          <Action id="gw-rules" text={t('Rules')} onClick={() => { rulesOpen = !rulesOpen }} width={64} height={38} scale={s} fontSize={13} accent="gold" active={rulesOpen} />
          <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />
          <Action id="gw-close" text="×" onClick={closeGravewatch} width={38} height={38} scale={s} fontSize={26} accent="gold" />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />

      <UiEntity uiTransform={{ width: '100%', height: 34 * s, flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: 14 * s }, flexShrink: 0, pointerFilter: 'none' }}>
        {GW_TABS.map((id) => <Action key={`gw-tab-${id}`} id={`gw-tab-${id}`} text={t(TAB_NAMES[id])} onClick={() => setGravewatchTab(id)}
          width={(inner - 4 * 6) / 5} height={36} scale={s} fontSize={13} accent="gold" active={tab === id} />)}
      </UiEntity>

      {gw.over && <Line text={t('Gravewatch has ended. Thank you for keeping the watch.')} scale={s} color={coral} />}
      {gw.guest && !gw.over && <Line text={t('Sign in with a wallet to earn embers and claim the wearables; guests may look.')} scale={s} color={coral} />}

      <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', pointerFilter: 'none' }}>
        {tab === 'rounds' && <RunTab scale={s} inner={inner} />}
        {tab === 'rounds' && runBoard().open && !rulesOpen && <Ladder scale={s} inner={inner} />}
        {tab === 'wheel' && <WheelTab scale={s} inner={inner} />}
        {tab === 'board' && <BoardTab scale={s} inner={inner} />}
        {tab === 'rising' && <RisingTab scale={s} inner={inner} />}
        {tab === 'reliquary' && <ReliquaryTab scale={s} inner={inner} />}
        {rulesOpen && <Rules scale={s} inner={inner} tab={tab} />}
        {!rulesOpen && gearCard() && <GearCard scale={s} prize={gearCard()!} />}
      </UiEntity>

      <Label value={gw.note} color={gw.note ? coral : muted} fontSize={14 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

// --- Rounds ------------------------------------------------------------------------------------

function RunTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const free = gw.runs < RUN_TOKENS
  const can = !gw.guest && !gw.over && !myParty() && (free || gw.embers >= RUN_EXTRA_COST)
  const label = myParty() ? t('Leave your party first') : free ? t('Run') : t('Run ({n} embers)', { n: RUN_EXTRA_COST })
  const cardW = (inner - 2 * 10) / 3
  const left = Math.max(0, RUN_TOKENS - gw.runs)
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 132 * s, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: RUN_BANNER }, color: Color4.White() }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 18 * s, bottom: 12 * s }, flexDirection: 'column', pointerFilter: 'none' }}>
        <Label value={t('THE BARROW RUN')} font="serif" color={white} fontSize={27 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 34 * s, pointerFilter: 'none' }} />
        <Label value={`${t('Runs today')}: ${Math.min(gw.runs, RUN_TOKENS)}/${RUN_TOKENS}   ·   ${gw.best > 0 ? t('Best today: {n} m', { n: gw.best }) : t('No run yet today')}`}
          color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 20 * s, pointerFilter: 'none' }} />
      </UiEntity>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 12 * s, top: 10 * s }, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
        <RunIcon tile={3} size={30} scale={s} />
        <Action id="gw-run-ladder" text={t('Leaderboard')} onClick={toggleRunBoard} width={118} height={30} scale={s} fontSize={13} accent="gold" active={runBoard().open} />
      </UiEntity>
    </UiEntity>
    <Gap h={10} scale={s} />
    <Track best={gw.best} inner={inner} scale={s} />
    <Gap h={8} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Glow on={can} scale={s}>
        <Action id="gw-run-go" text={label} onClick={gravewatchRun} width={300} height={46} scale={s} fontSize={17} primary accent="gold" disabled={!can} />
      </Glow>
      <Label value={free ? (left === 1 ? t('1 free run left') : t('{n} free runs left', { n: left })) : t('Free runs spent')} color={muted} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 120 * s, height: 20 * s, margin: { left: 12 * s }, pointerFilter: 'none' }} />
    </UiEntity>
    <Gap h={10} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 22 * s, flexDirection: 'row', alignItems: 'center', margin: { bottom: 4 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t('TRAINING')} color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      <Label value={`   ${t('{n} mileage points', { n: gw.mileage })}  ·  ${t('one per {m} m run', { m: RUN_MILE })}`} color={muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ height: '100%', pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {RUN_STATS.map((stat, i) => <TrainCard stat={stat} tile={i} level={gw.train[i]} width={cardW} scale={s} />)}
    </UiEntity>
  </UiEntity>
}

/** One tile of the run icon sheet: heart, boot, clover, trophy. */
function RunIcon({ tile, size, scale: s }: { tile: number; size: number; scale: number }) {
  return <UiEntity uiTransform={{ width: size * s, height: size * 1.4 * s, margin: { right: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src: RUN_ICONS }, uvs: sheetUvs(tile, 0, 4, 1), color: Color4.White() }} />
}

/** One tile of the prize icon sheet (ember, coins, gear, hourglass, dice, demon), sized by height; the tiles are tall. */
function GwIcon({ tile, height, scale: s, right = 6 }: { tile: number; height: number; scale: number; right?: number }) {
  return <UiEntity uiTransform={{ width: height * 0.61 * s, height: height * s, margin: { right: right * s }, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src: GW_ICONS }, uvs: sheetUvs(tile, 0, 6, 1), color: Color4.White() }} />
}

/** A painted strip across the top of a tab, the heading over its dark left end. */
function Strip({ src, title, sub, height, scale: s }: { src: string; title: string; sub: string; height: number; scale: number }) {
  return <UiEntity uiTransform={{ width: '100%', height: height * s, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src }, color: Color4.White() }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 16 * s, top: 0 }, height: '100%', flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
      <Label value={title} font="serif" color={white} fontSize={21 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 26 * s, pointerFilter: 'none' }} />
      <Label value={sub} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 16 * s, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

/** The ember glow around a tab's main button; dark and quiet while it cannot be pressed. */
function Glow({ on, scale: s, children }: { on: boolean; scale: number; children?: ReactEcs.JSX.Element | ReactEcs.JSX.Element[] }) {
  return <UiEntity uiTransform={{ padding: 3 * s, borderRadius: 6 * s, borderWidth: s, borderColor: on ? ember : line, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ color: on ? Color4.create(0.98, 0.55, 0.2, 0.14) : Color4.create(0, 0, 0, 0) }}>{children}</UiEntity>
}

/** The road as a bar: the four distance marks as lamps along it, lit as far as today's best, the pumpkin pawn at the best itself. */
function Track({ best, inner, scale: s }: { best: number; inner: number; scale: number }) {
  const last = RUN_TIERS[RUN_TIERS.length - 1].m
  const pad = 44
  const usable = inner - 2 * pad
  const at = (m: number) => pad + usable * Math.min(1, m / last)
  const reach = at(Math.min(best, last))
  return <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pad * s, top: 27 * s }, width: usable * s, height: 8 * s, borderRadius: 4 * s, pointerFilter: 'none' }}
      uiBackground={{ color: panelColor }} />
    {best > 0 && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: pad * s, top: 27 * s }, width: (reach - pad) * s, height: 8 * s, borderRadius: 4 * s, pointerFilter: 'none' }}
      uiBackground={{ color: ember }} />}
    {RUN_TIERS.map((tier) => {
      const lit = best >= tier.m
      const x = at(tier.m)
      return <UiEntity key={`gw-track-${tier.m}`} uiTransform={{ positionType: 'absolute', position: { left: (x - 34) * s, top: 0 }, width: 68 * s, height: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <Label value={`${tier.m} m`} color={lit ? ember : white} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: 18 * s, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: 18 * s, height: 18 * s, margin: { top: 4 * s }, borderRadius: 9 * s, borderWidth: 2 * s, borderColor: lit ? gold : line, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: lit ? ember : sheetColor }} />
        <Label value={`+${tier.embers}`} color={lit ? gold : muted} fontSize={11 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: 16 * s, margin: { top: 2 * s }, pointerFilter: 'none' }} />
      </UiEntity>
    })}
    {best > 0 && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (reach - 13) * s, top: 14 * s }, width: 26 * s, height: 26 * s, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: PAWN_IMAGE }, color: Color4.White() }} />}
  </UiEntity>
}

const STAT_NAMES: Record<RunStat, string> = { end: 'Endurance', spd: 'Speed', lck: 'Luck' }

function statEffect(stat: RunStat, level: number): string {
  switch (stat) {
    case 'end': return t('+{n}% stamina', { n: Math.round(level * RUN_END_STEP * 100) })
    case 'spd': return t('+{n}% speed', { n: Math.round(level * RUN_SPD_STEP * 100) })
    default: return level > 0 ? t('More and better pickups') : t('More pickups')
  }
}

function TrainCard({ stat, tile, level, width, scale: s }: { stat: RunStat; tile: number; level: number; width: number; scale: number }) {
  const gw = getGravewatch()
  const maxed = level >= RUN_TRAIN_MAX
  const cost = runTrainCost(level)
  const can = !maxed && !gw.guest && !gw.over && gw.mileage >= cost
  const pips: number[] = []
  for (let k = 0; k < RUN_TRAIN_MAX; k++) pips.push(k)
  return <UiEntity uiTransform={{ width: width * s, height: 108 * s, borderRadius: 6 * s, borderWidth: s, borderColor: level > 0 ? goldLine : line, flexDirection: 'column',
    padding: { top: 8 * s, bottom: 8 * s, left: 10 * s, right: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: panelColor }}>
    <UiEntity uiTransform={{ width: '100%', height: 56 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <RunIcon tile={tile} size={38} scale={s} />
      <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, pointerFilter: 'none' }}>
        <Label value={t(STAT_NAMES[stat])} color={white} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 18 * s, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: '100%', height: 8 * s, flexDirection: 'row', margin: { top: 2 * s, bottom: 2 * s }, pointerFilter: 'none' }}>
          {pips.map((k) => <UiEntity key={`gw-pip-${stat}-${k}`} uiTransform={{ width: 9 * s, height: 6 * s, margin: { right: 2 * s }, borderRadius: s, flexShrink: 0, pointerFilter: 'none' }}
            uiBackground={{ color: k < level ? gold : line }} />)}
        </UiEntity>
        <Label value={statEffect(stat, level)} color={level > 0 ? gold : muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 16 * s, pointerFilter: 'none' }} />
      </UiEntity>
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <Action id={`gw-train-${stat}`} text={maxed ? t('Trained') : t('Train: {n} pts', { n: cost })} onClick={() => gravewatchTrain(stat)} width={width - 20} height={30} scale={s}
        fontSize={13} accent="gold" primary={can} disabled={!can} />
    </UiEntity>
  </UiEntity>
}

/** The Barrow Run's best: this week beside all time, over the tab until closed. */
function Ladder({ scale: s, inner }: { scale: number; inner: number }) {
  const ladder = runBoard()
  const me = localAddress()
  const colW = (inner - 40 - 16) / 2
  const column = (title: string, rows: readonly RunBoardRow[]) => <UiEntity uiTransform={{ width: colW * s, flexDirection: 'column', pointerFilter: 'none' }}>
    <Label value={title} color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 24 * s, margin: { bottom: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {!ladder.loaded && <Line text={t('Asking the host...')} scale={s} size={13} />}
    {ladder.loaded && rows.length === 0 && <Line text={t('No runs yet. Be the first.')} scale={s} size={13} />}
    {rows.map((row, i) => {
      const mine = row.id === me
      return <UiEntity key={`${title}-${row.id}`} uiTransform={{ width: '100%', height: 24 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: mine ? emberDark : Color4.create(0, 0, 0, 0) }}>
        <Label value={`${i + 1}.`} color={i === 0 ? gold : muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: 28 * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={row.name || heroLabel(row.id)} color={mine ? ember : white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: (colW - 28 - 70) * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={`${row.m} m`} color={mine ? ember : white} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap" uiTransform={{ width: 70 * s, height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
  </UiEntity>
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: inner * s, height: '100%', padding: { left: 20 * s, right: 20 * s, top: 14 * s, bottom: 14 * s },
    borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexDirection: 'column', pointerFilter: 'block' }} uiBackground={{ color: Color4.create(0.025, 0.045, 0.07, 1) }}>
    <UiEntity uiTransform={{ width: '100%', height: 34 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: '100%', pointerFilter: 'none' }}>
        <RunIcon tile={3} size={26} scale={s} />
        <Label value={t('The Barrow Run: the best')} font="serif" color={gold} fontSize={22 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
      <Action id="gw-ladder-close" text={t('Close')} onClick={toggleRunBoard} width={80} height={32} scale={s} fontSize={13} accent="gold" />
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexGrow: 1, pointerFilter: 'none' }}>
      {column(t('THIS WEEK'), ladder.week)}
      {column(t('ALL TIME'), ladder.all)}
    </UiEntity>
  </UiEntity>
}

// --- the Wheel of Bones ---------------------------------------------------------------------

function WheelTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const spin = wheelState()
  const free = gw.spins === 0
  const turning = !!spin && !spin.done
  const can = !gw.guest && !gw.over && !turning && !gravewatchBusy() && (free || gw.embers >= GW_SPIN_COST)
  const me = localAddress()
  const party = myParty()
  const others = party ? party.members.filter((m) => m !== me) : []
  const wheelSize = 230
  const rowHeight = wheelSize + 20
  const frame = spin?.frame ?? 0
  const legendWidth = inner - wheelSize - 24
  // The prize pops over the wheel as it stops and stays a few seconds; the Pumpkin Head card takes the row once that has been seen.
  const result = spin?.done && spin.sinceDone < RESULT_SECONDS ? GW_WHEEL[spin.target] : undefined
  const pop = result ? 1 + 0.3 * Math.max(0, 1 - spin!.sinceDone / 0.3) : 1
  const pumpkinCard = gw.held && (!spin || (spin.done && spin.sinceDone >= 1.4))
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Strip src={WHEEL_STRIP} title={t('Wheel of Bones').toUpperCase()} sub={t('ONE FREE SPIN A DAY; MORE FOR {n} EMBERS', { n: GW_SPIN_COST })} height={60} scale={s} />
    <Gap h={8} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: rowHeight * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {/* The wheel: one frame of the sheet per angle, the pointer fixed over it. */}
      <UiEntity uiTransform={{ width: wheelSize * s, height: rowHeight * s, flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 20 * s }, width: wheelSize * s, height: wheelSize * s, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: wheelSheet(frame) }, uvs: sheetUvs((frame % WHEEL_SHEET_FRAMES) % WHEEL_SHEET_COLS, Math.floor((frame % WHEEL_SHEET_FRAMES) / WHEEL_SHEET_COLS), WHEEL_SHEET_COLS, WHEEL_SHEET_COLS), color: Color4.White() }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (wheelSize / 2 - 18) * s, top: 4 * s }, width: 36 * s, height: 36 * s, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: WHEEL_POINTER }, color: Color4.White() }} />
        {result && !pumpkinCard && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (wheelSize / 2 - 100 * pop) * s, top: (20 + wheelSize / 2 - 34 * pop) * s },
          width: 200 * pop * s, height: 68 * pop * s, borderRadius: 8 * s, borderWidth: 3 * s, borderColor: result.kind === 'curse' ? coral : gold, alignItems: 'center', justifyContent: 'center',
          padding: { left: 10 * s, right: 10 * s }, pointerFilter: 'none' }} uiBackground={{ color: Color4.create(0.03, 0.04, 0.06, 0.96) }}>
          <Label value={prizeLine(result)} color={result.kind === 'curse' ? coral : result.kind === 'gear' || result.kind === 'mult' ? gold : ember} font="serif"
            fontSize={(result.kind === 'embers' || result.kind === 'coins' ? 26 : 19) * pop * s} textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
        </UiEntity>}
      </UiEntity>
      <UiEntity uiTransform={{ width: legendWidth * s, height: '100%', margin: { left: 24 * s }, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
        {GW_WHEEL.map((seg, i) => {
          const lit = spin?.lit === i
          const landed = !!spin?.done && spin.target === i
          const rare = seg.kind === 'gear' || seg.kind === 'mult'
          return <UiEntity key={`gw-seg-${i}`} uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 3 * s }, padding: { left: 8 * s, right: 6 * s }, flexDirection: 'row',
            borderRadius: 3 * s, borderWidth: s, borderColor: landed ? gold : lit ? ember : rare ? goldLine : line, alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
            uiBackground={{ color: landed ? Color4.create(0.16, 0.12, 0.06, 0.96) : lit ? emberDark : panelColor }}>
            {seg.kind === 'curse'
              ? <UiEntity uiTransform={{ width: 18 * s, height: 18 * s, margin: { right: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ textureMode: 'stretch', texture: { src: PAWN_IMAGE }, color: Color4.White() }} />
              : <GwIcon tile={seg.kind === 'coins' ? ICON.coins : seg.kind === 'gear' ? ICON.gear : seg.kind === 'mult' ? ICON.mult : ICON.ember} height={20} scale={s} />}
            <Label value={t(seg.label)} color={landed ? gold : lit ? ember : seg.kind === 'curse' ? coral : rare ? gold : white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ flexGrow: 1, height: '100%', pointerFilter: 'none' }} />
            {rare && <UiEntity uiTransform={{ height: 16 * s, padding: { left: 6 * s, right: 6 * s }, borderRadius: 3 * s, borderWidth: s, borderColor: goldLine, alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
              uiBackground={{ color: Color4.create(0.16, 0.12, 0.06, 0.96) }}>
              <Label value={t('RARE')} color={gold} fontSize={9 * s} textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
            </UiEntity>}
          </UiEntity>
        })}
      </UiEntity>
      {/* The Pumpkin Head to give out: a card over the whole row, so the choice cannot be missed. */}
      {pumpkinCard && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8 * s, borderWidth: 2 * s, borderColor: coral, padding: { left: 24 * s, right: 24 * s }, pointerFilter: 'block' }} uiBackground={{ color: Color4.create(0.03, 0.04, 0.06, 0.98) }}>
        <UiEntity uiTransform={{ width: 56 * s, height: 56 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: PAWN_IMAGE }, color: Color4.White() }} />
        <Label value={gw.heads > 1 ? t('You hold {n} Pumpkin Heads', { n: gw.heads }) : t('You hold a Pumpkin Head')} color={coral} font="serif" fontSize={22 * s} textAlign="middle-center" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 30 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value={(others.length ? t('Crown someone in your party, or wear it yourself. The wearer grins for an hour and earns ×{m} embers the while.', { m: GW_MULT })
          : t('Nobody in your party to crown. Wear it yourself: a grin for an hour, and ×{m} embers the while.', { m: GW_MULT })) + (gw.heads > 1 ? ` ${t('One per hero: a second head on the same one does nothing.')}` : '')}
          color={white} fontSize={14 * s} textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: 44 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', margin: { top: 10 * s }, flexShrink: 0, pointerFilter: 'none' }}>
          {others.slice(0, 5).map((m) => <Action key={`gw-curse-${m}`} id={`gw-curse-${m}`} text={heroLabel(m)} onClick={() => gravewatchCurse(m)} width={118} height={36} scale={s} fontSize={12} accent="gold" />)}
          <Action id="gw-curse-me" text={t('Wear it myself')} onClick={() => gravewatchCurse('')} width={140} height={36} scale={s} fontSize={13} primary accent="gold" />
        </UiEntity>
      </UiEntity>}
    </UiEntity>
    <Gap h={10} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {free && !turning && <UiEntity uiTransform={{ height: 24 * s, padding: { left: 10 * s, right: 10 * s }, margin: { right: 12 * s }, borderRadius: 12 * s, borderWidth: s, borderColor: ember,
        alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: emberDark }}>
        <Label value={t('1 free spin today')} color={ember} fontSize={12 * s} textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      </UiEntity>}
      <Glow on={can} scale={s}>
        <Action id="gw-spin" text={turning ? t('Spinning…') : free ? t('Free spin') : t('Spin ({n} embers)', { n: GW_SPIN_COST })} onClick={gravewatchSpin}
          width={free ? 200 : 260} height={46} scale={s} fontSize={17} primary accent="gold" disabled={!can} />
      </Glow>
    </UiEntity>
    <Gap h={6} scale={s} />
    <PityBar scale={s} inner={inner} />
  </UiEntity>
}

/** The prize as it lands, in a few words. */
function prizeLine(seg: GwSegment): string {
  switch (seg.kind) {
    case 'embers': return `+${getGravewatch().mult > serverNow() ? Math.round(seg.amount * GW_MULT) : seg.amount} ${t('embers')}`
    case 'coins': return `+${seg.amount} ${t('coins')}`
    case 'gear': return t('A piece of gear!')
    case 'mult': return t('×{m} embers for an hour!', { m: GW_MULT })
    default: return t('Pumpkin Head!')
  }
}

/** Spins since the last gear: a thin track that fills toward the guaranteed piece. */
function PityBar({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const left = Math.max(0, GW_WHEEL_PITY - gw.pity)
  const trackWidth = 200
  return <UiEntity uiTransform={{ width: '100%', height: 20 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={left === 1 ? t('Next spin: guaranteed gear') : t('Guaranteed gear in {n} spins', { n: left })} color={muted} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: (inner - trackWidth) / 2 * s, height: '100%', margin: { right: 10 * s }, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: trackWidth * s, height: 8 * s, borderRadius: 4 * s, borderWidth: s, borderColor: line, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: panelColor }}>
      <UiEntity uiTransform={{ width: `${Math.min(100, (gw.pity / GW_WHEEL_PITY) * 100)}%`, height: '100%', borderRadius: 4 * s, pointerFilter: 'none' }} uiBackground={{ color: gold }} />
    </UiEntity>
    <Label value={`${Math.min(gw.pity, GW_WHEEL_PITY)}/${GW_WHEEL_PITY}`} color={muted} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: (inner - trackWidth) / 2 * s, height: '100%', margin: { left: 10 * s }, pointerFilter: 'none' }} />
  </UiEntity>
}

// --- Gravewalk, the board ----------------------------------------------------------------------

/** Tile i's column and row on the six-by-six rim, clockwise from the top-left. */
function tileCell(i: number): { col: number; row: number } {
  const last = BOARD_SIDE - 1
  if (i < BOARD_SIDE) return { col: i, row: 0 }
  if (i < BOARD_SIDE + last) return { col: last, row: i - last }
  if (i < BOARD_SIDE + 2 * last) return { col: last - (i - (BOARD_SIDE + last) + 1), row: last }
  return { col: 0, row: last - (i - (BOARD_SIDE + 2 * last) + 1) }
}

function BoardTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const play = boardState()
  const rolling = boardRolling()
  const left = Math.max(0, GW_BOARD_TOKENS - gw.rolls)
  const can = !gw.guest && !gw.over && left > 0 && !rolling && !gravewatchBusy()
  const size = 330
  const cell = size / BOARD_SIDE
  const tile = cell - 4
  const panel = inner - size - 16
  const roll = play.roll
  const landed = !!roll && play.landed
  const timing = boardTiming()
  // The landing tile pulses for a second; the payout pops in.
  const pulse = landed && timing.sinceLanded < 1 ? 0.5 + 0.5 * Math.cos(timing.sinceLanded * Math.PI * 4) : 0
  const pop = landed ? 1 + 0.35 * Math.max(0, 1 - timing.sinceLanded / 0.3) : 1
  const lift = Math.sin(timing.hop * Math.PI) * 12
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <SeasonBar scale={s} inner={inner} />
    <UiEntity uiTransform={{ width: '100%', height: size * s, flexDirection: 'row', flexShrink: 0, pointerFilter: 'none' }}>
      {/* The board: the painted ground, twenty tiles on the rim, the pawn, the dice in the middle. */}
      <UiEntity uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: BOARD_IMAGE }, color: Color4.White() }}>
        {GW_BOARD.map((tileInfo, i) => {
          const { col, row } = tileCell(i)
          const level = gw.tiles[i] ?? 1
          const here = play.pawn === i
          const lit = here && landed
          return <UiEntity key={`gw-tile-${i}`} uiTransform={{ positionType: 'absolute', position: { left: (col * cell + 2) * s, top: (row * cell + 2) * s }, width: tile * s, height: tile * s,
            borderRadius: 3 * s, borderWidth: lit ? (2 + 2 * pulse) * s : s, borderColor: lit ? Color4.create(1, 0.85 + 0.15 * pulse, 0.45 + 0.4 * pulse, 1) : here ? ember : Color4.create(0.5, 0.42, 0.25, 0.45),
            flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: { top: 3 * s, bottom: 4 * s }, pointerFilter: 'none' }}
            uiBackground={{ color: TILE_COLORS[tileInfo.kind] }}>
            <Label value={tileInfo.kind === 'embers' ? `${tilePay(tileInfo.amount, level)} ${t('embers')}` : tileInfo.kind === 'coins' ? `${tilePay(tileInfo.amount, level)} ${t('coins')}` : t(tileInfo.label)}
              color={tileInfo.kind === 'curse' ? coral : tileInfo.kind === 'start' ? gold : white} fontSize={(tileInfo.kind === 'mystery' ? 16 : 9) * s} textAlign="middle-center" textWrap="wrap"
              uiTransform={{ width: '100%', height: 26 * s, flexShrink: 0, pointerFilter: 'none' }} />
            <UiEntity uiTransform={{ height: 8 * s, flexDirection: 'row', flexShrink: 0, pointerFilter: 'none' }}>
              {tileInfo.kind !== 'start' && Array.from({ length: GW_TILE_MAX_LEVEL }, (_v, k) => <UiEntity key={`gw-pip-${i}-${k}`}
                uiTransform={{ width: 8 * s, height: 8 * s, margin: { left: 0.5 * s, right: 0.5 * s }, flexShrink: 0, pointerFilter: 'none' }}
                uiBackground={{ textureMode: 'stretch', texture: { src: STAR_IMAGE }, color: k < level ? Color4.White() : Color4.create(0.5, 0.5, 0.5, 0.25) }} />)}
            </UiEntity>
          </UiEntity>
        })}
        {/* The pawn. */}
        {(() => {
          const { col, row } = tileCell(play.pawn)
          return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (col * cell + cell / 2 - 16) * s, top: (row * cell - 10 - lift) * s }, width: 32 * s, height: 32 * s, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: PAWN_IMAGE }, color: Color4.White() }} />
        })()}
        {/* The middle: dice and the word on the landing. */}
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: cell * s, top: cell * s }, width: (size - 2 * cell) * s, height: (size - 2 * cell) * s,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ height: 52 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
            {play.faces[0] > 0 && <Die face={play.faces[0]} scale={s} size={46} dim={!play.settled} />}
            {play.faces[1] > 0 && <Die face={play.faces[1]} scale={s} size={46} dim={!play.settled} />}
          </UiEntity>
          <Label value={roll ? (landed ? landingLine(roll.said, roll.paid, roll.passed && roll.to !== 0) : play.settled ? `${play.faces[0] + play.faces[1]}` : '') : t('Roll to walk the graves')}
            color={landed ? ember : white} font="serif" fontSize={(landed ? 19 * pop : 20) * s} textAlign="middle-center" textWrap="wrap"
            uiTransform={{ width: (size - 2 * cell - 16) * s, height: 60 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
      </UiEntity>
      {/* The side: rolls left, the two rolls, the daily meter. */}
      <UiEntity uiTransform={{ width: panel * s, height: '100%', margin: { left: 16 * s }, flexDirection: 'column', pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ width: '100%', height: 50 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
          <GwIcon tile={ICON.dice} height={48} scale={s} right={10} />
          <Label value={`${left}`} color={left > 0 ? ember : muted} font="serif" fontSize={44 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ flexGrow: 1, height: '100%', pointerFilter: 'none' }} />
        </UiEntity>
        <Line text={t('rolls left today')} scale={s} size={13} height={20} />
        <Gap h={10} scale={s} />
        <Glow on={can} scale={s}>
          <Action id="gw-roll-one" text={rolling ? t('Rolling…') : t('Roll one die')} onClick={() => gravewatchRoll(false)} width={panel - 8} height={44} scale={s} fontSize={15} primary accent="gold" disabled={!can} />
        </Glow>
        <Gap h={8} scale={s} />
        <Action id="gw-roll-two" text={t('Two dice ({n} embers)', { n: GW_BOARD_DOUBLE_COST })} onClick={() => gravewatchRoll(true)} width={panel} height={44} scale={s} fontSize={14} accent="gold"
          disabled={!can || gw.embers < GW_BOARD_DOUBLE_COST} />
        <Gap h={8} scale={s} />
        <Action id="gw-roll-auto" text={isAutoRoll() ? t('Auto-roll: on') : t('Auto-roll')} onClick={toggleAutoRoll} width={panel} height={34} scale={s} fontSize={12} accent="gold"
          active={isAutoRoll()} disabled={!gw.guest && !gw.over && left > 0 ? false : true} />
        <Gap h={10} scale={s} />
        <Line text={t('Today\'s meter')} scale={s} color={gold} size={12} height={20} />
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexShrink: 0, pointerFilter: 'none' }}>
          {GW_HAT_STEPS.map((step, i) => {
            const got = gw.rolls >= step.rolls
            return <UiEntity key={`gw-hat-${i}`} uiTransform={{ width: ((panel - 8) / GW_HAT_STEPS.length) * s, height: 34 * s, margin: { right: i < GW_HAT_STEPS.length - 1 ? 4 * s : 0 }, borderRadius: 4 * s, borderWidth: s,
              borderColor: got ? ember : line, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
              uiBackground={{ color: got ? emberDark : panelColor }}>
              <Label value={`${step.rolls} ${t('rolls')}`} color={got ? ember : muted} fontSize={9 * s} textWrap="nowrap" uiTransform={{ height: 12 * s, flexShrink: 0, pointerFilter: 'none' }} />
              <Label value={`+${step.embers}`} color={got ? ember : white} fontSize={12 * s} textWrap="nowrap" uiTransform={{ height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />
            </UiEntity>
          })}
        </UiEntity>
        {gw.held && <Label value={t('A Pumpkin Head to give out: see the Wheel tab.')} color={coral} fontSize={11 * s} textAlign="top-left" textWrap="wrap"
          uiTransform={{ width: '100%', height: 30 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
      </UiEntity>
    </UiEntity>
  </UiEntity>
}

/**
 * What the landing says, in one line: "+5 embers"; "+150 coins"; "Chest: +17 embers";
 * "A piece of gear"; with " · passed Start" when the 20 for that is in the total.
 */
function landingLine(said: string, paid: number, passed: boolean): string {
  let line: string
  if (/^\d+ embers$/.test(said) || said === 'Start') line = `+${paid} ${t('embers')}`
  else if (/^\d+ coins$/.test(said)) line = `+${said.replace('coins', t('coins'))}${paid > 0 ? ` · +${paid} ${t('embers')}` : ''}`
  else if (said.startsWith('Chest')) line = `${t('Chest')}: +${paid} ${t('embers')}`
  else line = paid > 0 ? `${t(said)} · +${paid} ${t('embers')}` : t(said)
  return passed ? `${line} · ${t('passed Start')}` : line
}

/** Points toward the five season chests: a track that fills a fifth per chest, with the chest sitting on it. */
function SeasonBar({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const steps = GW_BOARD_MILESTONES.length
  // Where the fill stands: whole segments for chests paid, a part of the next.
  let fill = 0
  for (let i = 0; i < steps; i++) {
    const from = i === 0 ? 0 : GW_BOARD_MILESTONES[i - 1].points
    const to = GW_BOARD_MILESTONES[i].points
    if (gw.points >= to) fill = (i + 1) / steps
    else {
      fill = (i + Math.max(0, gw.points - from) / (to - from)) / steps
      break
    }
  }
  const labelWidth = 70
  const track = inner - labelWidth
  const icon = 30
  return <UiEntity uiTransform={{ width: '100%', height: 54 * s, flexDirection: 'row', alignItems: 'flex-start', margin: { bottom: 2 * s }, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: labelWidth * s, height: 30 * s, flexDirection: 'column', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={`${gw.points}`} color={gold} font="serif" fontSize={18 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={t('points')} color={muted} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 12 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: track * s, height: '100%', pointerFilter: 'none' }}>
      {/* The track and its fill, through the middle of the icons. */}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 11 * s }, width: track * s, height: 8 * s, borderRadius: 4 * s, pointerFilter: 'none' }}
        uiBackground={{ color: Color4.create(1, 1, 1, 0.1) }} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 11 * s }, width: Math.max(0, track * fill) * s, height: 8 * s, borderRadius: 4 * s, pointerFilter: 'none' }}
        uiBackground={{ color: ember }} />
      {GW_BOARD_MILESTONES.map((m, i) => {
        const paid = i < gw.miles
        const x = (track * (i + 1)) / steps - icon / 2 - (i === steps - 1 ? icon / 2 : 0)
        return <UiEntity key={`gw-mile-${i}`} uiTransform={{ positionType: 'absolute', position: { left: x * s, top: 0 }, width: (icon + 36) * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: icon * s, height: icon * s, flexShrink: 0, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: m.kind === 'gear' ? GEAR_BADGE_IMAGE : CHEST_IMAGE }, color: paid ? Color4.White() : Color4.create(0.6, 0.6, 0.6, 0.55) }} />
          <Label value={paid ? `✓ ${t(m.label)}` : t(m.label)} color={paid ? gold : muted} fontSize={9 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 12 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={paid ? '' : `${m.points}`} color={muted} fontSize={8.5 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 10 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
      })}
    </UiEntity>
  </UiEntity>
}

/** The rules of the open tab, in plain words, over its content. */
const RULES: Record<GwTab, { title: string; lines: () => string[] }> = {
  rounds: { title: 'How the Run works', lines: () => [
    t('Press "Run" and your hero sets off down the haunted road on their own. Press A or D to change lane.'),
    t('Your stamina drains as you run. Stones and ghouls knock a chunk off it and slow you; embers on the road refill it. A lantern makes you fast for a moment; a ward smashes anything you hit.'),
    t('The run ends when your stamina is gone. Distance pays embers at {a} m, {b} m, {c} m and {d} m, and every ember you picked up counts too.', { a: RUN_TIERS[0].m, b: RUN_TIERS[1].m, c: RUN_TIERS[2].m, d: RUN_TIERS[3].m }),
    t('Every {m} m run banks a mileage point. Spend them on Endurance (more stamina), Speed (faster from the start) or Luck (more and better pickups).', { m: RUN_MILE }),
    t('Three free runs a day; more cost {n} embers each. Clearing a dungeon drops a few embers too, three times a day.', { n: RUN_EXTRA_COST })
  ] },
  wheel: { title: 'How the Wheel works', lines: () => [
    t('One free spin a day. More spins cost {n} embers each.', { n: GW_SPIN_COST }),
    t('The wheel gives embers, coins, a piece of gear, an hour of x1.5 embers, or a Pumpkin Head. A second x1.5 while one runs does nothing.'),
    t('The Pumpkin Head is a grinning mask for an hour, and x1.5 embers while it is worn. Crown a party member, or wear it yourself.'),
    t('Every {n}th spin without gear is guaranteed to land on gear.', { n: GW_WHEEL_PITY })
  ] },
  board: { title: 'How Gravewalk works', lines: () => [
    t('You get {n} free rolls a day.', { n: GW_BOARD_TOKENS }),
    t('Roll, and your pumpkin walks that many graves.'),
    t('Every grave you land on gives you something: embers, coins, a chest, gear or a pumpkin curse.'),
    t('Each time you land on the same grave it earns a star. More stars, bigger prize (up to five).'),
    t('Go all the way round and pass Start for {n} embers.', { n: GW_BOARD_PASS_EMBERS }),
    t('Every landing adds points. Fill the bar at the top to open the season chests.'),
    t('Two dice costs {n} embers and moves you further.', { n: GW_BOARD_DOUBLE_COST })
  ] },
  rising: { title: 'How the Rising works', lines: () => [
    t('Saturdays at 9:15 PM ET the Demon climbs out of the barrow.'),
    t('Be in the hall and press Join. Everyone fights him together in one yard.'),
    t('If you fall, an ally standing over you raises you. If everyone falls, you all walk back to the hall and can try again until 10 PM.'),
    t('Everyone who fights gets {a} embers. If the Demon dies: {b} more, raid loot, and the week\'s wearable unlocks for everyone.', { a: GW_RISING_FIGHT_EMBERS, b: GW_RISING_WIN_EMBERS })
  ] },
  reliquary: { title: 'How the Reliquary works', lines: () => [
    t('Embers buy the three Gravewatch wearables, minted straight to your wallet.'),
    t('The legendary and the mythic unlock when a Rising is won, or on their backstop dates.'),
    t('One of each per wallet. Tap Claim twice. It shows in your backpack within a minute.')
  ] }
}

function Rules({ scale: s, inner, tab }: { scale: number; inner: number; tab: GwTab }) {
  const { title, lines } = RULES[tab]
  const rows = lines()
  const row = rows.length > 5 ? 36 : 44
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: inner * s, height: '100%', padding: { left: 20 * s, right: 20 * s, top: 14 * s, bottom: 14 * s },
    borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexDirection: 'column', pointerFilter: 'block' }} uiBackground={{ color: Color4.create(0.025, 0.045, 0.07, 1) }}>
    <Label value={t(title)} font="serif" color={gold} fontSize={22 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 34 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {rows.map((text, i) => <UiEntity key={`gw-rule-${i}`} uiTransform={{ width: '100%', height: row * s, flexDirection: 'row', alignItems: 'center', margin: { bottom: 4 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 26 * s, height: 26 * s, margin: { right: 10 * s }, borderRadius: 13 * s, alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: emberDark }}>
        <Label value={`${i + 1}`} color={ember} fontSize={13 * s} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
      <Label value={text} color={white} fontSize={(rows.length > 5 ? 13 : 14) * s} textAlign="middle-left" textWrap="wrap"
        uiTransform={{ width: (inner - 40 - 36) * s, height: '100%', flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>)}
    <UiEntity uiTransform={{ flexGrow: 1, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="gw-rules-ok" text={t('Got it')} onClick={() => { rulesOpen = false }} width={160} height={38} scale={s} fontSize={14} primary accent="gold" />
    </UiEntity>
  </UiEntity>
}

/** The gear prize, shown: its icon, name, rarity in its colour, and where it went. Over whatever tab is open. */
function GearCard({ scale: s, prize }: { scale: number; prize: { item: string; up: number } }) {
  const item = getEquipmentItemOrNull(prize.item)
  const rarity = RARITIES[item ? rarityOf(item.id, prize.up) : 'epic']
  const legendary = rarity.rank >= RARITIES.legendary.rank
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8 * s, borderWidth: 3 * s, borderColor: rarity.color, padding: { left: 24 * s, right: 24 * s }, pointerFilter: 'block' }} uiBackground={{ color: Color4.create(0.03, 0.04, 0.06, 0.98) }}>
    <Label value={legendary ? t('A LEGENDARY PIECE OF GEAR') : t('A PIECE OF GEAR')} color={rarity.color} fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: 120 * s, height: 120 * s, borderRadius: 8 * s, borderWidth: 2 * s, borderColor: rarity.color, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: Color4.create(rarity.color.r * 0.2, rarity.color.g * 0.2, rarity.color.b * 0.2, 1) }}>
      {item && <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} uiBackground={{ textureMode: 'stretch', texture: { src: item.icon }, color: Color4.White() }} />}
    </UiEntity>
    <Label value={item ? item.name : prize.item} color={white} font="serif" fontSize={24 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 32 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`${t(rarity.label)}${item?.setLabel ? `  ·  ${t(item.setLabel)}` : ''}`} color={rarity.color} fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={t('It is in your gear bag.')} color={muted} fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Action id="gw-gear-ok" text={t('Got it')} onClick={dismissGearCard} width={160} height={38} scale={s} fontSize={14} primary accent="gold" />
  </UiEntity>
}

/** One corner of a sprite sheet as UI uvs (bottom-left, top-left, top-right, bottom-right; v runs up). */
function sheetUvs(col: number, row: number, cols: number, rows: number): number[] {
  const u0 = col / cols
  const u1 = (col + 1) / cols
  const v1 = 1 - row / rows
  const v0 = 1 - (row + 1) / rows
  return [u0, v0, u0, v1, u1, v1, u1, v0]
}

/** A die face from the strip (1..6). */
function Die({ face, scale: s, size, dim }: { key?: string; face: number; scale: number; size: number; dim: boolean }) {
  const f = Math.max(1, Math.min(6, face))
  return <UiEntity uiTransform={{ width: size * s, height: size * s, margin: { left: 5 * s, right: 5 * s }, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src: DICE_STRIP }, uvs: sheetUvs(f - 1, 0, 6, 1), color: dim ? Color4.create(0.75, 0.75, 0.75, 0.7) : Color4.White() }} />
}

/** "+n embers" over the hall and the yard, as the host credits them. */
export function EmberToasts({ right, top, scale: s }: { right: number; top: number; scale: number }) {
  const gains = emberGains()
  if (!gains.length) return null
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { right, top }, width: 200 * s, flexDirection: 'column', alignItems: 'flex-end', pointerFilter: 'none' }}>
    {gains.map((g, i) => {
      const alpha = Math.min(1, (GAIN_SECONDS - g.age) / 0.6)
      return <UiEntity key={`gw-gain-${i}`} uiTransform={{ height: 34 * s, padding: { left: 14 * s, right: 14 * s }, margin: { bottom: 6 * s }, borderRadius: 6 * s, borderWidth: s,
        borderColor: Color4.create(1, 0.55, 0.2, alpha), alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: Color4.create(0.22, 0.09, 0.03, 0.94 * alpha) }}>
        <Label value={`+${g.amount} ${t('embers')}`} color={Color4.create(1, 0.55, 0.2, alpha)} font="serif" fontSize={18 * s} textWrap="nowrap"
          uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
  </UiEntity>
}

/** The results card's ember line: what this trip out of the hall earned. */
export function emberPayout(): number {
  return runEmberGain()
}

// --- the Rising -----------------------------------------------------------------------------------

function RisingTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const clock = risingClock()
  const dev = isDeveloper()
  const inside = inRisingArena()
  const unlock = clock.start > 0 ? GW_RISING_UNLOCKS[clock.start] : undefined
  const fight = clock.phase === 'fight'
  const canJoin = !gw.guest && !gw.over && !inside && (fight || dev) && !myParty()
  let headline = ''
  let sub = ''
  if (clock.phase === 'closed') {
    headline = t('The Risings are done.')
    sub = t('The Demon will not climb again this season.')
  } else if (fight) {
    headline = t('THE RISING IS ON')
    sub = t('{n} heroes in the yard. Join before the gate shuts at 10 PM ET.', { n: gw.arena })
  } else if (clock.phase === 'lobby') {
    headline = t('The Rising begins')
    sub = t('Be in the hall; the Join button appears at 9:15.')
  } else {
    headline = `${t('Next Rising')}: ${etLabel(clock.start)}`
    sub = t('Be in the hall and press Join.')
  }
  const left = Math.max(0, Math.floor(clock.seconds))
  const boxes: [number, string][] = [[Math.floor(left / 86400), t('days')], [Math.floor((left % 86400) / 3600), t('hours')], [Math.floor((left % 3600) / 60), t('min')], [left % 60, t('sec')]]
  const chipW = (inner - 2 * 10) / 3
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 171 * s, borderRadius: 6 * s, borderWidth: s, borderColor: fight ? coral : goldLine, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: RISING_BANNER }, color: Color4.White() }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 18 * s, bottom: 12 * s }, width: (inner - 36) * s, flexDirection: 'column', pointerFilter: 'none' }}>
        <Label value={headline} font="serif" color={fight ? coral : white} fontSize={(fight ? 28 : 24) * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 34 * s, pointerFilter: 'none' }} />
        <Label value={sub} color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: 20 * s, pointerFilter: 'none' }} />
      </UiEntity>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 12 * s, top: 10 * s }, height: 24 * s, padding: { left: 10 * s, right: 10 * s }, borderRadius: 12 * s, borderWidth: s,
        borderColor: fight ? coral : goldLine, alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: fight ? Color4.create(0.3, 0.06, 0.05, 0.9) : Color4.create(0.03, 0.04, 0.06, 0.8) }}>
        <Label value={fight ? t('LIVE NOW') : t('SATURDAYS · 9:15 PM ET')} color={fight ? coral : gold} fontSize={10.5 * s} textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    </UiEntity>
    <Gap h={10} scale={s} />
    {/* The clock: four boxes down to the gate; while the fight is on, the yard's count instead. */}
    {clock.phase !== 'closed' && <UiEntity uiTransform={{ width: '100%', height: 56 * s, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {fight
        ? <Label value={t('{n} heroes in the yard', { n: gw.arena })} font="serif" color={coral} fontSize={24 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
        : boxes.map(([n, unit], i) => <UiEntity key={`gw-rise-box-${i}`} uiTransform={{ width: 74 * s, height: '100%', margin: { left: 4 * s, right: 4 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: card }}>
          <Label value={n < 10 ? `0${n}` : `${n}`} font="serif" color={white} fontSize={24 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: 30 * s, pointerFilter: 'none' }} />
          <Label value={unit} color={muted} fontSize={10 * s} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: 14 * s, pointerFilter: 'none' }} />
        </UiEntity>)}
    </UiEntity>}
    <Gap h={10} scale={s} />
    {/* What it pays: the two ember purses and the week's wearable. */}
    <UiEntity uiTransform={{ width: '100%', height: 54 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <RisingChip icon={ICON.ember} big={`+${GW_RISING_FIGHT_EMBERS}`} small={t('embers for fighting')} width={chipW} color={ember} scale={s} />
      <RisingChip icon={ICON.demon} big={`+${GW_RISING_WIN_EMBERS}`} small={t('more if the Demon dies')} width={chipW} color={ember} scale={s} />
      <RisingChip picture={unlock ? GW_ITEM_INFO[unlock].picture : undefined} icon={ICON.gear} big={unlock ? GW_ITEM_INFO[unlock].name : t('Raid loot')} small={unlock ? t('unlocks for everyone on a win') : t('for everyone on a win')}
        width={chipW} color={unlock ? RARITY_COLORS[unlock] : gold} scale={s} />
    </UiEntity>
    <Gap h={8} scale={s} />
    <Line text={t('Everyone fights the Demon in one yard. If you fall, an ally standing over you raises you.')} scale={s} size={13} height={22} />
    <Gap h={8} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {inside && <Action id="gw-rising-leave" text={t('Leave the yard')} onClick={() => gravewatchRising('leave')} width={220} height={46} scale={s} fontSize={15} accent="gold" />}
      {!inside && (fight || (dev && clock.phase !== 'closed')) &&
        <Glow on={canJoin} scale={s}>
          <Action id="gw-rising-join" text={myParty() ? t('Leave your party first') : dev && !fight ? t('Open a test arena') : t('Join the Rising')} onClick={() => gravewatchRising('join')}
            width={260} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!canJoin} />
        </Glow>}
      {!inside && !fight && !dev && clock.phase !== 'closed' && <Label value={t('The Join button appears here at 9:15 PM ET on Saturday.')} color={muted} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    </UiEntity>
  </UiEntity>
}

/** One reward of the Rising: an icon or the wearable's picture, the figure, what it is for. */
function RisingChip({ icon, picture, big, small, width, color, scale: s }: { icon: number; picture?: string; big: string; small: string; width: number; color: Color4; scale: number }) {
  return <UiEntity uiTransform={{ width: width * s, height: '100%', padding: { left: 10 * s, right: 10 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
    flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: card }}>
    {picture
      ? <UiEntity uiTransform={{ width: 40 * s, height: 40 * s, margin: { right: 8 * s }, borderRadius: 4 * s, borderWidth: s, borderColor: color, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: picture }, color: Color4.White() }} />
      : <GwIcon tile={icon} height={40} scale={s} right={8} />}
    <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, minWidth: 0, pointerFilter: 'none' }}>
      <Label value={big} font="serif" color={color} fontSize={(big.length > 8 ? 14 : 20) * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 22 * s, pointerFilter: 'none' }} />
      <Label value={small} color={muted} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 14 * s, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

// --- the Reliquary ----------------------------------------------------------------------------------

function ReliquaryTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const now = serverNow()
  const cardWidth = (inner - 2 * 12) / 3
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Strip src={RELIQUARY_STRIP} title={t('Reliquary').toUpperCase()} sub={t('EMBERS BUY THE SEASON\'S WEARABLES')} height={60} scale={s} />
    <Gap h={8} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {GW_ITEMS.map((item) => <Relic key={`gw-relic-${item}`} item={item} scale={s} width={cardWidth} now={now} />)}
    </UiEntity>
    <Gap h={10} scale={s} />
    <Line text={t('One of each per wallet, minted to it. A minute to show in your backpack.')} scale={s} size={13} />
  </UiEntity>
}

function Relic({ item, scale: s, width }: { key?: string; item: GwItem; scale: number; width: number; now: number }) {
  const gw = getGravewatch()
  const info = GW_ITEM_INFO[item]
  const price = GW_PRICES[item]
  const live = gw.live.includes(item)
  const sold = gw.sold.includes(item)
  const keyed = gw.keyed.includes(item)
  const state = gw.redeemed[item]
  const confirm = gravewatchConfirm() === item
  const busy = gravewatchBusy() === 'redeem'
  let text = ''
  let can = false
  let why = ''
  if (state === 'granted') text = t('Yours')
  else if (state === 'pending') text = t('Minting…')
  else if (sold) text = t('Sold out')
  else if (!keyed) text = t('Not yet available')
  else if (!live) {
    text = t('Locked')
    const rising = Object.keys(GW_RISING_UNLOCKS).map(Number).find((start) => GW_RISING_UNLOCKS[start] === item)
    why = rising ? t('Beat the {d} Rising, or wait for {b}', { d: etLabel(rising, false), b: etLabel(GW_BACKSTOPS[item]) }) : ''
  } else if (gw.guest || gw.over) text = t('Claim')
  else {
    text = confirm ? t('Tap again to claim') : t('Claim')
    can = gw.embers >= price && !busy
    if (gw.embers < price) why = t('{n} more embers', { n: price - gw.embers })
  }
  const hover = hovered === `gw-relic-${item}`
  const tint = RARITY_COLORS[item]
  const dim = Color4.create(tint.r, tint.g, tint.b, 0.45)
  return <UiEntity uiTransform={{ width: width * s, flexDirection: 'column', alignItems: 'center', padding: 10 * s, borderRadius: 6 * s, borderWidth: (live && hover) || state === 'granted' ? 2 * s : s,
    borderColor: state === 'granted' ? green : live ? (hover ? white : tint) : dim, flexShrink: 0, pointerFilter: 'block' }}
    uiBackground={{ color: live ? card : panelColor }}
    onMouseEnter={() => { hovered = `gw-relic-${item}` }} onMouseLeave={() => { if (hovered === `gw-relic-${item}`) hovered = '' }}>
    <UiEntity uiTransform={{ width: (width - 40) * s, height: (width - 40) * s, borderRadius: 4 * s, borderWidth: s, borderColor: live ? dim : line, flexShrink: 0, pointerFilter: 'none', opacity: live ? 1 : 0.45 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: info.picture }, color: Color4.White() }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 4 * s, top: 4 * s }, height: 16 * s, padding: { left: 6 * s, right: 6 * s }, borderRadius: 8 * s, alignItems: 'center', pointerFilter: 'none' }}
        uiBackground={{ color: Color4.create(0.03, 0.04, 0.06, 0.85) }}>
        <Label value={t(info.rarity).toUpperCase()} color={tint} fontSize={8.5 * s} textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    </UiEntity>
    <Label value={info.name} font="serif" color={white} fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ height: 20 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <GwIcon tile={ICON.ember} height={18} scale={s} right={4} />
      <Label value={`${price} ${t('embers')}`} color={ember} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
    </UiEntity>
    <Gap h={6} scale={s} />
    <Action id={`gw-claim-${item}`} text={text} onClick={() => gravewatchRedeem(item)} width={width - 20} height={38} scale={s} fontSize={13}
      primary={can && confirm} accent={state === 'granted' ? 'green' : 'gold'} active={state === 'granted'} disabled={!can} />
    <Label value={why} color={muted} fontSize={11.5 * s} textAlign="middle-center" textWrap="wrap"
      uiTransform={{ width: '100%', height: 30 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

// --- the hall and the yard ----------------------------------------------------------------------------

/** The big button above Play: the event's name and what waits today. Gone after the event. */
export function GravewatchButton({ scale: s, disabled }: { scale: number; disabled: boolean }) {
  if (!available()) return null
  const gw = getGravewatch()
  const glow = gw.known && !gw.guest && (gw.rounds === 0 || gw.spins === 0 || risingClock().phase === 'fight')
  return <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0, pointerFilter: 'none' }}>
    <StackButton id="gravewatch" label={t('Gravewatch')} icon="images/hud/gravewatch.png" scale={s} tone="dark" height={58} fontSize={18} disabled={disabled}
      onClick={() => openGravewatch()} glow={glow} badge={risingClock().phase === 'fight' ? t('NOW') : t('NEW')} />
    <Label value={gravewatchButtonLine()} color={ember} font="sans-serif" fontSize={10.5 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: 190 * s, height: 16 * s, margin: { top: 2 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ height: 8 * s, pointerFilter: 'none' }} />
  </UiEntity>
}

/** The Rising's line across the screen: the wipe, the kill, a raise. */
export function GravewatchNotice({ width, top, scale: s }: { width: number; top: number; scale: number }) {
  const { text, left } = gravewatchScreenNote()
  if (!text) return null
  const alpha = Math.min(1, left / 0.6)
  const noticeWidth = Math.min(720 * s, width * 0.8)
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - noticeWidth) / 2, top },
    width: noticeWidth, height: 44 * s, borderRadius: 8 * s, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
    uiBackground={{ color: Color4.create(0.025, 0.045, 0.07, 0.9 * alpha) }}>
    <Label value={text} font="serif" color={Color4.create(1, 0.55, 0.2, alpha)} fontSize={22 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}
