import ReactEcs, { Button, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  CameraChoice,
  crawlerCameraAvailable,
  getDungeonState,
  returnToEntrance,
  setCameraChoice,
  toggleSpawnMarkers
} from './index'

const CAMERAS: Array<{ id: CameraChoice; label: string; hint: string; openOnly: boolean }> = [
  { id: 'native', label: 'Native cam', hint: 'Explorer camera, player can zoom', openOnly: false },
  { id: 'shoulder', label: 'Shoulder cam', hint: 'Fixed 3.2 m boom, smooth de-occlusion', openOnly: false },
  { id: 'crawler', label: 'Crawler cam', hint: 'Top-down follow, camera-facing walls drop', openOnly: true }
]

const PANEL = Color4.create(0.05, 0.05, 0.07, 0.82)
const TEXT = Color4.create(0.92, 0.9, 0.86, 1)
const MUTED = Color4.create(0.7, 0.68, 0.64, 1)

/** The dev panel is hidden by default; a small button in the corner brings it back. */
let panelOpen = false

/** Mount inside the scene's world HUD; it does not own the UI renderer. */
export function DungeonDevPanel() {
  if (!panelOpen) {
    return (
      <UiEntity uiTransform={{ position: { top: 200, right: 24 }, positionType: 'absolute' }}>
        <Button
          value="dev"
          fontSize={11}
          variant="secondary"
          uiTransform={{ width: 44, height: 22 }}
          uiBackground={{ color: Color4.create(0.05, 0.05, 0.07, 0.35) }}
          onMouseDown={() => (panelOpen = true)}
        />
      </UiEntity>
    )
  }
  return <DevPanel />
}

function DevPanel() {
  const state = getDungeonState()
  const d = state.dungeon
  const s = state.instance?.stats
  const kinds = d ? d.rooms.reduce<Record<string, number>>((m, r) => ((m[r.kind] = (m[r.kind] ?? 0) + 1), m), {}) : {}
  const enemies = state.instance?.spawns.filter((sp) => !sp.boss).length ?? 0
  return (
    <UiEntity
      uiTransform={{
        position: { top: 200, right: 24 },
        positionType: 'absolute',
        width: 320,
        padding: 12,
        flexDirection: 'column'
      }}
      uiBackground={{ color: PANEL }}
    >
      <UiEntity uiTransform={{ flexDirection: 'row', justifyContent: 'space-between', height: 26 }}>
        <Label value="Dungeon" fontSize={18} color={TEXT} uiTransform={{ height: 26 }} textAlign="middle-left" />
        <Button
          value="hide"
          fontSize={11}
          variant="secondary"
          uiTransform={{ width: 44, height: 22 }}
          onMouseDown={() => (panelOpen = false)}
        />
      </UiEntity>
      <Label value={`Seed ${state.seed} · ${state.style.label}`} fontSize={13} color={MUTED} uiTransform={{ height: 20 }} textAlign="middle-left" />
      {d && (
        <Label
          value={`${d.rooms.length} rooms · boss ${d.boss.depth} rooms deep · ${d.doors.length} doorways`}
          fontSize={13}
          color={TEXT}
          uiTransform={{ height: 20 }}
          textAlign="middle-left"
        />
      )}
      {d && (
        <Label
          value={`${kinds.combat ?? 0} combat · ${kinds.treasure ?? 0} treasure · ${kinds.quiet ?? 0} quiet · ${enemies} enemy spawns`}
          fontSize={13}
          color={MUTED}
          uiTransform={{ height: 20 }}
          textAlign="middle-left"
        />
      )}
      {s && (
        <Label
          value={`${s.entities} entities · ~${Math.round(s.triangles / 1000)}K tris · ${s.walls} wall modules`}
          fontSize={12}
          color={MUTED}
          uiTransform={{ height: 20 }}
          textAlign="middle-left"
        />
      )}
      {/* The layout is the party's level: no local reseed or style switch, which would
          desync this client from the run its server simulates. */}
      <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 8 } }}>
        <Button
          value="To entrance"
          fontSize={12}
          variant="secondary"
          uiTransform={{ width: 96, height: 28, margin: { right: 6 } }}
          onMouseDown={() => returnToEntrance()}
        />
        <Button
          value={state.showSpawns ? 'Hide spawns' : 'Show spawns'}
          fontSize={12}
          variant="secondary"
          uiTransform={{ width: 96, height: 28 }}
          onMouseDown={() => toggleSpawnMarkers()}
        />
      </UiEntity>
      <Label value="Camera" fontSize={12} color={MUTED} uiTransform={{ height: 18, margin: { top: 8 } }} textAlign="middle-left" />
      <UiEntity uiTransform={{ flexDirection: 'row' }}>
        {CAMERAS.filter((c) => !c.openOnly || crawlerCameraAvailable()).map((c) => (
          <Button
            key={c.id}
            value={c.label}
            fontSize={12}
            variant={state.camera === c.id ? 'primary' : 'secondary'}
            uiTransform={{ width: 96, height: 28, margin: { right: 6 } }}
            onMouseDown={() => setCameraChoice(c.id)}
          />
        ))}
      </UiEntity>
      <Label
        value={CAMERAS.find((c) => c.id === state.camera)?.hint ?? ''}
        fontSize={11}
        color={MUTED}
        uiTransform={{ height: 18 }}
        textAlign="middle-left"
      />
    </UiEntity>
  )
}
