// The Quartermaster's sheet: the bag laid out for selling (src/sell.ts). One
// row per copy with its icon, name, rarity, level and what it fetches; tabs
// narrow it to a rarity so a whole tier of common leavings can go with one
// press. What the hero has on is not listed: it cannot be sold. Same dark
// sheet and gold rule as the pit's; the world stays behind the veil.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, InputModifier, PointerLock } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { onDungeonLoaded } from './dungeon'
import { EQUIPMENT_SLOTS } from './equipmentCatalog'
import { t } from './i18n'
import { getLootState } from './loot'
import { menuColors, MenuAction as Action } from './menuUi'
import { sellGear, sellMany, SellOffer, sellOffers } from './sell'
import { BAG_CAPS, bagCount } from './shared/gearBag'
import { uiViewport, wholeCanvas } from './uiScale'
import { RARITIES, Rarity, RARITY_ORDER, WEAPON_CLASSES } from './weapons'

const { white, muted, gold, panel, card, line, goldLine } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const FRAME = { width: 760, height: 600 }
const ROW = { height: 46, gap: 6 }
const PER_PAGE = 7

type Tab = 'all' | Rarity

let open = false
let tab: Tab = 'all'
let page = 0
let hovered = ''
/** The last sale, for the footer: how many copies went and for how much. */
let lastSale: { count: number; coins: number } | undefined

export function isSellOpen(): boolean {
  return open
}

/** The sheet closes on its own when the hall is left with it up (the host started the run). */
export function initializeSellSheet() {
  onDungeonLoaded(closeSell)
}

/** Open the sheet (the Quartermaster's offer). False when it is up already. */
export function openSell(): boolean {
  if (open) return false
  open = true
  tab = 'all'
  page = 0
  hovered = ''
  lastSale = undefined
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  return true
}

export function closeSell() {
  if (!open) return
  open = false
  const current = InputModifier.getOrNull(engine.PlayerEntity)
  if (current?.mode?.$case === 'standard' && current.mode.standard.disableAll) InputModifier.deleteFrom(engine.PlayerEntity)
}

function sellOne(uid: string) {
  const coins = sellGear(uid)
  if (coins !== undefined) lastSale = { count: 1, coins }
}

function sellShown(offers: SellOffer[]) {
  if (!offers.length) return
  const coins = sellMany(offers.map((o) => o.uid))
  lastSale = { count: offers.length, coins }
  page = 0
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

function slotLabel(slot: string): string {
  return t(EQUIPMENT_SLOTS.find((entry) => entry.id === slot)?.label ?? slot)
}

/** "Rare · Sword · Lv 3" or "Rare · Jarl set · Legs · Lv 3". */
function subtitle(offer: SellOffer): string {
  const parts = [t(RARITIES[offer.rarity].label)]
  if (offer.item.weapon) parts.push(t(WEAPON_CLASSES[offer.item.weapon.class].label))
  else {
    if (offer.item.setLabel) parts.push(t('{set} set', { set: offer.item.setLabel }))
    parts.push(slotLabel(offer.item.slot))
  }
  if (offer.level > 1) parts.push(t('Lv {n}', { n: offer.level }))
  return parts.join(' · ')
}

function OfferRow({ offer, scale: s }: { key?: string; offer: SellOffer; scale: number }) {
  const id = `sell-${offer.uid}`
  const hover = hovered === id
  const rarity = RARITIES[offer.rarity]
  return <UiEntity key={id} uiTransform={{ width: '100%', height: ROW.height * s, margin: { bottom: ROW.gap * s },
    padding: { left: 8 * s, right: 8 * s }, borderRadius: 4 * s, borderWidth: s, borderColor: hover ? goldLine : rarity.rank > 0 ? rarity.color : line,
    flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'block' }}
    uiBackground={{ color: hover ? card : panel }}
    onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}>
    {offer.item.icon ? <UiEntity uiTransform={{ width: 36 * s, height: 36 * s, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ textureMode: 'stretch', texture: { src: offer.item.icon } }} />
      : <UiEntity uiTransform={{ width: 36 * s, height: 36 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ flexDirection: 'column', justifyContent: 'center', margin: { left: 10 * s }, width: 420 * s, height: '100%', pointerFilter: 'none' }}>
      <Label value={t(offer.item.name)} color={white} fontSize={12.5 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={subtitle(offer)} color={rarity.color} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 15 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <Label value={`◆ ${offer.coins}`} color={gold} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: 90 * s, height: '100%', margin: { right: 12 * s }, pointerFilter: 'none' }} />
    <Action id={id} text={t('Sell')} onClick={() => sellOne(offer.uid)} width={74} height={30} scale={s} fontSize={12} accent="gold" />
  </UiEntity>
}

export function SellUi() {
  const { scale: s, width, height, x, y } = layout()
  const all = sellOffers()
  const offers = tab === 'all' ? all : all.filter((o) => o.rarity === tab)
  const pages = Math.max(1, Math.ceil(offers.length / PER_PAGE))
  page = Math.min(page, pages - 1)
  const shown = offers.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const coins = getLootState().coins
  const total = offers.reduce((sum, o) => sum + o.coins, 0)
  // A whole tier goes at once, but never the whole bag and never the legendaries: those are sold one by one.
  const canSellShown = tab !== 'all' && tab !== 'legendary' && offers.length > 0
  const bagLine = `${t('{n}/{cap} weapons', { n: bagCount('weapon'), cap: BAG_CAPS.weapon })} · ${t('{n}/{cap} armor', { n: bagCount('armor'), cap: BAG_CAPS.armor })}`
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
          <Label value={t('Quartermaster')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 300 * s, height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <Label value={`◆ ${coins}`} color={gold} fontSize={16 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 120 * s, height: 38 * s, margin: { right: 16 * s }, pointerFilter: 'none' }} />
          <Action id="sell-close" text="×" onClick={closeSell} width={38} height={38} scale={s} fontSize={26} accent="gold" />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
      <Label value={`${t('He buys what you do not need: any copy not on a hero, for its rarity and a share of what the fire was fed.')}  ·  ${bagLine}`}
        color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />

      <UiEntity uiTransform={{ width: '100%', height: 32 * s, flexDirection: 'row', margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }}>
        {(['all', ...RARITY_ORDER] as Tab[]).map((which) => {
          const count = which === 'all' ? all.length : all.filter((o) => o.rarity === which).length
          return <UiEntity key={`tab-${which}`} uiTransform={{ margin: { right: 6 * s }, pointerFilter: 'none' }}>
            <Action id={`sell-tab-${which}`} text={`${which === 'all' ? t('All') : t(RARITIES[which].label)} ${count}`}
              onClick={() => { tab = which; page = 0 }} width={which === 'all' ? 84 : 108} height={32} scale={s} fontSize={11.5} accent="gold" active={tab === which} />
          </UiEntity>
        })}
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: PER_PAGE * (ROW.height + ROW.gap) * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
        {shown.map((offer) => <OfferRow key={offer.uid} offer={offer} scale={s} />)}
        {!shown.length && <Label value={all.length ? t('Nothing of this rarity to sell.') : t('Nothing to sell: everything you carry is on a hero.')}
          color={muted} fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 60 * s, pointerFilter: 'none' }} />}
      </UiEntity>

      <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          {pages > 1 && <Action id="sell-prev" text="‹" onClick={() => { page = Math.max(0, page - 1) }} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page === 0} />}
          {pages > 1 && <Label value={`${page + 1} / ${pages}`} color={muted} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ width: 60 * s, height: 38 * s, pointerFilter: 'none' }} />}
          {pages > 1 && <Action id="sell-next" text="›" onClick={() => { page = Math.min(pages - 1, page + 1) }} width={38} height={38} scale={s} fontSize={20} accent="gold" disabled={page >= pages - 1} />}
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
          <Label value={lastSale ? t('Sold {n} for {coins} coins', { n: lastSale.count, coins: lastSale.coins }) : ''}
            color={gold} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
            uiTransform={{ width: 220 * s, height: 38 * s, margin: { right: 12 * s }, pointerFilter: 'none' }} />
          <Action id="sell-done" text={t('Done')} onClick={closeSell} width={110} height={40} scale={s} fontSize={14} accent="gold" />
          <UiEntity uiTransform={{ width: 10 * s, pointerFilter: 'none' }} />
          <Action id="sell-all" text={canSellShown ? t('Sell all {tier} (◆ {n})', { tier: t(RARITIES[tab as Rarity].label), n: total }) : t('Sell a tier at a time')}
            onClick={() => sellShown(offers)} width={220} height={40} scale={s} fontSize={13} accent="gold" primary disabled={!canSellShown} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  </UiEntity>
}
