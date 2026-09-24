// The pit's sheet: which weapon to offer. Each of the hero's weapons is a card
// with its icon, its rarity now and the one the fire could give it, the coins
// it asks and the odds. Pick one, confirm, and the coins are spent and the shot
// begins (src/pitCinematic.ts). Same dark sheet and gold rule as the settings;
// the world camera stays where it is behind the veil, so the hero is still by
// the fire when the sheet closes.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, InputModifier, PointerLock, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { onDungeonLoaded } from './dungeon'
import { getEquipmentItemOrNull } from './equipmentCatalog'
import { t } from './i18n'
import { getLootState } from './loot'
import { menuColors, MenuAction as Action } from './menuUi'
import { startPitCinematic } from './pitCinematic'
import { attemptUpgrade, UpgradeOffer, upgradeOffers } from './upgrades'
import { RARITIES } from './weapons'

const { white, muted, gold, panel, card, line, goldLine, coral } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const FRAME = { width: 720, height: 560 }
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

function layout() {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = canvas?.width || 1600
  const screenHeight = canvas?.height || 900
  const inset = canvas?.screenInsetArea
  const left = Math.max(0, inset?.left || 0) + 24
  const right = Math.max(0, inset?.right || 0) + 24
  const top = Math.max(0, inset?.top || 0) + 48
  const bottom = Math.max(0, inset?.bottom || 0) + 24
  const scale = Math.min((screenWidth - left - right) / FRAME.width, (screenHeight - top - bottom) / FRAME.height, 1.1)
  const width = FRAME.width * scale
  const height = FRAME.height * scale
  return { scale, width, height, x: left + (screenWidth - left - right - width) / 2, y: top + (screenHeight - top - bottom - height) / 2 }
}

function WeaponCard({ offer, scale: s }: { key?: string; offer: UpgradeOffer; scale: number }) {
  const item = getEquipmentItemOrNull(offer.id)
  const id = `up-${offer.id}`
  const selected = selectedId === offer.id
  const hover = hovered === id
  const from = RARITIES[offer.from]
  const to = offer.to ? RARITIES[offer.to] : undefined
  const dim = !to
  return <UiEntity key={id} uiTransform={{ width: CARD.width * s, height: CARD.height * s, margin: { right: CARD.gap * s, bottom: CARD.gap * s },
    padding: 8 * s, borderRadius: 4 * s, borderWidth: (selected ? 2 : 1) * s, borderColor: selected ? gold : hover ? goldLine : from.rank > 0 ? from.color : line,
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
      <Label value={t(from.label)} color={from.color} fontSize={10 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 58 * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={to ? '→' : ''} color={muted} fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: 16 * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={to ? t(to.label) : ''} color={to?.color ?? muted} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 58 * s, height: '100%', pointerFilter: 'none' }} />
    </UiEntity>
    <Label value={to ? `◆ ${offer.coins}  ·  ${Math.round(offer.chance * 100)}%` : t('Cannot rise further')}
      color={to ? (offer.affordable ? gold : coral) : muted} fontSize={10.5 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
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
  const gridWidth = PER_ROW * (CARD.width + CARD.gap) - CARD.gap
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}
    uiBackground={{ color: veil }}>
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
      <Label value={t('Offer a weapon to the fire and it may come back one rarity higher. The coins are spent either way.')}
        color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />

      <UiEntity uiTransform={{ width: gridWidth * s, flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center', flexGrow: 1, pointerFilter: 'none' }}>
        {shown.map((offer) => <WeaponCard key={offer.id} offer={offer} scale={s} />)}
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          {pages > 1 && <Action id="upgrade-prev" text="‹" onClick={() => { page = Math.max(0, page - 1) }} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page === 0} />}
          {pages > 1 && <Label value={`${page + 1} / ${pages}`} color={muted} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ width: 60 * s, height: 38 * s, pointerFilter: 'none' }} />}
          {pages > 1 && <Action id="upgrade-next" text="›" onClick={() => { page = Math.min(pages - 1, page + 1) }} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page >= pages - 1} />}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <Label value={chosen?.to ? (chosen.affordable ? t('{n} coins · {p}% chance', { n: chosen.coins, p: Math.round(chosen.chance * 100) }) : t('Not enough coins'))
            : chosen ? t('Already legendary') : ''}
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
