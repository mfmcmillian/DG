import { loadDungeon } from './dungeon'
import { initializeCombatFx } from './combatFx'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeHeroVitals } from './heroVitals'
import { initializeDungeonEnemies } from './dungeonEnemies'

/** Headless host: dungeon + enemy AI + hero health + combat authority. No UI, no local hero. */
export function initServer(seed: number) {
  console.log('[Server] Dark Fortress host starting')
  loadDungeon(seed, 'open')
  initializeCombatFx()
  initializeLoot()
  initializeMultiplayer(true)
  initializeHeroVitals()
  initializeDungeonEnemies()
}
