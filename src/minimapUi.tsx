import { engine, Transform } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { floorRectangles } from './dungeon/layout'
import { getDungeonState } from './dungeon'
import { gridOrigin } from './dungeon/config'
import { minimapEnemies } from './dungeonEnemies'
import { heroPosition, localAddress } from './multiplayer'
import { myParty } from './party'
import { uiViewport } from './uiScale'

const MAP_DESKTOP = 178
const MAP_MOBILE = 150
const PAD = 9
const HEADER = 20

const PANEL = Color4.create(0.025, 0.035, 0.055, 0.9)
const FRAME = Color4.create(0.48, 0.58, 0.68, 0.72)
const VOID = Color4.create(0.015, 0.02, 0.03, 0.92)
const FLOOR = Color4.create(0.26, 0.31, 0.35, 0.95)
const PLAYER = Color4.create(1, 0.84, 0.3, 1)
const ALLY = Color4.create(0.28, 0.82, 1, 1)
const ENEMY = Color4.create(0.94, 0.22, 0.22, 1)
const BOSS = Color4.create(0.92, 0.25, 0.72, 1)

type Point = { x: number; z: number }

export function dungeonMinimapHeight(scale = 1): number {
  return ((uiViewport().mobile ? MAP_MOBILE : MAP_DESKTOP) + HEADER) * scale
}

function MapDot({
  point,
  origin,
  span,
  inner,
  colour,
  size,
  key
}: {
  point: Point
  origin: { x: number; z: number }
  span: number
  inner: number
  colour: Color4
  size: number
  key?: string
}) {
  const nx = (point.x - origin.x) / span
  const nz = (point.z - origin.z) / span
  if (nx < 0 || nx > 1 || nz < 0 || nz > 1) return null
  return (
    <UiEntity
      key={key}
      uiTransform={{
        positionType: 'absolute',
        position: { left: PAD + (1 - nx) * inner - size / 2, top: HEADER + PAD + nz * inner - size / 2 },
        width: size,
        height: size,
        pointerFilter: 'none'
      }}
      uiBackground={{ color: colour }}
    />
  )
}

export function DungeonMinimap({ right, top, scale: s }: { right: number; top: number; scale: number }) {
  const state = getDungeonState()
  const dungeon = state.dungeon
  if (!dungeon) return null

  const mapSize = (uiViewport().mobile ? MAP_MOBILE : MAP_DESKTOP) * s
  const header = HEADER * s
  const pad = PAD * s
  const inner = mapSize - pad * 2
  const origin = gridOrigin(state.style)
  const span = dungeon.size * state.style.tile
  const cell = inner / dungeon.size
  const me = localAddress()
  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const allies = (myParty()?.members ?? [])
    .filter((id) => id !== me)
    .map((id) => ({ id, position: heroPosition(id) }))
    .filter((row): row is { id: string; position: NonNullable<typeof row.position> } => !!row.position)
  const enemies = minimapEnemies()

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { right, top },
        width: mapSize,
        height: mapSize + header,
        pointerFilter: 'none'
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label
        value="MAP"
        color={FRAME}
        font="sans-serif"
        fontSize={11 * s}
        textAlign="middle-center"
        uiTransform={{ positionType: 'absolute', position: { left: 0, top: 1 * s }, width: mapSize, height: header, pointerFilter: 'none' }}
      />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { left: pad - 1 * s, top: header + pad - 1 * s },
          width: inner + 2 * s,
          height: inner + 2 * s,
          pointerFilter: 'none'
        }}
        uiBackground={{ color: FRAME }}
      />
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { left: pad, top: header + pad },
          width: inner,
          height: inner,
          pointerFilter: 'none'
        }}
        uiBackground={{ color: VOID }}
      />
      {floorRectangles(dungeon).map((rect, i) => (
        <UiEntity
          key={`floor-${i}`}
          uiTransform={{
            positionType: 'absolute',
            position: {
              left: pad + (dungeon.size - rect.x - rect.w) * cell,
              top: header + pad + rect.y * cell
            },
            width: rect.w * cell,
            height: rect.d * cell,
            pointerFilter: 'none'
          }}
          uiBackground={{ color: FLOOR }}
        />
      ))}
      {enemies.map((enemy, i) => (
        <MapDot
          key={`enemy-${i}`}
          point={enemy}
          origin={origin}
          span={span}
          inner={inner}
          colour={enemy.boss ? BOSS : ENEMY}
          size={(enemy.boss ? 9 : 5) * s}
        />
      ))}
      {allies.map((ally) => (
        <MapDot key={`ally-${ally.id}`} point={ally.position} origin={origin} span={span} inner={inner} colour={ALLY} size={7 * s} />
      ))}
      {player && <MapDot point={player} origin={origin} span={span} inner={inner} colour={PLAYER} size={9 * s} />}
    </UiEntity>
  )
}
