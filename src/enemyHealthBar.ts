import {
  Billboard, BillboardMode, engine, Entity, Material, MeshRenderer,
  Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const WIDTH = 0.74
const HEIGHT = 0.045
const HEAD_OFFSET = 2.1

export type EnemyHealthBar = {
  root: Entity
  filled: Entity
  empty: Entity
  ratio: number
  visible: boolean
}

/** Ordinary world geometry keeps the strip naturally occluded by walls and characters. */
export function createEnemyHealthBar(parent: Entity): EnemyHealthBar {
  const root = engine.addEntity()
  Transform.create(root, { parent, position: Vector3.create(0, HEAD_OFFSET, 0) })
  Billboard.create(root, { billboardMode: BillboardMode.BM_ALL })
  return {
    root,
    filled: createSegment(root, Color4.create(0.88, 0.2, 0.24, 1)),
    empty: createSegment(root, Color4.create(0.075, 0.08, 0.1, 1)),
    ratio: -1,
    visible: false
  }
}

export function updateEnemyHealthBar(bar: EnemyHealthBar, health: number, maxHealth: number, visible: boolean) {
  const ratio = Number.isFinite(health) && Number.isFinite(maxHealth) && maxHealth > 0
    ? Math.max(0, Math.min(1, health / maxHealth)) : 0
  const show = visible && ratio > 0
  if (ratio === bar.ratio && show === bar.visible) return

  if (ratio !== bar.ratio) {
    const filledWidth = WIDTH * ratio
    // Adjacent segments avoid overlapping planes and retain a fixed left edge.
    const filled = Transform.getMutable(bar.filled)
    filled.position = Vector3.create((filledWidth - WIDTH) / 2, 0, 0)
    filled.scale = Vector3.create(Math.max(0.0001, filledWidth), HEIGHT, 1)
    const empty = Transform.getMutable(bar.empty)
    empty.position = Vector3.create(filledWidth / 2, 0, 0)
    empty.scale = Vector3.create(Math.max(0.0001, WIDTH - filledWidth), HEIGHT, 1)
  }
  VisibilityComponent.getMutable(bar.filled).visible = show
  VisibilityComponent.getMutable(bar.empty).visible = show && ratio < 1
  bar.ratio = ratio
  bar.visible = show
}

export function destroyEnemyHealthBar(bar: EnemyHealthBar) {
  engine.removeEntity(bar.filled)
  engine.removeEntity(bar.empty)
  engine.removeEntity(bar.root)
}

function createSegment(parent: Entity, color: Color4): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { parent, scale: Vector3.create(WIDTH, HEIGHT, 1) })
  MeshRenderer.setPlane(entity)
  Material.setBasicMaterial(entity, { diffuseColor: color, castShadows: false })
  VisibilityComponent.create(entity, { visible: false })
  return entity
}
