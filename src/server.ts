import { loadDungeon } from './dungeon'
import { initializeCombatFx } from './combatFx'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeHeroVitals } from './heroVitals'
import { initializeDungeonEnemies } from './dungeonEnemies'
import { initializePartyServer } from './partyServer'
import { HUB_LEVEL } from './shared/levels'

/**
 * Headless host: party registry, one enemy simulation per running party, hero
 * health and combat authority. No UI, no local hero. The hub layout is loaded
 * for the scene's measurements only; runs generate their own level from its seed.
 */
export function initServer() {
  console.log('[Server] Dungeons of Antrom host starting')
  loadDungeon(HUB_LEVEL.seed, HUB_LEVEL.style)
  initializeCombatFx()
  initializeLoot()
  initializeMultiplayer(true)
  initializeHeroVitals()
  initializeDungeonEnemies()
  initializePartyServer()
}
