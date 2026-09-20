import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getEquippedCharacter, getPickerState, openPicker } from './characterPicker'
import { openInventory } from './inventory'
import { IconButton } from './hudButtons'
import { getPlayerCharacterState, getPlayerVitals, retryPlayerCharacter } from './playerCharacter'
import { getWorldRivalState, retryWorldRival } from './dungeonEnemies'
import { getLootState, getLootToasts, TOAST_SECONDS } from './loot'
import { getEquipmentItemOrNull } from './equipmentCatalog'
import { RARITIES, WEAPON_CLASSES } from './weapons'
import { isClientSynced, isSoloMode, localAddress, netStatus } from './multiplayer'
import { netDebugSummary, recentLogs } from './netDebug'
import { MenuAction } from './menuUi'
import {
  atWarTable, descend, getLobbyState, inRun, leaveParty, myParty, myPhase, openLobby, resultsWait, retryRun, returnToHall, setReady
} from './party'
import { HUB } from './partyLookup'
import { openSettings } from './settings'
import { devToolsOn } from './devAccess'
import { playerDisplayName } from './heroNameTag'
import { presence } from './presence'
import { trainingActive, trainingTally } from './trainingDummies'
import { localXp } from './heroXp'
import { bonusLines, MAX_LEVEL } from './shared/progression'
import { formatTime, heroLabel, partyTitle } from './lobbyUi'
import { DIFFICULTIES, LEVELS, MAX_PARTY, nextLevel, realmOfLevel } from './shared/levels'

/** Still shaking hands with the party server (solo play never waits). */
function joining() {
  return !isSoloMode() && !isClientSynced()
}

/** The handshake log and the network readout are for us, with the developer panel on. */
function showNetLog() {
  return devToolsOn() && joining()
}
import { DungeonDevPanel } from './dungeon/ui'

const white = Color4.create(0.94, 0.96, 0.98, 1)
const muted = Color4.create(0.76, 0.80, 0.85, 1)
const red = Color4.create(0.88, 0.23, 0.28, 1)
const panel = Color4.create(0.04, 0.065, 0.10, 0.82)
const hoverPanel = Color4.create(0.13, 0.17, 0.22, 0.96)
const line = Color4.create(0.52, 0.58, 0.66, 0.6)
const track = Color4.create(0.035, 0.045, 0.065, 0.86)
const stamina = Color4.create(0.35, 0.72, 0.95, 1)
const staminaLow = Color4.create(0.95, 0.62, 0.2, 1)
const gold = Color4.create(1, 0.84, 0.32, 1)
const bossRed = Color4.create(0.75, 0.12, 0.2, 1)
let hovered = ''

function hudLayout() {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const width = canvas?.width || 1600
  const height = canvas?.height || 900
  const scale = Math.max(0.8, Math.min(1.2, width / 1600, height / 900))
  const inset = canvas?.screenInsetArea
  const left = Math.max(0, inset?.left || 0) + 24 * scale
  const right = Math.max(0, inset?.right || 0) + 28 * scale
  const bottom = Math.max(0, inset?.bottom || 0) + 40 * scale
  // Vitals sit on the right, clear of the Explorer's left sidebar and the chat
  // column, under the minimap / top-right controls.
  const vitalsTop = Math.max(0, inset?.top || 0) + Math.max(150, height * 0.19)
  return { width, height, scale, left, right, bottom, vitalsTop }
}

/** "Ada · Vanguard 7": the display name (no tag over our own head) with the class and level dimmed after it. */
function heroTitle(): string {
  const name = playerDisplayName(localAddress())
  const cls = `${getEquippedCharacter().name} ${localXp().level}`
  return name ? `${name}  <color=#a3b3c2>·  ${cls}</color>` : cls
}

/** The thin gold bar under the title: experience into the level, and the step to the next. */
function XpBar({ scale: s }: { scale: number }) {
  const x = localXp()
  const capped = x.span <= 0
  const ratio = capped ? 1 : Math.max(0, Math.min(1, x.into / x.span))
  const caption = capped ? `LV ${x.level}  ·  MAX` : `LV ${x.level}  ·  ${x.into} / ${x.span}`
  return <UiEntity uiTransform={{ width: '100%', height: 12 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={caption} color={muted} font="sans-serif" fontSize={9 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: 110 * s, height: 12 * s, margin: { right: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: 108 * s, height: 3 * s, borderRadius: 1.5 * s, flexShrink: 0, flexDirection: 'row', pointerFilter: 'none' }} uiBackground={{ color: track }}>
      <UiEntity uiTransform={{ width: `${ratio * 100}%`, height: '100%', pointerFilter: 'none' }} uiBackground={{ color: gold }} />
    </UiEntity>
  </UiEntity>
}

/** Most rows the hall roster shows before folding the rest into "+n more". */
const ROSTER_ROWS = 8

/**
 * In the hall, where the health and stamina bars would be: who is in the
 * realm and where they are. Nobody needs a health bar between fights.
 */
function HallRoster({ scale: s }: { scale: number }) {
  const list = presence()
  const inHall = list.filter((p) => p.inHall).length
  const shown = list.slice(0, ROSTER_ROWS)
  const rowHeight = 18 * s
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 4 * s }, pointerFilter: 'none' }}>
    <Label value={`IN THE HALL ${inHall}  ·  ONLINE ${list.length}`} color={gold} font="sans-serif" fontSize={10 * s}
      textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, margin: { bottom: 2 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {shown.map((p) => <UiEntity key={p.id} uiTransform={{ width: '100%', height: rowHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={p.where} color={muted} font="sans-serif" fontSize={10 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 96 * s, height: rowHeight, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={p.cls ? `${p.name}  <color=#a3b3c2>·  ${p.cls}</color>` : p.name} color={p.me ? gold : white} font="sans-serif" fontSize={12 * s}
        textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 116 * s, height: rowHeight, margin: { left: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ width: 6 * s, height: 6 * s, margin: { left: 6 * s }, borderRadius: 3 * s, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: p.inHall ? stamina : p.where === 'at the gate' ? muted : gold }} />
    </UiEntity>)}
    {list.length > shown.length && <Label value={`+${list.length - shown.length} more`} color={muted} font="sans-serif" fontSize={10 * s}
      textAlign="middle-right" textWrap="nowrap" uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

function PlayerVitals({ right, top, scale: s }: { right: number; top: number; scale: number }) {
  const state = getWorldRivalState()
  if (!state.visible) return null
  const vitals = getPlayerVitals()
  const maximum = Math.max(1, vitals.maxHealth)
  const health = Math.max(0, Math.min(maximum, vitals.health))
  const staminaRatio = Math.max(0, Math.min(1, vitals.stamina / vitals.maxStamina))
  const coins = getLootState().coins
  const hall = myPhase() === HUB
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { right, top },
    width: 224 * s, flexDirection: 'column', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 24 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={state.party > 1 && !hall ? `◆ ${coins}  ·  ${state.party}` : `◆ ${coins}`} color={gold} font="sans-serif" fontSize={13 * s}
        textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 56 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={heroTitle()} color={white} font="sans-serif" fontSize={15 * s}
        textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 168 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <XpBar scale={s} />
    {hall ? <HallRoster scale={s} /> : <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 18 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 184 * s, height: 8 * s, padding: s, borderRadius: 2 * s, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', pointerFilter: 'none' }} uiBackground={{ color: track }}>
        <UiEntity uiTransform={{ width: `${health / maximum * 100}%`, height: '100%', pointerFilter: 'none' }} uiBackground={{ color: red }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: 17 * s, height: 17 * s, margin: { left: 9 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: 'images/hud/heart.png' } }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', height: 14 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, margin: { top: 4 * s }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 184 * s, height: 5 * s, padding: s, borderRadius: 2 * s, flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', pointerFilter: 'none' }} uiBackground={{ color: track }}>
        <UiEntity uiTransform={{ width: `${staminaRatio * 100}%`, height: '100%', pointerFilter: 'none' }}
          uiBackground={{ color: vitals.exhausted || staminaRatio < 0.3 ? staminaLow : stamina }} />
      </UiEntity>
      <UiEntity uiTransform={{ width: 17 * s, height: 17 * s, margin: { left: 9 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', height: 20 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 60 * s, height: 20 * s, flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
        {[0, 1, 2].map((i) => <UiEntity key={`combo-${i}`} uiTransform={{ width: 9 * s, height: 9 * s, margin: { right: 4 * s }, borderRadius: 5 * s, pointerFilter: 'none' }}
          uiBackground={{ color: i < vitals.comboStep ? gold : track }} />)}
      </UiEntity>
      <Label value={`${Math.ceil(health)} / ${maximum}`} color={muted} font="sans-serif" fontSize={12 * s}
        textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 120 * s, height: 20 * s, margin: { right: 26 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    </UiEntity>}
  </UiEntity>
}

/** Boss bar across the top while the Warlord is engaged. */
function BossBar({ width, scale: s }: { width: number; scale: number }) {
  const state = getWorldRivalState()
  if (!state.visible || state.phase !== 'fighting' || !state.bossAlive || state.name !== 'Warlord') return null
  const barWidth = Math.min(420 * s, width * 0.5)
  const ratio = Math.max(0, Math.min(1, state.health / Math.max(1, state.maxHealth)))
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const top = Math.max(0, canvas?.screenInsetArea?.top || 0) + 26 * s
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - barWidth) / 2, top },
    width: barWidth, height: 44 * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={state.bossLabel ? `${state.name}  ·  ${state.bossLabel}` : state.name} color={white} font="sans-serif" fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', height: 10 * s, padding: s, borderRadius: 3 * s, borderWidth: s, borderColor: line, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: track }}>
      <UiEntity uiTransform={{ width: `${ratio * 100}%`, height: '100%', pointerFilter: 'none' }} uiBackground={{ color: bossRed }} />
    </UiEntity>
  </UiEntity>
}

function TextAction({ id, text, onClick, scale: s, width = 82 }: {
  id: string; text: string; onClick: () => void; scale: number; width?: number
}) {
  return <UiEntity uiTransform={{ width: width * s, height: 36 * s, flexShrink: 0,
    justifyContent: 'center', alignItems: 'center', borderRadius: 6 * s, borderWidth: s, borderColor: line, pointerFilter: 'block' }}
    uiBackground={{ color: hovered === id ? hoverPanel : panel }}
    onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
    onMouseDown={() => { hovered = ''; onClick() }}>
    <Label value={text} color={white} font="sans-serif" fontSize={13 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

function StatusNotice({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  const player = getPlayerCharacterState()
  const rival = getWorldRivalState()
  let message = ''
  let retry: (() => void) | undefined
  if (player.active && player.loading === 'error') {
    message = 'Could not load your character.'
    retry = retryPlayerCharacter
  } else if (player.active && player.loading !== 'ready') {
    message = 'Preparing your character…'
  } else if (rival.visible && rival.phase === 'error') {
    message = 'Could not load the dungeon enemies.'
    retry = retryWorldRival
  } else if (rival.visible && rival.phase === 'defeat') {
    message = `Recovering in ${Math.ceil(rival.respawnSeconds)}s`
  } else if (joining()) {
    message = 'Joining the realm…'
  }
  // Routine combat, telegraphs, approach prompts and respawn counters stay off the HUD.
  if (!message) return null
  const noticeWidth = Math.min(380 * s, width * 0.65)
  return <UiEntity uiTransform={{ positionType: 'absolute',
    position: { left: Math.max(width * 0.28, (width - noticeWidth) / 2), bottom: bottom + 78 * s },
    width: noticeWidth, height: 52 * s, padding: 8 * s, borderRadius: 8 * s,
    flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: panel }}>
    <Label value={message} color={white} font="sans-serif" fontSize={13 * s} textAlign={retry ? 'middle-left' : 'middle-center'} textWrap="nowrap"
      uiTransform={{ width: noticeWidth - (retry ? 102 : 16) * s, height: 36 * s, flexShrink: 0, pointerFilter: 'none' }} />
    {retry && <TextAction id="retry-hud" text="Retry" onClick={retry} scale={s} />}
  </UiEntity>
}

function withAlpha(color: Color4, alpha: number): Color4 {
  return Color4.create(color.r, color.g, color.b, color.a * alpha)
}

/**
 * Weapon pickups, stacked above the action buttons on the right: the icon, the
 * name in its rarity's colour and what it is, or what a duplicate salvaged for.
 * Each card fades out over its last second.
 */
function LootToasts({ right, bottom, scale: s }: { right: number; bottom: number; scale: number }) {
  const toasts = getLootToasts()
  if (!toasts.length) return null
  const cardWidth = 300 * s
  const cardHeight = 54 * s
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { right, bottom: bottom + 60 * s },
    width: cardWidth, flexDirection: 'column-reverse', pointerFilter: 'none' }}>
    {toasts.map((t, i) => {
      const fade = Math.max(0, Math.min(1, (TOAST_SECONDS - t.age) / 0.9))
      const rarity = t.item.weapon ? RARITIES[t.item.weapon.rarity] : undefined
      const rarityColor = rarity ? rarity.color : white
      const subtitle = t.salvaged > 0
        ? `Already owned  ·  salvaged for ${t.salvaged} coins`
        : t.item.weapon ? `${rarity?.label ?? ''}  ·  ${WEAPON_CLASSES[t.item.weapon.class].label}  ·  now in your inventory` : ''
      return <UiEntity key={`${t.item.id}-${i}`} uiTransform={{ width: cardWidth, height: cardHeight, margin: { top: 6 * s },
        padding: 7 * s, borderRadius: 8 * s, borderWidth: s, borderColor: withAlpha(t.salvaged > 0 ? line : rarityColor, fade * 0.9),
        flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: withAlpha(panel, fade) }}>
        <UiEntity uiTransform={{ width: 40 * s, height: 40 * s, borderRadius: 6 * s, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: withAlpha(track, fade), textureMode: 'stretch', texture: { src: t.item.icon } }} />
        <UiEntity uiTransform={{ width: cardWidth - 62 * s, height: 40 * s, margin: { left: 8 * s }, flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
          <Label value={t.item.name} color={withAlpha(t.salvaged > 0 ? muted : rarityColor, fade)} font="sans-serif" fontSize={13.5 * s}
            textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={subtitle} color={withAlpha(muted, fade)} font="sans-serif" fontSize={11 * s}
            textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 17 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
      </UiEntity>
    })}
  </UiEntity>
}

/** The results card's haul: an icon per weapon unlocked, framed in its rarity, and the salvage tally. */
function FoundThisRun({ found, salvaged, width, scale: s }: { found: string[]; salvaged: number; width: number; scale: number }) {
  const items = found.map((id) => getEquipmentItemOrNull(id)).filter((item) => !!item)
  const shown = items.slice(0, 8)
  const more = items.length - shown.length
  const salvageText = salvaged > 0 ? `${salvaged} duplicate${salvaged === 1 ? '' : 's'} salvaged for coin` : ''
  const caption = items.length
    ? `Found this run  ·  ${items.length} new weapon${items.length === 1 ? '' : 's'}${salvageText ? `  ·  ${salvageText}` : ''}`
    : salvageText ? `No new weapons  ·  ${salvageText}` : 'No weapons dropped this run'
  return <UiEntity uiTransform={{ width, margin: { top: 12 * s }, flexDirection: 'column', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={caption} color={items.length ? gold : muted} font="sans-serif" fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
    {shown.length > 0 && <UiEntity uiTransform={{ width: '100%', height: 56 * s, margin: { top: 4 * s }, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {shown.map((item, i) => {
        const color = item.weapon ? RARITIES[item.weapon.rarity].color : line
        return <UiEntity key={`${item.id}-${i}`} uiTransform={{ width: 48 * s, height: 48 * s, margin: { left: 3 * s, right: 3 * s }, padding: 2 * s,
          borderRadius: 6 * s, borderWidth: 1.5 * s, borderColor: color, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: track }}>
          <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: item.icon } }} />
        </UiEntity>
      })}
      {more > 0 && <Label value={`+${more}`} color={muted} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: 40 * s, height: 48 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    </UiEntity>}
  </UiEntity>
}

/** Under the vitals during a run: the fortress, the tally and who is in with us. */
function RunPanel({ right, top, scale: s }: { right: number; top: number; scale: number }) {
  const party = myParty()
  if (!party || party.state !== 'running') return null
  const level = LEVELS[party.level]
  const diff = DIFFICULTIES[party.diff]
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { right, top }, width: 224 * s, flexDirection: 'column', pointerFilter: 'none' }}>
    <Label value={`${level?.name ?? ''}  ·  ${diff?.name ?? ''}`} color={gold} font="sans-serif" fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`Slain ${party.slain} / ${party.total}   ·   ${formatTime(party.time + getLobbyState().silence)}`} color={muted} font="sans-serif" fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    {party.members.length > 1 && party.members.map((m) => <Label key={m} value={`${heroLabel(m)}${m === party.leader ? ' ♛' : ''}`}
      color={white} font="sans-serif" fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 17 * s, flexShrink: 0, pointerFilter: 'none' }} />)}
  </UiEntity>
}

/**
 * The verdict and the decision. The party stands in the fortress it just
 * fought through (loot still on the floor) while the leader picks: down to the
 * next level or back to the hall after a win, again or the hall after a loss.
 * Going deeper needs everyone ready, like starting from the lobby. The host
 * walks an undecided party back on its own when the timer runs out.
 */
function ResultsOverlay({ width, height, scale: s }: { width: number; height: number; scale: number }) {
  const party = myParty()
  const result = getLobbyState().result
  if (!party || party.state !== 'done' || !result) return null
  const level = LEVELS[result.level]
  const diff = DIFFICULTIES[result.diff]
  const next = result.won ? nextLevel(result.level) : undefined
  const me = localAddress()
  const leader = party.leader === me
  const solo = party.members.length === 1
  const readyCount = party.members.filter((m) => party.ready.includes(m)).length
  const othersReady = party.members.every((m) => m === party.leader || party.ready.includes(m))
  const meReady = party.ready.includes(me)
  const wait = resultsWait()
  const cardWidth = Math.min(520 * s, width * 0.7)
  const goText = result.won ? (next ? `Descend to ${next.name}` : 'Fight it again') : 'Try again'
  const go = result.won && next ? descend : retryRun
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - cardWidth) / 2, top: height * 0.1 },
    width: cardWidth, padding: 24 * s, borderRadius: 8 * s, borderWidth: s, borderColor: result.won ? gold : line,
    flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }} uiBackground={{ color: panel }}>
    <Label value={result.won ? 'FORTRESS CLEARED' : 'THE PARTY HAS FALLEN'} font="serif" color={result.won ? gold : red} fontSize={30 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 40 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`${level?.name ?? ''}  ·  ${diff?.name ?? ''}`} color={white} font="sans-serif" fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 26 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={`Time ${formatTime(result.time)}   ·   Slain ${result.slain} / ${result.total}   ·   Coins +${Math.max(0, result.coins)}   ·   XP +${localXp().runGain}`}
      color={muted} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <FoundThisRun found={result.found} salvaged={result.salvaged} width={cardWidth - 48 * s} scale={s} />
    {next && <Label value={`${next.name} is open to you.`} color={gold} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    {result.won && !next && <Label value={`All of ${realmOfLevel(result.level).name} has fallen to you.`} color={gold} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ width: '100%', height: 40 * s, margin: { top: 16 * s }, flexDirection: 'row', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {leader
        ? <MenuAction id="results-go" text={othersReady ? goText : `${goText}  (${readyCount}/${party.members.length} ready)`} onClick={go}
          width={cardWidth / s - 48 - 176} height={40} scale={s} fontSize={14} primary disabled={!othersReady} />
        : <MenuAction id="results-ready" text={meReady ? 'Ready  ✓' : `Ready to go on  (${readyCount}/${party.members.length})`} onClick={() => setReady(!meReady)}
          width={cardWidth / s - 48 - 176} height={40} scale={s} fontSize={14} primary={!meReady} accent="gold" active={meReady} />}
      <UiEntity uiTransform={{ width: 12 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <MenuAction id="results-hall" text={leader ? 'Return to the hall' : 'Leave for the hall'} onClick={leader ? returnToHall : leaveParty}
        width={164} height={40} scale={s} fontSize={14} accent="gold" />
    </UiEntity>
    <Label value={leader
      ? (solo ? `Back to the hall on its own in ${formatTime(wait)}.` : `You lead: the party goes on once everyone is ready. Back to the hall on its own in ${formatTime(wait)}.`)
      : `${heroLabel(party.leader)} decides where the party goes next. Back to the hall in ${formatTime(wait)} at the latest.`}
      color={muted} font="sans-serif" fontSize={11.5 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 20 * s, margin: { top: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

/**
 * In the hall: where the party stands, and, at the war table, the way to the
 * dungeons. Away from the table the hall is just a place to be; the HUD's
 * Dungeons button is always there.
 */
function HubPrompt({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  if (myPhase() !== HUB || getLobbyState().open) return null
  const party = myParty()
  const near = atWarTable()
  if (!party && !near) return null
  const caption = party ? `${partyTitle(party)}  ·  ${party.members.length}/${MAX_PARTY}  ·  ${LEVELS[party.level]?.name ?? ''}`
    : 'The war table: choose a fortress to enter.'
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - 360 * s) / 2, bottom },
    width: 360 * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={caption} color={party ? gold : muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { bottom: 6 * s }, pointerFilter: 'none' }} />
    {(near || party) && <TextAction id="open-lobby" text={party ? 'Party' : 'Dungeons'} onClick={openLobby} scale={s} width={200} />}
  </UiEntity>
}

/** A line over the hall for a few seconds: the welcome, or what the last run changed. */
function HubNotice({ width, top, scale: s }: { width: number; top: number; scale: number }) {
  const { notice, noticeFor, open } = getLobbyState()
  if (!notice || open || myPhase() !== HUB) return null
  const alpha = Math.min(1, noticeFor / 0.6)
  const noticeWidth = Math.min(720 * s, width * 0.8)
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - noticeWidth) / 2, top },
    width: noticeWidth, height: 40 * s, borderRadius: 8 * s, alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
    uiBackground={{ color: Color4.create(panel.r, panel.g, panel.b, panel.a * alpha) }}>
    <Label value={notice} color={Color4.create(gold.r, gold.g, gold.b, alpha)} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

/**
 * The training yard's tally, top centre while the player is working a dummy:
 * the last blow, the string so far and its pace, and the best blow yet.
 */
function TrainingTally({ width, top, scale: s }: { width: number; top: number; scale: number }) {
  if (myPhase() !== HUB || getLobbyState().open || !trainingActive()) return null
  const t = trainingTally()
  // Fade in on the first blow, out over the last second and a half.
  const alpha = Math.min(1, (6 - t.since) / 1.5)
  const boxWidth = Math.min(560 * s, width * 0.7)
  const dim = Color4.create(muted.r, muted.g, muted.b, alpha)
  const bright = Color4.create(white.r, white.g, white.b, alpha)
  const cell = (label: string, value: string, colour = bright) => <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', width: boxWidth / 4, pointerFilter: 'none' }}>
    <Label value={value} color={colour} font="sans-serif" fontSize={22 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 28 * s, pointerFilter: 'none' }} />
    <Label value={label} color={dim} font="sans-serif" fontSize={10 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 14 * s, pointerFilter: 'none' }} />
  </UiEntity>
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - boxWidth) / 2, top },
    width: boxWidth, flexDirection: 'column', alignItems: 'center', padding: { top: 6 * s, bottom: 8 * s }, borderRadius: 8 * s, pointerFilter: 'none' }}
    uiBackground={{ color: Color4.create(panel.r, panel.g, panel.b, panel.a * alpha) }}>
    <Label value="TRAINING YARD" color={Color4.create(gold.r, gold.g, gold.b, alpha)} font="sans-serif" fontSize={10 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 14 * s, margin: { bottom: 2 * s }, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', pointerFilter: 'none' }}>
      {cell('LAST BLOW', `${t.last}`, Color4.create(gold.r, gold.g, gold.b, alpha))}
      {cell(t.hits === 1 ? '1 BLOW' : `${t.hits} BLOWS`, `${t.total}`)}
      {cell('PER SECOND', t.perSecond > 0 ? t.perSecond.toFixed(1) : '—')}
      {cell('BEST BLOW', `${t.best}`)}
    </UiEntity>
  </UiEntity>
}

/** "LEVEL 7": the local hero climbed; what the level brings, then it fades. */
function LevelUpNotice({ width, top, scale: s }: { width: number; top: number; scale: number }) {
  const x = localXp()
  if (!x.levelUp || getLobbyState().open) return null
  const alpha = Math.min(1, x.levelUpFor / 0.4, Math.max(0, (6 - x.levelUpFor) / 1.2))
  const boxWidth = Math.min(420 * s, width * 0.6)
  const cid = getEquippedCharacter().id
  const line = bonusLines(cid).join('   ·   ')
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - boxWidth) / 2, top },
    width: boxWidth, flexDirection: 'column', alignItems: 'center', padding: { top: 8 * s, bottom: 10 * s }, borderRadius: 8 * s, pointerFilter: 'none' }}
    uiBackground={{ color: Color4.create(panel.r, panel.g, panel.b, panel.a * alpha) }}>
    <Label value={`LEVEL ${x.levelUp}${x.levelUp >= MAX_LEVEL ? '  ·  THE SUMMIT' : ''}`} color={Color4.create(gold.r, gold.g, gold.b, alpha)} font="serif" fontSize={26 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 32 * s, pointerFilter: 'none' }} />
    <Label value={`${getEquippedCharacter().name}  ·  ${line}`} color={Color4.create(white.r, white.g, white.b, alpha)} font="sans-serif" fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, pointerFilter: 'none' }} />
  </UiEntity>
}

export function WorldHudUi() {
  const { width, height, scale: s, right, bottom, vitalsTop } = hudLayout()
  const created = getPickerState().hasCreatedCharacter
  const player = getPlayerCharacterState()
  const ready = created && player.active && player.loading === 'ready'
  const inHub = myPhase() === HUB && !getLobbyState().open
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width, height, pointerFilter: 'none' }}>
    {ready && <PlayerVitals right={right} top={vitalsTop} scale={s} />}
    {ready && inRun() && <RunPanel right={right} top={vitalsTop + 100 * s} scale={s} />}
    {ready && <ResultsOverlay width={width} height={height} scale={s} />}
    {ready && <HubPrompt width={width} bottom={bottom} scale={s} />}
    {ready && <HubNotice width={width} top={vitalsTop - 60 * s} scale={s} />}
    {ready && <TrainingTally width={width} top={vitalsTop - 8 * s} scale={s} />}
    {ready && <LevelUpNotice width={width} top={vitalsTop + 60 * s} scale={s} />}
    {ready && <BossBar width={width} scale={s} />}
    {ready && <LootToasts right={right} bottom={bottom} scale={s} />}
    {ready && devToolsOn() && <DungeonDevPanel />}
    {created && <StatusNotice width={width} bottom={bottom} scale={s} />}
    {created && devToolsOn() && <Label value={`${netStatus()} | ${netDebugSummary()}`} color={muted} font="sans-serif" fontSize={10 * s} textAlign="bottom-left" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 12 * s, bottom: 4 * s }, width: width - 140 * s, height: 16 * s, pointerFilter: 'none' }} />}
    {created && showNetLog() && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 12 * s, top: height * 0.32 }, width: 520 * s,
      flexDirection: 'column', padding: 6 * s, pointerFilter: 'none' }} uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}>
      {recentLogs().map((line, i) => <Label key={i} value={line} color={white} font="sans-serif" fontSize={9 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 12 * s, pointerFilter: 'none' }} />)}
    </UiEntity>}
    {created && <UiEntity uiTransform={{ positionType: 'absolute', position: { right, bottom },
      width: (inHub ? 228 : 168) * s, height: 48 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {inHub && <IconButton id="dungeons" label={myParty() ? 'Party' : 'Dungeons'} icon="images/hud/dungeons.png" scale={s} disabled={!ready} onClick={openLobby} />}
      <IconButton id="inventory" label="Inventory" icon="images/hud/inventory.png" scale={s} disabled={!ready} onClick={openInventory} />
      <IconButton id="character" label="Edit character" icon="images/hud/character.png" scale={s} onClick={openPicker} />
      <IconButton id="settings" label="Settings" icon="images/hud/settings.png" scale={s} onClick={openSettings} />
    </UiEntity>}
    {!created && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - 250 * s) / 2, bottom },
      width: 250 * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <Label value="Make a character to begin." color={muted} font="sans-serif" fontSize={13 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 27 * s, margin: { bottom: 8 * s }, pointerFilter: 'none' }} />
      <TextAction id="create-character" text="Create character" onClick={openPicker} scale={s} width={220} />
    </UiEntity>}
  </UiEntity>
}
