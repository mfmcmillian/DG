import { ColliderLayer, engine, executeTask, MeshCollider, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { rearmAvatarHiding } from './avatarHiding'
import { COURTYARD, courtyardSpawnCameraTarget, courtyardSpawnPosition, isInCourtyard } from './courtyard'

const CHECK_INTERVAL = 0.25
const RETRY_INTERVAL = 1
const RECOVERY_Y = COURTYARD.supportTopY - 0.05
let initialized = false
let placed = false
let movement: Promise<boolean> | undefined
let arrival: { position: Vector3; elapsed: number; requested: boolean; resolve: () => void; reject: (error: Error) => void } | undefined
let elapsed = 0
let retryAfter = 0

/** Menu handoffs share the same move owner as under-floor recovery. */
export async function preparePlayerForCameraReturn(position: Vector3, cameraTarget?: Vector3): Promise<void> {
  if (arrival) throw new Error('Player placement is already in progress')
  try {
    // The RPC only queues a teleport. Wait for the renderer's player transform,
    // not just its success response. The deadline also covers waiting on the RPC.
    await new Promise<void>((resolve, reject) => {
      const attempt = { position, elapsed: 0, requested: false, resolve, reject }
      arrival = attempt
      executeTask(async () => {
        try {
          if (movement) await movement
          if (arrival !== attempt) return
          const accepted = await requestMove(position, cameraTarget)
          if (arrival !== attempt) return
          if (!accepted) throw new Error('Player placement was rejected')
          attempt.requested = true
        } catch (error) {
          if (arrival !== attempt) return
          arrival = undefined
          reject(error)
        }
      })
    })
  } finally {
    retryAfter = RETRY_INTERVAL
  }
}

/** Cancel the arrival observer and queued work; an issued renderer RPC cannot be undone. */
export function cancelPlayerCameraReturn() {
  const pending = arrival
  if (!pending) return
  arrival = undefined
  pending.reject(new Error('Camera return was cancelled'))
}

/** Gameplay respawn: back to the entrance through the shared move owner, facing into the dungeon. */
export function movePlayerToSpawn() {
  if (arrival) return
  executeTask(async () => {
    try {
      if (movement) await movement
      await requestMove(courtyardSpawnPosition(), courtyardSpawnCameraTarget())
    } catch (error) {
      console.log('Player respawn failed', error)
    } finally {
      retryAfter = RETRY_INTERVAL
    }
  })
}

function requestMove(position: Vector3, cameraTarget?: Vector3): Promise<boolean> {
  const pending = movePlayerTo({ newRelativePosition: position, cameraTarget, avatarTarget: cameraTarget })
    .then((result) => {
      // A teleport can land the avatar shown; run it through the hide again.
      rearmAvatarHiding()
      return result.success
    })
    .finally(() => { if (movement === pending) movement = undefined })
  movement = pending
  return pending
}

/** Ground and recovery live for the whole scene, independently of menus and models. */
export function initializePlayerPlacement() {
  if (initialized) return
  initialized = true

  // Use the same walking plane as the courtyard's characters. The old support
  // at -0.5m could catch the native player underneath the visible dirt before
  // scenery colliders loaded, and recovery then accepted that buried position.
  const ground = engine.addEntity()
  Transform.create(ground, {
    position: Vector3.create(
      (COURTYARD.minX + COURTYARD.maxX) / 2,
      COURTYARD.supportTopY - COURTYARD.supportDepth / 2,
      (COURTYARD.minZ + COURTYARD.maxZ) / 2
    ),
    scale: Vector3.create(
      COURTYARD.maxX - COURTYARD.minX,
      COURTYARD.supportDepth,
      COURTYARD.maxZ - COURTYARD.minZ
    )
  })
  // PHYSICS alone maps to the renderer's CharacterOnly layer. The combined
  // mask also blocks the native third-person camera from passing under the floor.
  MeshCollider.setBox(ground, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  engine.addSystem(updatePlayerPlacement)
}

function updatePlayerPlacement(dt: number) {
  if (arrival) {
    arrival.elapsed += dt
    const player = Transform.getOrNull(engine.PlayerEntity)?.position
    const target = arrival.position
    if (arrival.requested && player && Math.abs(player.x - target.x) < 0.35 && Math.abs(player.z - target.z) < 0.35 &&
      player.y >= RECOVERY_Y && player.y <= target.y + 0.5) {
      const ready = arrival
      arrival = undefined
      placed = true
      ready.resolve()
    } else if (arrival.elapsed >= 5) {
      const expired = arrival
      arrival = undefined
      expired.reject(new Error('Player did not arrive at the return position'))
    }
  }
  retryAfter = Math.max(0, retryAfter - dt)
  elapsed += dt
  if (elapsed < CHECK_INTERVAL || movement || arrival || retryAfter > 0) return
  elapsed = 0

  const position = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return
  // A scene must not pull a player back after they leave its parcels.
  if (position.x < 0 || position.x >= COURTYARD.sceneSize || position.z < 0 || position.z >= COURTYARD.sceneSize) return

  const inside = isInCourtyard(position)
  if (inside && position.y >= RECOVERY_Y) {
    placed = true
    return
  }
  if (placed && !inside) return

  executeTask(async () => {
    try {
      // Omit cameraTarget and avatarTarget: recover position without resetting
      // either orientation or queuing an aim change behind a menu camera.
      await requestMove(courtyardSpawnPosition())
    } catch (error) {
      console.log('Player position recovery failed', error)
    } finally {
      retryAfter = RETRY_INTERVAL
    }
  })
}
