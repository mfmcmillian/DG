// The pit's sheet: which weapon or armor piece to offer. Each of the hero's items is a card
// with its icon, its level now and the one the fire will give it, and the coins
// it asks; what the hero has on wears a WORN tag and comes first, since that is
// what the next fight feels. Pick one, confirm, and the coins are spent and the shot begins
// (src/pitCinematic.ts). Same dark sheet and gold rule as the settings;
// the world camera stays where it is behind the veil, so the hero is still by
// the fire when the sheet closes.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { onDungeonLoaded } from './dungeon'
import { getEquipmentItemOrNull } from './equipmentCatalog'
import { t } from './i18n'
import { getLootState } from './loot'
import { menuColors, MenuAction as Action } from './menuUi'
import { startPitCinematic } from './pitCinematic'
import { attemptUpgrade, LEVEL_FLAT_DAMAGE, LEVEL_PERCENT, UpgradeOffer, upgradeOffers } from './upgrades'
import { MAX_LEVEL } from './shared/upgradeRanks'
import { RARITIES } from './weapons'
import { uiViewport, wholeCanvas } from './uiScale'

const { white, muted, gold, ink, panel, card, line, goldLine, coral } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const FRAME = { width: 760, height: 600 }
const CARD = { width: 148, height: 172, gap: 12 }
const PER_ROW = 4
const PER_PAGE = 8

let open = false
let selectedId = ''
let page = 0
let hovered = ''

export function isUpgradePickerOpen(): boolean {
  return open
}

/** The sheet closes on its own when the hall is left with it up (the host started the run). */
export function initializeUpgradePicker() {
  onDungeonLoaded(closeUpgradePicker)
}

/** Open the sheet (the prompt at the pit). False when it is up already or the hero owns nothing to offer. */
export function openUpgradePicker(): boolean {
  if (open) return false
  const offers = upgradeOffers()
  if (!offers.length) return false
  open = true
  page = 0
  hovered = ''
  selectedId = offers.find((o) => !!o.to && o.affordable)?.id ?? offers[0].id
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  return true
}

export function closeUpgradePicker() {
  if (!open) return
  open = false
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) InputModifier.deleteFrom(engine.PlayerEntity)
}

function confirm() {
  const result = attemptUpgrade(selectedId)
  if (!result) return
  closeUpgradePicker()
  startPitCinematic(result)
}

/** Turn the page; the selection follows onto it so the footer always describes a card in view. */
function turnPage(step: number, offers: UpgradeOffer[], pages: number) {
  page = Math.max(0, Math.min(pages - 1, page + step))
  const shown = offers.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  if (!shown.some((o) => o.id === selectedId)) selectedId = (shown.find((o) => !!o.to && o.affordable) ?? shown[0])?.id ?? selectedId
}

/** In virtual pixels of the UI root (uiScale.ts): the sheet fits the room the screen has, and never grows past its drawn size. */
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

function WeaponCard({ offer, scale: s }: { key?: string; offer: UpgradeOffer; scale: number }) {
  const item = getEquipmentItemOrNull(offer.id)
  const id = `up-${offer.id}`
  const selected = selectedId === offer.id
  const hover = hovered === id
  const rarity = RARITIES[offer.rarity]
  const to = offer.to
  const dim = !to
  return <UiEntity key={id} uiTransform={{ width: CARD.width * s, height: CARD.height * s, margin: { right: CARD.gap * s, bottom: CARD.gap * s },
    padding: 8 * s, borderRadius: 4 * s, borderWidth: (selected ? 2 : 1) * s, borderColor: selected ? gold : hover ? goldLine : rarity.rank > 0 ? rarity.color : line,
    flexDirection: 'column', alignItems: 'center', opacity: dim ? 0.55 : 1, flexShrink: 0, pointerFilter: 'block' }}
    uiBackground={{ color: selected ? Color4.create(0.16, 0.12, 0.06, 0.96) : hover ? card : panel }}
    onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
    onMouseDown={() => { selectedId = offer.id }}>
    {item?.icon ? <UiEntity uiTransform={{ width: 72 * s, height: 72 * s, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: item.icon } }} />
      : <UiEntity uiTransform={{ width: 72 * s, height: 72 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    <Label value={item ? t(item.name) : offer.id} color={white} fontSize={11.5 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', height: 16 * s, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t('Lv {n}', { n: offer.from })} color={rarity.color} fontSize={10 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 58 * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={to ? '→' : ''} color={muted} fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: 16 * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={to ? t('Lv {n}', { n: to }) : ''} color={to ? gold : muted} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 58 * s, height: '100%', pointerFilter: 'none' }} />
    </UiEntity>
    <Label value={to ? `◆ ${offer.coins}` : t('Cannot rise further')}
      color={to ? (offer.affordable ? gold : coral) : muted} fontSize={10.5 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {offer.equipped && <UiEntity uiTransform={{ width: 46 * s, height: 16 * s, positionType: 'absolute', position: { top: -8 * s, right: 8 * s },
      borderRadius: 8 * s, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
      uiBackground={{ color: gold }}>
      <Label value={t('WORN')} color={ink} font="sans-serif" fontSize={9 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
  </UiEntity>
}

export function UpgradeUi() {
  const { scale: s, width, height, x, y } = layout()
  const offers = upgradeOffers()
  const pages = Math.max(1, Math.ceil(offers.length / PER_PAGE))
  page = Math.min(page, pages - 1)
  const shown = offers.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const chosen = offers.find((o) => o.id === selectedId)
  const coins = getLootState().coins
  const canOffer = !!chosen?.to && chosen.affordable
  // Every card carries a right margin, the last one too, so the row is measured with it.
  const gridWidth = PER_ROW * (CARD.width + CARD.gap)
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={wholeCanvas()} uiBackground={{ color: veil }} />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheet }}>
      <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', pointerFilter: 'none' }}>
          <Label value="DUNGEONS OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 300 * s, height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={t('Upgrade pit')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 300 * s, height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <Label value={`◆ ${coins}`} color={gold} fontSize={16 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 120 * s, height: 38 * s, margin: { right: 16 * s }, pointerFilter: 'none' }} />
          <Action id="upgrade-close" text="×" onClick={closeUpgradePicker} width={38} height={38} scale={s} fontSize={26} accent="gold" />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
      <Label value={t('Offer a weapon or a piece of armor to the fire and it comes back a level stronger, to level {max} at most. Every level adds {pct}% to what it does, and a weapon +{flat} flat damage besides.', { max: MAX_LEVEL, pct: LEVEL_PERCENT, flat: LEVEL_FLAT_DAMAGE })}
        color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />

      <UiEntity uiTransform={{ width: gridWidth * s, height: (PER_PAGE / PER_ROW) * (CARD.height + CARD.gap) * s, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', alignSelf: 'center', flexShrink: 0, pointerFilter: 'none' }}>
        {shown.map((offer) => <WeaponCard key={offer.id} offer={offer} scale={s} />)}
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          {pages > 1 && <Action id="upgrade-prev" text="‹" onClick={() => turnPage(-1, offers, pages)} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page === 0} />}
          {pages > 1 && <Label value={`${page + 1} / ${pages}`} color={muted} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ width: 60 * s, height: 38 * s, pointerFilter: 'none' }} />}
          {pages > 1 && <Action id="upgrade-next" text="›" onClick={() => turnPage(1, offers, pages)} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page >= pages - 1} />}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <Label value={chosen?.to ? (chosen.affordable ? t(chosen.equipped ? '{n} coins · worn now · the fire always takes' : '{n} coins · the fire always takes', { n: chosen.coins }) : t('Not enough coins'))
            : chosen ? t('Already at level {n}', { n: MAX_LEVEL }) : ''}
            color={chosen?.to && !chosen.affordable ? coral : muted} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 240 * s, height: 38 * s, margin: { right: 12 * s }, pointerFilter: 'none' }} />
          <Action id="upgrade-cancel" text={t('Cancel')} onClick={closeUpgradePicker} width={110} height={40} scale={s} fontSize={14} accent="gold" />
          <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />
          <Action id="upgrade-confirm" text={t('Offer to the fire')} onClick={confirm} width={170} height={40} scale={s} fontSize={14} accent="gold" primary disabled={!canOffer} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  </UiEntity>
}
