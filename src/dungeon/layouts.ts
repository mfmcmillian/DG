// Which styles are drawn by hand rather than generated. Shared by the client
// (loadDungeon) and the server (createRunSim), so both build the same rooms.

import { DungeonStyle, StyleId } from './config'
import { Dungeon } from './generator'
import { gauntletDungeon, STAGES } from './gauntlet'
import { hubDungeon } from './hub'
import { passDungeon, PASS_STAGES } from './pass'
import { pitDungeon } from './pit'
import { Stage } from './stages'

/** The authored layout for a style, or undefined when the style is generated from a seed. */
export function authoredLayout(style: DungeonStyle): Dungeon | undefined {
  if (style.id === 'hall') return hubDungeon(style.torchEvery)
  if (style.id === 'pit') return pitDungeon(style.torchEvery)
  if (style.id === 'gauntlet') return gauntletDungeon(style.torchEvery)
  if (style.id === 'pass') return passDungeon(style.torchEvery)
  return undefined
}

/** The staged fights of a hand-drawn dungeon (waves, gates), or undefined when its enemies spawn by room. */
export function stagesFor(style: StyleId): readonly Stage[] | undefined {
  if (style === 'gauntlet') return STAGES
  if (style === 'pass') return PASS_STAGES
  return undefined
}
