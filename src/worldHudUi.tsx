import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getEquippedCharacter, getPickerState, openPicker } from './characterPicker'
import { openInventory } from './inventory'
import { getPlayerCharacterState, getPlayerVitals, retryPlayerCharacter } from './playerCharacter'
import { getWorldRivalState, retryWorldRival } from './dungeonEnemies'
import { getLootState } from './loot'
import { netStatus } from './multiplayer'
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
  // The expanded desktop chat occupies the lower left, not just the chat entry.
  // Short viewports use the free top-center area instead of squeezing above it.
  const compact = height < 600 || width < 900
  const vitalsLeft = compact ? Math.max(width * 0.32, (width - 224 * scale) / 2) : left
  const vitalsTop = Math.max(0, inset?.top || 0) + (compact ? 118 : Math.max(132, height * 0.155))
  return { width, height, scale, right, bottom, vitalsLeft, vitalsTop }
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

function PlayerVitals({ left, top, scale: s }: { left: number; top: number; scale: number }) {
  const state = getWorldRivalState()
  if (!state.visible) return null
  const vitals = getPlayerVitals()
  const maximum = Math.max(1, vitals.maxHealth)
  const health = Math.max(0, Math.min(maximum, vitals.health))
  const staminaRatio = Math.max(0, Math.min(1, vitals.stamina / vitals.maxStamina))
  const coins = getLootState().coins
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left, top },
    width: 224 * s, height: 96 * s, flexDirection: 'column', pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 24 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={getEquippedCharacter().name} color={white} font="sans-serif" fontSize={15 * s}
        textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 150 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={state.party > 1 ? `◆ ${coins}  ·  ${state.party}` : `◆ ${coins}`} color={gold} font="sans-serif" fontSize={13 * s}
        textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 74 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', height: 18 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 17 * s, height: 17 * s, margin: { right: 9 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ textureMode: 'stretch', texture: { src: 'images/hud/heart.png' } }} />
      <UiEntity uiTransform={{ width: 184 * s, height: 8 * s, padding: s, borderRadius: 2 * s, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: track }}>
        <UiEntity uiTransform={{ width: `${health / maximum * 100}%`, height: '100%', pointerFilter: 'none' }} uiBackground={{ color: red }} />
      </UiEntity>
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', height: 14 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, margin: { top: 4 * s }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: 17 * s, height: 17 * s, margin: { right: 9 * s }, flexShrink: 0, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ width: 184 * s, height: 5 * s, padding: s, borderRadius: 2 * s, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: track }}>
        <UiEntity uiTransform={{ width: `${staminaRatio * 100}%`, height: '100%', pointerFilter: 'none' }}
          uiBackground={{ color: vitals.exhausted || staminaRatio < 0.3 ? staminaLow : stamina }} />
      </UiEntity>
    </UiEntity>
    <UiEntity uiTransform={{ width: '100%', height: 20 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={`${Math.ceil(health)} / ${maximum}`} color={muted} font="sans-serif" fontSize={12 * s}
        textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 120 * s, height: 20 * s, margin: { left: 26 * s }, flexShrink: 0, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ width: 60 * s, height: 20 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'none' }}>
        {[0, 1, 2].map((i) => <UiEntity key={`combo-${i}`} uiTransform={{ width: 9 * s, height: 9 * s, margin: { left: 4 * s }, borderRadius: 5 * s, pointerFilter: 'none' }}
          uiBackground={{ color: i < vitals.comboStep ? gold : track }} />)}
      </UiEntity>
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

export function WorldHudUi() {
  const { width, height, scale: s, right, bottom, vitalsLeft, vitalsTop } = hudLayout()
  const created = getPickerState().hasCreatedCharacter
  const player = getPlayerCharacterState()
  const ready = created && player.active && player.loading === 'ready'
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width, height, pointerFilter: 'none' }}>
    {ready && <PlayerVitals left={vitalsLeft} top={vitalsTop} scale={s} />}
    {ready && <BossBar width={width} scale={s} />}
    {ready && <DungeonDevPanel />}
    {created && <StatusNotice width={width} bottom={bottom} scale={s} />}
    {created && <Label value={netStatus()} color={muted} font="sans-serif" fontSize={10 * s} textAlign="bottom-left" textWrap="nowrap"
      uiTransform={{ positionType: 'absolute', position: { left: 12 * s, bottom: 4 * s }, width: width - 140 * s, height: 16 * s, pointerFilter: 'none' }} />}
    {created && <UiEntity uiTransform={{ positionType: 'absolute', position: { right, bottom },
      width: 108 * s, height: 48 * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
      <IconButton id="inventory" label="Inventory" icon="images/hud/inventory.png" scale={s} disabled={!ready} onClick={openInventory} />
      <IconButton id="character" label="Edit character" icon="images/hud/character.png" scale={s} onClick={openPicker} />
    </UiEntity>}
    {!created && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - 250 * s) / 2, bottom },
      width: 250 * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <Label value="Make a character to begin." color={muted} font="sans-serif" fontSize={13 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 27 * s, margin: { bottom: 8 * s }, pointerFilter: 'none' }} />
      <TextAction id="create-character" text="Create character" onClick={openPicker} scale={s} width={220} />
    </UiEntity>}
  </UiEntity>
}
