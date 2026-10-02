// The Gravewatch sheet (the Settings/Inventory pattern): embers and today's
// progress in the header, five tabs below: Rounds, the Wheel of Bones,
// Knucklebones, the Rising and the Reliquary. Nothing here decides anything;
// every button is a message to the host and the sheet redraws from its answer.
// Also the hall's big button and the strip of text the Rising puts on screen.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport, wholeCanvas } from './uiScale'
import { menuColors, MenuAction as Action } from './menuUi'
import {
  available, closeGravewatch, diceState, getGravewatch, gravewatchBusy, gravewatchButtonLine, gravewatchConfirm, gravewatchCurse, gravewatchRedeem,
  gravewatchRising, gravewatchRoll, gravewatchRounds, gravewatchScreenNote, gravewatchSpin, gravewatchTab, GW_TABS, GwTab, inRisingArena, isFlyer,
  openGravewatch, risingClock, serverNow, setGravewatchTab, wheelState
} from './gravewatch'
import { heroLabel } from './lobbyUi'
import { myParty } from './party'
import { localAddress } from './multiplayer'
import { isDeveloper } from './devAccess'
import { t } from './i18n'
import {
  etOffset, GW_BACKSTOPS, GW_CLEAR_EMBERS, GW_CRYPT_CLEAR_MULT, GW_DICE_DAILY_CAP, GW_DICE_PAYOUT, GW_EVENT_END, GW_ITEM_INFO, GW_ITEMS, GW_MULT,
  GW_PRICES, GW_RISING_FIGHT_EMBERS, GW_RISING_UNLOCKS, GW_RISING_WIN_EMBERS, GW_ROUNDS_EMBERS, GW_SPIN_COST, GW_WAGERS, GW_WHEEL, GwItem
} from './shared/gravewatch'
import { StackButton } from './hudButtons'

const { white, muted, gold, panel, card, line, goldLine, green, coral, cyan } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheetColor = Color4.create(0.025, 0.045, 0.07, 0.97)
const ember = Color4.create(1, 0.55, 0.2, 1)
const emberDark = Color4.create(0.22, 0.09, 0.03, 0.96)
const FRAME = { width: 640, height: 600 }
const TAB_NAMES: Record<GwTab, string> = { rounds: 'Rounds', wheel: 'Wheel of Bones', dice: 'Knucklebones', rising: 'The Rising', reliquary: 'Reliquary' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
let hovered = ''

function layout() {
  const { width: screenWidth, height: screenHeight } = uiViewport()
  const left = 24
  const right = 24
  const top = 48
  const bottom = 24
  const scale = Math.min((screenWidth - left - right) / FRAME.width, (screenHeight - top - bottom) / FRAME.height, 1)
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
  return <Label value={title} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 20 * s, margin: { bottom: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
}

function Line({ text, scale: s, color = muted, size = 12, height = 20 }: { text: string; scale: number; color?: Color4; size?: number; height?: number }) {
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
        <UiEntity uiTransform={{ flexDirection: 'column', pointerFilter: 'none' }}>
          <Label value={flyer ? t('WELCOME TO').toUpperCase() : `${t('UNTIL')} ${etLabel(GW_EVENT_END, false).toUpperCase()}`} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 320 * s, height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={t('Gravewatch')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 320 * s, height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ height: 38 * s, padding: { left: 14 * s, right: 14 * s }, margin: { right: 10 * s }, borderRadius: 4 * s, borderWidth: s, borderColor: ember,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: emberDark }}>
            <Label value={`${gw.embers}  ${t('embers')}${gw.mult > serverNow() ? `  ×${GW_MULT}` : ''}`} color={ember} font="serif" fontSize={17 * s} textWrap="nowrap"
              uiTransform={{ height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
          <Action id="gw-close" text="×" onClick={closeGravewatch} width={38} height={38} scale={s} fontSize={26} accent="gold" />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />

      <UiEntity uiTransform={{ width: '100%', height: 34 * s, flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: 14 * s }, flexShrink: 0, pointerFilter: 'none' }}>
        {GW_TABS.map((id) => <Action key={`gw-tab-${id}`} id={`gw-tab-${id}`} text={t(TAB_NAMES[id])} onClick={() => setGravewatchTab(id)}
          width={(inner - 4 * 6) / 5} height={34} scale={s} fontSize={12} accent="gold" active={tab === id} />)}
      </UiEntity>

      {gw.over && <Line text={t('Gravewatch has ended. Thank you for keeping the watch.')} scale={s} color={coral} />}
      {gw.guest && !gw.over && <Line text={t('Sign in with a wallet to earn embers and claim the wearables; guests may look.')} scale={s} color={coral} />}

      <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', pointerFilter: 'none' }}>
        {tab === 'rounds' && <RoundsTab scale={s} />}
        {tab === 'wheel' && <WheelTab scale={s} inner={inner} />}
        {tab === 'dice' && <DiceTab scale={s} inner={inner} />}
        {tab === 'rising' && <RisingTab scale={s} inner={inner} />}
        {tab === 'reliquary' && <ReliquaryTab scale={s} inner={inner} />}
      </UiEntity>

      <Label value={gw.note} color={gw.note ? coral : muted} fontSize={12.5 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

// --- Rounds ------------------------------------------------------------------------------------

function RoundsTab({ scale: s }: { scale: number }) {
  const gw = getGravewatch()
  const can = !gw.guest && !gw.over && !myParty()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('THE BARROW YARD')} scale={s} />
    <Line text={t('A short fight through the graves outside the Crypt: the lychgate, then the Barrow Warden. Four minutes, any party.')} scale={s} />
    <Line text={t('Three Rounds a day pay embers: {a}, then {b}, then {c}. Every day resets at midnight ET.', { a: GW_ROUNDS_EMBERS[0], b: GW_ROUNDS_EMBERS[1], c: GW_ROUNDS_EMBERS[2] })} scale={s} />
    <Gap h={10} scale={s} />
    <Progress label={t('Rounds today')} done={gw.rounds} pays={GW_ROUNDS_EMBERS} scale={s} />
    <Gap h={14} scale={s} />
    <Heading title={t('DUNGEON CLEARS')} scale={s} />
    <Line text={t('Clearing any fortress pays too: {a}, {b}, {c} a day. The Crypt pays double.', { a: GW_CLEAR_EMBERS[0], b: GW_CLEAR_EMBERS[1], c: GW_CLEAR_EMBERS[2] })} scale={s} />
    <Gap h={6} scale={s} />
    <Progress label={t('Clears today')} done={gw.clears} pays={GW_CLEAR_EMBERS} scale={s} suffix={`  (${t('Crypt')} ×${GW_CRYPT_CLEAR_MULT})`} />
    <Gap h={22} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="gw-rounds-go" text={myParty() ? t('Leave your party first') : t('To the Barrow Yard')} onClick={gravewatchRounds} width={280} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!can} />
    </UiEntity>
  </UiEntity>
}

function Progress({ label, done, pays, scale: s, suffix = '' }: { label: string; done: number; pays: readonly number[]; scale: number; suffix?: string }) {
  return <UiEntity uiTransform={{ width: '100%', height: 30 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={`${label}: ${Math.min(done, pays.length)}/${pays.length}${suffix}`} color={white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: 260 * s, height: '100%', pointerFilter: 'none' }} />
    {pays.map((pay, i) => <UiEntity key={`${label}-${i}`} uiTransform={{ width: 64 * s, height: 24 * s, margin: { right: 8 * s }, borderRadius: 4 * s, borderWidth: s,
      borderColor: i < done ? ember : line, alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: i < done ? emberDark : panel }}>
      <Label value={i < done ? '✓' : `+${pay}`} color={i < done ? ember : muted} fontSize={12 * s} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
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
  const cellWidth = (inner - 8) / 2
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('ONE FREE SPIN A DAY; MORE FOR {n} EMBERS', { n: GW_SPIN_COST })} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {GW_WHEEL.map((seg, i) => {
        const lit = spin?.lit === i
        const landed = !!spin?.done && spin.target === i
        return <UiEntity key={`gw-seg-${i}`} uiTransform={{ width: cellWidth * s, height: 30 * s, margin: { bottom: 6 * s }, padding: { left: 10 * s },
          borderRadius: 4 * s, borderWidth: s, borderColor: landed ? gold : lit ? ember : line, alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: landed ? Color4.create(0.16, 0.12, 0.06, 0.96) : lit ? emberDark : panel }}>
          <Label value={t(seg.label)} color={landed ? gold : lit ? ember : seg.kind === 'curse' ? coral : white} fontSize={12.5 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
        </UiEntity>
      })}
    </UiEntity>
    <Gap h={8} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="gw-spin" text={turning ? t('Spinning…') : free ? t('Spin (free today)') : t('Spin ({n} embers)', { n: GW_SPIN_COST })} onClick={gravewatchSpin}
        width={260} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!can} />
    </UiEntity>
    {spin?.done && <Line text={`${t('The wheel stops on')}: ${t(GW_WHEEL[spin.target].label)}`} scale={s} color={gold} size={14} height={28} />}
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

// --- Knucklebones ------------------------------------------------------------------------------

function DiceTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const roll = diceState()
  const left = Math.max(0, GW_DICE_DAILY_CAP - gw.rolls)
  const rolling = !!roll && !roll.revealed
  const can = !gw.guest && !gw.over && left > 0 && !rolling && !gravewatchBusy()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('TWO DICE AGAINST THE HOUSE')} scale={s} />
    <Line text={t('Higher total wins {x}× the wager; ties go to the house. {n} rolls a day.', { x: GW_DICE_PAYOUT, n: GW_DICE_DAILY_CAP })} scale={s} />
    <Line text={t('Rolls left today: {n}', { n: left })} scale={s} color={white} />
    <Gap h={16} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 90 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <DiceHand title={t('You')} dice={roll ? roll.mine : undefined} shown={!!roll} scale={s} width={(inner - 20) / 2} lit={!!roll?.revealed && roll.won} />
      <DiceHand title={t('The house')} dice={roll && roll.revealed ? roll.house : undefined} shown={!!roll} scale={s} width={(inner - 20) / 2} lit={!!roll?.revealed && !roll.won} />
    </UiEntity>
    <Label value={roll && roll.revealed ? (roll.won ? t('You win {n} embers.', { n: Math.round(roll.wager * GW_DICE_PAYOUT) }) : t('The house takes {n} embers.', { n: roll.wager })) : rolling ? t('The bones tumble…') : ''}
      color={roll?.revealed ? (roll.won ? green : coral) : muted} font="serif" fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 30 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Gap h={10} scale={s} />
    <Line text={t('Wager')} scale={s} color={gold} size={11} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {GW_WAGERS.map((w) => <Action key={`gw-wager-${w}`} id={`gw-wager-${w}`} text={`${w}`} onClick={() => gravewatchRoll(w)} width={120} height={44} scale={s} fontSize={16} accent="gold"
        disabled={!can || gw.embers < w} />)}
    </UiEntity>
  </UiEntity>
}

function DiceHand({ title, dice, shown, scale: s, width, lit }: { title: string; dice?: [number, number]; shown: boolean; scale: number; width: number; lit: boolean }) {
  const faces = dice ? [dice[0], dice[1]] : ['?', '?']
  const total = dice ? dice[0] + dice[1] : undefined
  return <UiEntity uiTransform={{ width: width * s, height: '100%', borderRadius: 4 * s, borderWidth: s, borderColor: lit ? gold : line, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
    uiBackground={{ color: lit ? Color4.create(0.16, 0.12, 0.06, 0.96) : panel }}>
    <Label value={title} color={muted} fontSize={11 * s} textWrap="nowrap" uiTransform={{ height: 16 * s, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
      {faces.map((f, i) => <UiEntity key={`${title}-${i}`} uiTransform={{ width: 36 * s, height: 36 * s, margin: { left: 6 * s, right: 6 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: shown ? white : line,
        alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }} uiBackground={{ color: card }}>
        <Label value={`${f}`} color={white} font="serif" fontSize={20 * s} textWrap="nowrap" uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>)}
      <Label value={total !== undefined ? `= ${total}` : ''} color={lit ? gold : white} font="serif" fontSize={18 * s} textWrap="nowrap" uiTransform={{ width: 44 * s, height: 36 * s, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}

// --- the Rising -----------------------------------------------------------------------------------

function RisingTab({ scale: s }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const clock = risingClock()
  const dev = isDeveloper()
  const inside = inRisingArena()
  const unlock = clock.start > 0 ? GW_RISING_UNLOCKS[clock.start] : undefined
  const canSign = !gw.guest && !gw.over && (clock.phase === 'signup' || clock.phase === 'lobby')
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
    sub = t('{n} signed up. Stay in the hall: everyone on the list walks in together.', { n: gw.signed })
  } else {
    headline = `${t('Next Rising')}: ${etLabel(clock.start)}`
    sub = clock.phase === 'signup' ? t('Sign-ups are open: {n} so far. In {c}.', { n: gw.signed, c: countdown(clock.seconds) }) : t('Sign-ups open a day before. In {c}.', { c: countdown(clock.seconds) })
  }
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Label value={headline} font="serif" color={clock.phase === 'fight' ? coral : gold} fontSize={(clock.phase === 'fight' ? 24 : 19) * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 32 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Line text={sub} scale={s} color={white} size={13} height={24} />
    <Gap h={10} scale={s} />
    <Heading title={t('WHAT IT IS')} scale={s} />
    <Line text={t('Saturdays at 9:15 PM ET the Demon climbs out of the barrow. Everyone fights in one yard; he grows with the crowd.')} scale={s} />
    <Line text={t('A fallen hero is raised by an ally standing over them, or stands alone after thirty seconds. All down is a wipe: back to the hall, come again.')} scale={s} />
    <Line text={t('Fighting pays {a} embers, win or lose; a win pays {b} more, raid loot, and unlocks the week\'s wearable for everyone.', { a: GW_RISING_FIGHT_EMBERS, b: GW_RISING_WIN_EMBERS })} scale={s} />
    {unlock && <Line text={`${t('This Rising unlocks')}: ${GW_ITEM_INFO[unlock].name} (${t(GW_ITEM_INFO[unlock].rarity)})`} scale={s} color={gold} />}
    <Gap h={18} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {inside && <Action id="gw-rising-leave" text={t('Leave the yard')} onClick={() => gravewatchRising('leave')} width={220} height={46} scale={s} fontSize={15} accent="gold" />}
      {!inside && (clock.phase === 'fight' || (dev && clock.phase !== 'closed')) &&
        <Action id="gw-rising-join" text={myParty() ? t('Leave your party first') : dev && clock.phase !== 'fight' ? t('Open a test arena') : t('Join the Rising')} onClick={() => gravewatchRising('join')}
          width={260} height={46} scale={s} fontSize={16} primary accent="gold" disabled={!canJoin} />}
      {!inside && clock.phase !== 'fight' && clock.phase !== 'closed' && <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />}
      {!inside && clock.phase !== 'fight' && clock.phase !== 'closed' &&
        <Action id="gw-rising-sign" text={gw.signedUp ? t('Signed up — withdraw') : t('Sign up')} onClick={() => gravewatchRising(gw.signedUp ? 'unsign' : 'signup')}
          width={260} height={46} scale={s} fontSize={16} primary={!gw.signedUp} accent="gold" active={gw.signedUp} disabled={!canSign} />}
    </UiEntity>
    {clock.phase === 'idle' && <Line text={t('Sign-ups open 24 hours before.')} scale={s} height={26} />}
    <Gap h={4} scale={s} />
    <Line text={t('Backstops: the legendary is live from {a}, the mythic from {b}, whether or not the Demon falls.', { a: etLabel(GW_BACKSTOPS.w2), b: etLabel(GW_BACKSTOPS.w3) })} scale={s} size={11} />
  </UiEntity>
}

// --- the Reliquary ----------------------------------------------------------------------------------

function ReliquaryTab({ scale: s, inner }: { scale: number; inner: number }) {
  const gw = getGravewatch()
  const now = serverNow()
  const cardWidth = (inner - 2 * 12) / 3
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', pointerFilter: 'none' }}>
    <Heading title={t('EMBERS BUY THE SEASON\'S WEARABLES, MINTED TO YOUR WALLET')} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {GW_ITEMS.map((item) => <Relic key={`gw-relic-${item}`} item={item} scale={s} width={cardWidth} now={now} />)}
    </UiEntity>
    <Gap h={10} scale={s} />
    <Line text={t('One of each per wallet. A mint takes a minute to show in your backpack.')} scale={s} size={11} />
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
    uiBackground={{ color: live ? card : panel }}
    onMouseEnter={() => { hovered = `gw-relic-${item}` }} onMouseLeave={() => { if (hovered === `gw-relic-${item}`) hovered = '' }}>
    <UiEntity uiTransform={{ width: (width - 40) * s, height: (width - 40) * s, borderRadius: 4 * s, flexShrink: 0, pointerFilter: 'none', opacity: live ? 1 : 0.45 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: info.picture }, color: Color4.White() }} />
    <Label value={info.name} font="serif" color={white} fontSize={14 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`${t(info.rarity)}  ·  ${price} ${t('embers')}`} color={item === 'w3' ? coral : item === 'w2' ? gold : cyan} fontSize={11.5 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Gap h={8} scale={s} />
    <Action id={`gw-claim-${item}`} text={text} onClick={() => gravewatchRedeem(item)} width={width - 20} height={38} scale={s} fontSize={13}
      primary={can && confirm} accent={state === 'granted' ? 'green' : 'gold'} active={state === 'granted'} disabled={!can} />
    <Label value={why} color={muted} fontSize={10 * s} textAlign="middle-center" textWrap="wrap"
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
