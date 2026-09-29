// Background music: one global voice, the same loudness wherever the hero
// stands, choosing its track by where the hero is. Nothing starts or stops it
// by hand: each frame asks which track belongs here, fades out what plays when
// that changes and fades the new one in, so the hall, a run, the raid, a
// retry and a reload all land in the same place. The hall has a track today;
// a realm plays silence until it is given one in TRACKS.

import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { getSettings } from './settings'
import { myPhase } from './party'
import { HUB } from './partyLookup'
import { pitCinematicPlaying } from './pitCinematic'
import { getTalkState } from './hallTalk'

const TRACKS = {
  hall: 'sounds/music/hall.mp3'
}

/** Loudness per step of the settings' Music row: Off, Low, Medium, High. */
export const MUSIC_VOLUMES = [0, 0.06, 0.12, 0.2]
/** Seconds a track takes to fade fully in or out. */
const FADE_SECONDS = 1.2
/** Under the pit's cinematic and while hall folk talk, the music steps back. */
const CINEMATIC_DUCK = 0.3
const TALK_DUCK = 0.6

let voice: Entity | undefined
let clip = ''
let level = 0

/** The track that belongs where the hero is: the hall (and the title over it), or nothing yet. */
function trackHere(): string {
  return myPhase() === HUB ? TRACKS.hall : ''
}

function targetVolume(): number {
  const base = MUSIC_VOLUMES[getSettings().music] ?? 0
  if (pitCinematicPlaying()) return base * CINEMATIC_DUCK
  if (getTalkState().open) return base * TALK_DUCK
  return base
}

function musicSystem(dt: number) {
  if (voice === undefined) return
  const want = trackHere()
  const target = want === clip ? targetVolume() : 0
  const step = (MUSIC_VOLUMES[MUSIC_VOLUMES.length - 1] / FADE_SECONDS) * dt
  level = level < target ? Math.min(target, level + step) : Math.max(target, level - step)

  if (want !== clip && level <= 0) {
    clip = want
    const source = AudioSource.getMutable(voice)
    if (clip) source.audioClipUrl = clip
    source.volume = 0
    source.playing = clip !== '' && targetVolume() > 0
    return
  }
  const source = AudioSource.getMutable(voice)
  const playing = clip !== '' && level > 0
  if (source.playing !== playing) source.playing = playing
  if (Math.abs((source.volume ?? 0) - level) > 0.001) source.volume = level
}

export function initializeMusic() {
  if (voice !== undefined) return
  voice = engine.addEntity()
  Transform.create(voice)
  AudioSource.create(voice, { audioClipUrl: TRACKS.hall, playing: false, loop: true, volume: 0, global: true })
  engine.addSystem(musicSystem)
}
