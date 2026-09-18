import { loadDungeon } from './dungeon'
import { initializeCombatFx } from './combatFx'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeDungeonEnemies } from './dungeonEnemies'

/** Headless host: dungeon + enemy AI + combat authority. No UI, no local hero. */
export function initServer(seed: number) {
  console.log('[Server] Dark Fortress host starting')
  loadDungeon(seed, 'open')
  initializeCombatFx()
  initializeLoot()
  initializeMultiplayer(true)
  initializeDungeonEnemies()
}
