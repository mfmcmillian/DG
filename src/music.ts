// The game's music: one track, low, looping, riding with the camera so the high
// crawler camera never attenuates it. It starts with the scene and plays
// through title, hall and dungeon alike; the room tones and fire loops sit over it.

import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isHeadless } from './multiplayer'

const MUSIC = 'sounds/music/anthem.mp3'
/** Under the fires (0.3) and the hall tone (0.22): a bed, not a performance. */
const MUSIC_VOLUME = 0.1

let player: Entity | undefined

export function initializeMusic() {
  if (isHeadless() || player) return
  player = engine.addEntity()
  Transform.create(player, { parent: engine.CameraEntity, position: Vector3.Zero() })
  AudioSource.create(player, { audioClipUrl: MUSIC, playing: true, loop: true, volume: MUSIC_VOLUME })
}
