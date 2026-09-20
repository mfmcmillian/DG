// The settings sheet: camera choice and the developer panel switch. Same
// dark sheet, gold rule and flat buttons as the lobby.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { menuColors, MenuAction as Action } from './menuUi'
import { CAMERA_OPTIONS, closeSettings, getSettings, setCameraPreference, setDevTools } from './settings'
import { getUnlockedItems, relockAllWeapons, unlockAllWeapons } from './inventory'
import { isDeveloper } from './devAccess'
import { flushHeroSave } from './heroSave'
import { cycleLobbyPickLevel, getLobbyPick } from './party'
import { LEVELS } from './shared/levels'

const { white, muted, gold, panel, card, line, goldLine } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const FRAME = { width: 520, height: 470 }
let hovered = ''

function layout(extra = 0) {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = canvas?.width || 1600
  const screenHeight = canvas?.height || 900
  const inset = canvas?.screenInsetArea
  const left = Math.max(0, inset?.left || 0) + 24
  const right = Math.max(0, inset?.right || 0) + 24
  const top = Math.max(0, inset?.top || 0) + 48
  const bottom = Math.max(0, inset?.bottom || 0) + 24
  const frameHeight = FRAME.height + extra
  const scale = Math.min((screenWidth - left - right) / FRAME.width, (screenHeight - top - bottom) / frameHeight, 1.1)
  const width = FRAME.width * scale
  const height = frameHeight * scale
  return { scale, width, height, x: left + (screenWidth - left - right - width) / 2, y: top + (screenHeight - top - bottom - height) / 2 }
}

function Heading({ title, scale: s }: { title: string; scale: number }) {
  return <Label value={title} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 20 * s, margin: { bottom: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
}

export function SettingsUi() {
  const settings = getSettings()
  // The DEVELOPER heading is ours alone (preview or a listed wallet); its
  // jump and armoury rows only show with the panel switched on.
  const developer = isDeveloper()
  const dev = developer && settings.devTools
  const { scale: s, width, height, x, y } = layout(developer ? (dev ? 100 : 0) : -80)
  const inner = FRAME.width - 80
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}
    uiBackground={{ color: veil }}>
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheet }}>
      <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', pointerFilter: 'none' }}>
          <Label value="KINGDOM OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 300 * s, height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value="Settings" font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 300 * s, height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <Action id="settings-close" text="×" onClick={closeSettings} width={38} height={38} scale={s} fontSize={26} accent="gold" />
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: 18 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />

      <Heading title="CAMERA" scale={s} />
      {CAMERA_OPTIONS.map((option) => {
        const active = settings.camera === option.id
        const key = `camera-${option.id}`
        const hover = hovered === key
        return <UiEntity key={key} uiTransform={{ width: '100%', height: 64 * s, margin: { bottom: 8 * s }, padding: { left: 16 * s, right: 16 * s },
          borderRadius: 4 * s, borderWidth: s, borderColor: active ? gold : hover ? goldLine : line, flexDirection: 'column', justifyContent: 'center',
          flexShrink: 0, pointerFilter: 'block' }}
          uiBackground={{ color: active ? Color4.create(0.16, 0.12, 0.06, 0.96) : hover ? card : panel }}
          onMouseEnter={() => { hovered = key }} onMouseLeave={() => { if (hovered === key) hovered = '' }}
          onMouseDown={() => { hovered = ''; setCameraPreference(option.id) }}>
          <UiEntity uiTransform={{ width: '100%', height: 24 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
            <Label value={option.name} font="serif" color={active ? gold : white} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: (inner - 140) * s, height: '100%', pointerFilter: 'none' }} />
            <Label value={active ? 'Selected' : ''} color={gold} fontSize={11 * s} textAlign="middle-right" textWrap="nowrap"
              uiTransform={{ width: 100 * s, height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
          <Label value={option.blurb} color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
      })}

      {developer && <UiEntity uiTransform={{ width: '100%', height: 20 * s, margin: { top: 10 * s }, flexShrink: 0, pointerFilter: 'none' }}>
        <Heading title="DEVELOPER" scale={s} />
      </UiEntity>}
      {developer && <UiEntity uiTransform={{ width: '100%', height: 44 * s, margin: { top: 6 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <Label value="Dungeon panel: seed, room counts, spawn markers and the native camera." color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (inner - 150) * s, height: '100%', pointerFilter: 'none' }} />
        <Action id="settings-dev" text={settings.devTools ? 'Shown' : 'Hidden'} onClick={() => {
          setDevTools(!getSettings().devTools)
          flushHeroSave()
        }}
          width={136} height={38} scale={s} fontSize={13} accent="gold" active={settings.devTools} />
      </UiEntity>}

      {dev && <UiEntity uiTransform={{ width: '100%', height: 44 * s, margin: { top: 6 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <Label value={`Jump: ${LEVELS[getLobbyPick().level]?.name ?? ''} (does not write clears).`} color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (inner - 200) * s, height: '100%', pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ flexDirection: 'row', pointerFilter: 'none' }}>
          <Action id="settings-level-prev" text="Prev" onClick={() => cycleLobbyPickLevel(-1)} width={72} height={38} scale={s} fontSize={13} accent="gold" />
          <UiEntity uiTransform={{ width: 8 * s, pointerFilter: 'none' }} />
          <Action id="settings-level-next" text="Next" onClick={() => cycleLobbyPickLevel(1)} width={72} height={38} scale={s} fontSize={13} accent="gold" />
        </UiEntity>
      </UiEntity>}

      {dev && <UiEntity uiTransform={{ width: '100%', height: 44 * s, margin: { top: 6 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <Label value={`Armoury: ${getUnlockedItems().length} loot weapon(s) owned.`} color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (inner - 290) * s, height: '100%', pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ flexDirection: 'row', pointerFilter: 'none' }}>
          <Action id="settings-armoury-all" text="Grant all" onClick={unlockAllWeapons} width={136} height={38} scale={s} fontSize={13} accent="gold" />
          <UiEntity uiTransform={{ width: 8 * s, pointerFilter: 'none' }} />
          <Action id="settings-armoury-none" text="Starter only" onClick={relockAllWeapons} width={136} height={38} scale={s} fontSize={13} accent="gold" />
        </UiEntity>
      </UiEntity>}

      <Label value="Saved with your champion." color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 20 * s, margin: { top: 18 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
  </UiEntity>
}
