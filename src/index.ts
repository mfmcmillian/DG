import { AvatarLocomotionSettings, engine, Entity, SkyboxTime } from '@dcl/sdk/ecs'
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
import { fxSoundAssets, initializeCombatFx } from './combatFx'
import { initializeLoot } from './loot'
import { initializeMultiplayer } from './multiplayer'
import { initializeRemotePlayers } from './remotePlayers'
import { initializeAvatarHiding } from './avatarHiding'
import { adoptPlayerCharacter, initializePlayerCharacter, setPlayerCharacter } from './playerCharacter'
import { preloadAssets } from './preload'
import { BRICK_TEXTURE, FLOOR_TEXTURE, KIT } from './dungeon/kit'
import { equipmentModelPaths } from './equipmentAvatar'
import { enemyPreloadAssets } from './dungeonEnemies'
import { CHARACTERS } from './characterPicker'
import { GAME_VERSION } from './version'

export const DUNGEON_SEED = 1337

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
    initServer(DUNGEON_SEED)
    return
  }
  initClient()
}

function initClient() {
  // Deep night so the torches carry the lighting.
  SkyboxTime.create(engine.RootEntity, { fixedTime: 1800 })
  // Ask the renderer for everything the first minute needs before the title
  // screen lets anyone in; remote content servers otherwise stream bodies and
  // floors in piecemeal while the player is already fighting.
  preloadAssets([
    ...Object.values(KIT).map((piece) => piece.src),
    FLOOR_TEXTURE, BRICK_TEXTURE,
    'models/loot/coin.glb', 'models/loot/heart.glb',
    ...fxSoundAssets(),
    ...enemyPreloadAssets(),
    ...CHARACTERS.flatMap((c) => equipmentModelPaths(c.id, getCommittedLoadout(c.id)))
  ])
  // The static spawn point in scene.json sits on the open style's entrance tile for this seed.
  loadDungeon(DUNGEON_SEED, 'open')
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
  initializeLoot()
  initializeMultiplayer(false)
  initializeAvatarHiding()
  initializeRemotePlayers()

  initializePlayerCharacter()
  initializeCharacterPicker(applyCharacter)
  initializeInventory(applyCharacter)
  initializeCombat()
  initializeDungeonEnemies()
  setupCharacterPickerUi()
  openTitle()
}

function applyCharacter(character: CharacterDefinition, previewRoot?: Entity): boolean {
  if (previewRoot !== undefined) return adoptPlayerCharacter(previewRoot, character.id, getCommittedLoadout(character.id))
  setPlayerCharacter(character.id, getCommittedLoadout(character.id))
  return true
}
