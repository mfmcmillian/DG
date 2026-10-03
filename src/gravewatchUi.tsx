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
  available, boardRolling, boardState, boardTiming, closeGravewatch, DICE_STRIP, emberGains, GAIN_SECONDS, getGravewatch, gravewatchBusy, gravewatchButtonLine, gravewatchConfirm,
  gravewatchCurse, gravewatchGrant, gravewatchRedeem, gravewatchRising, gravewatchRoll, gravewatchRounds, gravewatchScreenNote, gravewatchSpin, gravewatchTab, GW_TABS, GwTab,
  emberTickLeft, inRisingArena, isAutoRoll, isFlyer, openGravewatch, risingClock, runEmberGain, serverNow, setGravewatchTab, shownEmbers, toggleAutoRoll, WHEEL_POINTER, WHEEL_SHEET, wheelState
} from './gravewatch'
import { heroLabel } from './lobbyUi'
import { myParty } from './party'
import { localAddress } from './multiplayer'
import { isDeveloper } from './devAccess'
import { t } from './i18n'
import {
  etOffset, GW_BACKSTOPS, GW_BOARD, GW_BOARD_DOUBLE_COST, GW_BOARD_MILESTONES, GW_BOARD_PASS_EMBERS, GW_BOARD_TOKENS, GW_CLEAR_EMBERS, GW_CRYPT_CLEAR_MULT, GW_EVENT_END,
  GW_HAT_STEPS, GW_ITEM_INFO, GW_ITEMS, GW_MULT, GW_PRICES, GW_RISING_FIGHT_EMBERS, GW_RISING_UNLOCKS, GW_RISING_WIN_EMBERS, GW_ROUNDS_EMBERS, GW_SPIN_COST,
  GW_TILE_MAX_LEVEL, GW_WHEEL, GwItem, GwTileKind, tilePay
} from './shared/gravewatch'
import { StackButton } from './hudButtons'

const { white, muted, gold, panel: panelColor, card, line, goldLine, green, coral, cyan } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheetColor = Color4.create(0.025, 0.045, 0.07, 0.97)
const ember = Color4.create(1, 0.55, 0.2, 1)
const emberDark = Color4.create(0.22, 0.09, 0.03, 0.96)
const FRAME = { width: 640, height: 600 }
const TAB_NAMES: Record<GwTab, string> = { rounds: 'Rounds', wheel: 'Wheel of Bones', board: 'Gravewalk', rising: 'The Rising', reliquary: 'Reliquary' }
const BOARD_IMAGE = 'images/gravewatch/board.png'
const PAWN_IMAGE = 'images/gravewatch/pumpkin.png'
const STAR_IMAGE = 'images/gravewatch/star.png'
const CHEST_IMAGE = 'images/gravewatch/chest.png'
const GEAR_BADGE_IMAGE = 'images/gravewatch/gear-badge.png'
let rulesOpen = false
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

function Heading({ title, scale: s }: { title: string; scale: number }) {
  return <Label value={title} color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
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
  if (tab !== 'board') rulesOpen = false
  const flyer = isFlyer()
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={wholeCanvas()} uiBackground={{ color: veil }} />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheetColor }}>
      <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, margin: { right: 12 * s }, pointerFilter: 'none' }}>
          <Label value={flyer ? t('WELCOME TO').toUpperCase() : `${t('UNTIL')} ${etLabel(GW_EVENT_END, false).toUpperCase()}  ·  ${t('DAILY RESET IN')} ${countdown(untilReset())}`} color={gold} fontSize={10.5 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={t('Gravewatch')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
          {emberTickLeft() > 0 && <Label value={`+${emberTickLeft()}`} color={gold} font="serif" fontSize={20 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 80 * s, height: 38 * s, margin: { right: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
          <UiEntity uiTransform={{ height: 38 * s, padding: { left: 14 * s, right: 14 * s }, margin: { right: 10 * s }, borderRadius: 4 * s, borderWidth: shownEmbers() !== gw.embers ? 2 * s : s, borderColor: shownEmbers() !== gw.embers ? gold : ember,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: emberDark }}>
            <Label value={`${shownEmbers()}  ${t('embers')}${gw.mult > serverNow() ? `  ×${GW_MULT}` : ''}`} color={shownEmbers() !== gw.embers ? gold : ember} font="serif" fontSize={17 * s} textWrap="nowrap"
              uiTransform={{ height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
          {isDeveloper() && <Action id="gw-grant" text="+1000" onClick={gravewatchGrant} width={64} height={38} scale={s} fontSize={13} accent="gold" />}
          {isDeveloper() && <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />}
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
        {tab === 'rounds' && <RoundsTab scale={s} />}
        {tab === 'wheel' && <WheelTab scale={s} inner={inner} />}
        {tab === 'board' && <BoardTab scale={s} inner={inner} />}
        {tab === 'rising' && <RisingTab scale={s} inner={inner} />}
        {tab === 'reliquary' && <ReliquaryTab scale={s} inner={inner} />}
      </UiEntity>

      <Label value={gw.note} color={gw.note ? coral : muted} fontSize={14 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

// --- Rounds ------------------------------------------------------------------------------------

function RoundsTab({ scale: s }: { scale: number }) {
  const gw = getGravewatch()
  const can = !gw.guest && !gw.over && !myParty()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('THE BARROW YARD')} scale={s} />
    <Line text={t('Five minutes through the graves, any party. Three Rounds a day pay embers.')} scale={s} />
    <Gap h={10} scale={s} />
    <Progress label={t('Rounds today')} done={gw.rounds} pays={GW_ROUNDS_EMBERS} scale={s} />
    <Gap h={18} scale={s} />
    <Heading title={t('DUNGEON CLEARS')} scale={s} />
    <Line text={t('Any fortress cleared pays too. The Crypt pays double.')} scale={s} />
    <Gap h={10} scale={s} />
    <Progress label={t('Clears today')} done={gw.clears} pays={GW_CLEAR_EMBERS} scale={s} suffix={`  (${t('Crypt')} ×${GW_CRYPT_CLEAR_MULT})`} />
    <Gap h={18} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="gw-rounds-go" text={myParty() ? t('Leave your party first') : t('To the Barrow Yard')} onClick={gravewatchRounds} width={280} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!can} />
    </UiEntity>
  </UiEntity>
}

function Progress({ label, done, pays, scale: s, suffix = '' }: { label: string; done: number; pays: readonly number[]; scale: number; suffix?: string }) {
  return <UiEntity uiTransform={{ width: '100%', height: 30 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={`${label}: ${Math.min(done, pays.length)}/${pays.length}${suffix}`} color={white} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: 270 * s, height: '100%', pointerFilter: 'none' }} />
    {pays.map((pay, i) => <UiEntity key={`${label}-${i}`} uiTransform={{ width: 72 * s, height: 28 * s, margin: { right: 8 * s }, borderRadius: 4 * s, borderWidth: s,
      borderColor: i < done ? ember : line, alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: i < done ? emberDark : panelColor }}>
      <Label value={i < done ? '✓' : `+${pay}`} color={i < done ? ember : muted} fontSize={14 * s} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>)}
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
  const wheelSize = 250
  const frame = spin?.frame ?? 0
  const legendWidth = inner - wheelSize - 24
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('ONE FREE SPIN A DAY; MORE FOR {n} EMBERS', { n: GW_SPIN_COST })} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: (wheelSize + 20) * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {/* The wheel: one frame of the sheet per angle, the pointer fixed over it. */}
      <UiEntity uiTransform={{ width: wheelSize * s, height: (wheelSize + 20) * s, flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 20 * s }, width: wheelSize * s, height: wheelSize * s, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: WHEEL_SHEET }, uvs: sheetUvs(frame % 10, Math.floor(frame / 10), 10, 10), color: Color4.White() }} />
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (wheelSize / 2 - 18) * s, top: 4 * s }, width: 36 * s, height: 36 * s, pointerFilter: 'none' }}
          uiBackground={{ textureMode: 'stretch', texture: { src: WHEEL_POINTER }, color: Color4.White() }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: legendWidth * s, height: '100%', margin: { left: 24 * s }, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
        {GW_WHEEL.map((seg, i) => {
          const lit = spin?.lit === i
          const landed = !!spin?.done && spin.target === i
          return <UiEntity key={`gw-seg-${i}`} uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 3 * s }, padding: { left: 8 * s },
            borderRadius: 3 * s, borderWidth: s, borderColor: landed ? gold : lit ? ember : line, alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
            uiBackground={{ color: landed ? Color4.create(0.16, 0.12, 0.06, 0.96) : lit ? emberDark : panelColor }}>
            <Label value={t(seg.label)} color={landed ? gold : lit ? ember : seg.kind === 'curse' ? coral : white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
        })}
      </UiEntity>
    </UiEntity>
    <Gap h={6} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="gw-spin" text={turning ? t('Spinning…') : free ? t('Spin (free today)') : t('Spin ({n} embers)', { n: GW_SPIN_COST })} onClick={gravewatchSpin}
        width={260} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!can} />
    </UiEntity>
    {spin?.done && <Line text={`${t('The wheel stops on')}: ${t(GW_WHEEL[spin.target].label)}`} scale={s} color={gold} size={16} height={28} />}
    {gw.held && <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <Line text={others.length ? t('You hold a pumpkin curse. Who wears it for an hour?') : t('You hold a pumpkin curse. No party to pass it to: wear it yourself?')} scale={s} color={coral} />
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', flexShrink: 0, pointerFilter: 'none' }}>
        {others.slice(0, 5).map((m) => <Action key={`gw-curse-${m}`} id={`gw-curse-${m}`} text={heroLabel(m)} onClick={() => gravewatchCurse(m)} width={118} height={34} scale={s} fontSize={12} accent="gold" />)}
        <Action id="gw-curse-me" text={t('Wear it myself')} onClick={() => gravewatchCurse('')} width={140} height={34} scale={s} fontSize={12} accent="gold" />
      </UiEntity>
    </UiEntity>}
    {gw.curse > serverNow() && <Line text={t('You wear the pumpkin for another {m} min.', { m: Math.max(1, Math.ceil((gw.curse - serverNow()) / 60000)) })} scale={s} color={coral} />}
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
        <Label value={`${left}`} color={left > 0 ? ember : muted} font="serif" fontSize={44 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 50 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Line text={t('rolls left today')} scale={s} size={13} height={20} />
        <Gap h={10} scale={s} />
        <Action id="gw-roll-one" text={rolling ? t('Rolling…') : t('Roll one die')} onClick={() => gravewatchRoll(false)} width={panel} height={44} scale={s} fontSize={15} primary accent="gold" disabled={!can} />
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
        <Gap h={10} scale={s} />
        <Action id="gw-rules" text={t('Rules')} onClick={() => { rulesOpen = true }} width={panel} height={34} scale={s} fontSize={12} accent="gold" />
        {gw.held && <Label value={t('Pumpkin curse held: give it out on the Wheel tab.')} color={coral} fontSize={11 * s} textAlign="top-left" textWrap="wrap"
          uiTransform={{ width: '100%', height: 30 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
      </UiEntity>
    </UiEntity>
    {rulesOpen && <Rules scale={s} inner={inner} />}
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

/** The rules, in plain words, over the board. */
function Rules({ scale: s, inner }: { scale: number; inner: number }) {
  const lines = [
    t('You get {n} free rolls a day.', { n: GW_BOARD_TOKENS }),
    t('Roll, and your pumpkin walks that many graves.'),
    t('Every grave you land on gives you something: embers, coins, a chest, gear or a pumpkin curse.'),
    t('Each time you land on the same grave it earns a star. More stars, bigger prize (up to five).'),
    t('Go all the way round and pass Start for {n} embers.', { n: GW_BOARD_PASS_EMBERS }),
    t('Every landing adds points. Fill the bar at the top to open the season chests.'),
    t('Two dice costs {n} embers and moves you further.', { n: GW_BOARD_DOUBLE_COST })
  ]
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: inner * s, height: '100%', padding: 22 * s, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
    flexDirection: 'column', pointerFilter: 'block' }} uiBackground={{ color: Color4.create(0.025, 0.045, 0.07, 0.985) }}>
    <UiEntity uiTransform={{ width: '100%', height: 36 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t('How Gravewalk works')} font="serif" color={gold} fontSize={22 * s} textAlign="middle-left" textWrap="nowrap" uiTransform={{ height: '100%', pointerFilter: 'none' }} />
      <Action id="gw-rules-close" text="×" onClick={() => { rulesOpen = false }} width={34} height={34} scale={s} fontSize={22} accent="gold" />
    </UiEntity>
    <Gap h={10} scale={s} />
    {lines.map((text, i) => <UiEntity key={`gw-rule-${i}`} uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start', margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 26 * s, height: 26 * s, margin: { right: 10 * s }, borderRadius: 13 * s, alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: emberDark }}>
        <Label value={`${i + 1}`} color={ember} fontSize={13 * s} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
      <Label value={text} color={white} fontSize={14.5 * s} textAlign="middle-left" textWrap="wrap"
        uiTransform={{ width: (inner - 44 - 36) * s, height: 40 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>)}
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

function RisingTab({ scale: s }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const clock = risingClock()
  const dev = isDeveloper()
  const inside = inRisingArena()
  const unlock = clock.start > 0 ? GW_RISING_UNLOCKS[clock.start] : undefined
  const canJoin = !gw.guest && !gw.over && !inside && (clock.phase === 'fight' || dev) && !myParty()
  let headline = ''
  let sub = ''
  if (clock.phase === 'closed') {
    headline = t('The Risings are done.')
    sub = t('The Demon will not climb again this season.')
  } else if (clock.phase === 'fight') {
    headline = t('THE RISING IS ON')
    sub = t('{n} heroes in the yard. Join before the gate shuts at 10 PM ET.', { n: gw.arena })
  } else if (clock.phase === 'lobby') {
    headline = t('The Rising begins in {c}', { c: countdown(clock.seconds) })
    sub = t('Be in the hall; the Join button appears at 9:15.')
  } else {
    headline = `${t('Next Rising')}: ${etLabel(clock.start)}`
    sub = t('In {c}. Be in the hall and press Join.', { c: countdown(clock.seconds) })
  }
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Label value={headline} font="serif" color={clock.phase === 'fight' ? coral : gold} fontSize={(clock.phase === 'fight' ? 26 : 22) * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 36 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Line text={sub} scale={s} color={white} size={15} height={26} />
    <Gap h={14} scale={s} />
    <Line text={t('Saturdays, 9:15 PM ET. Everyone fights the Demon in one yard.')} scale={s} />
    <Line text={t('Fighting pays {a} embers. A win pays {b} more and unlocks the week\'s wearable.', { a: GW_RISING_FIGHT_EMBERS, b: GW_RISING_WIN_EMBERS })} scale={s} />
    {unlock && <Line text={`${t('This Rising unlocks')}: ${GW_ITEM_INFO[unlock].name} (${t(GW_ITEM_INFO[unlock].rarity)})`} scale={s} color={gold} />}
    <Gap h={22} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {inside && <Action id="gw-rising-leave" text={t('Leave the yard')} onClick={() => gravewatchRising('leave')} width={220} height={46} scale={s} fontSize={15} accent="gold" />}
      {!inside && (clock.phase === 'fight' || (dev && clock.phase !== 'closed')) &&
        <Action id="gw-rising-join" text={myParty() ? t('Leave your party first') : dev && clock.phase !== 'fight' ? t('Open a test arena') : t('Join the Rising')} onClick={() => gravewatchRising('join')}
          width={260} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!canJoin} />}
    </UiEntity>
  </UiEntity>
}

// --- the Reliquary ----------------------------------------------------------------------------------

function ReliquaryTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const now = serverNow()
  const cardWidth = (inner - 2 * 12) / 3
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('EMBERS BUY THE SEASON\'S WEARABLES')} scale={s} />
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
  return <UiEntity uiTransform={{ width: width * s, flexDirection: 'column', alignItems: 'center', padding: 10 * s, borderRadius: 6 * s, borderWidth: s,
    borderColor: state === 'granted' ? green : live ? (hover ? gold : goldLine) : line, flexShrink: 0, pointerFilter: 'block' }}
    uiBackground={{ color: live ? card : panelColor }}
    onMouseEnter={() => { hovered = `gw-relic-${item}` }} onMouseLeave={() => { if (hovered === `gw-relic-${item}`) hovered = '' }}>
    <UiEntity uiTransform={{ width: (width - 40) * s, height: (width - 40) * s, borderRadius: 4 * s, flexShrink: 0, pointerFilter: 'none', opacity: live ? 1 : 0.45 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: info.picture }, color: Color4.White() }} />
    <Label value={info.name} font="serif" color={white} fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`${t(info.rarity)}  ·  ${price} ${t('embers')}`} color={item === 'w3' ? coral : item === 'w2' ? gold : cyan} fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Gap h={8} scale={s} />
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
