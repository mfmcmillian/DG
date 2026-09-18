import { engine, Entity, InputModifier, MainCamera, PointerLock, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { setPlayerCharacterSuspended } from './playerCharacter'
import { COURTYARD, courtyardSpawnCameraTarget, courtyardSpawnPosition, isInCourtyard } from './courtyard'
import { preparePlayerForCameraReturn } from './playerPlacement'
import { resumeDungeonCamera, suspendDungeonCamera } from './dungeon'

type View = 'title' | 'picker' | 'inventory' | 'combat'
export type SceneCameraSession = Readonly<{ view: View }>

// Keep the rig alive across menu exits. Explorer releases its active camera and
// restriction when MainCamera's optional reference is cleared.
let rig: { camera: Entity; target: Entity } | undefined
let activeSession: SceneCameraSession | undefined
let preparation: Promise<void> | undefined
let prepared = false

export function openSceneCamera(
  view: View, position: Vector3, target: Vector3
): SceneCameraSession | undefined {
  if (activeSession) return undefined
  prepared = false
  preparation = undefined
  if (!rig) rig = { camera: engine.addEntity(), target: engine.addEntity() }

  Transform.createOrReplace(rig.target, { position: Vector3.create(target.x, target.y, target.z) })
  Transform.createOrReplace(rig.camera, {
    position: Vector3.create(position.x, position.y, position.z),
    rotation: Quaternion.lookRotation(Vector3.subtract(target, position), Vector3.Up())
  })
  VirtualCamera.createOrReplace(rig.camera, {
    lookAtEntity: rig.target,
    // Cut directly to the isolated menu stage; this is the incoming transition
    // only. Native camera release below remains unchanged.
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(view === 'combat' ? 0.3 : 0) }
  })

  activeSession = { view }
  // The dungeon's follow camera must let go before the menu rig takes MainCamera.
  suspendDungeonCamera()
  setPlayerCharacterSuspended(true)
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({ disableAll: true })
  })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: rig.camera })
  PointerLock.createOrReplace(engine.CameraEntity, { isPointerLocked: false })
  return activeSession
}

/** Prepare spawn and aim together while the creator still owns the preview. */
export function prepareSceneCameraReturn(session: SceneCameraSession | undefined, firstCreation = false): Promise<void> {
  if (!session || session !== activeSession) return Promise.reject(new Error('Camera session is no longer active'))
  if (prepared) return Promise.resolve()
  if (preparation) return preparation

  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const useSpawn = firstCreation || !player || !isInCourtyard(player) || !Number.isFinite(player.y) || player.y < COURTYARD.supportTopY
  if (!useSpawn) {
    prepared = true
    return Promise.resolve()
  }

  preparation = preparePlayerForCameraReturn(courtyardSpawnPosition(), courtyardSpawnCameraTarget())
    .then(() => {
      if (session !== activeSession) throw new Error('Camera session is no longer active')
      prepared = true
    })
    .finally(() => { if (session === activeSession) preparation = undefined })
  return preparation
}

/** Release through Explorer's camera-change path, then leave native control alone. */
export function closeSceneCamera(session: SceneCameraSession | undefined) {
  if (!session || session !== activeSession) return
  activeSession = undefined
  prepared = false
  preparation = undefined

  const mainCamera = MainCamera.getMutableOrNull(engine.CameraEntity)
  if (mainCamera) mainCamera.virtualCameraEntity = undefined
  InputModifier.deleteFrom(engine.PlayerEntity)
  setPlayerCharacterSuspended(false)
  // Blend from the menu straight into the dungeon's follow camera.
  resumeDungeonCamera()
}
