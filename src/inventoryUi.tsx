import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  getInventoryState, getInventoryCharacter, getInventoryItems, getInventoryNewItems, isInventoryItemLocked,
  getPreviewLoadout, getCommittedLoadout, getInventoryIsDirty, inventoryEntry, InventoryEntry, FREE_COPY,
  selectInventorySlot, selectInventoryItem, setInventoryFilter, setInventoryPage,
  equipSelectedItem, unequipSelectedSlot, revertInventoryPreview,
  retryInventoryPreview, rotateInventoryPreview, closeInventory
} from './inventory'
import { armorSourceComingSoon, armorSourceLabel, EquipmentItem, EquipmentSlot, EQUIPMENT_SLOTS, getEquipmentItem, getUnequippedItem } from './equipmentCatalog'
import { getMenuLayout } from './menuLayout'
import { menuColors, MenuAction as Action } from './menuUi'
import { gearDisplayName, RARITIES, rarityOf, WEAPON_CLASSES, weaponStats } from './weapons'
import { armorBonuses, armorPieceStats } from './armor'
import { affixOf } from './shared/affixes'
import { HeroAttackMotion, resolveCombatHit } from './combatActions'
import { heroClassOf } from './heroClasses'
import { upgradeAffixOf, upgradeLevelOf, upgradeRankOf } from './shared/upgradeRanks'
import { t } from './i18n'
import { isGearNew, newGearCount } from './newGear'
import { bagRowsOf } from './shared/gearBag'

const { white, muted, gold, green, line, panel, card, selectedGold, goldLine, coral } = menuColors
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

/** The line over a card's name, short: the copy's rarity, then what it is (a weapon's class, a piece's set), then its forge level if any. */
function itemSubtitle(entry: InventoryEntry): string {
  const item = entry.item
  if (isEmptyItem(item)) return slotLabel(item.slot)
  const rarity = t(RARITIES[rarityOf(item.id, entry.rank)].label)
  const what = item.weapon ? t(WEAPON_CLASSES[item.weapon.class].label) : item.setLabel ? t('{set} set', { set: item.setLabel }) : slotLabel(item.slot)
  const forged = entry.level > 1 ? ` · ${t('Level {n}', { n: entry.level })}` : ''
  return `${rarity} · ${what}${forged}`
}

/** What the whole outfit adds up to, for the line under the hero's name. Empty when it adds nothing. */
function outfitLine(): string {
  const b = armorBonuses(getPreviewLoadout())
  const parts: string[] = []
  const taken = Math.round((1 - b.toughness) * 100)
  const dealt = Math.round((b.might - 1) * 100)
  if (taken) parts.push(t('-{pct}% damage taken', { pct: taken }))
  if (dealt) parts.push(t('+{pct}% damage dealt', { pct: dealt }))
  if (b.health) parts.push(t('+{n} health', { n: b.health }))
  if (b.stamina) parts.push(t('+{n} stamina', { n: b.stamina }))
  return parts.join('  ·  ')
}

/** One number on the picked piece: what it is, its value, and how that compares with the piece worn in the slot. */
type StatCell = { label: string; value: string; delta?: string; better?: boolean }
/** A copy's identity for the stat math: the item and the rank, forge level and affix of that copy. */
type Copy = Pick<InventoryEntry, 'item' | 'rank' | 'level' | 'affix'>

const signed = (n: number, suffix = '') => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n * 10) / 10)}${suffix}`

/** Damage this hero's own moves do with the copy in hand: first light, the string's finisher, the heavy (and its arrow count). */
function weaponHits(characterId: string, copy: Copy): { light: number; finisher: number; heavy: number; shots: number } {
  const cls = heroClassOf(characterId)
  const w = weaponStats(copy.item.id, true, copy.rank, copy.level, copy.affix)
  const hit = (motion: HeroAttackMotion, finisher: boolean) => resolveCombatHit(motion, false, finisher, w).damage
  return {
    light: hit(cls.light[0], false),
    finisher: hit(cls.light[cls.light.length - 1], true),
    heavy: hit(cls.heavy, false),
    shots: cls.ranged[cls.heavy]?.count ?? 1
  }
}

/** "Light hit 15 +1 · Finisher 23 +1 · Heavy 30 +2": real per-hit damage, green or red against the weapon in hand. */
function weaponCells(characterId: string, copy: Copy, worn?: Copy): StatCell[] {
  const a = weaponHits(characterId, copy)
  const b = worn && weaponHits(characterId, worn)
  const cell = (label: string, v: number, w: number | undefined, shots = 1): StatCell => ({
    label, value: shots > 1 ? `${shots} × ${v}` : `${v}`,
    ...(w !== undefined && w !== v ? { delta: signed(v - w), better: v > w } : {})
  })
  return [cell(t('Light hit'), a.light, b?.light), cell(t('Finisher'), a.finisher, b?.finisher), cell(t('Heavy hit'), a.heavy, b?.heavy, a.shots)]
}

/** How the copy's blows land compared with a plain sword, in words; empty when it is within a tenth either way. */
function weaponFeel(copy: Copy): string {
  const w = weaponStats(copy.item.id, true, copy.rank, copy.level, copy.affix)
  const parts: string[] = []
  if (w.stagger >= 1.1) parts.push(t('Staggers longer')); else if (w.stagger <= 0.9) parts.push(t('Staggers less'))
  if (w.knockback >= 1.1) parts.push(t('Shoves further')); else if (w.knockback <= 0.9) parts.push(t('Shoves less'))
  return parts.join('  ·  ')
}

/** "Damage taken -4% -1% · Health +12 +4": what the piece is worth against the piece worn in its slot. Only stats one of them has. */
function armorCells(copy: Copy, worn?: Copy): StatCell[] {
  const a = armorPieceStats(copy.item, () => copy.rank, () => copy.level, () => copy.affix)
  const b = worn ? armorPieceStats(worn.item, () => worn.rank, () => worn.level, () => worn.affix) : undefined
  const cells: StatCell[] = []
  // `sign` is how the stat reads on the card: damage taken counts down, everything else up.
  const cell = (label: string, v: number, w: number | undefined, sign: 1 | -1, suffix: string) => {
    if (!v && !w) return
    const shown = (n: number) => n ? signed(sign * n, suffix) : '0'
    cells.push({ label, value: shown(v), ...(w !== undefined && Math.round((v - w) * 10) ? { delta: signed(sign * (v - w), suffix), better: v > w } : {}) })
  }
  cell(t('Damage taken'), a.toughness, b?.toughness, -1, '%')
  cell(t('Damage dealt'), a.might, b?.might, 1, '%')
  cell(t('Health'), a.health, b?.health, 1, '')
  cell(t('Stamina'), a.stamina, b?.stamina, 1, '')
  return cells
}

/** Rough pixel width of a nowrap label at `px`: wide scripts count double. */
function textWidth(text: string, px: number): number {
  let n = 0
  for (const ch of text) n += ch.charCodeAt(0) > 0x2e7f ? 2 : 1
  return n * px * 0.58 + 6
}

/** A row of stat cells: muted name, big number, coloured change beside it. */
function StatCells({ cells, y, scale: s }: { cells: StatCell[]; y: number; scale: number }) {
  return <UiEntity uiTransform={{ ...rect(758, y, 484, 24, s), flexDirection: 'row', alignItems: 'center' }}>
    {cells.map((c) => <UiEntity key={c.label} uiTransform={{ height: '100%', flexDirection: 'row', alignItems: 'center', margin: { right: 24 * s }, flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={c.label} color={muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: textWidth(c.label, 13) * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={c.value} color={white} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: textWidth(c.value, 18) * s, height: '100%', pointerFilter: 'none' }} />
      {c.delta && <Label value={c.delta} color={c.better ? green : coral} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: textWidth(c.delta, 13) * s, height: '100%', pointerFilter: 'none' }} />}
    </UiEntity>)}
  </UiEntity>
}

/** The copy of `itemId` the hero uses, as a card uid. */
function activeUid(itemId: string): string {
  return bagRowsOf(itemId)[0]?.uid ?? FREE_COPY + itemId
}

function ItemIcon({ item, size, scale: s }: { item?: EquipmentItem, size: number, scale: number }) {
  return item?.icon && !isEmptyItem(item) ? <UiEntity
    uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ textureMode: 'stretch', texture: { src: item.icon } }} /> :
    <Label value="—" fontSize={28 * s} color={muted} textWrap="nowrap"
      uiTransform={{ width: size * s, height: size * s, flexShrink: 0, pointerFilter: 'none' }} />
}

/** The frame: 1280 wide, 820 tall (menuLayout.ts). The hero bay is x 120..500, y 190..750; the backpack the right 624. */
const SOCKET = 96
const SOCKET_STEP = 130
const sockets: Array<{ slot: EquipmentSlot, x: number, y: number }> = [
  { slot: 'head', x: 20, y: 200 },
  { slot: 'chest', x: 20, y: 200 + SOCKET_STEP },
  { slot: 'hands', x: 20, y: 200 + SOCKET_STEP * 2 },
  { slot: 'weapon', x: 20, y: 200 + SOCKET_STEP * 3 },
  { slot: 'shoulders', x: 504, y: 200 },
  { slot: 'legs', x: 504, y: 200 + SOCKET_STEP },
  { slot: 'boots', x: 504, y: 200 + SOCKET_STEP * 2 }
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
  return <UiEntity uiTransform={rect(x, y, SOCKET, SOCKET + 28, s)}>
    <UiEntity uiTransform={{ width: SOCKET * s, height: SOCKET * s, flexShrink: 0,
      borderRadius: 6 * s, borderWidth: (active ? 2 : 1) * s, borderColor: active ? gold : changed ? goldLine : rarity && rarity.rank > 0 ? rarity.color : line,
      alignItems: 'center', justifyContent: 'center', pointerFilter: 'block' }}
      uiBackground={{ color: active ? selectedGold : hovered === id ? card : sheet }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={() => selectInventorySlot(slot)}>
      <ItemIcon item={item} size={SOCKET - 8} scale={s} />
      {rarity && rarity.rank > 0 && <UiEntity uiTransform={rect(5, 5, 8, 8, s)} uiBackground={{ color: rarity.color }} />}
      {changed && <UiEntity uiTransform={{ ...rect(SOCKET - 15, 7, 8, 8, s), borderRadius: 4 * s }} uiBackground={{ color: gold }} />}
    </UiEntity>
    <Label value={slotLabel(slot).toUpperCase()} color={active ? gold : muted} fontSize={13 * s} textWrap="nowrap"
      uiTransform={rect(-32, SOCKET + 4, SOCKET + 64, 22, s)} />
  </UiEntity>
}

const GRID = { x: 666, y: 212, card: 135, tall: 112, stepX: 147, stepY: 124 }

function BackpackCard({ entry, index, scale: s }: { key?: string, entry?: InventoryEntry, index: number, scale: number }) {
  const state = getInventoryState()
  const item = entry?.item
  const selected = !!entry && entry.uid === state.selectedUid
  const equipped = !!entry && getCommittedLoadout(state.characterId)[entry.item.slot] === entry.item.id && activeUid(entry.item.id) === entry.uid
  const id = entry ? `item-${entry.uid}` : `empty-${index}`
  const hover = hovered === id && !!entry
  const fresh = !!entry && isGearNew(entry.uid)
  const rarity = entry && !isEmptyItem(item) ? RARITIES[rarityOf(entry.item.id, entry.rank)] : undefined
  return <UiEntity uiTransform={{ ...rect(GRID.x + (index % 4) * GRID.stepX, GRID.y + Math.floor(index / 4) * GRID.stepY, GRID.card, GRID.tall, s),
    borderRadius: 6 * s, borderWidth: (selected || fresh ? 2 : 1) * s, borderColor: selected || fresh ? gold : hover ? goldLine : rarity && rarity.rank > 0 ? rarity.color : line,
    alignItems: 'center', justifyContent: 'center', opacity: !entry ? 0.25 : 1,
    pointerFilter: entry ? 'block' : 'none' }}
    uiBackground={{ color: selected ? selectedGold : hover ? card : panel }}
    onMouseEnter={entry ? () => { hovered = id } : undefined}
    onMouseLeave={entry ? () => { if (hovered === id) hovered = '' } : undefined}
    onMouseDown={entry ? () => selectInventoryItem(entry.uid) : undefined}>
    {item && <ItemIcon item={item} size={100} scale={s} />}
    {entry && entry.level > 1 && <Label value={t('Lv {n}', { n: entry.level })} color={rarity?.color ?? muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={rect(8, GRID.tall - 24, 70, 20, s)} />}
    {entry && entry.affix > 0 && <Label value={t(affixOf(entry.affix)?.name ?? '')} color={rarity?.color ?? muted} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={rect(GRID.card - 78, GRID.tall - 24, 70, 20, s)} />}
    {equipped && !isEmptyItem(item) && <Label value="✓" color={gold} fontSize={20 * s}
      uiTransform={rect(GRID.card - 28, 4, 24, 26, s)} />}
    {fresh && <UiEntity uiTransform={{ ...rect(GRID.card - 50, -8, 46, 18, s), borderRadius: 9 * s, alignItems: 'center', justifyContent: 'center' }}
      uiBackground={{ color: gold }}>
      <Label value={t('NEW')} color={ink} font="sans-serif" fontSize={10 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
    {rarity && rarity.rank > 0 && <UiEntity uiTransform={rect(5, 5, 8, 8, s)} uiBackground={{ color: rarity.color }} />}
    {selected && <UiEntity uiTransform={rect(20, GRID.tall - 3, GRID.card - 40, 2, s)} uiBackground={{ color: gold }} />}
  </UiEntity>
}

const FILTER_NAMES = { all: 'All', weapon: 'Weapons', head: 'Head', chest: 'Chest', other: 'Other' } as const

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
    ?? { uid: state.selectedUid, item: selectedItem, rank: upgradeRankOf(selectedItem.id), level: upgradeLevelOf(selectedItem.id), affix: upgradeAffixOf(selectedItem.id), virtual: true }
  const selected = chosen.item
  const committed = getCommittedLoadout(state.characterId)
  const equipped = committed[selected.slot] === selected.id && (chosen.virtual || activeUid(selected.id) === chosen.uid)
  const dirty = getInventoryIsDirty()
  const canUnequip = committed[state.selectedSlot] !== getUnequippedItem(state.selectedSlot).id
  const loading = state.loading === 'loading'
  const error = state.loading === 'error'
  const locked = isInventoryItemLocked(selected.id)
  const freshCount = newGearCount()
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
  const preview = getPreviewLoadout()
  // The numbers compare with the piece worn in the same slot, unless this is that piece.
  const wornItem = getEquipmentItem(committed[selected.slot])
  const worn: Copy | undefined = equipped ? undefined
    : { item: wornItem, rank: upgradeRankOf(wornItem.id), level: upgradeLevelOf(wornItem.id), affix: upgradeAffixOf(wornItem.id) }
  const cells = selected.weapon ? weaponCells(state.characterId, chosen, worn) : armorCells(chosen, worn)
  const feel = selected.weapon ? weaponFeel(chosen) : ''
  const outfit = outfitLine()

  // The shared frame reserves the native chat column. Only controls capture pointers;
  // the hero bay stays clear so the scene's animated equipment preview remains visible.
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute',
    position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ ...rect(0, 0, 600, 84, s), flexDirection: 'column' }}>
        <Label value="DUNGEONS OF ANTROM" color={gold} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value={t('Equipment')} font="serif" color={white} fontSize={40 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 52 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: 240 * s, height: 2 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: gold }} />
      </UiEntity>
      <UiEntity uiTransform={rect(1236, 8, 44, 44, s)}>
        <Action id="inventory-close" text="×" onClick={closeInventory} width={44} height={44} scale={s} fontSize={30} accent="gold" />
      </UiEntity>

      {/* The hero bay: the name and what the outfit adds up to above, the pieces down both sides, the turn buttons below. */}
      <Label value={character.name} font="serif" color={white} fontSize={30 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(120, 92, 380, 40, s)} />
      {outfit && <Label value={outfit} color={gold} fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(20, 136, 580, 26, s)} />}
      {sockets.map((socket) => <EquipmentSocket key={socket.slot} {...socket} scale={s} />)}
      {(loading || error) && <Label value={error ? t('Preview unavailable') : t('Preparing equipment…')} color={error ? coral : muted} fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(40, 702, 540, 26, s)} />}
      <UiEntity uiTransform={{ ...rect(220, 740, 180, 40, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action id="inventory-rotate-left" text="↶" onClick={() => rotateInventoryPreview(-45)} width={40} height={40} scale={s} fontSize={26} accent="gold" />
        <Label value={t('Rotate')} color={muted} fontSize={15 * s} textWrap="nowrap"
          uiTransform={{ width: 90 * s, height: 40 * s, pointerFilter: 'none' }} />
        <Action id="inventory-rotate-right" text="↷" onClick={() => rotateInventoryPreview(45)} width={40} height={40} scale={s} fontSize={26} accent="gold" />
      </UiEntity>

      {/* The backpack: tabs, twelve cards, the pager, then the picked piece and what to do with it. */}
      <UiEntity uiTransform={{ ...rect(642, 92, 624, 720, s), borderRadius: 8 * s, borderWidth: s, borderColor: goldLine }} uiBackground={{ color: sheet }} />
      <Label value={t('BACKPACK')} color={gold} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(666, 110, 200, 24, s)} />
      {freshCount > 0 && <Label value={t('{n} new', { n: freshCount })} color={gold} fontSize={14 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={rect(742, 110, 500, 24, s)} />}
      <UiEntity uiTransform={{ ...rect(666, 144, 576, 42, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        {(['all', 'weapon', 'head', 'chest', 'other'] as const).map((filter) => <Action key={filter} id={`filter-${filter}`}
          text={t(FILTER_NAMES[filter])}
          onClick={() => setInventoryFilter(filter)} width={108} height={42} scale={s} accent="gold"
          active={filter === 'other' ? otherActive : state.filter === filter} fontSize={15} />)}
      </UiEntity>
      {(['weapon', 'head', 'chest', 'other'] as const).map((filter, i) => freshIn(filter) &&
        <UiEntity key={`fresh-${filter}`} uiTransform={{ ...rect(666 + (i + 1) * 117 + 98, 140, 8, 8, s), borderRadius: 4 * s }} uiBackground={{ color: gold }} />)}
      <UiEntity uiTransform={rect(666, 200, 576, 1, s)} uiBackground={{ color: line }} />
      {visibleItems.map((entry, index) => <BackpackCard key={`cell-${entry.uid}`} entry={entry} index={index} scale={s} />)}
      {visibleItems.length === 0 && <Label value={t('Nothing here yet. Gear drops in the dungeons.')} color={muted} fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={rect(666, 212, 576, 112, s)} />}
      {pages > 1 && <UiEntity uiTransform={{ ...rect(1082, 584, 160, 34, s), flexDirection: 'row', justifyContent: 'space-between' }}>
        <Action id="inventory-previous" text="‹" onClick={() => setInventoryPage(page - 1)} width={34} height={34}
          scale={s} disabled={page === 0} fontSize={26} accent="gold" />
        <Label value={`${page + 1} / ${pages}`} color={muted} fontSize={15 * s} textWrap="nowrap"
          uiTransform={{ width: 76 * s, height: 34 * s, pointerFilter: 'none' }} />
        <Action id="inventory-next" text="›" onClick={() => setInventoryPage(page + 1)} width={34} height={34}
          scale={s} disabled={page >= pages - 1} fontSize={26} accent="gold" />
      </UiEntity>}

      <UiEntity uiTransform={rect(666, 630, 576, 1, s)} uiBackground={{ color: gold }} />
      <UiEntity uiTransform={{ ...rect(666, 646, 76, 76, s), alignItems: 'center', justifyContent: 'center' }}>
        <ItemIcon item={selected} size={72} scale={s} />
      </UiEntity>
      <Label value={itemSubtitle(chosen).toUpperCase()}
        color={selected.weapon || selected.realm ? RARITIES[rarityOf(selected.id, chosen.rank)].color : gold} fontSize={13 * s}
        textAlign="middle-left" textWrap="nowrap" uiTransform={rect(758, 642, 484, 22, s)} />
      <Label value={gearDisplayName(selected, chosen.affix)} font="serif" color={white} fontSize={30 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(758, 664, 484, 38, s)} />
      {/* Weapons: the three blows on one row, how they land in words under. Armor: up to four stats over two rows. */}
      {cells.length > 0 && <StatCells cells={selected.weapon ? cells : cells.slice(0, 2)} y={702} scale={s} />}
      {!selected.weapon && cells.length > 2 && <StatCells cells={cells.slice(2)} y={726} scale={s} />}
      {feel && <Label value={feel} color={muted} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={rect(758, 726, 484, 20, s)} />}
      <Label value={status} color={error || locked ? coral : dirty ? gold : muted} fontSize={15 * s} textAlign="middle-left"
        uiTransform={rect(666, 750, showAction ? 360 : 576, 24, s)} />
      {dirty && <UiEntity uiTransform={rect(666, 774, 150, 30, s)}>
        <Action id="inventory-revert" text={t('Revert preview')} onClick={revertInventoryPreview} width={150} height={30} scale={s} fontSize={13} accent="gold" />
      </UiEntity>}
      {showAction && <UiEntity uiTransform={rect(1042, 748, 200, 52, s)}>
        <Action id="inventory-apply" text={actionText} onClick={action} width={200} height={52} scale={s} accent="gold"
          primary={!equipped || error} disabled={loading || (!error && !equipped && !dirty)} fontSize={18} />
      </UiEntity>}
    </UiEntity>
  </UiEntity>
}
