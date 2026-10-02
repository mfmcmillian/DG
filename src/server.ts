import { loadDungeon } from './dungeon'
import { initializeCombatFx } from './combatFx'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeHeroVitals } from './heroVitals'
import { initializeDungeonEnemies } from './dungeonEnemies'
import { initializePartyServer } from './partyServer'
import { initializeJoinNotify } from './joinNotify'
import { initializeGravewatchServer } from './gravewatchServer'
import { initializeVisitLog } from './visitLog'
import { initializeMetrics } from './metrics'
import { HUB_LEVEL } from './shared/levels'
import { EnvVar } from '@dcl/sdk/server'
import { GAME_VERSION } from './version'

/**
 * The server environment variables the host reads, reported at boot as set or
 * unset (never their values): the metrics secret and the Rewards dispenser
 * keys of the Gravewatch event, `npx sdk-commands storage env set NAME --value …`.
 */
const ENV_KEYS = ['METRICS_KEY', 'REWARDS_KEY_TEST', 'REWARDS_KEY_W1', 'REWARDS_KEY_W2', 'REWARDS_KEY_W3']

async function reportEnv() {
  const found: string[] = []
  for (const key of ENV_KEYS) {
    let value: string | undefined
    try {
      value = await EnvVar.get(key)
    } catch {
      value = undefined
    }
    found.push(`${key}=${value ? 'set' : 'unset'}`)
  }
  console.log(`[Server] v${GAME_VERSION} env: ${found.join(' ')}`)
}

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
  initializeVisitLog()
  initializeMetrics()
  initializeJoinNotify()
  initializeGravewatchServer()
  void reportEnv()
}
