// The game's music: one track, low, looping, riding with the camera so the high
// crawler camera never attenuates it. It starts with the scene and plays
// through title, hall and dungeon alike; the room tones and fire loops sit over it.
// The Barrow Run has a faster track of its own: the bed swaps for it while the
// run is on screen and comes back, from the top, when the hero leaves the road.

import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isHeadless } from './multiplayer'
import { isBarrowRunOpen } from './barrowRun'

const MUSIC = 'sounds/music/anthem.mp3'
const RUN_MUSIC = 'sounds/music/run.mp3'
/** Under the fires (0.3) and the hall tone (0.22): a bed, not a performance. The run's a touch louder; it is the run's own voice. */
const MUSIC_VOLUME = 0.1
const RUN_VOLUME = 0.16

let player: Entity | undefined
let onRun = false

export function initializeMusic() {
  if (isHeadless() || player) return
  player = engine.addEntity()
  Transform.create(player, { parent: engine.CameraEntity, position: Vector3.Zero() })
  AudioSource.create(player, { audioClipUrl: MUSIC, playing: true, loop: true, volume: MUSIC_VOLUME })
  engine.addSystem(musicSystem)
}

function musicSystem() {
  if (!player) return
  const run = isBarrowRunOpen()
  if (run === onRun) return
  onRun = run
  AudioSource.createOrReplace(player, { audioClipUrl: run ? RUN_MUSIC : MUSIC, playing: true, loop: true, volume: run ? RUN_VOLUME : MUSIC_VOLUME })
}
