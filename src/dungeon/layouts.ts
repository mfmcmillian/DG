// Which styles are drawn by hand rather than generated. Shared by the client
// (loadDungeon) and the server (createRunSim), so both build the same rooms.

import { DungeonStyle } from './config'
import { Dungeon } from './generator'
import { gauntletDungeon } from './gauntlet'
import { hubDungeon } from './hub'
import { pitDungeon } from './pit'

/** The authored layout for a style, or undefined when the style is generated from a seed. */
export function authoredLayout(style: DungeonStyle): Dungeon | undefined {
  if (style.id === 'hall') return hubDungeon(style.torchEvery)
  if (style.id === 'pit') return pitDungeon(style.torchEvery)
  if (style.id === 'gauntlet') return gauntletDungeon(style.torchEvery)
  return undefined
}
