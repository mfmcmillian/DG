import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport, VIRTUAL_SCREEN, wholeCanvas } from './uiScale'
import { getInventoryState } from './inventory'
import { InventoryUi } from './inventoryUi'
import { getCombatState } from './combat'
import { CombatUi } from './combatUi'
import { WorldHudUi } from './worldHudUi'
import { getMenuLayout } from './menuLayout'
import { menuColors, MenuAction as Action } from './menuUi'
import { PATCH_NOTES } from './patchNotes'
import { kitTexture, UI_KIT } from './uiKit'
import { isSettingsOpen } from './settings'
import { SettingsUi } from './settingsUi'
import { isUpgradePickerOpen, UpgradeUi } from './upgradeUi'
import {
  isPickerFromSave, isSavedHeroReady, isTitleLooking, isTitleOpen, isTitleReady, isTitleResuming,
  pickerBackToTitle, titleBegin, titleContinue, titleResumeSaved
} from './titleScreen'
import { getHeroSaveState, isHeroSaveUnreachable, savedHeroName } from './heroSave'
import { getLobbyState } from './party'
import { LobbyUi } from './lobbyUi'
import { GAME_VERSION } from './version'
import { getPreloadGroup, releasePreload } from './preload'
import { t } from './i18n'
import { LanguageRow } from './languageUi'
import { heroGroupId, preloadCaption, PRELOAD_HUB } from './preloadPlan'
import { BODY_TYPES, HAIR_STYLES, HAIR_COLORS, SKIN_TONES } from './appearance'
import {
  CHARACTERS, getPickerState, getSelectedCharacter,
  getCreatorAppearance, setCreatorAppearance,
  closePicker, selectCharacter, confirmCharacter, rotatePreview,
  setPreviewMotion, toggleAutoRotate
} from './characterPicker'

const { white, muted, gold, card, selectedGold, line, goldLine, coral, ink } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.55)
/** Over the title's backdrop: enough to lift the crest and the lettering off it, no more. */
const titleVeil = Color4.create(0.01, 0.02, 0.03, 0.3)
/** A first champion sees one screen (class, rolled face, Enter); the face and outfit editors sit behind Customise. */
let customising = false
const veilDeep = Color4.create(0.01, 0.02, 0.03, 0.72)
/** The lobby's sheet: every full-screen panel in the game shares it. */
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
let hovered = ''

/** Small gold caps over a section, as in the lobby. */
function Heading({ title, scale: s }: { title: string; scale: number }) {
  return <Label value={title} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 20 * s, margin: { bottom: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
}

/** A lobby-style sheet placed inside the picker frame. */
function Sheet({ left, top, width, height, padding, scale: s, children }: {
  left: number; top: number; width: number; height: number; padding: number; scale: number; children?: ReactEcs.JSX.Element[] | ReactEcs.JSX.Element
}) {
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: left * s, top: top * s }, width: width * s, height: height * s,
    padding: { left: padding * s, right: padding * s, top: 22 * s, bottom: 22 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
    flexDirection: 'column', pointerFilter: 'none' }}
    uiBackground={{ color: sheet }}>
    {children}
  </UiEntity>
}

type AppearanceOption = { id: string; name: string; color?: string }

function optionName(options: readonly AppearanceOption[], selected: string) {
  const name = options.find((option) => option.id === selected)?.name
  return name ? t(name) : t('Choose a style')
}

function swatchColor(hex?: string) {
  const value = (hex || '#FFFFFF').replace('#', '')
  const expanded = value.length === 3 ? value.split('').map((digit) => digit + digit).join('') : value
  return Color4.create(parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255, parseInt(expanded.slice(4, 6), 16) / 255, 1)
}

function FieldHeading({ title, value, scale: s }: { title: string; value?: string; scale: number }) {
  return <UiEntity uiTransform={{ width: '100%', height: 20 * s, margin: { top: 16 * s, bottom: 6 * s },
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
  return <Sheet left={794} top={100} width={486} height={538} padding={24} scale={s}>
    <Heading title={t('APPEARANCE')} scale={s} />
    <Label value={t('Your face')} font="serif" color={white} fontSize={26 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 38 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <FieldHeading title={t('BODY')} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {BODY_TYPES.map((body) => <Action key={body.id} id={`body-${body.id}`} text={t(body.name)} accent="gold"
        width={(438 - (BODY_TYPES.length - 1) * 10) / Math.max(1, BODY_TYPES.length)} height={44} scale={s}
        active={appearance.bodyType === body.id} disabled={disabled} onClick={() => setCreatorAppearance({ bodyType: body.id })} />)}
    </UiEntity>
    <FieldHeading title={t('HAIRSTYLE')} value={`${Math.max(0, hairIndex) + 1} / ${HAIR_STYLES.length}`} scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 48 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="hair-previous" text="‹" width={42} height={42} scale={s} fontSize={26} accent="gold"
        disabled={disabled || HAIR_STYLES.length < 2} onClick={() => cycleHair(-1)} />
      <Label value={optionName(HAIR_STYLES, appearance.hairStyle)} color={white} fontSize={17 * s} textWrap="nowrap"
        uiTransform={{ width: 342 * s, height: 42 * s, pointerFilter: 'none' }} />
      <Action id="hair-next" text="›" width={42} height={42} scale={s} fontSize={26} accent="gold"
        disabled={disabled || HAIR_STYLES.length < 2} onClick={() => cycleHair(1)} />
    </UiEntity>
    <FieldHeading title={t('HAIR COLOR')} value={optionName(HAIR_COLORS, appearance.hairColor)} scale={s} />
    <Swatches id="hair-color" options={HAIR_COLORS} selected={appearance.hairColor} onSelect={(hairColor) => setCreatorAppearance({ hairColor })} scale={s} />
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', display: SKIN_TONES.length ? 'flex' : 'none', flexShrink: 0, pointerFilter: 'none' }}>
      <FieldHeading title={t('SKIN TONE')} value={optionName(SKIN_TONES, appearance.skinTone)} scale={s} />
      <Swatches id="skin-tone" options={SKIN_TONES} selected={appearance.skinTone} onSelect={(skinTone) => setCreatorAppearance({ skinTone })} scale={s} />
    </UiEntity>
  </Sheet>
}

function OutfitPresets({ scale: s }: { scale: number }) {
  const state = getPickerState()
  const first = !state.hasCreatedCharacter
  return <Sheet left={0} top={100} width={234} height={538} padding={18} scale={s}>
    <Heading title={first ? t('CHAMPION') : t('OUTFIT')} scale={s} />
    <Label value={first ? t('Pick one') : t('Starting armor')} font="serif" color={white} fontSize={20 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 34 * s, margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
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
            <Label value={t(entry.role)} color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />
          </UiEntity>
        </UiEntity>
      })}
    </UiEntity>
  </Sheet>
}

/** The right-hand sheet for a first champion: who this is, and the door to the editors. */
function ChampionCard({ scale: s }: { scale: number }) {
  const selected = getSelectedCharacter()
  const disabled = getPickerState().confirming
  return <Sheet left={794} top={100} width={486} height={538} padding={24} scale={s}>
    <Heading title={t('YOUR CHAMPION')} scale={s} />
    <Label value={selected.name} font="serif" color={white} fontSize={30 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 40 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={t(selected.role).toUpperCase()} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={t(selected.description)} color={muted} fontSize={14 * s} textAlign="top-left" textWrap="wrap"
      uiTransform={{ width: '100%', height: 90 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', flexGrow: 1, pointerFilter: 'none' }} />
    <Label value={t('Your face is already picked. Change it if you like, or just go.')} color={muted} fontSize={12 * s} textAlign="middle-left" textWrap="wrap"
      uiTransform={{ width: '100%', height: 36 * s, margin: { bottom: 10 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Action id="customise" text={t('Customise your look')} onClick={() => { customising = true }} width={438} height={44} scale={s} fontSize={15} accent="gold" disabled={disabled} />
  </Sheet>
}

const MOTION_NAMES = { idle: 'Idle', walk: 'Walk', run: 'Run' } as const

function PreviewControls({ scale: s }: { scale: number }) {
  const state = getPickerState()
  const disabled = state.confirming || state.loading !== 'ready'
  const status = state.confirming ? t('Entering the hall…') : state.loading === 'loading' ? t('Updating your look…')
    : state.loading === 'error' ? t('Could not load this look') : ''
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 654 * s }, width: 476 * s,
    flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={status} color={state.loading === 'error' ? coral : muted} fontSize={13 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: 428 * s, height: 38 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="rotate-left" text="↶" onClick={() => rotatePreview(-45)} width={38} height={36} scale={s} fontSize={22} accent="gold" disabled={state.confirming} />
      {(['idle', 'walk', 'run'] as const).map((motion) => <Action key={motion} id={motion} accent="gold"
        text={t(MOTION_NAMES[motion])} onClick={() => setPreviewMotion(motion)}
        width={100} height={36} scale={s} active={state.motion === motion} disabled={disabled} fontSize={14} />)}
      <Action id="rotate-right" text="↷" onClick={() => rotatePreview(45)} width={38} height={36} scale={s} fontSize={22} accent="gold" disabled={state.confirming} />
    </UiEntity>
    <UiEntity uiTransform={{ margin: { top: 8 * s }, pointerFilter: 'none' }}>
      <Action id="spin" text={state.autoRotate ? t('Spin · On') : t('Spin · Off')} onClick={toggleAutoRotate}
        width={120} height={28} scale={s} active={state.autoRotate} disabled={state.confirming} fontSize={12} accent="gold" />
    </UiEntity>
  </UiEntity>
}

/** The crest's drawn size in canvas pixels at scale 1: the plaque from the scene's own thumbnail (the sprite is 768x665). */
const EMBLEM = { width: 460, height: 398 }
/** The Updates panel is up over the title. */
let updatesOpen = false

/**
 * The title fits the whole screen rather than the menu frame: the crest sits in the
 * middle, the one thing to press under it, and the corners hold the rest.
 */
function titleLayout() {
  // Virtual pixels of the UI root (uiScale.ts); the corners keep clear of the explorer's own HUD.
  const { width: screenWidth, height: screenHeight, reserved } = uiViewport()
  // Drawn for the full virtual screen; a phone's shorter screen shrinks the crest and its column to fit.
  const s = Math.max(0.5, Math.min(1, screenWidth / 1600, screenHeight / 900))
  return { s, screenWidth, screenHeight, left: reserved.left, right: reserved.right, top: reserved.top, bottom: reserved.bottom }
}

function TitleScreen() {
  const { s, screenWidth, screenHeight, left, right, top, bottom } = titleLayout()
  const created = getPickerState().hasCreatedCharacter
  const ready = isTitleReady()
  const saved = getHeroSaveState()
  const unreachable = isHeroSaveUnreachable()
  const heroReady = isSavedHeroReady()
  const resuming = isTitleResuming()
  const looking = isTitleLooking()
  // The crest and what stands under it are one column, centred a little above the middle.
  const column = EMBLEM.height * s + 20 * s + 130 * s
  const columnTop = Math.max(top + 12 * s, (screenHeight - column) / 2 - 10 * s)
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={wholeCanvas()} uiBackground={kitTexture(UI_KIT.titleBg)} />
    <UiEntity uiTransform={wholeCanvas()} uiBackground={{ color: titleVeil }} />
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: columnTop }, width: '100%',
      flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: EMBLEM.width * s, height: EMBLEM.height * s, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={kitTexture(UI_KIT.titleEmblem)} />
      <UiEntity uiTransform={{ width: 560 * s, margin: { top: 20 * s }, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        {ready && looking
          // Nothing to press until the wallet has answered: a new champion made now would overwrite the saved one.
          ? <Action id="title-looking" text={t('Looking for your champion…')} onClick={() => undefined} disabled accent="gold"
            width={360} height={60} scale={s} fontSize={18} />
          : ready
          ? <TitleActions created={created} saved={saved.found} unreachable={unreachable} heroReady={heroReady} resuming={resuming} scale={s} />
          : <TitleLoading scale={s} />}
      </UiEntity>
    </UiEntity>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: left + 24 * s, bottom: bottom + 20 * s }, flexDirection: 'column', pointerFilter: 'none' }}>
      <LanguageRow scale={s} />
      <Label value={`v${GAME_VERSION}`} color={gold} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 160 * s, height: 20 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { right: right + 28 * s, bottom: bottom + 28 * s }, pointerFilter: 'none' }}>
      <Action id="title-updates" text={t('Updates')} onClick={() => { updatesOpen = !updatesOpen }} primary accent="green" width={170} height={54} scale={s} fontSize={20} />
    </UiEntity>
    {updatesOpen && <UpdatesPanel scale={s} screenWidth={screenWidth} screenHeight={screenHeight} />}
  </UiEntity>
}

/** What stands under the crest once the hall is in: Play, and whatever the saved champion calls for around it. Another class is chosen in the hall, not here. */
function TitleActions({ created, saved, unreachable, heroReady, resuming, scale: s }: {
  created: boolean; saved: boolean; unreachable: boolean; heroReady: boolean; resuming: boolean; scale: number
}) {
  const savedOnly = saved && !created
  const caption = savedOnly ? t('Continue as {name}', { name: savedHeroName() }) : ''
  const preparing = savedOnly && !heroReady
  const playText = resuming ? t('Entering the hall…')
    : preparing ? preloadCaption(getPreloadGroup(heroGroupId(getHeroSaveState().cid)), t('Preparing'))
    : unreachable && !created ? t('Play offline') : t('Play')
  const play = savedOnly ? titleResumeSaved : created ? titleContinue : titleBegin
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    {unreachable && !created && <UiEntity uiTransform={{ width: 520 * s, flexDirection: 'column', alignItems: 'center', margin: { bottom: 10 * s }, pointerFilter: 'none' }}>
      <Label value={t("Can't reach the server.")} color={coral} fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={t('Your saved champion is safe there. Leave and come back in a moment, or play offline: nothing you do now is kept.')}
        color={muted} fontSize={12 * s} textAlign="top-center"
        uiTransform={{ width: '100%', height: 36 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>}
    {caption && <Label value={caption} color={white} fontSize={15 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    <Action id="title-play" text={playText} onClick={play} disabled={resuming || preparing} primary accent="gold"
      width={preparing || resuming ? 360 : 220} height={64} scale={s} fontSize={preparing || resuming ? 17 : 26} />
    {created && <UiEntity uiTransform={{ margin: { top: 14 * s }, pointerFilter: 'none' }}>
      <Action id="title-enter" text={unreachable ? t('Play offline') : t('New game')} onClick={titleBegin} disabled={resuming} accent="gold" width={200} height={40} scale={s} fontSize={14} />
    </UiEntity>}
  </UiEntity>
}

/** The recent versions and what each changed, on the lobby's sheet over the title. */
function UpdatesPanel({ scale: s, screenWidth, screenHeight }: { scale: number; screenWidth: number; screenHeight: number }) {
  const width = 560
  const height = Math.min(500, Math.max(300, screenHeight / s - 80))
  const shown = PATCH_NOTES.slice(0, 6)
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (screenWidth - width * s) / 2, top: (screenHeight - height * s) / 2 },
    width: width * s, height: height * s, padding: { left: 32 * s, right: 32 * s, top: 22 * s, bottom: 22 * s },
    borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexDirection: 'column', pointerFilter: 'block' }}
    uiBackground={{ color: sheet }}>
    <UiEntity uiTransform={{ width: '100%', height: 38 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t("What's new")} font="serif" color={white} fontSize={26 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 300 * s, height: '100%', pointerFilter: 'none' }} />
      <Action id="updates-close" text="×" onClick={() => { updatesOpen = false }} width={38} height={38} scale={s} fontSize={26} accent="gold" />
    </UiEntity>
    <UiEntity uiTransform={{ width: 160 * s, height: 2 * s, margin: { top: 4 * s, bottom: 14 * s }, flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: gold }} />
    <UiEntity uiTransform={{ width: '100%', flexGrow: 1, flexDirection: 'column', overflow: 'hidden', pointerFilter: 'none' }}>
      {shown.map((entry) => <UiEntity key={`notes-${entry.version}`} uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: 12 * s }, flexShrink: 0, pointerFilter: 'none' }}>
        <Label value={`v${entry.version}`} color={gold} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        {entry.notes.map((note, i) => <Label key={`note-${entry.version}-${i}`} value={`·  ${t(note)}`} color={muted} fontSize={12.5 * s} textAlign="top-left"
          uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />)}
      </UiEntity>)}
    </UiEntity>
  </UiEntity>
}

/** Seconds on the title before "Enter anyway" appears under the bar. */
const ENTER_ANYWAY_SECONDS = 15

function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Shown in the buttons' place until the renderer has the hall cached. */
function TitleLoading({ scale: s }: { scale: number }) {
  const load = getPreloadGroup(PRELOAD_HUB)
  const width = 400
  const fill = Math.max(0.02, Math.min(1, load?.progress ?? 0))
  const pct = Math.round(fill * 100)
  const stalled = load?.stalledOn
  const slow = (load?.elapsed ?? 0) >= ENTER_ANYWAY_SECONDS
  return <UiEntity uiTransform={{ width: width * s, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={preloadCaption(load)} color={muted} fontSize={14 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: width * s, height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: width * s, height: 18 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none',
      padding: 3 * s }}
      uiBackground={{ color: card }}>
      <UiEntity uiTransform={{ width: `${fill * 100}%`, height: '100%', pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
    </UiEntity>
    <UiEntity uiTransform={{ width: width * s, height: 20 * s, margin: { top: 4 * s }, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={stalled ? t('Still waiting on {file}', { file: fileName(stalled) }) : ''} color={coral} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: (width - 60) * s, height: '100%', pointerFilter: 'none' }} />
      <Label value={`${pct}%`} color={gold} fontSize={13 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 60 * s, height: '100%', pointerFilter: 'none' }} />
    </UiEntity>
    {slow && <UiEntity uiTransform={{ margin: { top: 14 * s }, pointerFilter: 'none' }}>
      <Action id="title-enter-anyway" text={t('Enter anyway')} onClick={() => releasePreload(PRELOAD_HUB)} accent="gold"
        width={200} height={40} scale={s} fontSize={14} />
    </UiEntity>}
  </UiEntity>
}

function HallVeil() {
  return <UiEntity uiTransform={wholeCanvas()}>
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
  // Editing an existing champion always shows the editors; a first one opens them on request.
  const editing = state.hasCreatedCharacter || customising
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <HallVeil />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y }, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: 700 * s, flexDirection: 'column', pointerFilter: 'none' }}>
        <Label value="DUNGEONS OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value={state.hasCreatedCharacter ? t('Your champion') : t('Choose your champion')} font="serif" color={white} fontSize={32 * s}
          textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 44 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }}
          uiBackground={{ color: gold }} />
      </UiEntity>
      <UiEntity uiTransform={{ positionType: 'absolute', position: { right: 0, top: 18 * s }, pointerFilter: 'none' }}>
        {state.hasCreatedCharacter && <Action id="close" text="×" onClick={closePicker} width={38} height={38} scale={s} fontSize={26} accent="gold" disabled={state.confirming} />}
        {!state.hasCreatedCharacter && isPickerFromSave() && <Action id="picker-back" text={t('Back')} onClick={pickerBackToTitle} width={90} height={38} scale={s} fontSize={14} accent="gold" disabled={state.confirming} />}
      </UiEntity>
      <OutfitPresets scale={s} />
      {editing && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 654 * s }, width: 234 * s, pointerFilter: 'none' }}>
        <LanguageRow scale={s * 0.82} caption="below" />
      </UiEntity>}
      {editing ? <AppearanceEditor scale={s} /> : <ChampionCard scale={s} />}
      <Label value={selected.name} font="serif" color={white} fontSize={26 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 84 * s }, width: 476 * s, height: 36 * s, pointerFilter: 'none' }} />
      <Label value={t(selected.role).toUpperCase()} color={gold} fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ positionType: 'absolute', position: { left: 254 * s, top: 122 * s }, width: 476 * s, height: 18 * s, pointerFilter: 'none' }} />
      {editing && <PreviewControls scale={s} />}
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 794 * s, top: 650 * s }, width: 486 * s,
        flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
        <Label value={state.confirmationError ? t(state.confirmationError) : t('Gear can be changed after you enter.')} color={state.confirmationError ? coral : muted}
          fontSize={13 * s} uiTransform={{ width: '100%', height: 28 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
        <Action id="confirm"
          text={state.confirming ? t('Entering the hall…') : state.confirmationError ? t('Try again')
            : state.loading === 'error' ? t('Retry this look') : state.hasCreatedCharacter ? t('Save champion') : t('Enter the hall')}
          onClick={state.loading === 'error' ? () => selectCharacter(selected.id) : () => { customising = false; confirmCharacter() }}
          width={438} height={52} scale={s} fontSize={18} primary accent="gold"
          disabled={state.confirming || state.loading === 'loading'} />
      </UiEntity>
    </UiEntity>
  </UiEntity>
}

export function setupCharacterPickerUi() {
  ReactEcsRenderer.setUiRenderer(
    () => getCombatState().open ? <CombatUi /> : getInventoryState().open ? <InventoryUi />
      : isTitleOpen() ? <TitleScreen /> : getPickerState().open ? <Picker />
        : isSettingsOpen() ? <SettingsUi /> : getLobbyState().open ? <LobbyUi /> : isUpgradePickerOpen() ? <UpgradeUi /> : <WorldHudUi />,
    // Every layout is drawn in virtual pixels of one screen (uiScale.ts); the SDK
    // scales it to the canvas and keeps the root inside the device's safe margins.
    { virtualWidth: VIRTUAL_SCREEN.width, virtualHeight: VIRTUAL_SCREEN.height, screenInset: 'device' }
  )
}
