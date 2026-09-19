import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getEquippedCharacter, getPickerState, openPicker } from './characterPicker'
import { openInventory } from './inventory'
import { getPlayerCharacterState, getPlayerVitals, retryPlayerCharacter } from './playerCharacter'
import { getWorldRivalState, retryWorldRival } from './dungeonEnemies'
import { getLootState } from './loot'
import { isClientSynced, isSoloMode, localAddress, netStatus } from './multiplayer'
import { netDebugSummary, recentLogs } from './netDebug'
import { MenuAction } from './menuUi'
import {
  descend, getLobbyState, inRun, leaveParty, myParty, myPhase, openLobby, resultsWait, retryRun, returnToHall, setReady
} from './party'
import { HUB } from './partyLookup'
import { getSettings, openSettings } from './settings'
import { playerDisplayName } from './heroNameTag'
import { formatTime, heroLabel, partyTitle } from './lobbyUi'
import { DIFFICULTIES, LEVELS, MAX_PARTY, nextLevel } from './shared/levels'

/** The handshake log is for the wait; once the fight runs (server or solo) it goes. */
function showNetLog() {
  return !isSoloMode() && !isClientSynced()
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

type IconButtonProps = {
  id: string; label: string; icon: string; onClick: () => void; scale: number; disabled?: boolean
}

function IconButton({ id, label, icon, onClick, scale: s, disabled = false }: IconButtonProps) {
  const hover = hovered === id
  return <UiEntity uiTransform={{ width: 48 * s, height: 48 * s, flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: 8 * s,
      borderWidth: s, borderColor: hover && !disabled ? white : line,
      justifyContent: 'center', alignItems: 'center', opacity: disabled ? 0.4 : 1, pointerFilter: 'block' }}
      uiBackground={{ color: hover && !disabled ? hoverPanel : panel }}
      onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
      onMouseDown={disabled ? undefined : () => { hovered = ''; onClick() }}>
      <UiEntity uiTransform={{ width: 26 * s, height: 26 * s, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: icon } }} />
    </UiEntity>
    {hover && <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 0, bottom: 57 * s },
      width: 142 * s, height: 30 * s, borderRadius: 5 * s, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
      <Label value={label} color={white} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>}
  </UiEntity>
}

/** "Ada · Vanguard": the display name (no tag over our own head) with the class dimmed after it. */
function heroTitle(): string {
  const name = playerDisplayName(localAddress())
  const cls = getEquippedCharacter().name
  return name ? `${name}  <color=#a3b3c2>·  ${cls}</color>` : cls
}

function PlayerVitals({ right, top, scale: s }: { right: number; top: number; scale: number }) {
  const state = getWorldRivalState()
  if (!state.visible) return null
  const vitals = getPlayerVitals()
  const maximum = Math.max(1, vitals.maxHealth)
  const health = Math.max(0, Math.min(maximum, vitals.health))
  const staminaRatio = Math.max(0, Math.min(1, vitals.stamina / vitals.maxStamina))
  const coins = getLootState().coins
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { right, top },
    width: 224 * s, height: 96 * s, flexDirection: 'column', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 24 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={state.party > 1 ? `◆ ${coins}  ·  ${state.party}` : `◆ ${coins}`} color={gold} font="sans-serif" fontSize={13 * s}
        textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 56 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={heroTitle()} color={white} font="sans-serif" fontSize={15 * s}
        textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 168 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
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
    <Label value={`Time ${formatTime(result.time)}   ·   Slain ${result.slain} / ${result.total}   ·   Coins +${Math.max(0, result.coins)}`}
      color={muted} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {next && <Label value={`${next.name} is open to you.`} color={gold} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    {result.won && !next && <Label value="Every fortress has fallen to you." color={gold} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
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

/** In the hall: the way to the dungeons, and where the party stands. */
function HubPrompt({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  if (myPhase() !== HUB || getLobbyState().open) return null
  const party = myParty()
  const caption = party ? `${partyTitle(party)}  ·  ${party.members.length}/${MAX_PARTY}  ·  ${LEVELS[party.level]?.name ?? ''}`
    : 'Choose a fortress to enter.'
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - 300 * s) / 2, bottom },
    width: 300 * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={caption} color={party ? gold : muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { bottom: 6 * s }, pointerFilter: 'none' }} />
    <TextAction id="open-lobby" text={party ? 'Party' : 'Dungeons'} onClick={openLobby} scale={s} width={200} />
  </UiEntity>
}

export function WorldHudUi() {
  const { width, height, scale: s, right, bottom, vitalsTop } = hudLayout()
  const created = getPickerState().hasCreatedCharacter
  const player = getPlayerCharacterState()
  const ready = created && player.active && player.loading === 'ready'
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width, height, pointerFilter: 'none' }}>
    {ready && <PlayerVitals right={right} top={vitalsTop} scale={s} />}
    {ready && inRun() && <RunPanel right={right} top={vitalsTop + 100 * s} scale={s} />}
    {ready && <ResultsOverlay width={width} height={height} scale={s} />}
    {ready && <HubPrompt width={width} bottom={bottom} scale={s} />}
    {ready && <BossBar width={width} scale={s} />}
    {ready && getSettings().devTools && <DungeonDevPanel />}
    {created && <StatusNotice width={width} bottom={bottom} scale={s} />}
    {created && <Label value={`${netStatus()} | ${netDebugSummary()}`} color={muted} font="sans-serif" fontSize={10 * s} textAlign="bottom-left" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 12 * s, bottom: 4 * s }, width: width - 140 * s, height: 16 * s, pointerFilter: 'none' }} />}
    {created && showNetLog() && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 12 * s, top: height * 0.32 }, width: 520 * s,
      flexDirection: 'column', padding: 6 * s, pointerFilter: 'none' }} uiBackground={{ color: Color4.create(0, 0, 0, 0.55) }}>
      {recentLogs().map((line, i) => <Label key={i} value={line} color={white} font="sans-serif" fontSize={9 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 12 * s, pointerFilter: 'none' }} />)}
    </UiEntity>}
    {created && <UiEntity uiTransform={{ positionType: 'absolute', position: { right, bottom },
      width: 168 * s, height: 48 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
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
