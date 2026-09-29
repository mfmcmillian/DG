import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  getInventoryState, getInventoryCharacter, getInventoryItems, getInventoryNewItems, getInventoryTotalCount, getInventoryFoundCount, isInventoryItemLocked,
  getPreviewLoadout, getCommittedLoadout, getInventoryIsDirty, inventoryEntry, InventoryEntry, FREE_COPY,
  selectInventorySlot, selectInventoryItem, setInventoryFilter, setInventoryPage,
  equipSelectedItem, unequipSelectedSlot, revertInventoryPreview,
  retryInventoryPreview, rotateInventoryPreview, closeInventory
} from './inventory'
import { armorSourceComingSoon, armorSourceLabel, EquipmentItem, EquipmentLoadout, EquipmentSlot, EQUIPMENT_SLOTS, getEquipmentItem, getUnequippedItem } from './equipmentCatalog'
import { getMenuLayout } from './menuLayout'
import { menuColors, MenuAction as Action } from './menuUi'
import { RARITIES, Rarity, rarityOf, RARITY_ORDER, weaponStatLine, weaponSubtitle } from './weapons'
import { armorSetLine, armorStatLine, armorSummaryLine } from './armor'
import { t } from './i18n'
import { isGearNew, newGearCount } from './newGear'
import { BAG_CAPS, bagCount, bagRowsOf, upgradeLevelOf, upgradeRankOf } from './shared/gearBag'

const { white, muted, gold, line, panel, card, selectedGold, goldLine, coral } = menuColors
/** The lobby's sheet, shared by every full-screen panel. */
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const ink = Color4.create(0.12, 0.08, 0.02, 1)
let hovered = ''

function rect(x: number, y: number, width: number, height: number, s: number) {
  return { positionType: 'absolute' as const, position: { left: x * s, top: y * s },
    width: width * s, height: height * s, pointerFilter: 'none' as const }
}

function slotLabel(slot: EquipmentSlot) {
  return t(EQUIPMENT_SLOTS.find((entry) => entry.id === slot)?.label || slot)
}

function isEmptyItem(item?: EquipmentItem) {
  return !!item && item.id === getUnequippedItem(item.slot).id
}

/** The line under a card's name: a weapon's class and rarity, or an armor piece's set and where it is found, for this copy. */
function itemSubtitle(entry: InventoryEntry): string {
  const item = entry.item
  if (item.weapon) return weaponSubtitle(item, entry.rank, entry.level)
  if (item.setLabel) {
    const where = armorSourceLabel(item.realm)
    const found = armorSourceComingSoon(item.realm) ? t('found in {realm} (coming soon)', { realm: t(where) }) : t('found in {realm}', { realm: t(where) })
    const forged = entry.level > 1 ? ` · ${t('Level {n}', { n: entry.level })}` : ''
    return `${slotLabel(item.slot)} · ${t('{set} set', { set: item.setLabel })}${where ? ` · ${t(RARITIES[rarityOf(item.id, entry.rank)].label)}${forged} · ${found}` : ''}`
  }
  return slotLabel(item.slot)
}

/** The copy of `itemId` the hero uses, as a card uid. */
function activeUid(itemId: string): string {
  return bagRowsOf(itemId)[0]?.uid ?? FREE_COPY + itemId
}

function ItemIcon({ item, size, scale: s }: { item?: EquipmentItem, size: number, scale: number }) {
  return item?.icon && !isEmptyItem(item) ? <UiEntity
    uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src: item.icon } }} /> :
    <Label value="—" fontSize={22 * s} color={muted} textWrap="nowrap"
      uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }} />
}

const sockets: Array<{ slot: EquipmentSlot, x: number, y: number }> = [
  { slot: 'head', x: 14, y: 130 },
  { slot: 'chest', x: 14, y: 260 },
  { slot: 'hands', x: 14, y: 390 },
  { slot: 'weapon', x: 14, y: 520 },
  { slot: 'shoulders', x: 520, y: 130 },
  { slot: 'legs', x: 520, y: 260 },
  { slot: 'boots', x: 520, y: 390 }
]

function EquipmentSocket({ slot, x, y, scale: s }: { key?: string, slot: EquipmentSlot, x: number, y: number, scale: number }) {
  const state = getInventoryState()
  const loadout = getPreviewLoadout()
  const item = getEquipmentItem(loadout[slot])
  const active = state.selectedSlot === slot
  const changed = loadout[slot] !== getCommittedLoadout(state.characterId)[slot]
  const id = `socket-${slot}`
  // The piece's rarity frames the socket, as it does the backpack's cards, so the outfit's worth reads at a glance.
  const rarity = item && !isEmptyItem(item) ? RARITIES[rarityOf(item.id)] : undefined
  return <UiEntity uiTransform={rect(x, y, 80, 112, s)}>
    <UiEntity uiTransform={{ width: 80 * s, height: 80 * s, flexShrink: 0,
      borderRadius: 4 * s, borderWidth: (active ? 2 : 1) * s, borderColor: active ? gold : changed ? goldLine : rarity && rarity.rank > 0 ? rarity.color : line,
      alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: active ? selectedGold : hovered === id ? card : sheet }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={() => selectInventorySlot(slot)}>
      <ItemIcon item={item} size={72} scale={s} />
      {rarity && rarity.rank > 0 && <UiEntity uiTransform={rect(4, 4, 6, 6, s)} uiBackground={{ color: rarity.color }} />}
      {changed && <UiEntity uiTransform={{ ...rect(67, 7, 6, 6, s), borderRadius: 3 * s }} uiBackground={{ color: gold }} />}
    </UiEntity>
    <Label value={slotLabel(slot).toUpperCase()} color={active ? gold : muted} fontSize={10 * s} textWrap="nowrap"
      uiTransform={rect(-12, 88, 104, 20, s)} />
  </UiEntity>
}

function BackpackCard({ entry, index, scale: s }: { key?: string, entry?: InventoryEntry, index: number, scale: number }) {
  const state = getInventoryState()
  const item = entry?.item
  const selected = !!entry && entry.uid === state.selectedUid
  const equipped = !!entry && getCommittedLoadout(state.characterId)[entry.item.slot] === entry.item.id && activeUid(entry.item.id) === entry.uid
  const id = entry ? `item-${entry.uid}` : `empty-${index}`
  const hover = hovered === id && !!entry
  const fresh = !!entry && isGearNew(entry.uid)
  const rarity = entry && !isEmptyItem(item) ? RARITIES[rarityOf(entry.item.id, entry.rank)] : undefined
  return <UiEntity uiTransform={{ ...rect(666 + (index % 4) * 145, 205 + Math.floor(index / 4) * 109, 133, 98, s),
    borderRadius: 4 * s, borderWidth: (selected || fresh ? 2 : 1) * s, borderColor: selected || fresh ? gold : hover ? goldLine : rarity && rarity.rank > 0 ? rarity.color : line,
    alignItems: 'center', justifyContent: 'center', opacity: !entry ? 0.25 : 1,
    pointerFilter: entry ? 'block' : 'none' }}
    uiBackground={{ color: selected ? selectedGold : hover ? card : panel }}
    onMouseEnter={entry ? () => { hovered = id } : undefined}
    onMouseLeave={entry ? () => { if (hovered === id) hovered = '' } : undefined}
    onMouseDown={entry ? () => selectInventoryItem(entry.uid) : undefined}>
    {item && <ItemIcon item={item} size={88} scale={s} />}
    {isEmptyItem(item) && <Label value={t('Remove')} color={muted} fontSize={11 * s} textWrap="nowrap"
      uiTransform={rect(0, 68, 133, 21, s)} />}
    {entry && entry.level > 1 && <Label value={t('Lv {n}', { n: entry.level })} color={rarity?.color ?? muted} fontSize={9.5 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={rect(6, 78, 60, 16, s)} />}
    {equipped && !isEmptyItem(item) && <Label value="✓" color={gold} fontSize={16 * s}
      uiTransform={rect(108, 3, 21, 23, s)} />}
    {fresh && <UiEntity uiTransform={{ ...rect(92, -7, 40, 16, s), borderRadius: 8 * s, alignItems: 'center', justifyContent: 'center' }}
      uiBackground={{ color: gold }}>
      <Label value={t('NEW')} color={ink} font="sans-serif" fontSize={9 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
    {rarity && rarity.rank > 0 && <UiEntity uiTransform={rect(4, 4, 6, 6, s)} uiBackground={{ color: rarity.color }} />}
    {selected && <UiEntity uiTransform={rect(18, 94, 97, 2, s)} uiBackground={{ color: gold }} />}
  </UiEntity>
}

const FILTER_NAMES = { all: 'All', weapon: 'Weapons', head: 'Head', chest: 'Chest', other: 'Other' } as const

/** How many of the outfit's pieces (the weapon too, empty slots aside) are of each rarity, rarest first. */
function rarityTally(loadout: EquipmentLoadout): Array<{ rarity: Rarity; count: number }> {
  const counts = new Map<Rarity, number>()
  for (const slot of EQUIPMENT_SLOTS) {
    const item = getEquipmentItem(loadout[slot.id])
    if (!item || isEmptyItem(item)) continue
    const rarity = rarityOf(item.id)
    counts.set(rarity, (counts.get(rarity) ?? 0) + 1)
  }
  return [...RARITY_ORDER].reverse().filter((rarity) => counts.has(rarity)).map((rarity) => ({ rarity, count: counts.get(rarity)! }))
}

/**
 * The tally as a row of coloured labels, "2 Legendary · 3 Rare · 2 Common", each in its rarity's
 * colour, set large enough to read from across the room. It fills the bay between the sockets and
 * wraps onto a second row when the outfit is mixed enough to need it.
 */
function RarityTally({ loadout, scale: s }: { loadout: EquipmentLoadout; scale: number }) {
  const tally = rarityTally(loadout)
  if (!tally.length) return null
  const font = 31.5
  const row = 40
  return <UiEntity uiTransform={{ ...rect(97, 142, 426, row * 2, s), flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start' }}>
    {tally.map(({ rarity, count }, i) => {
      const text = `${count} ${t(RARITIES[rarity].label)}`
      return <UiEntity key={`tally-${rarity}`} uiTransform={{ flexDirection: 'row', alignItems: 'center', height: row * s, pointerFilter: 'none' }}>
        {i > 0 && <Label value="·" color={muted} fontSize={font * s} textAlign="middle-center" textWrap="nowrap"
          uiTransform={{ width: 24 * s, height: '100%', pointerFilter: 'none' }} />}
        <UiEntity uiTransform={{ width: 12 * s, height: 12 * s, margin: { right: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: RARITIES[rarity].color }} />
        <Label value={text} color={RARITIES[rarity].color} fontSize={font * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: text.length * font * 0.56 * s, height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
  </UiEntity>
}

export function InventoryUi() {
  const { scale: s, x, y, width, height } = getMenuLayout('inventory')
  const state = getInventoryState()
  const character = getInventoryCharacter()
  const items = getInventoryItems()
  const pages = Math.max(1, Math.ceil(items.length / 12))
  const page = Math.min(state.page, pages - 1)
  const visibleItems = items.slice(page * 12, page * 12 + 12)
  const selectedItem = getEquipmentItem(state.selectedItemId)
  const chosen: InventoryEntry = inventoryEntry(state.selectedUid)
    ?? { uid: state.selectedUid, item: selectedItem, rank: upgradeRankOf(selectedItem.id), level: upgradeLevelOf(selectedItem.id), virtual: true }
  const selected = chosen.item
  const committed = getCommittedLoadout(state.characterId)
  const equipped = committed[selected.slot] === selected.id && (chosen.virtual || activeUid(selected.id) === chosen.uid)
  const dirty = getInventoryIsDirty()
  const canUnequip = committed[state.selectedSlot] !== getUnequippedItem(state.selectedSlot).id
  const loading = state.loading === 'loading'
  const error = state.loading === 'error'
  const locked = isInventoryItemLocked(selected.id)
  const total = getInventoryTotalCount()
  const found = getInventoryFoundCount()
  const freshCount = newGearCount()
  const bagLine = `${t('{n}/{cap} weapons', { n: bagCount('weapon'), cap: BAG_CAPS.weapon })} · ${t('{n}/{cap} armor', { n: bagCount('armor'), cap: BAG_CAPS.armor })}`
  // Which tabs hold something new (the "All" tab needs no dot: the header says so).
  const freshItems = getInventoryNewItems()
  const freshIn = (filter: 'weapon' | 'head' | 'chest' | 'other') => freshItems.some(({ item }) =>
    filter === 'other' ? item.slot !== 'head' && item.slot !== 'chest' && item.slot !== 'weapon' : item.slot === filter)
  const otherActive = state.filter !== 'all' && state.filter !== 'head' && state.filter !== 'chest' && state.filter !== 'weapon'
  const source = armorSourceLabel(selected.realm)
  const status = error ? t('Preview unavailable. Please try again.') : loading ? t('Preparing equipment…') :
    locked ? (selected.weapon ? t("Not yet found · weapons drop from the dungeons' enemies") : (armorSourceComingSoon(selected.realm) ? t('Not yet found · this set drops in {realm}, a map still being built', { realm: t(source) }) : t('Not yet found · a piece of this set drops in {realm}', { realm: t(source) }))) :
    dirty ? t('Previewing · equip to keep this change') : isEmptyItem(selected) ? t('Nothing equipped in this slot') : t('Currently equipped')
  const showAction = error || (!locked && (!equipped || canUnequip))
  const actionText = error ? t('Retry preview') : equipped ? t('Unequip') : isEmptyItem(selected) ? t('Remove item') : t('Equip item')
  const action = error ? retryInventoryPreview : equipped ? unequipSelectedSlot : equipSelectedItem
  const category = state.filter === 'all' ? t('All equipment') : state.filter === 'other' ? t('More armor') : slotLabel(state.filter)
  const preview = getPreviewLoadout()
  const statLine = selected.weapon ? weaponStatLine(selected, chosen.rank, chosen.level) : armorStatLine(selected, chosen.rank, chosen.level)
  const setLine = selected.weapon ? '' : armorSetLine(selected, preview)
  const outfit = armorSummaryLine(preview)

  // The shared frame reserves the native chat column. Only controls capture pointers;
  // the hero bay stays clear so the scene's animated equipment preview remains visible.
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute',
    position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ ...rect(0, 0, 600, 76, s), flexDirection: 'column' }}>
        <Label value="DUNGEONS OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value={t('Equipment')} font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 44 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: gold }} />
      </UiEntity>
      <UiEntity uiTransform={rect(1242, 18, 38, 38, s)}>
        <Action id="inventory-close" text="×" onClick={closeInventory} width={38} height={38} scale={s} fontSize={26} accent="gold" />
      </UiEntity>

      <Label value={character.name} font="serif" color={white} fontSize={24 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(120, 86, 390, 36, s)} />
      {outfit && <Label value={outfit} color={gold} fontSize={10.5 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(60, 122, 510, 18, s)} />}
      <RarityTally loadout={preview} scale={s} />
      {sockets.map((socket) => <EquipmentSocket key={socket.slot} {...socket} scale={s} />)}
      <UiEntity uiTransform={{ ...rect(230, 690, 170, 34, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action id="inventory-rotate-left" text="↶" onClick={() => rotateInventoryPreview(-45)} width={36} height={34} scale={s} fontSize={23} accent="gold" />
        <Label value={t('Rotate')} color={muted} fontSize={11 * s} textWrap="nowrap"
          uiTransform={{ width: 88 * s, height: 34 * s, pointerFilter: 'none' }} />
        <Action id="inventory-rotate-right" text="↷" onClick={() => rotateInventoryPreview(45)} width={36} height={34} scale={s} fontSize={23} accent="gold" />
      </UiEntity>
      {(loading || error) && <Label value={error ? t('Preview unavailable') : t('Preparing equipment…')} color={error ? coral : muted}
        fontSize={13 * s} textWrap="nowrap" uiTransform={rect(120, 649, 390, 29, s)} />}

      <UiEntity uiTransform={{ ...rect(642, 84, 638, 654, s), borderRadius: 6 * s, borderWidth: s, borderColor: goldLine }} uiBackground={{ color: sheet }} />
      <Label value={t('BACKPACK')} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(666, 104, 330, 20, s)} />
      <Label value={`${freshCount > 0 ? `${t('{n} new', { n: freshCount })}  ·  ` : ''}${t('{n} of {total} found', { n: found, total })}  ·  ${bagLine}`}
        color={freshCount > 0 ? gold : muted} fontSize={11 * s} textAlign="middle-right" textWrap="nowrap" uiTransform={rect(760, 104, 474, 20, s)} />
      <UiEntity uiTransform={{ ...rect(666, 132, 568, 36, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        {(['all', 'weapon', 'head', 'chest', 'other'] as const).map((filter) => <Action key={filter} id={`filter-${filter}`}
          text={t(FILTER_NAMES[filter])}
          onClick={() => setInventoryFilter(filter)} width={108} height={36} scale={s} accent="gold"
          active={filter === 'other' ? otherActive : state.filter === filter} fontSize={13} />)}
      </UiEntity>
      {(['weapon', 'head', 'chest', 'other'] as const).map((filter, i) => freshIn(filter) &&
        <UiEntity key={`fresh-${filter}`} uiTransform={{ ...rect(666 + (i + 1) * 115 + 98, 128, 8, 8, s), borderRadius: 4 * s }} uiBackground={{ color: gold }} />)}
      <UiEntity uiTransform={rect(666, 184, 568, 1, s)} uiBackground={{ color: line }} />
      {Array.from({ length: 12 }, (_, index) => <BackpackCard key={`cell-${index}`} entry={visibleItems[index]} index={index} scale={s} />)}
      <Label value={category} color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(666, 529, 270, 28, s)} />
      <UiEntity uiTransform={{ ...rect(1090, 526, 148, 31, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action id="inventory-previous" text="‹" onClick={() => setInventoryPage(page - 1)} width={30} height={31}
          scale={s} disabled={page === 0} fontSize={23} accent="gold" />
        <Label value={`${page + 1} / ${pages}`} color={muted} fontSize={11 * s} textWrap="nowrap"
          uiTransform={{ width: 70 * s, height: 31 * s, pointerFilter: 'none' }} />
        <Action id="inventory-next" text="›" onClick={() => setInventoryPage(page + 1)} width={30} height={31}
          scale={s} disabled={page >= pages - 1} fontSize={23} accent="gold" />
      </UiEntity>

      <UiEntity uiTransform={rect(666, 567, 568, 1, s)} uiBackground={{ color: gold }} />
      <UiEntity uiTransform={{ ...rect(666, 584, 62, 62, s), alignItems: 'center', justifyContent: 'center' }}>
        <ItemIcon item={selected} size={60} scale={s} />
      </UiEntity>
      <Label value={itemSubtitle(chosen).toUpperCase()}
        color={selected.weapon || selected.realm ? RARITIES[rarityOf(selected.id, chosen.rank)].color : gold} fontSize={10 * s}
        textAlign="middle-left" textWrap="nowrap" uiTransform={rect(744, 579, 488, 22, s)} />
      <Label value={selected.name} font="serif" color={white} fontSize={25 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(744, 601, 490, 30, s)} />
      <Label value={t(selected.description)} color={muted} fontSize={11.5 * s} textAlign="middle-left"
        uiTransform={rect(744, 631, 490, 22, s)} />
      {statLine && <Label value={statLine} color={white} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(744, 653, 490, 16, s)} />}
      {setLine && <Label value={setLine} color={muted} fontSize={10 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(744, 668, 490, 15, s)} />}
      <Label value={status} color={error || locked ? coral : dirty ? gold : muted} fontSize={11 * s} textAlign="middle-left"
        uiTransform={rect(666, 683, showAction ? 364 : 568, 26, s)} />
      {dirty && <UiEntity uiTransform={rect(666, 706, 128, 28, s)}>
        <Action id="inventory-revert" text={t('Revert preview')} onClick={revertInventoryPreview} width={128} height={27} scale={s} fontSize={11} accent="gold" />
      </UiEntity>}
      {showAction && <UiEntity uiTransform={rect(1064, 685, 170, 39, s)}>
        <Action id="inventory-apply" text={actionText} onClick={action} width={170} height={39} scale={s} accent="gold"
          primary={!equipped || error} disabled={loading || (!error && !equipped && !dirty)} fontSize={14} />
      </UiEntity>}
    </UiEntity>
  </UiEntity>
}
