import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { getInventoryState } from './inventory'
import { InventoryUi } from './inventoryUi'
import { getCombatState } from './combat'
import { CombatUi } from './combatUi'
import { WorldHudUi } from './worldHudUi'
import { getMenuLayout } from './menuLayout'
import { menuColors, MenuAction as Action, KitButton } from './menuUi'
import { kitTexture, UI_KIT } from './uiKit'
import { isTitleOpen, isTitleReady, titleBegin, titleContinue } from './titleScreen'
import { getPreloadState } from './preload'
import { BODY_TYPES, HAIR_STYLES, HAIR_COLORS, SKIN_TONES } from './appearance'
import {
  CHARACTERS, getPickerState, getSelectedCharacter,
  getCreatorAppearance, setCreatorAppearance,
  closePicker, selectCharacter, confirmCharacter, rotatePreview,
  setPreviewMotion, toggleAutoRotate
} from './characterPicker'

const { white, muted, gold, panel, card, selectedGold, line, goldLine, coral, ink } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.55)
const veilDeep = Color4.create(0.01, 0.02, 0.03, 0.72)
let hovered = ''

type AppearanceOption = { id: string; name: string; color?: string }

function optionName(options: readonly AppearanceOption[], selected: string) {
  return options.find((option) => option.id === selected)?.name || 'Choose a style'
}

function swatchColor(hex?: string) {
  const value = (hex || '#FFFFFF').replace('#', '')
  const expanded = value.length === 3 ? value.split('').map((digit) => digit + digit).join('') : value
  return Color4.create(parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255, parseInt(expanded.slice(4, 6), 16) / 255, 1)
}

function FieldHeading({ title, value, scale: s }: { title: string; value?: string; scale: number }) {
  return <UiEntity uiTransform={{ width: '100%', height: 22 * s, margin: { top: 18 * s, bottom: 6 * s },
    flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={title} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: 148 * s, height: '100%', pointerFilter: 'none' }} />
    <Label value={value || ''} color={muted} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: 270 * s, height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

function Swatches({ id, options, selected, onSelect, scale: s }: {
  id: string; options: readonly AppearanceOption[]; selected: string; onSelect: (value: string) => void; scale: number
}) {
  const size = Math.min(40, 438 / Math.max(1, options.length) - 10)
  const disabled = getPickerState().confirming
  return <UiEntity uiTransform={{ width: 438 * s, height: 44 * s, flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
    {options.map((option) => {
      const active = selected === option.id
      const key = `${id}-${option.id}`
      return <UiEntity key={key} uiTransform={{ width: size * s, height: size * s, minWidth: size * s, flexShrink: 0,
        margin: { right: 10 * s }, padding: 3 * s, borderRadius: size * s / 2, borderWidth: (active ? 2 : 1) * s,
        borderColor: active ? gold : hovered === key ? goldLine : line, opacity: disabled ? 0.45 : 1, pointerFilter: 'block' }}
        uiBackground={{ color: card }} onMouseEnter={() => { hovered = key }}
        onMouseLeave={() => { if (hovered === key) hovered = '' }} onMouseDown={disabled ? undefined : () => onSelect(option.id)}>
        <UiEntity uiTransform={{ width: '100%', height: '100%', borderRadius: size * s / 2, pointerFilter: 'none' }}
          uiBackground={{ color: swatchColor(option.color) }} />
      </UiEntity>
    })}
  </UiEntity>
}

function cycleHair(direction: number) {
  if (HAIR_STYLES.length === 0) return
  const current = HAIR_STYLES.findIndex((style) => style.id === getCreatorAppearance().hairStyle)
  const next = (Math.max(0, current) + direction + HAIR_STYLES.length) % HAIR_STYLES.length
  setCreatorAppearance({ hairStyle: HAIR_STYLES[next].id })
}

function AppearanceEditor({ scale: s }: { scale: number }) {
  const appearance = getCreatorAppearance()
  const disabled = getPickerState().confirming
  const hairIndex = HAIR_STYLES.findIndex((style) => style.id === appearance.hairStyle)
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 794 * s, top: 100 * s }, width: 486 * s, height: 538 * s,
    padding: { left: 36 * s, right: 36 * s, top: 36 * s }, flexDirection: 'column', pointerFilter: 'none' }}
    uiBackground={{ color: panel }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
      uiBackground={kitTexture(UI_KIT.panelMedium)} />
    <Label value="APPEARANCE" color={gold} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value="Your face" font="serif" color={white} fontSize={28 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 38 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <FieldHeading title="BODY" scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {BODY_TYPES.map((body) => <Action key={body.id} id={`body-${body.id}`} text={body.name} accent="gold"
        width={(438 - (BODY_TYPES.length - 1) * 10) / Math.max(1, BODY_TYPES.length)} height={44} scale={s}
        active={appearance.bodyType === body.id} disabled={disabled} onClick={() => setCreatorAppearance({ bodyType: body.id })} />)}
    </UiEntity>
    <FieldHeading title="HAIRSTYLE" value={`${Math.max(0, hairIndex) + 1} / ${HAIR_STYLES.length}`} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 48 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="hair-previous" text="‹" width={42} height={42} scale={s} fontSize={26} accent="gold"
        disabled={disabled || HAIR_STYLES.length < 2} onClick={() => cycleHair(-1)} />
      <Label value={optionName(HAIR_STYLES, appearance.hairStyle)} color={white} fontSize={17 * s} textWrap="nowrap"
        uiTransform={{ width: 342 * s, height: 42 * s, pointerFilter: 'none' }} />
      <Action id="hair-next" text="›" width={42} height={42} scale={s} fontSize={26} accent="gold"
        disabled={disabled || HAIR_STYLES.length < 2} onClick={() => cycleHair(1)} />
    </UiEntity>
    <FieldHeading title="HAIR COLOR" value={optionName(HAIR_COLORS, appearance.hairColor)} scale={s} />
    <Swatches id="hair-color" options={HAIR_COLORS} selected={appearance.hairColor} onSelect={(hairColor) => setCreatorAppearance({ hairColor })} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', display: SKIN_TONES.length ? 'flex' : 'none', flexShrink: 0, pointerFilter: 'none' }}>
      <FieldHeading title="SKIN TONE" value={optionName(SKIN_TONES, appearance.skinTone)} scale={s} />
      <Swatches id="skin-tone" options={SKIN_TONES} selected={appearance.skinTone} onSelect={(skinTone) => setCreatorAppearance({ skinTone })} scale={s} />
    </UiEntity>
  </UiEntity>
}

function OutfitPresets({ scale: s }: { scale: number }) {
  const state = getPickerState()
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 100 * s }, width: 234 * s, height: 538 * s,
    padding: { left: 18 * s, right: 18 * s, top: 28 * s }, flexDirection: 'column', pointerFilter: 'none' }}
    uiBackground={{ color: panel }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
      uiBackground={kitTexture(UI_KIT.panelMedium)} />
    <Label value="OUTFIT" color={gold} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value="Starting armor" font="serif" color={white} fontSize={22 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 32 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {CHARACTERS.map((entry) => {
        const active = entry.id === state.selectedId
        const key = `outfit-${entry.id}`
        return <UiEntity key={key} uiTransform={{ width: 96 * s, height: 168 * s, margin: { bottom: 10 * s }, flexShrink: 0,
          borderRadius: 5 * s, borderWidth: (active ? 2 : 1) * s, borderColor: active ? gold : hovered === key ? goldLine : line,
          overflow: 'hidden', opacity: state.confirming ? 0.5 : 1, pointerFilter: 'block' }}
          uiBackground={{ color: active ? selectedGold : card }}
          onMouseEnter={() => { hovered = key }} onMouseLeave={() => { if (hovered === key) hovered = '' }}
          onMouseDown={state.confirming ? undefined : () => selectCharacter(entry.id)}>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 8 * s, left: 3 * s }, width: 90 * s, height: 96 * s, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: entry.portrait } }} />
          <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 0, left: 0 }, width: '100%', height: 52 * s,
            padding: { left: 8 * s, top: 6 * s }, flexDirection: 'column', pointerFilter: 'none' }} uiBackground={{ color: ink }}>
            <Label value={entry.name} color={active ? gold : white} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
            <Label value={entry.role} color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />
          </UiEntity>
        </UiEntity>
      })}
    </UiEntity>
  </UiEntity>
}

function PreviewControls({ scale: s }: { scale: number }) {
  const state = getPickerState()
  const disabled = state.confirming || state.loading !== 'ready'
  const status = state.confirming ? 'Entering the dungeon…' : state.loading === 'loading' ? 'Updating your look…'
    : state.loading === 'error' ? 'Could not load this look' : ''
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 654 * s }, width: 476 * s,
    flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={status} color={state.loading === 'error' ? coral : muted} fontSize={13 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: 428 * s, height: 38 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="rotate-left" text="↶" onClick={() => rotatePreview(-45)} width={38} height={36} scale={s} fontSize={22} accent="gold" disabled={state.confirming} />
      {(['idle', 'walk', 'run'] as const).map((motion) => <Action key={motion} id={motion} accent="gold"
        text={motion[0].toUpperCase() + motion.slice(1)} onClick={() => setPreviewMotion(motion)}
        width={100} height={36} scale={s} active={state.motion === motion} disabled={disabled} fontSize={14} />)}
      <Action id="rotate-right" text="↷" onClick={() => rotatePreview(45)} width={38} height={36} scale={s} fontSize={22} accent="gold" disabled={state.confirming} />
    </UiEntity>
    <UiEntity uiTransform={{ margin: { top: 8 * s }, pointerFilter: 'none' }}>
      <Action id="spin" text={state.autoRotate ? 'Spin · On' : 'Spin · Off'} onClick={toggleAutoRotate}
        width={120} height={28} scale={s} active={state.autoRotate} disabled={state.confirming} fontSize={12} accent="gold" />
    </UiEntity>
  </UiEntity>
}

function TitleScreen() {
  const { scale: s, x, screenHeight } = getMenuLayout('picker')
  const created = getPickerState().hasCreatedCharacter
  const ready = isTitleReady()
  const top = Math.max(80, screenHeight * 0.18)
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}
    uiBackground={kitTexture(UI_KIT.titleBg)}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: x, top }, width: 520 * s,
      flexDirection: 'column', alignItems: 'flex-start', pointerFilter: 'none' }}>
      <Label value="KINGDOM OF ANTROM" color={gold} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 480 * s, height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value="The Dungeon" font="serif" color={white} fontSize={56 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 520 * s, height: 70 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ width: 200 * s, height: 28 * s, margin: { top: 4 * s, bottom: 36 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={kitTexture(UI_KIT.flourish)} />
      {ready
        ? <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'flex-start', pointerFilter: 'none' }}>
          <KitButton id="title-enter" text="New game" onClick={titleBegin}
            width={400} height={76} scale={s} fontSize={20} variant="banner" />
          {created && <UiEntity uiTransform={{ margin: { top: 12 * s }, pointerFilter: 'none' }}>
            <KitButton id="title-continue" text="Continue" onClick={titleContinue}
              width={400} height={76} scale={s} fontSize={20} variant="banner" />
          </UiEntity>}
        </UiEntity>
        : <TitleLoading scale={s} />}
    </UiEntity>
  </UiEntity>
}

/** Shown in the buttons' place until the renderer has the dungeon's assets cached. */
function TitleLoading({ scale: s }: { scale: number }) {
  const load = getPreloadState()
  const width = 400
  const fill = Math.max(0.02, Math.min(1, load.progress))
  const pct = Math.round(fill * 100)
  const caption = load.total ? `Preparing the fortress\u2026 ${load.done} / ${load.total}` : 'Preparing the fortress\u2026'
  return <UiEntity uiTransform={{ width: width * s, flexDirection: 'column', alignItems: 'flex-start', pointerFilter: 'none' }}>
    <Label value={caption} color={muted} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: width * s, height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: width * s, height: 18 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none',
      padding: 3 * s }}
      uiBackground={{ color: card }}>
      <UiEntity uiTransform={{ width: `${fill * 100}%`, height: '100%', pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
    </UiEntity>
    <Label value={`${pct}%`} color={gold} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: width * s, height: 20 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

function HallVeil() {
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '22%', height: '100%', pointerFilter: 'none' }}
      uiBackground={{ color: veilDeep }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 0, top: 0 }, width: '22%', height: '100%', pointerFilter: 'none' }}
      uiBackground={{ color: veilDeep }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '16%', pointerFilter: 'none' }}
      uiBackground={{ color: veil }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, bottom: 0 }, width: '100%', height: '14%', pointerFilter: 'none' }}
      uiBackground={{ color: veil }} />
  </UiEntity>
}

function Picker() {
  const { scale: s, x, y, width, height } = getMenuLayout('picker')
  const state = getPickerState()
  const selected = getSelectedCharacter()
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <HallVeil />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y }, pointerFilter: 'none' }}>
      <Label value="KINGDOM OF ANTROM" color={gold} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 0, top: 2 * s }, width: 420 * s, height: 20 * s, pointerFilter: 'none' }} />
      <Label value={state.hasCreatedCharacter ? 'Your champion' : 'Choose your champion'} font="serif" color={white} fontSize={34 * s}
        textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 0, top: 22 * s }, width: 1100 * s, height: 46 * s, pointerFilter: 'none' }} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 76 * s }, width: 220 * s, height: 2 * s, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 0, top: 18 * s }, pointerFilter: 'none' }}>
        <Action id="close" text="×" onClick={closePicker} width={42} height={42} scale={s} fontSize={28} accent="gold" disabled={state.confirming} />
      </UiEntity>
      <OutfitPresets scale={s} />
      <AppearanceEditor scale={s} />
      <Label value={selected.name} font="serif" color={white} fontSize={26 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 88 * s }, width: 476 * s, height: 32 * s, pointerFilter: 'none' }} />
      <Label value={selected.role.toUpperCase()} color={gold} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 118 * s }, width: 476 * s, height: 18 * s, pointerFilter: 'none' }} />
      <PreviewControls scale={s} />
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 794 * s, top: 650 * s }, width: 486 * s,
        flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <Label value={state.confirmationError || 'Gear can be changed after you enter.'} color={state.confirmationError ? coral : muted}
          fontSize={13 * s} uiTransform={{ width: '100%', height: 28 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
        <KitButton id="confirm"
          text={state.confirming ? 'Entering dungeon…' : state.confirmationError ? 'Try again'
            : state.loading === 'error' ? 'Retry this look' : state.hasCreatedCharacter ? 'Save champion' : 'Enter the dungeon'}
          onClick={state.loading === 'error' ? () => selectCharacter(selected.id) : confirmCharacter}
          width={438} height={64} scale={s} fontSize={18}
          disabled={state.confirming || state.loading === 'loading'} />
      </UiEntity>
    </UiEntity>
  </UiEntity>
}

export function setupCharacterPickerUi() {
  ReactEcsRenderer.setUiRenderer(
    () => getCombatState().open ? <CombatUi /> : getInventoryState().open ? <InventoryUi />
      : isTitleOpen() ? <TitleScreen /> : getPickerState().open ? <Picker /> : <WorldHudUi />,
    // Every scene UI already uses canvas-pixel layouts. Disable the SDK's second
    // virtual-screen scale and apply native/device insets once in those layouts.
    { virtualWidth: 0, virtualHeight: 0, screenInset: 'none' }
  )
}
