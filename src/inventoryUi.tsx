import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  getInventoryState, getInventoryCharacter, getInventoryItems,
  getPreviewLoadout, getCommittedLoadout, getInventoryIsDirty,
  selectInventorySlot, selectInventoryItem, setInventoryFilter, setInventoryPage,
  equipSelectedItem, unequipSelectedSlot, revertInventoryPreview,
  retryInventoryPreview, rotateInventoryPreview, closeInventory
} from './inventory'
import { EquipmentItem, EquipmentSlot, EQUIPMENT_SLOTS, getEquipmentItem, getUnequippedItem } from './equipmentCatalog'
import { getMenuLayout } from './menuLayout'
import { menuColors, MenuAction as Action } from './menuUi'
import { RARITIES, weaponStatLine, weaponSubtitle } from './weapons'

const { white, muted, gold, line, panel, card, selectedGold, goldLine, coral } = menuColors
/** The lobby's sheet, shared by every full-screen panel. */
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
let hovered = ''

function rect(x: number, y: number, width: number, height: number, s: number) {
  return { positionType: 'absolute' as const, position: { left: x * s, top: y * s },
    width: width * s, height: height * s, pointerFilter: 'none' as const }
}

function slotLabel(slot: EquipmentSlot) {
  return EQUIPMENT_SLOTS.find((entry) => entry.id === slot)?.label || slot
}

function isEmptyItem(item?: EquipmentItem) {
  return !!item && item.id === getUnequippedItem(item.slot).id
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
  return <UiEntity uiTransform={rect(x, y, 80, 112, s)}>
    <UiEntity uiTransform={{ width: 80 * s, height: 80 * s, flexShrink: 0,
      borderRadius: 4 * s, borderWidth: (active ? 2 : 1) * s, borderColor: active ? gold : changed ? goldLine : line,
      alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: active ? selectedGold : hovered === id ? card : sheet }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={() => selectInventorySlot(slot)}>
      <ItemIcon item={item} size={72} scale={s} />
      {changed && <UiEntity uiTransform={{ ...rect(67, 7, 6, 6, s), borderRadius: 3 * s }} uiBackground={{ color: gold }} />}
    </UiEntity>
    <Label value={slotLabel(slot).toUpperCase()} color={active ? gold : muted} fontSize={10 * s} textWrap="nowrap"
      uiTransform={rect(-12, 88, 104, 20, s)} />
  </UiEntity>
}

function BackpackCard({ item, index, scale: s }: { key?: string, item?: EquipmentItem, index: number, scale: number }) {
  const state = getInventoryState()
  const selected = item?.id === state.selectedItemId
  const equipped = !!item && getCommittedLoadout(state.characterId)[item.slot] === item.id
  const id = item ? `item-${item.id}` : `empty-${index}`
  const hover = hovered === id && !!item
  const rarity = item?.weapon ? RARITIES[item.weapon.rarity] : undefined
  return <UiEntity uiTransform={{ ...rect(666 + (index % 4) * 145, 205 + Math.floor(index / 4) * 109, 133, 98, s),
    borderRadius: 4 * s, borderWidth: (selected ? 2 : 1) * s, borderColor: selected ? gold : hover ? goldLine : rarity && rarity.rank > 0 ? rarity.color : line,
    alignItems: 'center', justifyContent: 'center', opacity: item ? 1 : 0.25,
    pointerFilter: item ? 'block' : 'none' }}
    uiBackground={{ color: selected ? selectedGold : hover ? card : panel }}
    onMouseEnter={item ? () => { hovered = id } : undefined}
    onMouseLeave={item ? () => { if (hovered === id) hovered = '' } : undefined}
    onMouseDown={item ? () => selectInventoryItem(item.id) : undefined}>
    {item && <ItemIcon item={item} size={88} scale={s} />}
    {isEmptyItem(item) && <Label value="Remove" color={muted} fontSize={11 * s} textWrap="nowrap"
      uiTransform={rect(0, 68, 133, 21, s)} />}
    {equipped && !isEmptyItem(item) && <Label value="✓" color={gold} fontSize={16 * s}
      uiTransform={rect(108, 3, 21, 23, s)} />}
    {rarity && <UiEntity uiTransform={rect(4, 4, 6, 6, s)} uiBackground={{ color: rarity.color }} />}
    {selected && <UiEntity uiTransform={rect(18, 94, 97, 2, s)} uiBackground={{ color: gold }} />}
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
  const selected = getEquipmentItem(state.selectedItemId)
  const committed = getCommittedLoadout(state.characterId)
  const equipped = !!selected && committed[selected.slot] === selected.id
  const dirty = getInventoryIsDirty()
  const canUnequip = committed[state.selectedSlot] !== getUnequippedItem(state.selectedSlot).id
  const loading = state.loading === 'loading'
  const error = state.loading === 'error'
  const otherActive = state.filter !== 'all' && state.filter !== 'head' && state.filter !== 'chest' && state.filter !== 'weapon'
  const status = error ? 'Preview unavailable. Please try again.' : loading ? 'Preparing equipment…' :
    dirty ? 'Previewing · equip to keep this change' : isEmptyItem(selected) ? 'Nothing equipped in this slot' : 'Currently equipped'
  const showAction = error || !equipped || canUnequip
  const actionText = error ? 'Retry preview' : equipped ? 'Unequip' : isEmptyItem(selected) ? 'Remove item' : 'Equip item'
  const action = error ? retryInventoryPreview : equipped ? unequipSelectedSlot : equipSelectedItem
  const category = state.filter === 'all' ? 'All equipment' : state.filter === 'other' ? 'More armor' : slotLabel(state.filter)

  // The shared frame reserves the native chat column. Only controls capture pointers;
  // the hero bay stays clear so the scene's animated equipment preview remains visible.
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute',
    position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ ...rect(0, 0, 600, 76, s), flexDirection: 'column' }}>
        <Label value="KINGDOM OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value="Equipment" font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 44 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: gold }} />
      </UiEntity>
      <UiEntity uiTransform={rect(1242, 18, 38, 38, s)}>
        <Action id="inventory-close" text="×" onClick={closeInventory} width={38} height={38} scale={s} fontSize={26} accent="gold" />
      </UiEntity>

      <Label value={character.name} font="serif" color={white} fontSize={24 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(120, 86, 390, 36, s)} />
      {sockets.map((socket) => <EquipmentSocket key={socket.slot} {...socket} scale={s} />)}
      <UiEntity uiTransform={{ ...rect(230, 690, 170, 34, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action id="inventory-rotate-left" text="↶" onClick={() => rotateInventoryPreview(-45)} width={36} height={34} scale={s} fontSize={23} accent="gold" />
        <Label value="Rotate" color={muted} fontSize={11 * s} textWrap="nowrap"
          uiTransform={{ width: 88 * s, height: 34 * s, pointerFilter: 'none' }} />
        <Action id="inventory-rotate-right" text="↷" onClick={() => rotateInventoryPreview(45)} width={36} height={34} scale={s} fontSize={23} accent="gold" />
      </UiEntity>
      {(loading || error) && <Label value={error ? 'Preview unavailable' : 'Preparing equipment…'} color={error ? coral : muted}
        fontSize={13 * s} textWrap="nowrap" uiTransform={rect(120, 649, 390, 29, s)} />}

      <UiEntity uiTransform={{ ...rect(642, 84, 638, 654, s), borderRadius: 6 * s, borderWidth: s, borderColor: goldLine }} uiBackground={{ color: sheet }} />
      <Label value="BACKPACK" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(666, 104, 330, 20, s)} />
      <Label value={`${items.length} ${items.length === 1 ? 'item' : 'items'}`} color={muted} fontSize={11 * s}
        textAlign="middle-right" textWrap="nowrap" uiTransform={rect(1100, 104, 134, 20, s)} />
      <UiEntity uiTransform={{ ...rect(666, 132, 568, 36, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        {(['all', 'weapon', 'head', 'chest', 'other'] as const).map((filter) => <Action key={filter} id={`filter-${filter}`}
          text={filter === 'weapon' ? 'Weapons' : filter[0].toUpperCase() + filter.slice(1)}
          onClick={() => setInventoryFilter(filter)} width={108} height={36} scale={s} accent="gold"
          active={filter === 'other' ? otherActive : state.filter === filter} fontSize={13} />)}
      </UiEntity>
      <UiEntity uiTransform={rect(666, 184, 568, 1, s)} uiBackground={{ color: line }} />
      {Array.from({ length: 12 }, (_, index) => <BackpackCard key={`cell-${index}`} item={visibleItems[index]} index={index} scale={s} />)}
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
      <Label value={selected.weapon ? weaponSubtitle(selected).toUpperCase() : slotLabel(selected.slot).toUpperCase()}
        color={selected.weapon ? RARITIES[selected.weapon.rarity].color : gold} fontSize={10 * s}
        textAlign="middle-left" textWrap="nowrap" uiTransform={rect(744, 579, 488, 22, s)} />
      <Label value={selected.name} font="serif" color={white} fontSize={25 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(744, 601, 490, 34, s)} />
      <Label value={selected.weapon ? `${selected.description}  ${weaponStatLine(selected)}` : selected.description}
        color={muted} fontSize={12 * s} textAlign="middle-left"
        uiTransform={rect(744, 637, 490, 35, s)} />
      <Label value={status} color={error ? coral : dirty ? gold : muted} fontSize={11 * s} textAlign="middle-left"
        uiTransform={rect(666, 683, showAction ? 364 : 568, 26, s)} />
      {dirty && <UiEntity uiTransform={rect(666, 706, 128, 28, s)}>
        <Action id="inventory-revert" text="Revert preview" onClick={revertInventoryPreview} width={128} height={27} scale={s} fontSize={11} accent="gold" />
      </UiEntity>}
      {showAction && <UiEntity uiTransform={rect(1064, 685, 170, 39, s)}>
        <Action id="inventory-apply" text={actionText} onClick={action} width={170} height={39} scale={s} accent="gold"
          primary={!equipped || error} disabled={loading || (!error && !equipped && !dirty)} fontSize={14} />
      </UiEntity>}
    </UiEntity>
  </UiEntity>
}
