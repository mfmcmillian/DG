// Roaming enemies and the boss, one per dungeon spawn point. This generalises
// the old single courtyard rival: the same brain, swings, hit rules, health bars
// and equipment avatars, but many actors, each leashed to its own room, and
// movement that respects the dungeon's walls and doorways.
//
// Presentation (particles, numbers, sounds, telegraph decals, camera kicks,
// hit-stop) lives in combatFx; loot in loot.ts.

import { EasingFunction, engine, Entity, Transform, Tween } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD, isInCourtyard } from './courtyard'
import { DEFAULT_LOADOUTS, EquipmentLoadout } from './equipmentCatalog'
import { CharacterAppearance } from './appearance'
import {
  destroyEquipmentAvatar, equipmentModelPaths, getEquipmentLoading, setEquipmentAvatar,
  setEquipmentMotion, setEquipmentStride, setEquipmentTimeScale, setEquipmentVisible
} from './equipmentAvatar'
import { EquipmentMotion } from './combatAnimations'
import {
  advanceAttack, attackCanReach, attackRange, attackRecovery, AttackMotion, canStartAttack,
  combatDistance, CombatPose, COMBAT_RULES, createSwing, facesCombatant, isHeavyMotion,
  MAX_COMBAT_HEALTH, resolveCombatHit, Swing, WeaponMotion
} from './combatActions'
import { createRivalBrain, resetRivalBrain, RivalBrain, RivalProfile, updateRivalBrain } from './rivalBrain'
import {
  BossAttack, BossBrain, bossPhaseLabel, createBossBrain, resetBossBrain, updateBossBrain
} from './bossBrain'
import { COMBAT_CLIPS } from './combatAnimations'
import {
  createEnemyHealthBar, destroyEnemyHealthBar, EnemyHealthBar, updateEnemyHealthBar
} from './enemyHealthBar'
import {
  getPlayerCombatPose, hitStopPlayer, playerBlockedHit, receivePlayerCombatHit, restorePlayerCombatHealth,
  setPlayerAttackContactHandler, setPlayerAttackStartHandler, setPlayerFacingOverride, setPlayerStepIn
} from './playerCharacter'
import { movePlayerToSpawn } from './playerPlacement'
import { dungeonCell, DungeonState, getDungeonState, isDungeonFloor, onDungeonLoaded } from './dungeon'
import { DOOR_OPENINGS } from './dungeon/kit'
import { RoomKind, Side } from './dungeon/generator'
import {
  createDecal, Decal, destroyDecal, fxDeathPuff, fxGlitter, fxImpact, fxNumber, fxSlam, fxSlash, fxSound, updateDecal
} from './combatFx'
import { kickCrawlerCamera } from './dungeon/crawlerCamera'
import { clearLoot, spawnLoot } from './loot'
import { unlockInventoryItem } from './inventory'
import { AttackContext } from './roamingCombat'
import {
  allFighters, EnemySnap, ImpactNet, isHost, localAddress, NetFighter, publishEnemies, publishHitEnemy,
  publishHitPlayer, publishImpact, publishLoot, remoteCount, setMultiplayerHandlers
} from './multiplayer'

type WorldPhase = 'loading' | 'idle' | 'fighting' | 'victory' | 'defeat' | 'error'
/** Shape kept from the courtyard rival so the world HUD keeps working unchanged. */
type WorldRivalState = {
  visible: boolean; phase: WorldPhase; name: string; health: number; playerHealth: number
  maxHealth: number; message: string; respawnSeconds: number; telegraph: string
  /** Dungeon extras. */
  alive: number; total: number; bossAlive: boolean; party: number
  bossPhase: number; bossLabel: string
}

type Archetype = {
  name: string; characterId: string; weapon: string; health: number; scale: number
  damageScale: number; aggro: number; leash: number
  /** Walk speed multiplier. */
  speed: number
  profile: RivalProfile
}

type Enemy = CombatPose & {
  /** Position only; glided by the renderer between ticks. Never written while gliding. */
  root: Entity
  /** Child carrying rotation, scale, the outfit and the health bar. */
  body: Entity
  archetype: Archetype; boss: boolean
  home: CombatPose; health: number; recovery: number; stagger: number; blocking: boolean
  motion: EquipmentMotion; visible: boolean; healthBar: EnemyHealthBar; swing?: Swing
  /** The current swing is the boss's area slam rather than a sword strike. */
  slamming: boolean
  brain: RivalBrain; engaged: boolean; returningHome: boolean; dead: boolean; deadSeconds: number
  loading: 'loading' | 'ready' | 'error'; loadSeconds: number
  ring: Decal; ritual?: Decal
  hitStop: number
  /** Set once per wind-up so its sound plays a single time. */
  announced: boolean
  /** Velocity last handed to the renderer for the glide; undefined = snapped, no tween. */
  glide?: Vector3
  /** Logical position at the previous sync, for the glide's slope. */
  lastSynced?: Vector3
  lastFacing: number
  /** Seconds since the brain last asked to advance. */
  stillSeconds: number
  /** Wallet the host AI is currently chasing. */
  targetId?: string
  bossBrain?: BossBrain
  hyperArmor: boolean
  rollSeconds: number
  rollDir: number
}

const STRIKER: Archetype = {
  name: 'Striker', characterId: 'striker', weapon: 'pride-sword', health: 90, scale: 1, damageScale: 1,
  aggro: 6.5, leash: 11, speed: 1.15, profile: { blockChance: 0.15, pace: 0.8 }
}
const SCOUT: Archetype = {
  name: 'Scout', characterId: 'scout', weapon: 'pride-sword-dusk', health: 75, scale: 0.95, damageScale: 0.85,
  aggro: 7.5, leash: 11, speed: 1.2, profile: { blockChance: 0.2, pace: 0.9 }
}
const GUARD: Archetype = {
  name: 'Vault Guard', characterId: 'vanguard', weapon: 'pride-sword', health: 150, scale: 1.08, damageScale: 1.15,
  aggro: 5, leash: 10, speed: 0.9, profile: { blockChance: 0.5, pace: 1.1 }
}
const BOSS: Archetype = {
  name: 'Warlord', characterId: 'brute', weapon: 'pride-sword-dusk', health: 460, scale: 1.48,
  damageScale: 1.7, aggro: 11, leash: 18, speed: 1.08,
  profile: { blockChance: 0.08, pace: 0.82, pattern: ['attack_light', 'attack_light2', 'attack_heavy', 'slam'], slamRange: 3.6 }
}
const BOSS_APPEARANCE: CharacterAppearance = { bodyType: 'male', hairStyle: 'short', hairColor: 'brown', skinTone: 'warm' }

function archetypeLoadout(archetype: Archetype): EquipmentLoadout {
  return { ...DEFAULT_LOADOUTS[archetype.characterId], weapon: archetype.weapon }
}

/** Every GLB the dungeon's enemies and the Warlord will request when they spawn. */
export function enemyPreloadAssets(): string[] {
  const paths: string[] = []
  for (const archetype of [STRIKER, SCOUT, GUARD, BOSS]) {
    paths.push(...equipmentModelPaths(archetype.characterId, archetypeLoadout(archetype), archetype === BOSS ? BOSS_APPEARANCE : undefined))
  }
  return paths
}

const SLAM_RADIUS = 3.2
const SLAM_DAMAGE = 32
const RECOVER_SECONDS = 4
const CORPSE_SECONDS = 4
const BODY_RADIUS = 0.42
/** Soft lock-on only engages once a target is just about in reach, within this half-angle. */
const LOCK_MARGIN = 0.35
const LOCK_COS = 0.1
/** The swing's lunge closes to this distance from a locked-on enemy. */
const STEP_TO = 1.2
const BOSS_DROP = 'pride-sword-dusk'

const state: WorldRivalState = {
  visible: false, phase: 'loading', name: '', health: 0, playerHealth: MAX_COMBAT_HEALTH,
  maxHealth: MAX_COMBAT_HEALTH, message: '', respawnSeconds: 0, telegraph: '',
  alive: 0, total: 0, bossAlive: false, party: 1, bossPhase: 0, bossLabel: ''
}
let initialized = false
let enemies: Enemy[] = []
let elapsed = 0
let graceSeconds = 1.2
let noticeSeconds = 0
let paused = true
let defeated = false
let bossDropGiven = false
let snapshotAge = 0
/** Edges that block or gate movement between floor cells, keyed from both sides. */
let blockedEdges = new Set<string>()
let doorEdges = new Set<string>()

export function initializeDungeonEnemies() {
  if (initialized) return
  initialized = true
  setPlayerAttackStartHandler(lockOn)
  setPlayerAttackContactHandler(hitEnemies)
  setMultiplayerHandlers({
    hitEnemy: applyRemoteHit,
    hitPlayer: (id, damage, stagger, yaw) => {
      if (id !== localAddress()) return
      if (!receivePlayerCombatHit(damage, stagger, yaw)) return
      state.playerHealth = getPlayerCombatPose()?.health ?? state.playerHealth
      if (state.playerHealth === 0) onLocalDefeated()
    },
    impact: presentImpact,
    enemies: applyEnemySnapshots,
    loot: grantLoot
  })
  engine.addSystem(updateEnemies)
  onDungeonLoaded(populate)
}

export function getWorldRivalState(): Readonly<WorldRivalState> {
  return state
}

/** Re-spawn any enemy whose avatar failed to load. */
export function retryWorldRival() {
  if (state.phase !== 'error') return
  const failed = enemies.filter((e) => e.loading === 'error')
  for (const e of failed) {
    const fresh = spawnEnemy(e.home, e.archetype, e.boss)
    despawn(e)
    enemies[enemies.indexOf(e)] = fresh
  }
  state.phase = 'loading'
}

// --- population --------------------------------------------------------------

function archetypesFor(kind: RoomKind | undefined, index: number): Archetype[] {
  switch (kind) {
    case 'boss': return [BOSS]
    case 'combat': return index % 2 === 0 ? [STRIKER, SCOUT] : [SCOUT, STRIKER]
    case 'treasure': return [GUARD]
    default: return [index % 2 === 0 ? SCOUT : STRIKER]
  }
}

function populate(dungeon: Readonly<DungeonState>) {
  for (const e of enemies) despawn(e)
  enemies = []
  clearLoot()
  defeated = false
  bossDropGiven = false
  state.respawnSeconds = 0
  indexEdges(dungeon)
  const spawns = dungeon.instance?.spawns ?? []
  const rooms = dungeon.dungeon?.rooms ?? []
  spawns.forEach((s, i) => {
    const kind = s.boss ? 'boss' : rooms.find((r) => r.id === s.roomId)?.kind
    archetypesFor(kind, i).forEach((archetype, j) => {
      // Pairs stand a stride apart, still on floor; face the entrance (+Z) so patrols greet the player.
      const offset = j === 0 ? 0 : 1.6
      const x = isDungeonFloor(s.x + offset, s.z) ? s.x + offset : s.x
      const home: CombatPose = { position: Vector3.create(x, COURTYARD.characterFloorY, s.z), facing: 0 }
      enemies.push(spawnEnemy(home, archetype, s.boss))
    })
  })
  state.total = enemies.length
  state.phase = enemies.length ? 'loading' : 'idle'
  state.message = ''
}

function indexEdges(dungeon: Readonly<DungeonState>) {
  blockedEdges = new Set()
  doorEdges = new Set()
  const d = dungeon.dungeon
  if (!d) return
  const opposite: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' }
  const step: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }
  const both = (set: Set<string>, x: number, y: number, side: Side) => {
    set.add(`${x},${y},${side}`)
    const [dx, dy] = step[side]
    set.add(`${x + dx},${y + dy},${opposite[side]}`)
  }
  for (const w of d.walls) both(blockedEdges, w.x, w.y, w.side)
  for (const o of d.doors) both(doorEdges, o.x, o.y, o.side)
}

function spawnEnemy(home: CombatPose, archetype: Archetype, boss: boolean): Enemy {
  const root = engine.addEntity()
  Transform.create(root, { position: { ...home.position } })
  const body = engine.addEntity()
  Transform.create(body, {
    parent: root,
    rotation: Quaternion.fromEulerDegrees(0, (home.facing * 180) / Math.PI, 0),
    scale: Vector3.create(archetype.scale, archetype.scale, archetype.scale)
  })
  setEquipmentAvatar(body, archetype.characterId, archetypeLoadout(archetype), false, boss ? { appearance: BOSS_APPEARANCE } : undefined)
  setEquipmentVisible(body, false)
  setEquipmentMotion(body, boss ? 'menace' : 'combat_idle', true)
  // Enemies advance at a fixed pace; play the walk cycle (authored for ~1.5 m/s) to match it.
  setEquipmentStride(body, Math.min(1.35, Math.max(0.7, (COMBAT_RULES.rivalSpeed * archetype.speed) / 1.5)))
  return {
    root, body, archetype, boss, home, position: { ...home.position }, facing: home.facing, lastFacing: home.facing,
    health: archetype.health, recovery: 0, stagger: 0, blocking: false, visible: false,
    motion: 'combat_idle', healthBar: createEnemyHealthBar(body), brain: createRivalBrain(), slamming: false,
    engaged: false, returningHome: false, dead: false, deadSeconds: 0, loading: 'loading', loadSeconds: 0,
    ring: createDecal('ring'), ritual: boss ? createDecal('ritual') : undefined, hitStop: 0, announced: false, stillSeconds: 0,
    bossBrain: boss ? createBossBrain() : undefined, hyperArmor: false, rollSeconds: 0, rollDir: 1
  }
}

function despawn(e: Enemy) {
  destroyEnemyHealthBar(e.healthBar)
  destroyEquipmentAvatar(e.body)
  destroyDecal(e.ring)
  if (e.ritual) destroyDecal(e.ritual)
  engine.removeEntity(e.body)
  engine.removeEntity(e.root)
}

// --- per-frame ---------------------------------------------------------------

function updateEnemies(deltaTime: number) {
  const dt = Number.isFinite(deltaTime) ? Math.max(0, deltaTime) : 0
  const local = getPlayerCombatPose()
  const fighters = allFighters(local)
  state.visible = !!local
  state.party = 1 + remoteCount()
  if (local) state.playerHealth = local.health
  elapsed += dt
  graceSeconds = Math.max(0, graceSeconds - dt)
  noticeSeconds = Math.max(0, noticeSeconds - dt)

  if (defeated) {
    state.respawnSeconds = Math.max(0, state.respawnSeconds - dt)
    if (state.respawnSeconds === 0) recoverPlayer()
  }

  if (fighters.length === 0) {
    if (!paused && isHost()) {
      for (const e of enemies) {
        e.swing = undefined
        e.slamming = false
        e.blocking = false
        e.targetId = undefined
        resetRivalBrain(e.brain)
        if (!e.dead) playMotion(e, 'combat_idle')
        hideDecals(e)
        stopGlide(e)
      }
    }
    state.telegraph = ''
    paused = true
    for (const e of enemies) {
      tickEnemyPresentation(e, dt)
      updateBar(e)
    }
    return
  }
  if (paused) {
    graceSeconds = 1.2
    paused = false
  }

  let anyLoading = false
  let anyError = false
  let engagedEnemy: Enemy | undefined
  let engagedDistance = Infinity
  for (const e of enemies) {
    tickEnemyPresentation(e, dt)
    if (e.loading !== 'ready') {
      e.loadSeconds += dt
      const loading = getEquipmentLoading(e.body)
      if (loading === 'error' || e.loadSeconds > 35) {
        e.loading = 'error'
        anyError = true
      } else if (loading === 'ready') {
        e.loading = 'ready'
        show(e, true)
        playMotion(e, e.boss ? 'menace' : 'combat_idle', true)
        syncTransform(e)
      } else anyLoading = true
      continue
    }
    if (e.dead) {
      e.deadSeconds += dt
      if (e.deadSeconds > CORPSE_SECONDS) show(e, false)
      updateBar(e)
      continue
    }
    if (isHost()) {
      const target = pickTarget(e, fighters)
      if (target) {
        if (e.boss) updateBoss(e, dt, target, fighters)
        else updateEnemy(e, dt, target, fighters)
      }
      else {
        if (e.engaged) {
          e.engaged = false
          e.returningHome = true
          e.swing = undefined
          e.slamming = false
          e.blocking = false
          e.targetId = undefined
          resetRivalBrain(e.brain)
          if (e.bossBrain) resetBossBrain(e.bossBrain)
          hideDecals(e)
        }
        if (e.returningHome) {
          const stride = COMBAT_RULES.rivalSpeed * e.archetype.speed * Math.min(dt, 0.05)
          moveToward(e, e.home, stride, 0)
          if (combatDistance(e, e.home) < 0.05) {
            e.returningHome = false
            e.health = e.archetype.health
            e.stagger = 0
            e.recovery = 0
            playMotion(e, e.boss ? 'menace' : 'combat_idle')
          }
          syncTransform(e, dt)
        }
      }
    }
    updateBar(e)
    if (e.engaged) {
      const focus = local ?? fighters[0]
      const d = combatDistance(e, focus)
      if (d < engagedDistance) {
        engagedDistance = d
        engagedEnemy = e
      }
    }
  }

  if (isHost()) {
    snapshotAge += dt
    if (snapshotAge >= 0.12) {
      snapshotAge = 0
      publishEnemies(enemies.map((e, i) => ({
        i, x: e.position.x, z: e.position.z, f: e.facing, h: e.health, m: e.motion, dead: e.dead, engaged: e.engaged
      })))
    }
  }

  state.alive = enemies.filter((e) => !e.dead).length
  state.bossAlive = enemies.some((e) => e.boss && !e.dead)
  if (defeated) state.phase = 'defeat'
  else if (anyError) state.phase = 'error'
  else if (anyLoading && !engagedEnemy) state.phase = 'loading'
  else state.phase = engagedEnemy ? 'fighting' : 'idle'
  if (engagedEnemy && !defeated) {
    state.name = engagedEnemy.archetype.name
    state.health = engagedEnemy.health
    state.maxHealth = engagedEnemy.archetype.health
    if (engagedEnemy.boss && engagedEnemy.bossBrain) {
      state.bossPhase = engagedEnemy.bossBrain.phase
      state.bossLabel = bossPhaseLabel(engagedEnemy.bossBrain.phase)
    } else {
      state.bossPhase = 0
      state.bossLabel = ''
    }
    if (noticeSeconds === 0) {
      state.message = engagedEnemy.blocking
        ? `${engagedEnemy.archetype.name} guarding — heavies and the third light break through`
        : 'E light (x3 combo) · F heavy · Space block · Ctrl roll'
    }
  } else if (!defeated) {
    state.telegraph = ''
    if (noticeSeconds === 0) {
      state.message = state.alive === 0 && enemies.length > 0 ? 'The dungeon is cleared' : ''
    }
  }
}

function tickEnemyPresentation(e: Enemy, dt: number) {
  if (e.hitStop > 0) {
    e.hitStop -= dt
    if (e.hitStop <= 0) {
      e.hitStop = 0
      setEquipmentTimeScale(e.body, 1)
    }
  }
}

function pickTarget(e: Enemy, fighters: NetFighter[]): NetFighter | undefined {
  const living = fighters.filter((f) => f.health > 0 && isInCourtyard(f.position) &&
    combatDistance(e.home, f) <= e.archetype.leash &&
    Math.abs(f.position.y - e.position.y) <= COMBAT_RULES.maximumVerticalReach + 1)
  if (living.length === 0) return undefined
  const current = e.targetId ? living.find((f) => f.address === e.targetId) : undefined
  if (current && combatDistance(e, current) <= e.archetype.leash) return current
  let best = living[0]
  let bestDistance = combatDistance(e, best)
  for (const f of living) {
    const d = combatDistance(e, f)
    if (d < bestDistance) {
      best = f
      bestDistance = d
    }
  }
  e.targetId = best.address
  return best
}

function updateBoss(e: Enemy, dt: number, target: NetFighter, fighters: NetFighter[]) {
  const brain = e.bossBrain
  if (!brain) return
  e.recovery = Math.max(0, e.recovery - dt)
  e.stagger = Math.max(0, e.stagger - dt)
  const movementDt = Math.min(dt, 0.05)
  const stride = COMBAT_RULES.rivalSpeed * e.archetype.speed * movementDt
  const inTerritory = isInCourtyard(target.position) && combatDistance(e.home, target) <= e.archetype.leash &&
    Math.abs(target.position.y - e.position.y) <= COMBAT_RULES.maximumVerticalReach + 1
  if (!inTerritory && e.engaged) {
    e.engaged = false
    e.returningHome = true
    e.swing = undefined
    e.slamming = false
    e.blocking = false
    e.rollSeconds = 0
    resetBossBrain(brain)
    hideDecals(e)
  }
  if (e.returningHome) {
    moveToward(e, e.home, stride, 0)
    if (combatDistance(e, e.home) < 0.05) {
      e.returningHome = false
      e.health = e.archetype.health
      e.stagger = 0
      e.recovery = 0
      playMotion(e, 'menace')
    }
    syncTransform(e, dt)
    return
  }
  if (!e.engaged && inTerritory && combatDistance(e, target) <= e.archetype.aggro && graceSeconds === 0) {
    e.engaged = true
    showNotice(`${e.archetype.name} answers`)
    fxSound('roar', 1)
    kickCrawlerCamera(Vector3.create(0, -0.35, 0.2))
  }
  if (!e.engaged || graceSeconds > 0) {
    if (!e.swing && e.stagger <= 0 && e.rollSeconds <= 0) playMotion(e, 'menace')
    hideDecals(e)
    syncTransform(e, dt)
    return
  }

  if (e.rollSeconds > 0) {
    e.rollSeconds = Math.max(0, e.rollSeconds - dt)
    const side = Vector3.create(Math.cos(e.facing) * e.rollDir, 0, -Math.sin(e.facing) * e.rollDir)
    move(e, side.x * stride * 3.4, side.z * stride * 3.4)
    playMotion(e, 'roll')
    advanceSwing(e, dt, target, fighters)
    syncTransform(e, dt)
    return
  }

  const decision = updateBossBrain(brain, dt, combatDistance(e, target), canStartAttack(e) && e.rollSeconds <= 0, e.health, e.archetype.health)
  e.hyperArmor = decision.hyperArmor
  e.blocking = decision.block
  if (decision.notice) showNotice(decision.notice, 1.6)
  if (decision.telegraph) state.telegraph = decision.telegraph
  state.bossPhase = brain.phase
  state.bossLabel = bossPhaseLabel(brain.phase)
  if (decision.pose && !e.swing) {
    playMotion(e, decision.pose, decision.pose !== e.motion)
    if (decision.pose === 'flourish' || decision.pose === 'menace_enter') {
      fxSound('roar', decision.pose === 'flourish' ? 1 : 0.75)
      kickCrawlerCamera(Vector3.create(0, -0.22, 0.12))
    }
  }
  if (decision.advance && !e.swing) moveToward(e, target, stride * (brain.phase === 3 ? 1.25 : 1), COMBAT_RULES.approachStop)

  if (decision.telegraphAttack) {
    const slam = decision.telegraphAttack === 'slam'
    const wide = slam || decision.telegraphAttack === 'flourish_heavy' || decision.telegraphAttack === 'leap'
    if (!e.announced) {
      e.announced = true
      if (wide) fxSound('roar', 0.85)
    }
    const radius = slam ? (brain.phase === 3 ? 4.1 : SLAM_RADIUS) :
      attackRange(weaponOf(decision.telegraphAttack)) * 0.55
    const centre = slam
      ? e.position
      : Vector3.create(e.position.x + Math.sin(e.facing) * radius, e.position.y, e.position.z + Math.cos(e.facing) * radius)
    if (slam && e.ritual) {
      updateDecal(e.ring, false)
      updateDecal(e.ritual, true, centre, radius, decision.telegraphProgress, Color3.create(1, 0.12, 0.08))
    } else {
      updateDecal(e.ritual ? e.ritual : e.ring, false)
      updateDecal(e.ring, true, centre, radius, decision.telegraphProgress,
        wide ? Color3.create(1, 0.4, 0.05) : Color3.create(1, 0.2, 0.15))
    }
  } else {
    e.announced = false
    hideDecals(e)
  }

  if (decision.attack) {
    if (decision.attack === 'roll') {
      e.rollSeconds = COMBAT_CLIPS.roll.duration
      e.rollDir = Math.random() < 0.5 ? 1 : -1
      e.blocking = false
      playMotion(e, 'roll', true)
      fxSound('dodge', 0.7)
    } else {
      const slam = decision.attack === 'slam'
      const motion = weaponOf(decision.attack)
      e.swing = createSwing(motion, elapsed)
      e.slamming = slam
      e.blocking = false
      playMotion(e, motion, true)
      if (!slam) {
        fxSlash(e.body, slashStyle(motion))
        fxSound(isHeavyMotion(motion) ? 'swing_heavy' : 'swing_light', 0.55)
      }
    }
  }

  if (e.swing?.motion === 'leap') moveToward(e, target, stride * 3.6, 1.1)
  if (!e.swing && e.stagger <= 0) faceTarget(e, target)
  separate(e, target)
  advanceSwing(e, dt, target, fighters)
  if (e.health > 0 && !e.swing && e.rollSeconds <= 0 && e.stagger <= 0 && !decision.pose) {
    e.stillSeconds = decision.advance ? 0 : e.stillSeconds + dt
    const walking = decision.advance || (e.motion === 'walk' && e.stillSeconds < 0.15)
    playMotion(e, e.blocking ? 'block' : walking ? 'walk' : 'combat_idle')
  }
  syncTransform(e, dt)
}

function weaponOf(attack: BossAttack): WeaponMotion {
  if (attack === 'slam') return 'flourish_heavy'
  if (attack === 'roll') return 'fencing'
  return attack
}

function slashStyle(motion: WeaponMotion): AttackMotion {
  if (motion === 'attack_light2' || motion === 'fencing' || motion === 'attack_light3') return 'attack_light2'
  if (isHeavyMotion(motion)) return 'attack_heavy'
  return 'attack_light'
}

function updateEnemy(e: Enemy, dt: number, target: NetFighter, fighters: NetFighter[]) {
  e.recovery = Math.max(0, e.recovery - dt)
  e.stagger = Math.max(0, e.stagger - dt)
  const movementDt = Math.min(dt, 0.05)
  const stride = COMBAT_RULES.rivalSpeed * e.archetype.speed * movementDt

  const inTerritory = isInCourtyard(target.position) && combatDistance(e.home, target) <= e.archetype.leash &&
    Math.abs(target.position.y - e.position.y) <= COMBAT_RULES.maximumVerticalReach + 1
  if (!inTerritory && e.engaged) {
    e.engaged = false
    e.returningHome = true
    e.swing = undefined
    e.slamming = false
    e.blocking = false
    resetRivalBrain(e.brain)
    if (e.bossBrain) resetBossBrain(e.bossBrain)
    hideDecals(e)
  }
  if (e.returningHome) {
    moveToward(e, e.home, stride, 0)
    if (combatDistance(e, e.home) < 0.05) {
      e.returningHome = false
      e.health = e.archetype.health
      e.stagger = 0
      e.recovery = 0
      playMotion(e, 'combat_idle')
    }
    syncTransform(e, dt)
    return
  }
  if (!e.engaged && inTerritory && combatDistance(e, target) <= e.archetype.aggro && graceSeconds === 0) {
    e.engaged = true
    if (e.boss) {
      showNotice(`${e.archetype.name} has noticed the party`)
      fxSound('roar', 0.9)
    }
  }
  if (!e.engaged || graceSeconds > 0) {
    if (!e.swing && e.stagger <= 0) playMotion(e, 'combat_idle')
    advanceSwing(e, dt, target, fighters)
    hideDecals(e)
    return
  }

  if (!e.swing && e.stagger <= 0) faceTarget(e, target)
  const decision = updateRivalBrain(e.brain, dt, combatDistance(e, target), canStartAttack(e), e.archetype.profile)
  e.blocking = decision.block
  if (decision.telegraph) state.telegraph = decision.telegraph
  if (decision.advance) moveToward(e, target, stride, COMBAT_RULES.approachStop)

  // Telegraph decals: a red ring the size of the coming swing, or the boss's slam circle.
  if (decision.telegraphAttack) {
    const slam = decision.telegraphAttack === 'slam'
    const heavy = decision.telegraphAttack === 'attack_heavy'
    if (!e.announced) {
      e.announced = true
      if (slam) fxSound('roar', 1)
    }
    if (slam && e.ritual) {
      updateDecal(e.ring, false)
      updateDecal(e.ritual, true, e.position, SLAM_RADIUS, decision.telegraphProgress, Color3.create(1, 0.15, 0.1))
    } else {
      // Rings are centred a stride ahead of the enemy, where the blade lands.
      const reach = heavy ? 2.15 : 1.9
      const centre = Vector3.create(e.position.x + Math.sin(e.facing) * reach * 0.5, e.position.y, e.position.z + Math.cos(e.facing) * reach * 0.5)
      updateDecal(e.ring, true, centre, reach * 0.55, decision.telegraphProgress,
        heavy ? Color3.create(1, 0.45, 0.05) : Color3.create(1, 0.2, 0.15))
    }
  } else {
    e.announced = false
    hideDecals(e)
  }

  if (decision.attack) {
    const slam = decision.attack === 'slam'
    const motion: AttackMotion = decision.attack === 'slam' ? 'attack_heavy' : decision.attack
    e.swing = createSwing(motion, elapsed)
    e.slamming = slam
    e.blocking = false
    playMotion(e, motion, true)
    if (!slam) {
      fxSlash(e.body, motion)
      fxSound(motion === 'attack_heavy' ? 'swing_heavy' : 'swing_light', 0.45)
    }
  }
  separate(e, target)
  advanceSwing(e, dt, target, fighters)
  if (e.health > 0 && !e.swing && e.stagger <= 0) {
    // At the edge of reach the advance flag can flip every tick as the player
    // shuffles; hold the walk briefly so the gait does not pop in and out.
    e.stillSeconds = decision.advance ? 0 : e.stillSeconds + dt
    const walking = decision.advance || (e.motion === 'walk' && e.stillSeconds < 0.15)
    playMotion(e, e.blocking ? 'block' : walking ? 'walk' : 'combat_idle')
  }
  syncTransform(e, dt)
}

// --- player attacks ----------------------------------------------------------

/** Soft lock-on: turn the body to the best enemy in front and step in if it is just out of reach. */
function lockOn(motion: AttackMotion, _context: AttackContext) {
  const attacker = getPlayerCombatPose()
  if (!attacker || attacker.health <= 0 || paused || defeated) return
  const reach = motion === 'attack_heavy' ? 2.15 : 1.9
  // Only when the enemy is actually there: swinging while running through a room
  // must not yank the body around or teleport the player toward distant targets.
  const range = reach + LOCK_MARGIN
  let best: Enemy | undefined
  let bestScore = Infinity
  for (const e of enemies) {
    if (e.loading !== 'ready' || e.dead || e.returningHome) continue
    const d = combatDistance(attacker, e)
    if (d > range || !facesCombatant(attacker, e, LOCK_COS)) continue
    if (Math.abs(attacker.position.y - e.position.y) > COMBAT_RULES.maximumVerticalReach) continue
    // Prefer near and centred targets.
    const dx = e.position.x - attacker.position.x
    const dz = e.position.z - attacker.position.z
    const dot = d > 0.0001 ? (Math.sin(attacker.facing) * dx + Math.cos(attacker.facing) * dz) / d : 1
    const score = d + (1 - dot) * 1.5
    if (score < bestScore) {
      bestScore = score
      best = e
    }
  }
  if (!best) return
  const dx = best.position.x - attacker.position.x
  const dz = best.position.z - attacker.position.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance > 0.0001) setPlayerFacingOverride(Math.atan2(dx, dz))
  // The wind-up's lunge closes the last gap so the blow lands at sword reach;
  // an enemy already that close gets a swing from a standstill.
  setPlayerStepIn(distance - STEP_TO)
}

function hitEnemies(motion: AttackMotion, context: AttackContext) {
  const attacker = getPlayerCombatPose()
  if (!attacker || attacker.health <= 0 || paused || defeated) return
  let best: Enemy | undefined
  let bestIndex = -1
  let bestDistance = Infinity
  enemies.forEach((e, i) => {
    if (e.loading !== 'ready' || e.dead || e.returningHome || !attackCanReach(attacker, e, motion)) return
    const d = combatDistance(attacker, e)
    if (d < bestDistance) {
      bestDistance = d
      best = e
      bestIndex = i
    }
  })
  if (!best || bestIndex < 0) return
  presentPlayerStrike(attacker, best, motion, context)
  if (isHost()) applyPlayerHit(attacker, best, motion, context)
  else publishHitEnemy(bestIndex, motion, context.finisher)
}

function applyRemoteHit(id: string, index: number, motion: string, finisher: boolean) {
  if (!isHost()) return
  const attack = asAttack(motion)
  const e = enemies[index]
  if (!attack || !e || e.dead || e.loading !== 'ready') return
  const attacker = allFighters(getPlayerCombatPose()).find((f) => f.address === id)
  if (!attacker) return
  applyPlayerHit(attacker, e, attack, { finisher })
}

function applyPlayerHit(
  attacker: CombatPose, e: Enemy, motion: AttackMotion, context: { finisher: boolean }
) {
  e.engaged = true
  const guarded = e.blocking && facesCombatant(e, attacker, 0.1)
  const hit = resolveCombatHit(motion, guarded, context.finisher)
  const armored = e.hyperArmor && !context.finisher && motion !== 'attack_heavy'
  const damage = armored ? Math.max(1, Math.round(hit.damage * 0.55)) : hit.damage
  e.health = Math.max(0, e.health - damage)
  const freeze = motion === 'attack_heavy' || context.finisher ? 0.09 : 0.06
  e.hitStop = freeze
  setEquipmentTimeScale(e.body, 0.02)
  if (!hit.interrupt || armored) return
  e.swing = undefined
  e.slamming = false
  e.blocking = false
  hideDecals(e)
  resetRivalBrain(e.brain, 0.1, false)
  if (e.health === 0) {
    kill(e)
    return
  }
  e.stagger = hit.stagger
  playMotion(e, 'hit', true)
  move(e, Math.sin(attacker.facing) * hit.knockback, Math.cos(attacker.facing) * hit.knockback)
  syncTransform(e)
}

function presentPlayerStrike(
  attacker: CombatPose, e: Enemy, motion: AttackMotion, context: { finisher: boolean }
) {
  const heavy = motion === 'attack_heavy'
  const guarded = e.blocking && facesCombatant(e, attacker, 0.1)
  const hit = resolveCombatHit(motion, guarded, context.finisher)
  const contact = Vector3.create(
    (attacker.position.x + e.position.x) / 2, e.position.y + 1.15 * e.archetype.scale, (attacker.position.z + e.position.z) / 2)
  fxImpact(contact, heavy || context.finisher, hit.damage === 0)
  const kind = hit.damage === 0 ? 'blocked' : context.finisher ? 'finisher' : heavy ? 'heavy' : guarded ? 'blocked' : 'damage'
  const label = hit.damage === 0 ? 'Blocked' : `${hit.damage}`
  fxNumber(Vector3.create(contact.x, contact.y + 0.6, contact.z), label, kind)
  const sound = hit.damage === 0 || guarded ? 'block' : heavy || context.finisher ? 'hit_heavy' : 'hit_light'
  const vol = hit.damage === 0 ? 0.7 : 0.9
  fxSound(sound, vol)
  const weight = heavy ? 0.3 : context.finisher ? 0.26 : 0.16
  kickCrawlerCamera(Vector3.create(Math.sin(attacker.facing) * weight, -weight * 0.3, Math.cos(attacker.facing) * weight))
  hitStopPlayer(heavy || context.finisher ? 0.09 : 0.06)
  publishImpact({
    x: contact.x, y: contact.y, z: contact.z, heavy: heavy || context.finisher,
    blocked: hit.damage === 0, label, kind, sound, vol
  })
}

function presentImpact(p: ImpactNet) {
  const contact = Vector3.create(p.x, p.y, p.z)
  fxImpact(contact, p.heavy, p.blocked)
  fxNumber(Vector3.create(p.x, p.y + 0.6, p.z), p.label, p.kind as 'damage' | 'heavy' | 'finisher' | 'blocked')
  fxSound(p.sound as 'block' | 'hit_heavy' | 'hit_light', p.vol)
}

function asAttack(motion: string): AttackMotion | undefined {
  if (motion === 'attack_light' || motion === 'attack_light2' || motion === 'attack_heavy') return motion
}

function kill(e: Enemy) {
  presentDeath(e)
  if (!isHost()) return
  const coin = e.boss ? 10 : 2 + Math.floor(Math.random() * 3)
  const heart = e.boss ? 2 : Math.random() < 0.35 ? 1 : 0
  const dusk = !!(e.boss && !bossDropGiven)
  if (dusk) bossDropGiven = true
  grantLoot(e.position.x, e.position.z, coin, heart, dusk)
  publishLoot(e.position.x, e.position.z, coin, heart, dusk)
}

function grantLoot(x: number, z: number, coin: number, heart: number, dusk: boolean) {
  const origin = Vector3.create(x, COURTYARD.characterFloorY, z)
  if (coin > 0) spawnLoot(origin, 'coin', coin)
  if (heart > 0) spawnLoot(origin, 'heart', heart)
  if (dusk && unlockInventoryItem(BOSS_DROP)) {
    fxGlitter(Vector3.add(origin, Vector3.create(0, 1.2, 0)), Color4.create(0.6, 0.5, 1, 1))
    fxNumber(Vector3.add(origin, Vector3.create(0, 2.4, 0)), 'Dusk blade unlocked', 'note')
    showNotice('The Warlord drops the Dusk blade — check your inventory', 3)
  }
}

function presentDeath(e: Enemy) {
  if (e.dead) return
  e.dead = true
  e.deadSeconds = 0
  e.engaged = false
  e.targetId = undefined
  stopGlide(e)
  playMotion(e, 'death', true)
  fxSound('death', 0.8)
  fxDeathPuff(e.position)
  showNotice(e.boss ? `${e.archetype.name} is slain!` : `${e.archetype.name} down`)
}

// --- enemy attacks -----------------------------------------------------------

function advanceSwing(e: Enemy, dt: number, target: NetFighter, fighters: NetFighter[]) {
  if (!e.swing) return
  const swing = e.swing
  const finished = advanceAttack(swing, elapsed, dt, () => {
    if (e.slamming) {
      slam(e, fighters)
      return
    }
    if (!attackCanReach(e, target, swing.motion)) return
    const guarded = target.blocking && facesCombatant(target, e, 0.1)
    const hit = resolveCombatHit(swing.motion, guarded)
    if (hit.damage === 0) {
      if (target.local) playerBlockedHit(e.facing)
      fxImpact(Vector3.add(target.position, Vector3.create(0, 1.2, 0)), false, true)
      return
    }
    const damage = Math.round(hit.damage * e.archetype.damageScale)
    strikeFighter(target, damage, hit.stagger, e.facing)
    fxImpact(Vector3.add(target.position, Vector3.create(0, 1.2, 0)), isHeavyMotion(swing.motion), false)
    fxSound(isHeavyMotion(swing.motion) ? 'hit_heavy' : 'hit_light', 0.8)
  })
  if (e.swing === swing && finished) {
    e.swing = undefined
    e.slamming = false
    e.recovery = attackRecovery(swing.motion)
  }
}

function slam(e: Enemy, fighters: NetFighter[]) {
  const radius = e.bossBrain?.phase === 3 ? 4.1 : SLAM_RADIUS
  const damage = e.bossBrain?.phase === 3 ? 38 : SLAM_DAMAGE
  hideDecals(e)
  fxSlam(e.position, radius)
  fxSound('slam', 1)
  const local = getPlayerCombatPose()
  if (local) {
    const d = combatDistance(e, local)
    const weight = Math.max(0.15, 0.5 - d * 0.06)
    kickCrawlerCamera(Vector3.create(0, -weight, weight * 0.4))
  }
  for (const fighter of fighters) {
    if (fighter.health <= 0) continue
    const d = combatDistance(e, fighter)
    if (d > radius || Math.abs(fighter.position.y - e.position.y) > COMBAT_RULES.maximumVerticalReach) continue
    const towards = Math.atan2(fighter.position.x - e.position.x, fighter.position.z - e.position.z)
    strikeFighter(fighter, damage, 0.9, towards)
  }
}

function strikeFighter(target: NetFighter, damage: number, stagger: number, yaw: number) {
  if (target.local) {
    if (!receivePlayerCombatHit(damage, stagger, yaw)) return
    state.playerHealth = getPlayerCombatPose()?.health ?? state.playerHealth
    if (state.playerHealth === 0) onLocalDefeated()
    return
  }
  publishHitPlayer(target.address, damage, stagger, yaw)
}

function onLocalDefeated() {
  defeated = true
  state.phase = 'defeat'
  state.respawnSeconds = RECOVER_SECONDS
  state.telegraph = ''
  setPlayerFacingOverride(undefined)
}

/** Back to the entrance with full health. Living enemies keep fighting anyone still standing. */
function recoverPlayer() {
  defeated = false
  restorePlayerCombatHealth()
  graceSeconds = 2
  state.phase = 'idle'
  state.playerHealth = MAX_COMBAT_HEALTH
  state.message = ''
  movePlayerToSpawn()
}

function applyEnemySnapshots(list: EnemySnap[]) {
  for (const snap of list) {
    const e = enemies[snap.i]
    if (!e) continue
    e.position = Vector3.create(snap.x, COURTYARD.characterFloorY, snap.z)
    e.facing = snap.f
    e.health = snap.h
    e.engaged = snap.engaged
    if (snap.dead) presentDeath(e)
    else if (!e.dead) {
      const reset = snap.m !== e.motion && (
        snap.m === 'attack_light' || snap.m === 'attack_light2' || snap.m === 'attack_light3' ||
        snap.m === 'attack_heavy' || snap.m === 'flourish_heavy' || snap.m === 'stab' ||
        snap.m === 'heavy_combo_a' || snap.m === 'heavy_combo_b' || snap.m === 'heavy_combo_c' ||
        snap.m === 'leap' || snap.m === 'fencing' || snap.m === 'flourish' || snap.m === 'menace_enter' ||
        snap.m === 'roll' || snap.m === 'stun' || snap.m === 'hit'
      )
      playMotion(e, snap.m, reset)
      const attack = asAttack(snap.m)
      const style = attack ?? (snap.m === 'flourish_heavy' || snap.m === 'stab' || snap.m === 'heavy_combo_a' ||
        snap.m === 'heavy_combo_b' || snap.m === 'heavy_combo_c' || snap.m === 'leap' || snap.m === 'fencing' ||
        snap.m === 'attack_light3' ? slashStyle(snap.m) : undefined)
      if (reset && style) {
        fxSlash(e.body, style)
        fxSound(isHeavyMotion(style) ? 'swing_heavy' : 'swing_light', 0.45)
      }
    }
    if (e.loading === 'ready') syncTransform(e, 0.12)
  }
}

// --- movement ----------------------------------------------------------------

function faceTarget(e: Enemy, target: CombatPose) {
  const x = target.position.x - e.position.x
  const z = target.position.z - e.position.z
  if (x * x + z * z > 0.0001) e.facing = Math.atan2(x, z)
}

function moveToward(e: Enemy, target: CombatPose, amount: number, stop: number) {
  const distance = combatDistance(e, target)
  if (distance <= stop + 0.0001) return
  faceTarget(e, target)
  const step = Math.min(amount, distance - stop)
  move(e, ((target.position.x - e.position.x) / distance) * step, ((target.position.z - e.position.z) / distance) * step)
  playMotion(e, 'walk')
}

/** Move by (x, z) if the dungeon allows it; otherwise slide along whichever axis is free. */
function move(e: Enemy, x: number, z: number) {
  const from = e.position
  const attempt = (dx: number, dz: number) => {
    const nx = from.x + dx
    const nz = from.z + dz
    if (!canStand(nx, nz) || !canCross(from.x, from.z, nx, nz)) return false
    e.position = Vector3.create(nx, COURTYARD.characterFloorY, nz)
    return true
  }
  if (attempt(x, z)) return
  if (Math.abs(x) > 0.0001 && attempt(x, 0)) return
  if (Math.abs(z) > 0.0001) attempt(0, z)
}

function canStand(x: number, z: number): boolean {
  const r = BODY_RADIUS
  return isDungeonFloor(x - r, z - r) && isDungeonFloor(x + r, z - r) &&
    isDungeonFloor(x - r, z + r) && isDungeonFloor(x + r, z + r)
}

/** Cell-to-cell crossings may not pass through a wall, and must go through the middle of a doorway. */
function canCross(x0: number, z0: number, x1: number, z1: number): boolean {
  const a = dungeonCell(x0, z0)
  const b = dungeonCell(x1, z1)
  if (a.cx === b.cx && a.cy === b.cy) return true
  const side: Side | undefined = b.cy < a.cy ? 'n' : b.cy > a.cy ? 's' : b.cx < a.cx ? 'w' : b.cx > a.cx ? 'e' : undefined
  if (!side) return true
  const key = `${a.cx},${a.cy},${side}`
  if (blockedEdges.has(key)) return false
  if (doorEdges.has(key)) {
    const { style } = getDungeonState()
    const opening = DOOR_OPENINGS[style.door]
    const half = (opening?.width ?? style.tile) / 2 - BODY_RADIUS
    // Lateral offset from the door's centre line, which runs through the cell centre.
    const T = style.tile
    const lateral = side === 'n' || side === 's'
      ? x1 - (Math.floor(x1 / T) * T + T / 2)
      : z1 - (Math.floor(z1 / T) * T + T / 2)
    return Math.abs(lateral) <= half
  }
  return true
}

function separate(e: Enemy, target: CombatPose) {
  if (Math.abs(target.position.y - e.position.y) <= COMBAT_RULES.maximumVerticalReach) {
    const distance = combatDistance(e, target)
    if (distance < COMBAT_RULES.bodySeparation) {
      const push = COMBAT_RULES.bodySeparation - distance
      move(e, (distance > 0.0001 ? (e.position.x - target.position.x) / distance : Math.sin(e.facing + Math.PI)) * push,
        (distance > 0.0001 ? (e.position.z - target.position.z) / distance : Math.cos(e.facing + Math.PI)) * push)
    }
  }
  for (const other of enemies) {
    if (other === e || other.dead || other.loading !== 'ready') continue
    const distance = combatDistance(e, other)
    if (distance >= COMBAT_RULES.bodySeparation || distance < 0.0001) continue
    const push = (COMBAT_RULES.bodySeparation - distance) / 2
    move(e, ((e.position.x - other.position.x) / distance) * push, ((e.position.z - other.position.z) / distance) * push)
  }
}

// --- presentation ------------------------------------------------------------

function showNotice(message: string, seconds = 0.85) {
  state.message = message
  noticeSeconds = seconds
}

function hideDecals(e: Enemy) {
  updateDecal(e.ring, false)
  if (e.ritual) updateDecal(e.ritual, false)
}

function playMotion(e: Enemy, motion: EquipmentMotion, reset = false) {
  if (e.motion === motion && !reset) return
  e.motion = motion
  setEquipmentMotion(e.body, motion, reset)
}

function show(e: Enemy, visible: boolean) {
  if (e.visible === visible) return
  e.visible = visible
  setEquipmentVisible(e.body, visible)
}

function updateBar(e: Enemy) {
  updateEnemyHealthBar(e.healthBar, e.health, e.archetype.health,
    state.visible && e.visible && !e.dead && e.engaged && !e.returningHome)
}

/** Glide the root to the logical position between ticks; rotation goes on the body. */
function syncTransform(e: Enemy, dt?: number) {
  if (e.facing !== e.lastFacing) {
    e.lastFacing = e.facing
    Transform.getMutable(e.body).rotation = Quaternion.fromEulerDegrees(0, (e.facing * 180) / Math.PI, 0)
  }
  const previous = e.lastSynced
  e.lastSynced = { ...e.position }
  if (dt === undefined || dt <= 0 || !previous || e.glide === undefined || Vector3.distance(e.position, previous) > 1.5) {
    // Spawn, respawn, teleport home, knockback: place directly and (re)start gliding.
    if (Tween.has(e.root)) Tween.deleteFrom(e.root)
    Transform.getMutable(e.root).position = { ...e.position }
    e.glide = Vector3.Zero()
    return
  }
  // Hand the renderer a short straight glide from the logical position along the
  // path's smoothed velocity; it interpolates every frame and we replace it next
  // tick. Both ends are ours, so the renderer's read-back never feeds back in.
  const pathVelocity = Vector3.scale(Vector3.subtract(e.position, previous), 1 / dt)
  e.glide = Vector3.lerp(e.glide, pathVelocity, 1 - Math.exp(-dt * 14))
  if (Vector3.length(e.glide) < 0.01 && Vector3.length(pathVelocity) < 0.01) {
    if (Tween.has(e.root)) {
      Tween.deleteFrom(e.root)
      Transform.getMutable(e.root).position = { ...e.position }
    }
    e.glide = Vector3.Zero()
    return
  }
  Tween.setMove(e.root, { ...e.position }, Vector3.add(e.position, Vector3.scale(e.glide, 0.12)), 120, EasingFunction.EF_LINEAR)
}

/** Stop the renderer-side glide and pin the root where the logic says it is. */
function stopGlide(e: Enemy) {
  if (Tween.has(e.root)) Tween.deleteFrom(e.root)
  Transform.getMutable(e.root).position = { ...e.position }
  e.glide = undefined
  e.lastSynced = undefined
}
