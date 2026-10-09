import { engine, executeTask, InputModifier } from '@dcl/sdk/ecs'
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport, wholeCanvas } from './uiScale'

type Phase = 'idle' | 'covering' | 'covered' | 'revealing'

const COVER_SECONDS = 0.8
/** Let the fade land and breathe before the synchronous world rebuild begins. */
const COVERED_BEFORE_LOAD = 2
/** Keep the rebuilt world hidden while assets and the camera settle around the confirmed player position. */
const SETTLE_SECONDS = 2
const REVEAL_SECONDS = 0.9

let phase: Phase = 'idle'
let elapsed = 0
let caption = ''
let task: (() => Promise<void> | void) | undefined
let taskStarted = false
let taskDone = false
let systemAdded = false

export function sceneTransitionActive(): boolean {
  return phase !== 'idle'
}

/** Fade over the current world, run its rebuild while fully covered, then reveal it. */
export function beginSceneTransition(label: string, action: () => Promise<void> | void): boolean {
  if (phase !== 'idle') return false
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(updateSceneTransition)
  }
  caption = label
  task = action
  taskStarted = false
  taskDone = false
  elapsed = 0
  phase = 'covering'
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })
  return true
}

function updateSceneTransition(dt: number) {
  if (phase === 'idle') return
  elapsed += Math.max(0, dt)
  if (phase === 'covering') {
    if (elapsed < COVER_SECONDS) return
    phase = 'covered'
    elapsed = 0
    return
  }
  if (phase === 'covered') {
    if (!taskStarted && elapsed >= COVERED_BEFORE_LOAD) {
      taskStarted = true
      const action = task
      executeTask(async () => {
        try {
          await action?.()
        } catch (error) {
          console.error('Scene transition failed', error)
        } finally {
          taskDone = true
          elapsed = 0
        }
      })
    }
    if (!taskDone || elapsed < SETTLE_SECONDS) return
    phase = 'revealing'
    elapsed = 0
    return
  }
  if (elapsed < REVEAL_SECONDS) return
  phase = 'idle'
  caption = ''
  task = undefined
  const input = InputModifier.getOrNull(engine.PlayerEntity)
  if (input?.mode?.$case === 'standard' && input.mode.standard.disableAll) {
    InputModifier.deleteFrom(engine.PlayerEntity)
  }
}

function opacity(): number {
  if (phase === 'covering') return Math.min(1, elapsed / COVER_SECONDS)
  if (phase === 'covered') return 1
  if (phase === 'revealing') return Math.max(0, 1 - elapsed / REVEAL_SECONDS)
  return 0
}

export function SceneTransitionUi() {
  const { canvas } = uiViewport()
  const alpha = opacity()
  return <UiEntity
    uiTransform={{
      ...wholeCanvas(),
      justifyContent: 'center', alignItems: 'center', flexDirection: 'column',
      pointerFilter: 'block'
    }}
    uiBackground={{ color: Color4.create(0.005, 0.008, 0.014, alpha) }}
  >
    {alpha > 0.7 && <Label value={caption} color={Color4.create(0.94, 0.86, 0.62, alpha)}
      font="serif" fontSize={32} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: Math.min(720, canvas.width * 0.8), height: 48, pointerFilter: 'none' }} />}
  </UiEntity>
}
