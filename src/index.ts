import { AvatarLocomotionSettings, engine, Entity } from '@dcl/sdk/ecs'
import { isServer as isServerApi } from '~system/EngineApi'
import './shared/messages'
import { initServer } from './server'
import { loadDungeon } from './dungeon'
import { initializePlayerPlacement } from './playerPlacement'
import {
  CharacterDefinition,
  initializeCharacterPicker
} from './characterPicker'
import { openTitle } from './titleScreen'
import { setupCharacterPickerUi } from './characterPickerUi'
import { initializeInventory } from './inventory'
import { getCommittedLoadout } from './equipmentState'
import { initializeCombat } from './combat'
import { initializeDungeonEnemies } from './dungeonEnemies'
import { initializeTrainingDummies } from './trainingDummies'
import { initializeHallFolk } from './hallFolk'
import { initializeHallTalk } from './hallTalk'
import { initializeHallGuide } from './hallGuide'
import { initializeHallPrompt } from './hallPrompt'
import { initializeHints } from './hints'
import { initializeColossusClient } from './raid/colossusClient'
import { initializeCombatFx } from './combatFx'
import { initializeProjectiles } from './projectiles'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeRemotePlayers } from './remotePlayers'
import { initializeAvatarHiding } from './avatarHiding'
import { adoptPlayerCharacter, initializePlayerCharacter, setPlayerCharacter } from './playerCharacter'
import { planPreload } from './preloadPlan'
import { GAME_VERSION } from './version'
import { installNetDebug } from './netDebug'
import { initializeParty } from './party'
import { initializeHeroSave } from './heroSave'
import { initializeHeroXp } from './heroXp'
import { initializeHeroSkills } from './heroSkills'
import { initializePartyServer } from './partyServer'
import { HUB_LEVEL } from './shared/levels'
export async function main() {
  // Ask the runtime directly rather than reading the SDK's isServer() atom: that
  // atom is filled by the same RPC asynchronously and may not have landed yet
  // on the first tick, which is when main() runs.
  const server = (await isServerApi({})).isServer
  console.log(`[DG] v${GAME_VERSION} ${server ? 'server' : 'client'}`)
  if (server) {
    // The SDK's network layer logs state requests and replies when this is set;
    // on the headless host that is the only view of the client handshake.
    ;(globalThis as { DEBUG_NETWORK_MESSAGES?: boolean }).DEBUG_NETWORK_MESSAGES = true
    initServer()
    return
  }
  initClient()
}

function initClient() {
  installNetDebug()
  // The sky is the player's: no fixed time of day, the torches carry the rooms whatever the hour.
  // The title waits only on the hall (see preloadPlan); heroes and realms
  // download behind it and each door waits on its own group.
  planPreload()
  // The static spawn point in scene.json sits on the open style's entrance tile for this seed.
  loadDungeon(HUB_LEVEL.seed, HUB_LEVEL.style)
  initializePlayerPlacement()
  // No native jump in the dungeon (it would fight the walls and the Space guard),
  // and a slower pace than the Explorer's 8 / 10 m/s so the crawler camera can
  // keep up without a long lead. Ctrl (IA_WALK) is the dodge roll; the Shift
  // sprint barely differs from the jog so it is not worth a lead of its own.
  AvatarLocomotionSettings.create(engine.PlayerEntity, {
    jumpHeight: 0,
    runJumpHeight: 0,
    walkSpeed: 1.5,
    jogSpeed: 5.5,
    runSpeed: 6.5
  })
  initializeCombatFx()
  initializeProjectiles()
  initializeLoot()
  initializeMultiplayer(false)
  initializeAvatarHiding()
  initializeRemotePlayers()

  initializePlayerCharacter()
  initializeCharacterPicker(applyCharacter)
  initializeInventory(applyCharacter)
  initializeCombat()
  initializeDungeonEnemies()
  initializeTrainingDummies()
  initializeHallFolk()
  initializeHallTalk()
  initializeHallPrompt()
  initializeHallGuide()
  initializeHints()
  initializeColossusClient()
  // Lobby mirror and saved hero ride on the room; a client that goes solo also
  // hosts the party registry itself (see partyServer's onHostStart binding).
  initializeParty()
  initializeHeroSave()
  initializeHeroXp()
  initializeHeroSkills()
  initializePartyServer()
  setupCharacterPickerUi()
  openTitle()
}

function applyCharacter(character: CharacterDefinition, previewRoot?: Entity): boolean {
  if (previewRoot !== undefined) return adoptPlayerCharacter(previewRoot, character.id, getCommittedLoadout(character.id))
  setPlayerCharacter(character.id, getCommittedLoadout(character.id))
  return true
}
