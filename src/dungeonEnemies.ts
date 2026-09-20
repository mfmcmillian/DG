// Roaming enemies and the boss, one per dungeon spawn point. This generalises
// the old single courtyard rival: the same brain, swings, hit rules, health bars
// and equipment avatars, but many actors, each leashed to its own room, and
// movement that respects the dungeon's walls and doorways.
//
// Presentation (particles, numbers, sounds, telegraph decals, camera kicks,
// hit-stop) lives in combatFx; loot in loot.ts.

import { EasingFunction, engine, Entity, Transform, Tween } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { DEFAULT_LOADOUTS, EquipmentLoadout } from './equipmentCatalog'
import { CharacterAppearance } from './appearance'
import {
  destroyEquipmentAvatar, equipmentModelPaths, getEquipmentLoading, setEquipmentAvatar,
  setEquipmentMotion, setEquipmentStride, setEquipmentTimeScale, setEquipmentVisible
} from './equipmentAvatar'
import { EquipmentMotion } from './combatAnimations'
import {
  advanceAttack, attackCanReach, attackRange, attackRecovery, AttackMotion, canStartAttack,
  combatDistance, CombatPose, COMBAT_RULES, createSwing, facesCombatant, HeroAttackMotion, isHeavyMotion, isRangedAttack,
  MAX_COMBAT_HEALTH, resolveCombatHit, Swing, WeaponModifiers, WeaponMotion
} from './combatActions'
import { heroClassOf, shotProfile, weaponPoolFor } from './heroClasses'
import { clearProjectiles, launchShot, ProjectileTarget, setProjectileTargets, SHOT_HEIGHT } from './projectiles'
import { createRivalBrain, resetRivalBrain, RivalBrain, updateRivalBrain } from './rivalBrain'
import {
  BossAttack, BossBrain, bossPhaseLabel, createBossBrain, resetBossBrain, updateBossBrain
} from './bossBrain'
import { COMBAT_CLIPS } from './combatAnimations'
import {
  createEnemyHealthBar, destroyEnemyHealthBar, EnemyHealthBar, updateEnemyHealthBar
} from './enemyHealthBar'
import {
  getPlayerCharacterState, getPlayerCombatPose, getPlayerWeapon, healPlayer, hitStopPlayer, isPlayerDown, playerBlockedHit, playerDodgedHit,
  receivePlayerCombatHit, reconcilePlayerHealth, restorePlayerCombatHealth,
  setPlayerAttackContactHandler, setPlayerAttackStartHandler, setPlayerEnemyWithinHandler, setPlayerFacingOverride, setPlayerStepIn
} from './playerCharacter'
import { presentRemoteHeal, presentRemoteHit, presentRemoteRevive, presentRemoteShot } from './remotePlayers'
import { RAID_RECOVER_SECONDS, RECOVER_SECONDS, strikeHero } from './heroVitals'
import { movePlayerToSpawn } from './playerPlacement'
import { DungeonState, onDungeonLoaded } from './dungeon'
import { cellCenter, DungeonStyle, gridOrigin, StyleId, STYLES, styleGeneratorOptions } from './dungeon/config'
import { DOOR_OPENINGS } from './dungeon/kit'
import { edgeMidpoint, sideInward, sideYaw } from './dungeon/layout'
import { Archetype, Roster, rosterFor } from './dungeon/rosters'
import { Dungeon, generateDungeon, RoomKind, Side } from './dungeon/generator'
import { authoredLayout } from './dungeon/layouts'
import {
  DifficultyDefinition, difficultyById, HUB_LEVEL, LevelDefinition, levelById, RAID_PARTY
} from './shared/levels'
import { HUB, partyOf } from './partyLookup'
import { heroBonusesFor } from './heroXp'
import {
  createDecal, Decal, destroyDecal, fxDeathPuff, fxGlitter, fxImpact, fxNumber, fxSlam, fxSlash, fxSound, FxSound, fxWoodHit, updateDecal
} from './combatFx'
import { kickCrawlerCamera } from './dungeon/crawlerCamera'
import { clearLoot, spawnLoot } from './loot'
import { rollWeaponDrop, weaponStats } from './weapons'
import { AttackContext } from './roamingCombat'
import {
  allFighters, EnemySnap, heroCharacters, HeroHit, heroWeapon, ImpactNet, isHeadless, isHost, localAddress, NetFighter, publishEnemies, publishHitEnemy,
  publishImpact, publishLoot, publishRespawn, publishShot, setMultiplayerHandlers
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

type Enemy = CombatPose & {
  /** Position only; glided by the renderer between ticks. Never written while gliding. */
  root: Entity
  /** Child carrying rotation, scale, the outfit and the health bar. */
  body: Entity
  archetype: Archetype; boss: boolean
  /** Full health for this run: the archetype's, scaled by level and difficulty. */
  maxHealth: number
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
  /** Seconds left of answering a blow from outside the leash: face it, close to the edge, do not chase. */
  provoked: number
  provokedFrom?: CombatPose
  /** Left home during this engagement; only then does the walk back restore health. */
  strayed: boolean
  /** Cached grid route toward whatever the enemy last walked to. */
  path?: EnemyPath
}

type EnemyPath = { key: string; cells: Array<{ cx: number; cy: number }>; age: number }

const BOSS_APPEARANCE: CharacterAppearance = { bodyType: 'male', hairStyle: 'short', hairColor: 'brown', skinTone: 'warm' }

function archetypeLoadout(archetype: Archetype): EquipmentLoadout {
  // One-piece realm bodies have no Sidekick defaults; the armor slots are unused for them anyway.
  return { ...(DEFAULT_LOADOUTS[archetype.characterId] ?? DEFAULT_LOADOUTS.vanguard), ...archetype.armor, weapon: archetype.weapon }
}

/** GLBs one realm's roster will request. Defaults to the fortress so the title does not wait on later realms. */
export function enemyPreloadAssets(styleId: StyleId = 'open'): string[] {
  const roster = rosterFor(styleId)
  const archetypes = [roster.striker, roster.scout, roster.guard, roster.boss]
  if (roster.posted) archetypes.push(roster.posted)
  const paths: string[] = []
  for (const archetype of archetypes) {
    paths.push(...equipmentModelPaths(archetype.characterId, archetypeLoadout(archetype), archetype.role === 'boss' ? BOSS_APPEARANCE : undefined))
  }
  return paths
}

const SLAM_RADIUS = 3.2
const SLAM_DAMAGE = 32
const CORPSE_SECONDS = 4
const BODY_RADIUS = 0.42
/** Soft lock-on only engages once a target is just about in reach, within this half-angle. */
const LOCK_MARGIN = 0.35
const LOCK_COS = 0.1
/** The swing's lunge closes to this distance from a locked-on enemy. */
const STEP_TO = 1.2
/** How long a blow from beyond the leash keeps an enemy facing the shooter at its edge. */
const PROVOKED_SECONDS = 5
/** Wandering this far from home during a fight counts as having left it (heals on the way back). */
const STRAY_DISTANCE = 1.5
/** Grid routes are re-solved this often while walking. */
const PATH_REPLAN_SECONDS = 0.4

const state: WorldRivalState = {
  visible: false, phase: 'loading', name: '', health: 0, playerHealth: MAX_COMBAT_HEALTH,
  maxHealth: MAX_COMBAT_HEALTH, message: '', respawnSeconds: 0, telegraph: '',
  alive: 0, total: 0, bossAlive: false, party: 1, bossPhase: 0, bossLabel: ''
}

/**
 * One party's fight: its layout (for the enemies' pathing), its enemies and
 * the run's bookkeeping. The client has exactly one, for the party it is in
 * (or the empty hub). The headless server has one per running party; they all
 * occupy the same 96 m, each invisible to the others' members.
 */
type Sim = {
  party: string
  level: LevelDefinition
  diff: DifficultyDefinition
  dungeon: Dungeon
  style: DungeonStyle
  enemies: Enemy[]
  /** Edges that block or gate movement between floor cells, keyed from both sides. */
  blockedEdges: Set<string>
  doorEdges: Set<string>
  graceSeconds: number
  paused: boolean
  bossDropGiven: boolean
  snapshotAge: number
  damageScale: number
  coinScale: number
  slain: number
  /** Verdict: the Warlord fell, or every hero was down at once. */
  won: boolean
  lost: boolean
  /** Host-owned floor traps (forge). Visuals come from the layout. */
  traps: Array<{ x: number; z: number; radius: number; damage: number; cool: number }>
}

export type RunStatus = { slain: number; total: number; won: boolean; lost: boolean }

let initialized = false
/** The simulation the code below is working on; switched per party on the server. */
let sim: Sim | undefined
/** Client: the one simulation, for our party (or the hub). */
let clientSim: Sim | undefined
/** Client: the run our party is in; the next dungeon load populates for it (none = hub, no enemies). */
let clientRun: { party: string; level: number; diff: number } | undefined
/** Headless server: one simulation per running party. */
const sims = new Map<string, Sim>()
let elapsed = 0
let noticeSeconds = 0
let defeated = false
/** The local countdown ran out and a `respawn` was sent; cleared by the revive. */
let respawnAsked = false

export function initializeDungeonEnemies() {
  if (initialized) return
  initialized = true
  setPlayerAttackStartHandler(lockOn)
  setPlayerAttackContactHandler(hitEnemies)
  setPlayerEnemyWithinHandler(enemyWithin)
  setProjectileTargets(projectileTargets)
  setMultiplayerHandlers({
    hitEnemy: applyRemoteHit,
    shot: (p) => {
      if (samePhase(p.id)) presentRemoteShot(p)
    },
    hitPlayer: applyHeroHit,
    heal: (id, amount, health) => {
      if (id === localAddress()) healPlayer(amount, health)
      else if (samePhase(id)) presentRemoteHeal(id, amount)
    },
    revive: (id, _health, inPlace) => {
      if (id === localAddress()) recoverPlayer(inPlace)
      else if (samePhase(id)) presentRemoteRevive(id)
    },
    vitals: (id, health) => {
      if (id !== localAddress()) return
      const change = reconcilePlayerHealth(health)
      if (change === 'died') onLocalDefeated()
      else if (change === 'revived') recoverPlayer()
    },
    impact: presentImpact,
    enemies: applyEnemySnapshots,
    loot: grantLoot,
    join: () => {
      for (const s of sims.values()) {
        sim = s
        publishEnemies(s.party, enemySnaps())
      }
    }
  })
  engine.addSystem(updateEnemies)
  onDungeonLoaded(populate)
}

export function getWorldRivalState(): Readonly<WorldRivalState> {
  return state
}

/** Client: another hero is in our party (or with us in the hub), so their fight is ours to show. */
function samePhase(id: string): boolean {
  return partyOf(id) === (clientSim?.party ?? HUB)
}

/** Re-spawn any enemy whose avatar failed to load. */
export function retryWorldRival() {
  if (state.phase !== 'error' || !clientSim) return
  sim = clientSim
  const failed = sim.enemies.filter((e) => e.loading === 'error')
  for (const e of failed) {
    const fresh = spawnEnemy(e.home, e.archetype, e.boss)
    despawn(e)
    sim.enemies[sim.enemies.indexOf(e)] = fresh
  }
  state.phase = 'loading'
}

// --- runs (server) -------------------------------------------------------------

/**
 * Server: start simulating a party's run. The layout is generated here from the
 * level's seed, the same way every member's client builds it. A client hosting
 * its own fight (solo fallback) simulates through its one client sim instead.
 */
export function createRunSim(party: string, levelId: number, diffId: number) {
  if (!isHeadless()) return
  destroyRunSim(party)
  const level = levelById(levelId)
  const style = STYLES[level.style]
  const dungeon = authoredLayout(style) ?? generateDungeon(level.seed, styleGeneratorOptions(style))
  const s = createSim(party, level, difficultyById(diffId), dungeon, style, true)
  sims.set(party, s)
  console.log(`[Server] run ${party}: level ${level.id + 1} "${level.name}" (${s.diff.name}), ${s.enemies.length} enemies`)
}

export function destroyRunSim(party: string) {
  const s = sims.get(party)
  if (!s) return
  for (const e of s.enemies) despawn(e)
  sims.delete(party)
  if (sim === s) sim = undefined
}

/** Where a party's run stands; undefined when nothing is simulated for it here. */
export function runStatus(party: string): RunStatus | undefined {
  const s = sims.get(party) ?? (clientSim?.party === party ? clientSim : undefined)
  if (!s) return undefined
  return { slain: s.slain, total: s.enemies.length, won: s.won, lost: s.lost }
}

/** Client: the run the next dungeon load is for. Undefined means the hub: the layout, no enemies. */
export function setClientRun(run: { party: string; level: number; diff: number } | undefined) {
  clientRun = run
}

function simFor(party: string): Sim | undefined {
  return sims.get(party) ?? (clientSim?.party === party ? clientSim : undefined)
}

// --- population --------------------------------------------------------------

function archetypesFor(roster: Roster, kind: RoomKind | undefined, index: number, extra: number): Archetype[] {
  switch (kind) {
    case 'boss': return [roster.boss]
    case 'combat': {
      const pair = index % 2 === 0 ? [roster.striker, roster.scout] : [roster.scout, roster.striker]
      if (roster.posted && index === 0) pair[0] = roster.posted
      for (let i = 0; i < extra; i++) pair.push(i % 2 === 0 ? roster.guard : roster.striker)
      return pair
    }
    case 'treasure': return [roster.guard]
    default: return [index % 2 === 0 ? roster.scout : roster.striker]
  }
}

/** Just inside the room's first doorway, facing out — the posted knight's post. */
function postedDoorHome(dungeon: Dungeon, room: { x: number; y: number; w: number; h: number }, style: DungeonStyle): CombatPose | undefined {
  const door = dungeon.doors.find((d) => d.x >= room.x && d.x < room.x + room.w && d.y >= room.y && d.y < room.y + room.h)
  if (!door) return undefined
  const m = edgeMidpoint(style, door)
  const inward = sideInward(door.side)
  return {
    position: Vector3.create(m.x + inward.x * (style.tile * 0.38), COURTYARD.characterFloorY, m.z + inward.z * (style.tile * 0.38)),
    facing: (sideYaw(door.side) * Math.PI) / 180
  }
}

/** Client: a dungeon was (re)built; the one client sim follows it. */
function populate(dungeon: Readonly<DungeonState>) {
  if (clientSim) {
    for (const e of clientSim.enemies) despawn(e)
    clientSim = undefined
  }
  clearLoot()
  clearProjectiles()
  defeated = false
  respawnAsked = false
  state.respawnSeconds = 0
  if (!dungeon.dungeon) return
  const run = clientRun
  clientSim = run
    ? createSim(run.party, levelById(run.level), difficultyById(run.diff), dungeon.dungeon, dungeon.style, true)
    : createSim(HUB, HUB_LEVEL, difficultyById(0), dungeon.dungeon, dungeon.style, false)
  sim = clientSim
  state.total = sim.enemies.length
  state.phase = sim.enemies.length ? 'loading' : 'idle'
  state.message = ''
}

function createSim(
  party: string, level: LevelDefinition, diff: DifficultyDefinition, dungeon: Dungeon, style: DungeonStyle, withEnemies: boolean
): Sim {
  const s: Sim = {
    party, level, diff, dungeon, style, enemies: [],
    blockedEdges: new Set(), doorEdges: new Set(),
    graceSeconds: 1.2, paused: true, bossDropGiven: false, snapshotAge: 0,
    damageScale: level.damage * diff.damage, coinScale: level.coins * diff.coins,
    slain: 0, won: false, lost: false, traps: []
  }
  indexEdges(s)
  if (!withEnemies) return s
  const previous = sim
  sim = s
  const healthScale = level.health * diff.health
  const roster = rosterFor(style.id)
  // Spawn points come straight from the rooms, so the server and every member
  // enumerate the same enemies in the same order (the snapshot index).
  let index = 0
  for (const room of dungeon.rooms) {
    for (const [ex, ey] of room.enemies) {
      const c = cellCenter(style, ex, ey)
      const boss = room.kind === 'boss'
      archetypesFor(roster, room.kind, index, diff.extra).forEach((archetype, j) => {
        // Pairs stand a stride apart, still on floor; face the entrance (+Z) so patrols greet the player.
        const offset = j === 0 ? 0 : j === 1 ? 1.6 : -1.6
        const x = simFloor(c.x + offset, c.z) ? c.x + offset : c.x
        let home: CombatPose = { position: Vector3.create(x, COURTYARD.characterFloorY, c.z), facing: 0 }
        if (archetype.posted) {
          const posted = postedDoorHome(dungeon, room, style)
          if (posted) home = posted
        }
        const e = spawnEnemy(home, archetype, boss)
        e.maxHealth = Math.round(archetype.health * healthScale)
        e.health = e.maxHealth
        s.enemies.push(e)
      })
      index++
    }
    if (style.trap) {
      for (const [tx, ty] of room.traps) {
        const c = cellCenter(style, tx, ty)
        s.traps.push({ x: c.x, z: c.z, radius: 1.15, damage: Math.round(18 * s.damageScale), cool: 0 })
      }
    }
  }
  sim = previous ?? s
  return s
}

function indexEdges(s: Sim) {
  const d = s.dungeon
  const opposite: Record<Side, Side> = { n: 's', s: 'n', w: 'e', e: 'w' }
  const step: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }
  const both = (set: Set<string>, x: number, y: number, side: Side) => {
    set.add(`${x},${y},${side}`)
    const [dx, dy] = step[side]
    set.add(`${x + dx},${y + dy},${opposite[side]}`)
  }
  for (const w of d.walls) both(s.blockedEdges, w.x, w.y, w.side)
  for (const o of d.doors) both(s.doorEdges, o.x, o.y, o.side)
}

/** Floor test against the current sim's layout (not the client's built dungeon, which may be another party's). */
function simFloor(x: number, z: number): boolean {
  if (!sim) return false
  const d = sim.dungeon
  const o = gridOrigin(sim.style)
  const cx = Math.floor((x - o.x) / sim.style.tile)
  const cy = Math.floor((z - o.z) / sim.style.tile)
  if (cx < 0 || cy < 0 || cx >= d.size || cy >= d.size) return false
  return d.cells[cy * d.size + cx] !== 0
}

function simCell(x: number, z: number): { cx: number; cy: number } {
  const style = sim?.style ?? STYLES.open
  const o = gridOrigin(style)
  return { cx: Math.floor((x - o.x) / style.tile), cy: Math.floor((z - o.z) / style.tile) }
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
  if (!isHeadless()) {
    setEquipmentAvatar(body, archetype.characterId, archetypeLoadout(archetype), false, boss ? { appearance: BOSS_APPEARANCE } : undefined)
    setEquipmentVisible(body, false)
    setEquipmentMotion(body, boss ? 'menace' : 'combat_idle', true)
    // Enemies advance at a fixed pace; play the walk cycle (authored for ~1.5 m/s) to match it.
    setEquipmentStride(body, Math.min(1.35, Math.max(0.7, (COMBAT_RULES.rivalSpeed * archetype.speed) / 1.5)))
  }
  return {
    root, body, archetype, boss, maxHealth: archetype.health, home, position: { ...home.position }, facing: home.facing, lastFacing: home.facing,
    health: archetype.health, recovery: 0, stagger: 0, blocking: false, visible: false,
    motion: 'combat_idle', healthBar: createEnemyHealthBar(body), brain: createRivalBrain(), slamming: false,
    engaged: false, returningHome: false, dead: false, deadSeconds: 0, loading: isHeadless() ? 'ready' : 'loading', loadSeconds: 0,
    ring: createDecal('ring'), ritual: boss ? createDecal('ritual') : undefined, hitStop: 0, announced: false, stillSeconds: 0,
    bossBrain: boss ? createBossBrain() : undefined, hyperArmor: false, rollSeconds: 0, rollDir: 1,
    provoked: 0, strayed: false
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
  elapsed += dt
  noticeSeconds = Math.max(0, noticeSeconds - dt)
  if (isHeadless()) {
    // One pass per party; each sees only its own members.
    const everyone = allFighters()
    for (const s of [...sims.values()]) {
      sim = s
      stepSim(dt, everyone.filter((f) => partyOf(f.address) === s.party), undefined)
    }
    sim = undefined
    return
  }
  if (!clientSim) return
  sim = clientSim
  const local = getPlayerCombatPose()
  const fighters = allFighters(local).filter((f) => f.local || partyOf(f.address) === clientSim!.party)
  state.visible = !!local
  state.party = fighters.length
  if (local) state.playerHealth = local.health
  stepSim(dt, fighters, local)
}

/** Advance the current sim by one tick against the heroes in its party. */
function stepSim(dt: number, fighters: NetFighter[], local: ReturnType<typeof getPlayerCombatPose>) {
  if (!sim) return
  const enemies = sim.enemies
  sim.graceSeconds = Math.max(0, sim.graceSeconds - dt)

  if (defeated) {
    // The host stands us back up (`revive`); the countdown is for the HUD, and
    // when it runs out we remind the host in case that message was lost.
    state.respawnSeconds = Math.max(0, state.respawnSeconds - dt)
    if (state.respawnSeconds === 0 && !respawnAsked) {
      respawnAsked = true
      publishRespawn()
    }
  }

  if (fighters.length === 0) {
    if (!sim.paused && isHost()) {
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
    if (!sim.paused && isHost()) console.log(`[Server] run ${sim.party} paused: no heroes in the fight`)
    sim.paused = true
    for (const e of enemies) {
      tickEnemyPresentation(e, dt)
      updateBar(e)
    }
    return
  }
  if (sim.paused) {
    sim.graceSeconds = 1.2
    sim.paused = false
    if (isHost()) {
      const f = fighters[0]
      console.log(`[Server] run ${sim.party} live: ${fighters.length} hero(es); first at ${f.position.x.toFixed(1)}, ${f.position.z.toFixed(1)} health ${f.health}`)
    }
  }

  if (isHost() && sim.traps.length && sim.graceSeconds === 0) {
    for (const trap of sim.traps) {
      trap.cool = Math.max(0, trap.cool - dt)
      if (trap.cool > 0) continue
      for (const fighter of fighters) {
        if (fighter.health <= 0) continue
        const dx = fighter.position.x - trap.x
        const dz = fighter.position.z - trap.z
        if (dx * dx + dz * dz > trap.radius * trap.radius) continue
        if (Math.abs(fighter.position.y - COURTYARD.characterFloorY) > 1.2) continue
        strikeFighter(fighter, trap.damage, 0.35, fighter.facing)
        trap.cool = 1.6
        break
      }
    }
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
        const stride = COMBAT_RULES.rivalSpeed * e.archetype.speed * Math.min(dt, 0.05)
        if (e.returningHome) {
          e.provoked = 0
          e.blocking = false
          walkHome(e, dt, stride)
        } else if (e.provoked > 0) {
          updateProvoked(e, dt, stride)
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
    sim.snapshotAge += dt
    if (sim.snapshotAge >= 0.12) {
      sim.snapshotAge = 0
      publishEnemies(sim.party, enemySnaps())
    }
    // The verdict: the Warlord fell, or nobody in the party is left standing.
    if (!sim.won && !sim.lost && enemies.length > 0) {
      if (enemies.some((e) => e.boss && e.dead)) sim.won = true
      else if (sim.party !== HUB && fighters.every((f) => f.health <= 0)) sim.lost = true
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
    state.maxHealth = engagedEnemy.maxHealth
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
  const living = fighters.filter((f) => f.health > 0 && simFloor(f.position.x, f.position.z) &&
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
  const inTerritory = simFloor(target.position.x, target.position.z) && combatDistance(e.home, target) <= e.archetype.leash &&
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
    walkHome(e, dt, stride)
    return
  }
  const grace = sim?.graceSeconds ?? 0
  if (!e.engaged && inTerritory && (combatDistance(e, target) <= e.archetype.aggro || e.provoked > 0) && grace === 0) {
    e.engaged = true
    e.provoked = 0
    showNotice(`${e.archetype.name} answers`)
    fxSound('roar', 1)
    kickCrawlerCamera(Vector3.create(0, -0.35, 0.2))
  }
  if (!e.engaged || grace > 0) {
    if (e.provoked > 0 && grace === 0) {
      updateProvoked(e, dt, stride)
      return
    }
    if (!e.swing && e.stagger <= 0 && e.rollSeconds <= 0) playMotion(e, 'menace')
    hideDecals(e)
    syncTransform(e, dt)
    return
  }
  if (combatDistance(e, e.home) > STRAY_DISTANCE) e.strayed = true

  if (e.rollSeconds > 0) {
    e.rollSeconds = Math.max(0, e.rollSeconds - dt)
    const side = Vector3.create(Math.cos(e.facing) * e.rollDir, 0, -Math.sin(e.facing) * e.rollDir)
    move(e, side.x * stride * 3.4, side.z * stride * 3.4)
    playMotion(e, 'roll')
    advanceSwing(e, dt, target, fighters)
    syncTransform(e, dt)
    return
  }

  const decision = updateBossBrain(brain, dt, combatDistance(e, target), canStartAttack(e) && e.rollSeconds <= 0, e.health, e.maxHealth)
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
  if (decision.advance && !e.swing && e.stagger <= 0) {
    const pace = (brain.phase === 3 ? 1.25 : 1) * (e.recovery > 0 ? 0.5 : 1)
    walkToward(e, dt, target, stride * pace, COMBAT_RULES.approachStop)
  }

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

  const inTerritory = simFloor(target.position.x, target.position.z) && combatDistance(e.home, target) <= e.archetype.leash &&
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
    walkHome(e, dt, stride)
    return
  }
  const grace = sim?.graceSeconds ?? 0
  if (!e.engaged && inTerritory && (combatDistance(e, target) <= e.archetype.aggro || e.provoked > 0) && grace === 0) {
    e.engaged = true
    e.provoked = 0
    if (e.boss) {
      showNotice(`${e.archetype.name} has noticed the party`)
      fxSound('roar', 0.9)
    }
  }
  if (!e.engaged || grace > 0) {
    if (e.provoked > 0 && grace === 0) {
      updateProvoked(e, dt, stride)
      return
    }
    if (!e.swing && e.stagger <= 0) playMotion(e, 'combat_idle')
    advanceSwing(e, dt, target, fighters)
    hideDecals(e)
    return
  }
  if (combatDistance(e, e.home) > STRAY_DISTANCE) e.strayed = true

  if (!e.swing && e.stagger <= 0) faceTarget(e, target)
  const decision = updateRivalBrain(e.brain, dt, combatDistance(e, target), canStartAttack(e), e.archetype.profile)
  e.blocking = decision.block
  if (decision.telegraph) state.telegraph = decision.telegraph
  if (decision.advance) walkToward(e, dt, target, stride, COMBAT_RULES.approachStop)

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

// --- training targets ----------------------------------------------------------

/**
 * Something in the hall a hero can hit that is not an enemy: the training
 * dummies. They take every blow a hero can land (sword, arrow, bolt), show the
 * same numbers and impacts, and report each hit back; they have no health and
 * no host authority, so the hits stay on the client that threw them.
 */
export type TrainingTarget = {
  /** The hull's base: on the floor for a dummy, up the body for the Colossus's head. */
  position: Vector3
  /** Body size relative to a hero, for the projectile hull and the aim point. */
  scale: number
  /** What the blow lands on, for the chips it throws and the sound it makes. */
  material: 'wood' | 'straw' | 'stone'
  /** Hull radius and height in metres when not a hero-shaped body (the Colossus's parts). */
  radius?: number
  height?: number
  /** Only a shot reaches it (the head): never the sword's fallback, never the vertical-reach test. */
  rangedOnly?: boolean
  /** Multiplier on the number shown (weak points); the host applies its own. */
  damageScale?: number
  onHit: (damage: number, attacker: CombatPose, motion: HeroAttackMotion, heavy: boolean, finisher: boolean) => void
}
const trainingProviders: Array<() => TrainingTarget[]> = []

/** Add a source of hittable things (the hall's dummies, the raid's Colossus). */
export function setTrainingTargets(provider: () => TrainingTarget[]) {
  trainingProviders.push(provider)
}

function trainingTargets(): TrainingTarget[] {
  if (trainingProviders.length === 1) return trainingProviders[0]()
  const out: TrainingTarget[] = []
  for (const p of trainingProviders) out.push(...p())
  return out
}

/** What a hero's blow needs of whatever it lands on; enemies and training targets both fit. */
type StrikeTarget = CombatPose & { blocking: boolean; archetype: { scale: number }; aerial?: boolean }

/**
 * A training target as a body. Wide hulls (a leg of stone) present their
 * surface to the attacker: the reach tests are centre-to-centre for a hero-sized
 * body, so the centre is brought in by the hull's extra radius.
 */
function trainingBody(t: TrainingTarget, attacker?: CombatPose): StrikeTarget {
  const scale = t.height !== undefined ? t.height / 1.85 : t.scale
  const extra = (t.radius ?? 0.45 * t.scale) - 0.45
  let position = t.position
  if (attacker && extra > 0) {
    const dx = attacker.position.x - t.position.x
    const dz = attacker.position.z - t.position.z
    const d = Math.sqrt(dx * dx + dz * dz)
    const pull = Math.min(extra, Math.max(0, d - 0.3))
    if (d > 0.0001) position = Vector3.create(t.position.x + (dx / d) * pull, t.position.y, t.position.z + (dz / d) * pull)
  }
  return { position, facing: 0, blocking: false, archetype: { scale }, aerial: t.rangedOnly }
}

/** Indices below zero in the shared target space are training targets. */
function trainingIndex(i: number) {
  return -1 - i
}

function strikeTraining(attacker: CombatPose, t: TrainingTarget, motion: HeroAttackMotion, context: { finisher: boolean }, at?: Vector3) {
  const heavy = isHeavyMotion(motion) || context.finisher
  const hit = resolveCombatHit(motion, false, context.finisher, localWeapon())
  hit.damage = withMight(hit.damage, localMight())
  if (t.damageScale) hit.damage = Math.max(1, Math.round(hit.damage * t.damageScale))
  const stone = t.material === 'stone'
  const hullRadius = t.radius ?? 0.45 * t.scale
  const dx = attacker.position.x - t.position.x
  const dz = attacker.position.z - t.position.z
  const d = Math.sqrt(dx * dx + dz * dz)
  // A sword meets a dummy between the two; a wide hull at its surface; a projectile where it landed.
  const contact = at ? Vector3.clone(at) : stone && d > 0.0001
    ? Vector3.create(t.position.x + (dx / d) * hullRadius, t.position.y + Math.min(1.3, (t.height ?? 1.85 * t.scale) * 0.4), t.position.z + (dz / d) * hullRadius)
    : Vector3.create((attacker.position.x + t.position.x) / 2, t.position.y + 1.15 * t.scale, (attacker.position.z + t.position.z) / 2)
  // Wood and straw, not flesh: chips and dust, a knock instead of a wet hit. Stone throws sparks.
  if (stone) fxImpact(contact, heavy, false)
  else fxWoodHit(contact, heavy, t.material === 'straw')
  const label = `${hit.damage}`
  const kind = context.finisher ? 'finisher' : heavy ? 'heavy' : 'damage'
  fxNumber(Vector3.create(contact.x, contact.y + 0.6, contact.z), label, kind)
  const sound: FxSound = stone ? (heavy ? 'hit_heavy' : 'hit_light') : t.material === 'straw' ? 'thud_straw' : 'thunk_wood'
  const vol = heavy ? 1 : 0.85
  fxSound(sound, vol)
  const weight = heavy ? 0.26 : 0.14
  kickCrawlerCamera(Vector3.create(Math.sin(attacker.facing) * weight, -weight * 0.3, Math.cos(attacker.facing) * weight))
  hitStopPlayer(heavy ? 0.08 : 0.05)
  publishImpact({ x: contact.x, y: contact.y, z: contact.z, heavy, blocked: false, label, kind, sound, vol, material: t.material })
  t.onHit(hit.damage, attacker, motion, heavy, context.finisher)
}

// --- player attacks ----------------------------------------------------------

/**
 * The best enemy (or training target) in front within `range` and the cone
 * `minDot`: near and centred wins. Training targets share the index space
 * below zero.
 */
function pickHeroTarget(attacker: CombatPose, range: number, minDot: number, verticalSlack = 0, shot = false): { e: StrikeTarget; index: number } | undefined {
  if (!sim) return undefined
  let best: { e: StrikeTarget; index: number } | undefined
  let bestScore = Infinity
  const consider = (e: StrikeTarget, index: number) => {
    // Hulls up a body (the Colossus's head) are for shots only, and the shot's own hull test judges the height.
    if (e.aerial && !shot) return
    const d = combatDistance(attacker, e)
    if (d > range || !facesCombatant(attacker, e, minDot)) return
    if (!e.aerial && Math.abs(attacker.position.y - e.position.y) > COMBAT_RULES.maximumVerticalReach + verticalSlack) return
    // Prefer near and centred targets.
    const dx = e.position.x - attacker.position.x
    const dz = e.position.z - attacker.position.z
    const dot = d > 0.0001 ? (Math.sin(attacker.facing) * dx + Math.cos(attacker.facing) * dz) / d : 1
    const score = d + (1 - dot) * 1.5
    if (score < bestScore) {
      bestScore = score
      best = { e, index }
    }
  }
  sim.enemies.forEach((e, index) => {
    if (e.loading !== 'ready' || e.dead) return
    consider(e, index)
  })
  trainingTargets().forEach((t, i) => consider(trainingBody(t, attacker), trainingIndex(i)))
  return best
}

/** Half-angle of the ranged classes' soft lock, as the dot product `facesCombatant` wants. */
function aimCos(): number {
  return Math.cos((heroClassOf(getPlayerCharacterState().characterId).aimCone * Math.PI) / 180)
}

/**
 * Soft lock-on: turn the body to the best enemy in front and step in if it is
 * just out of reach. A shot locks over the class's range and cone and never
 * steps: the archer stands and looses.
 */
function lockOn(motion: HeroAttackMotion, _context: AttackContext) {
  const attacker = getPlayerCombatPose()
  if (!attacker || attacker.health <= 0 || !clientSim || clientSim.paused || defeated) return
  sim = clientSim
  const shot = shotProfile(getPlayerCharacterState().characterId, motion)
  // A leap locks on from three metres: it is the one swing that travels to its mark.
  const reach = shot ? shot.range : attackRange(motion)
  // Only when the enemy is actually there: swinging while running through a room
  // must not yank the body around or teleport the player toward distant targets.
  const best = pickHeroTarget(attacker, reach + LOCK_MARGIN, shot ? aimCos() : LOCK_COS, shot ? 1.5 : 0, !!shot)
  if (!best) return
  const dx = best.e.position.x - attacker.position.x
  const dz = best.e.position.z - attacker.position.z
  const distance = Math.sqrt(dx * dx + dz * dz)
  if (distance > 0.0001) setPlayerFacingOverride(Math.atan2(dx, dz))
  // The wind-up's lunge closes the last gap so the blow lands at sword reach;
  // an enemy already that close gets a swing from a standstill.
  setPlayerStepIn(shot ? 0 : distance - STEP_TO)
}

/** roamingCombat asks before a ranged light: is someone at arm's length in front? */
function enemyWithin(range: number): boolean {
  const attacker = getPlayerCombatPose()
  if (!attacker || !clientSim || clientSim.paused || defeated) return false
  sim = clientSim
  return !!pickHeroTarget(attacker, range, LOCK_COS)
}

/** The enemies a projectile can reach right now, as bodies. */
function projectileTargets(): ProjectileTarget[] {
  const out: ProjectileTarget[] = []
  if (!clientSim || clientSim.paused) return out
  clientSim.enemies.forEach((e, index) => {
    if (e.loading !== 'ready' || e.dead) return
    out.push({ index, position: e.position, height: 1.85 * e.archetype.scale, radius: 0.45 * e.archetype.scale })
  })
  trainingTargets().forEach((t, i) => out.push({
    index: trainingIndex(i), position: t.position, height: t.height ?? 1.85 * t.scale, radius: t.radius ?? 0.45 * t.scale
  }))
  return out
}

function hitEnemies(motion: HeroAttackMotion, context: AttackContext) {
  const attacker = getPlayerCombatPose()
  if (!attacker || attacker.health <= 0 || !clientSim || clientSim.paused || defeated) return
  sim = clientSim
  if (isRangedAttack(motion)) {
    shootEnemies(attacker, motion, context)
    return
  }
  let best: Enemy | undefined
  let bestIndex = -1
  let bestDistance = Infinity
  sim.enemies.forEach((e, i) => {
    if (e.loading !== 'ready' || e.dead || e.returningHome || !attackCanReach(attacker, e, motion)) return
    const d = combatDistance(attacker, e)
    if (d < bestDistance) {
      bestDistance = d
      best = e
      bestIndex = i
    }
  })
  if (!best || bestIndex < 0) {
    // Nobody to fight: a training dummy in reach takes the blow instead.
    let dummy: TrainingTarget | undefined
    let dummyDistance = Infinity
    for (const t of trainingTargets()) {
      if (t.rangedOnly) continue
      const body = trainingBody(t, attacker)
      if (!attackCanReach(attacker, body, motion)) continue
      const d = combatDistance(attacker, body)
      if (d < dummyDistance) {
        dummyDistance = d
        dummy = t
      }
    }
    if (dummy) strikeTraining(attacker, dummy, motion, context)
    return
  }
  presentPlayerStrike(attacker, best, motion, context)
  if (isHost()) applyPlayerHit(attacker, best, motion, { finisher: context.finisher, weapon: localWeapon(), might: localMight() })
  else publishHitEnemy(bestIndex, motion, context.finisher)
}

/**
 * The contact frame of a shot: the projectile leaves toward the soft-lock
 * target (or straight ahead) and lands its blow on whatever body it reaches,
 * through the same host/client path as a sword.
 */
function shootEnemies(attacker: CombatPose, motion: HeroAttackMotion, context: AttackContext) {
  const profile = shotProfile(getPlayerCharacterState().characterId, motion)
  if (!profile || !sim) return
  const target = pickHeroTarget(attacker, profile.range + LOCK_MARGIN, aimCos(), 1.5, true)
  const origin = Vector3.create(
    attacker.position.x + Math.sin(attacker.facing) * 0.35, attacker.position.y + SHOT_HEIGHT, attacker.position.z + Math.cos(attacker.facing) * 0.35)
  let yaw = attacker.facing
  let pitch = 0
  if (target) {
    const aimAt = Vector3.create(target.e.position.x, target.e.position.y + 1.1 * target.e.archetype.scale, target.e.position.z)
    const dx = aimAt.x - origin.x
    const dz = aimAt.z - origin.z
    const flat = Math.sqrt(dx * dx + dz * dz)
    if (flat > 0.0001) yaw = Math.atan2(dx, dz)
    pitch = Math.atan2(aimAt.y - origin.y, Math.max(0.5, flat))
  }
  const simAtLaunch = sim
  launchShot({
    origin, yaw, pitch, profile, motion, finisher: context.finisher,
    // Each arrow of a volley lands its own blow; a projectile stops at the first body it meets.
    onHit: (t, at) => {
      // The sim may have been rebuilt while the arrow flew; the index means nothing then.
      if (simAtLaunch !== clientSim || !clientSim || clientSim.paused || defeated) return
      sim = clientSim
      if (t.index < 0) {
        const dummy = trainingTargets()[trainingIndex(t.index)]
        if (!dummy) return
        const shooter = getPlayerCombatPose() ?? attacker
        const dx = dummy.position.x - shooter.position.x
        const dz = dummy.position.z - shooter.position.z
        strikeTraining({ position: shooter.position, facing: dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : shooter.facing }, dummy, motion, context, at)
        return
      }
      const e = sim.enemies[t.index]
      if (!e || e.dead || e.loading !== 'ready') return
      const shooter = getPlayerCombatPose() ?? attacker
      // Knockback goes the way the shot went, not the way the body has turned since.
      const dx = e.position.x - shooter.position.x
      const dz = e.position.z - shooter.position.z
      const from: CombatPose = { position: shooter.position, facing: dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : shooter.facing }
      presentPlayerStrike(from, e, motion, context, at)
      if (isHost()) applyPlayerHit(from, e, motion, { finisher: context.finisher, weapon: localWeapon(), might: localMight() })
      else publishHitEnemy(t.index, motion, context.finisher)
    }
  })
  publishShot({ motion, x: origin.x, y: origin.y, z: origin.z, yaw, pitch })
}

function applyRemoteHit(id: string, index: number, motion: string, finisher: boolean) {
  if (!isHost()) return
  const s = simFor(partyOf(id))
  if (!s) return
  sim = s
  const attack = asHeroAttack(motion)
  const e = s.enemies[index]
  if (!attack || !e || e.dead || e.loading !== 'ready') return
  const attacker = allFighters().find((f) => f.address === id)
  // Reach is checked on the server pose with slack for the lunge the client
  // already played; facing is not, because the body yaw is still client-owned.
  // A shot's reach is its range (attackRange knows), with the same slack.
  if (!attacker) return
  // A ranged blow was decided where the projectile landed; the hero may stand a step up from there.
  const shot = isRangedAttack(attack)
  if (Math.abs(attacker.position.y - e.position.y) > COMBAT_RULES.maximumVerticalReach + (shot ? 2 : 0.5)) return
  if (combatDistance(attacker, e) > attackRange(attack) + 1.5) return
  // Only the class that owns the motion may claim it: a blade cannot report a volley.
  const cid = heroCharacters((owner) => owner === id)[0]
  if (!heroClassMotionAllowed(cid, attack)) return
  // The weapon is read off the hero's synced body: the client never states its own damage.
  applyPlayerHit(attacker, e, attack, { finisher, weapon: weaponStats(heroWeapon(id)), might: heroBonusesFor(id, cid ?? '').might })
}

/** The local hero's weapon, for the numbers it shows and the hits it hosts. */
function localWeapon(): WeaponModifiers {
  return weaponStats(getPlayerWeapon())
}

/** The local hero's level bonus on damage dealt (src/heroXp.ts). */
function localMight(): number {
  return heroBonusesFor(localAddress(), getPlayerCharacterState().characterId ?? '').might
}

/** A blow's damage after the hero's level; a blow that landed never rounds to nothing. */
function withMight(damage: number, might: number): number {
  return damage > 0 ? Math.max(1, Math.round(damage * might)) : 0
}

function enemySnaps(): EnemySnap[] {
  return (sim?.enemies ?? []).map((e, i) => ({
    i, x: e.position.x, z: e.position.z, f: e.facing, h: e.health, m: e.motion, dead: e.dead, engaged: e.engaged
  }))
}

/** Whether the champion's class fights with this motion (the host trusts no client's word for it). */
function heroClassMotionAllowed(cid: string | undefined, motion: HeroAttackMotion): boolean {
  const cls = heroClassOf(cid)
  return cls.light.includes(motion) || cls.heavy === motion || cls.pointBlank?.motion === motion
}

function applyPlayerHit(
  attacker: CombatPose, e: Enemy, motion: HeroAttackMotion, context: { finisher: boolean; weapon: WeaponModifiers; might: number }
) {
  // A blow from inside the territory starts the fight. One from beyond the leash (an
  // arrow from the next room) only provokes: the enemy answers at its edge, and the
  // damage stands, because it never left home to earn the walk-back heal.
  if (inTerritory(e, attacker)) e.engaged = true
  else if (!e.engaged) {
    e.provoked = PROVOKED_SECONDS
    e.provokedFrom = { position: Vector3.clone(attacker.position), facing: attacker.facing }
    e.returningHome = false
  }
  const heavy = isHeavyMotion(motion)
  const guarded = e.blocking && facesCombatant(e, attacker, 0.1)
  const hit = resolveCombatHit(motion, guarded, context.finisher, context.weapon)
  const armored = e.hyperArmor && !context.finisher && !heavy
  const dealt = withMight(hit.damage, context.might)
  const damage = armored ? Math.max(1, Math.round(dealt * 0.55)) : dealt
  e.health = Math.max(0, e.health - damage)
  const freeze = heavy || context.finisher ? 0.09 : 0.06
  e.hitStop = freeze
  setEquipmentTimeScale(e.body, 0.02)
  if (!hit.interrupt || armored) return
  // The Warlord's poise: a single arrow or bolt wounds him but does not stop him
  // (the third of a string still does), and nothing stops a leap or a roll once
  // it has begun. Without this an archer at ten paces cancels every leap and he
  // never reaches anyone.
  const rangedLight = (motion === 'bow_shoot' || motion === 'cast_bolt') && !context.finisher
  const committed = e.swing?.motion === 'leap' || e.rollSeconds > 0
  if (e.boss && (rangedLight || committed) && e.health > 0) return
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
  attacker: CombatPose, e: StrikeTarget, motion: HeroAttackMotion, context: { finisher: boolean }, at?: Vector3
) {
  const heavy = isHeavyMotion(motion)
  const guarded = e.blocking && facesCombatant(e, attacker, 0.1)
  const hit = resolveCombatHit(motion, guarded, context.finisher, localWeapon())
  hit.damage = withMight(hit.damage, localMight())
  // A sword meets the body between the two; a projectile where it landed.
  const contact = at ? Vector3.clone(at) : Vector3.create(
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
    blocked: hit.damage === 0, label, kind, sound, vol, material: ''
  })
}

function presentImpact(p: ImpactNet) {
  const contact = Vector3.create(p.x, p.y, p.z)
  if (p.material && p.material !== 'stone') fxWoodHit(contact, p.heavy, p.material === 'straw')
  else fxImpact(contact, p.heavy, p.blocked)
  fxNumber(Vector3.create(p.x, p.y + 0.6, p.z), p.label, p.kind as 'damage' | 'heavy' | 'finisher' | 'blocked')
  fxSound(p.sound as FxSound, p.vol)
}

function asAttack(motion: string): AttackMotion | undefined {
  if (motion === 'attack_light' || motion === 'attack_light2' || motion === 'attack_heavy') return motion
}

/** A hero's blow as reported over the wire: the sword set or one of the class actions. */
function asHeroAttack(motion: string): HeroAttackMotion | undefined {
  if (asAttack(motion)) return motion as AttackMotion
  if (motion === 'bow_shoot' || motion === 'bow_volley' || motion === 'bow_bash' || motion === 'cast_bolt' || motion === 'cast_nova') return motion
  if (motion === 'attack_light3' || motion === 'heavy_combo_c' || motion === 'leap') return motion
}

function kill(e: Enemy) {
  presentDeath(e)
  if (!isHost() || !sim) return
  sim.slain++
  const coin = Math.round((e.boss ? 10 : 2 + Math.floor(Math.random() * 3)) * sim.coinScale)
  const heart = e.boss ? 2 : Math.random() < 0.35 ? 1 : 0
  // The Warlord always drops a weapon, once; guards often, the rest rarely.
  let item = ''
  if (!e.boss || !sim.bossDropGiven) {
    // Drawn from what the party can wield: an all-archer party never sees a mace.
    const party = sim.party
    const characters = heroCharacters((id) => partyOf(id) === party)
    if (!isHeadless() && partyOf(localAddress()) === party) {
      const mine = getPlayerCharacterState().characterId
      if (mine) characters.push(mine)
    }
    item = rollWeaponDrop(
      e.boss ? 'boss' : e.archetype.role === 'elite' ? 'elite' : 'grunt', sim.level.id, sim.diff.id, Math.random, weaponPoolFor(characters))
  }
  if (e.boss && item) sim.bossDropGiven = true
  publishLoot(sim.party, e.position.x, e.position.z, coin, heart, item, e.boss)
}

function grantLoot(party: string, x: number, z: number, coin: number, heart: number, item: string, boss: boolean) {
  if (!clientSim || party !== clientSim.party) return
  const origin = Vector3.create(x, COURTYARD.characterFloorY, z)
  if (coin > 0) spawnLoot(origin, 'coin', coin)
  if (heart > 0) spawnLoot(origin, 'heart', heart)
  if (item) spawnLoot(origin, 'weapon', 1, item, boss)
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
    // Enemies get their weapon's class, not its rarity bonus: the archetype's damageScale is their tuning.
    const hit = resolveCombatHit(swing.motion, guarded, false, weaponStats(e.archetype.weapon, false))
    if (hit.damage === 0) {
      blockFighter(target, e.facing)
      return
    }
    const damage = Math.round(hit.damage * e.archetype.damageScale * (sim?.damageScale ?? 1))
    strikeFighter(target, damage, hit.stagger, e.facing)
  })
  if (e.swing === swing && finished) {
    e.swing = undefined
    e.slamming = false
    e.recovery = attackRecovery(swing.motion)
  }
}

function slam(e: Enemy, fighters: NetFighter[]) {
  const radius = e.bossBrain?.phase === 3 ? 4.1 : SLAM_RADIUS
  const damage = Math.round((e.bossBrain?.phase === 3 ? 38 : SLAM_DAMAGE) * (sim?.damageScale ?? 1))
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

/**
 * Enemy blows only ever land on the host, which owns every hero's health. The
 * hero's roll (`invulnerable`) is read from their last pose; the host decides
 * the dodge so every screen agrees, and broadcasts the outcome as `hitPlayer`.
 */
function strikeFighter(target: NetFighter, damage: number, stagger: number, yaw: number) {
  if (!isHost()) return
  strikeHero(target.address, damage, stagger, yaw, { dodged: target.invulnerable })
}

function blockFighter(target: NetFighter, yaw: number) {
  if (!isHost()) return
  strikeHero(target.address, 0, 0, yaw, { blocked: true })
}

/** Client: the host's verdict on an enemy blow against a hero, ours or another's. */
function applyHeroHit(hit: HeroHit) {
  if (hit.id !== localAddress()) {
    if (samePhase(hit.id)) presentRemoteHit(hit.id, hit.damage, hit.health, hit.blocked, hit.dodged)
    return
  }
  if (hit.blocked) {
    playerBlockedHit(hit.yaw)
    return
  }
  if (hit.dodged) {
    playerDodgedHit()
    return
  }
  const pose = getPlayerCombatPose()
  if (pose) fxImpact(Vector3.add(pose.position, Vector3.create(0, 1.2, 0)), hit.health <= 0, false)
  const down = receivePlayerCombatHit(hit.damage, hit.stagger, hit.health, hit.yaw)
  state.playerHealth = hit.health
  if (down) onLocalDefeated()
}

function onLocalDefeated() {
  if (defeated) return
  defeated = true
  respawnAsked = false
  state.phase = 'defeat'
  state.respawnSeconds = clientSim?.party === RAID_PARTY ? RAID_RECOVER_SECONDS : RECOVER_SECONDS
  state.telegraph = ''
  setPlayerFacingOverride(undefined)
}

/**
 * The host stood us back up: full health at the entrance, or where we fell when
 * an ally raised us. Living enemies keep fighting anyone still standing.
 */
function recoverPlayer(inPlace = false) {
  if (!defeated && !isPlayerDown()) return
  defeated = false
  respawnAsked = false
  restorePlayerCombatHealth()
  if (clientSim) clientSim.graceSeconds = 2
  state.phase = 'idle'
  state.respawnSeconds = 0
  state.playerHealth = MAX_COMBAT_HEALTH
  state.message = ''
  if (!inPlace) movePlayerToSpawn()
}

function applyEnemySnapshots(party: string, list: EnemySnap[]) {
  if (!clientSim || party !== clientSim.party) return
  sim = clientSim
  for (const snap of list) {
    const e = clientSim.enemies[snap.i]
    if (!e) continue
    e.position = Vector3.create(snap.x, COURTYARD.characterFloorY, snap.z)
    e.facing = snap.f
    e.health = snap.h
    e.engaged = snap.engaged
    if (snap.dead && !e.dead) clientSim.slain++
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

/** Whether a fighter stands where this enemy may fight: on the floor, inside the leash, on its level. */
function inTerritory(e: Enemy, f: CombatPose): boolean {
  return simFloor(f.position.x, f.position.z) && combatDistance(e.home, f) <= e.archetype.leash &&
    Math.abs(f.position.y - e.position.y) <= COMBAT_RULES.maximumVerticalReach + 1
}

/**
 * Answering a blow from beyond the leash: face where it came from, close to the
 * edge of the territory on that side, and hold there (shields up for the ones
 * that block) until the provocation fades, then walk back to the post.
 */
function updateProvoked(e: Enemy, dt: number, stride: number) {
  e.provoked = Math.max(0, e.provoked - dt)
  e.recovery = Math.max(0, e.recovery - dt)
  e.stagger = Math.max(0, e.stagger - dt)
  const from = e.provokedFrom
  if (e.provoked <= 0 || !from) {
    e.provoked = 0
    e.blocking = false
    e.returningHome = combatDistance(e, e.home) > 0.05
    if (!e.returningHome) playMotion(e, e.boss ? 'menace' : 'combat_idle')
    syncTransform(e, dt)
    return
  }
  // The point of the leash circle nearest the shooter, a little inside it.
  const dx = from.position.x - e.home.position.x
  const dz = from.position.z - e.home.position.z
  const d = Math.sqrt(dx * dx + dz * dz)
  const reach = Math.max(0, Math.min(d, e.archetype.leash - 0.4))
  const edge: CombatPose = d > 0.0001
    ? { position: Vector3.create(e.home.position.x + (dx / d) * reach, e.home.position.y, e.home.position.z + (dz / d) * reach), facing: 0 }
    : e.home
  if (e.stagger <= 0) {
    const before = e.position
    if (combatDistance(e, edge) > 0.15) walkToward(e, dt, edge, stride, 0)
    // Arrived, or the edge sits in a wall and the walk went nowhere: hold here.
    if (combatDistance(e, edge) <= 0.15 || combatDistance({ position: before, facing: 0 }, e) < 0.001) {
      e.path = undefined
      faceTarget(e, from)
      e.blocking = e.archetype.profile.blockChance >= 0.3
      playMotion(e, e.blocking ? 'block' : e.boss ? 'menace' : 'combat_idle')
    }
  }
  syncTransform(e, dt)
}

/** Walk back to the post; health returns only if the fight actually pulled the enemy away from it. */
function walkHome(e: Enemy, dt: number, stride: number) {
  if (combatDistance(e, e.home) > 0.05) walkToward(e, dt, e.home, stride, 0)
  if (combatDistance(e, e.home) < 0.05) {
    e.returningHome = false
    e.path = undefined
    if (e.strayed) e.health = e.maxHealth
    e.strayed = false
    e.stagger = 0
    e.recovery = 0
    e.facing = e.home.facing
    playMotion(e, e.boss ? 'menace' : 'combat_idle')
  }
  syncTransform(e, dt)
}

/**
 * Step toward a target through the dungeon rather than straight at it: a grid
 * route over open cells and doorways (re-solved every PATH_REPLAN_SECONDS),
 * string-pulled to the farthest route point the enemy can walk to directly.
 */
function walkToward(e: Enemy, dt: number, target: CombatPose, amount: number, stop: number) {
  const here = simCell(e.position.x, e.position.z)
  const there = simCell(target.position.x, target.position.z)
  if ((here.cx === there.cx && here.cy === there.cy) || clearLine(e.position, target.position)) {
    e.path = undefined
    moveToward(e, target, amount, stop)
    return
  }
  const key = `${here.cx},${here.cy}>${there.cx},${there.cy}`
  if (e.path) e.path.age += dt
  if (!e.path || e.path.key !== key || e.path.age > PATH_REPLAN_SECONDS) {
    e.path = { key, cells: findRoute(here, there, e), age: 0 }
  }
  const cells = e.path.cells
  if (cells.length < 2) {
    // No route inside the territory: press on directly and let `move` slide.
    moveToward(e, target, amount, stop)
    return
  }
  // Farthest route cell reachable in a straight walk; the target itself if that is clear.
  let waypoint: CombatPose | undefined
  for (let i = cells.length - 1; i >= 1; i--) {
    const c = cellCenter(sim?.style ?? STYLES.open, cells[i].cx, cells[i].cy)
    const p = Vector3.create(c.x, e.position.y, c.z)
    if (clearLine(e.position, p)) {
      waypoint = { position: p, facing: 0 }
      break
    }
  }
  if (!waypoint) {
    const c = cellCenter(sim?.style ?? STYLES.open, cells[1].cx, cells[1].cy)
    waypoint = { position: Vector3.create(c.x, e.position.y, c.z), facing: 0 }
  }
  moveToward(e, waypoint, amount, 0)
}

/** Whether a body can walk the straight segment: floor under every step and no wall or door-jamb crossed. */
function clearLine(from: Vector3, to: Vector3): boolean {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const steps = Math.max(1, Math.ceil(length / 0.25))
  let px = from.x
  let pz = from.z
  for (let i = 1; i <= steps; i++) {
    const nx = from.x + (dx * i) / steps
    const nz = from.z + (dz * i) / steps
    if (!canStand(nx, nz) || !canCross(px, pz, nx, nz)) return false
    px = nx
    pz = nz
  }
  return true
}

/** Breadth-first route over floor cells (through doorways, never through walls), kept near the enemy's territory. */
function findRoute(from: { cx: number; cy: number }, to: { cx: number; cy: number }, e: Enemy): Array<{ cx: number; cy: number }> {
  if (!sim) return []
  const d = sim.dungeon
  const n = d.size
  const style = sim.style
  const limit = e.archetype.leash + style.tile * 2
  const open = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= n || cy >= n || d.cells[cy * n + cx] === 0) return false
    const c = cellCenter(style, cx, cy)
    return combatDistance(e.home, { position: Vector3.create(c.x, e.home.position.y, c.z), facing: 0 }) <= limit
  }
  const sides: Array<[Side, number, number]> = [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]]
  const prev = new Map<number, number>()
  const start = from.cy * n + from.cx
  const goal = to.cy * n + to.cx
  const queue = [start]
  prev.set(start, -1)
  let found = start === goal
  for (let head = 0; head < queue.length && !found && queue.length < 900; head++) {
    const cur = queue[head]
    const cx = cur % n
    const cy = Math.floor(cur / n)
    for (const [side, sx, sy] of sides) {
      const nx = cx + sx
      const ny = cy + sy
      const next = ny * n + nx
      if (prev.has(next) || !open(nx, ny) || sim.blockedEdges.has(`${cx},${cy},${side}`)) continue
      prev.set(next, cur)
      if (next === goal) {
        found = true
        break
      }
      queue.push(next)
    }
  }
  if (!found) return []
  const cells: Array<{ cx: number; cy: number }> = []
  for (let cur = goal; cur !== -1; cur = prev.get(cur) ?? -1) cells.push({ cx: cur % n, cy: Math.floor(cur / n) })
  return cells.reverse()
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
  return simFloor(x - r, z - r) && simFloor(x + r, z - r) &&
    simFloor(x - r, z + r) && simFloor(x + r, z + r)
}

/** Cell-to-cell crossings may not pass through a wall, and must go through the middle of a doorway. */
function canCross(x0: number, z0: number, x1: number, z1: number): boolean {
  if (!sim) return false
  const a = simCell(x0, z0)
  const b = simCell(x1, z1)
  if (a.cx === b.cx && a.cy === b.cy) return true
  const side: Side | undefined = b.cy < a.cy ? 'n' : b.cy > a.cy ? 's' : b.cx < a.cx ? 'w' : b.cx > a.cx ? 'e' : undefined
  if (!side) return true
  const key = `${a.cx},${a.cy},${side}`
  if (sim.blockedEdges.has(key)) return false
  if (sim.doorEdges.has(key)) {
    const style = sim.style
    const opening = DOOR_OPENINGS[style.door]
    const half = (opening?.width ?? style.tile) / 2 - BODY_RADIUS
    // Lateral offset from the door's centre line, which runs through the centre
    // of the cell being entered. The grid does not start at world 0, so the
    // centre comes from cellCenter (gridOrigin-aware), not from flooring x.
    const centre = cellCenter(style, b.cx, b.cy)
    const lateral = side === 'n' || side === 's' ? x1 - centre.x : z1 - centre.z
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
  // Bodies filing through a doorway are left to overlap for the moment it
  // takes: shoving them apart there pushes them out of the opening's band and
  // the whole queue jams against the jambs.
  if (nearDoor(e.position)) return
  for (const other of sim?.enemies ?? []) {
    if (other === e || other.dead || other.loading !== 'ready') continue
    const distance = combatDistance(e, other)
    if (distance >= COMBAT_RULES.bodySeparation || distance < 0.0001) continue
    const push = (COMBAT_RULES.bodySeparation - distance) / 2
    move(e, ((e.position.x - other.position.x) / distance) * push, ((e.position.z - other.position.z) / distance) * push)
  }
}

/** Whether a point stands within a body's reach of one of its cell's doorways. */
function nearDoor(p: Vector3): boolean {
  if (!sim) return false
  const style = sim.style
  const T = style.tile
  const o = gridOrigin(style)
  const { cx, cy } = simCell(p.x, p.z)
  const reach = BODY_RADIUS + 0.3
  const edges: Array<[Side, number]> = [
    ['n', p.z - (o.z + cy * T)], ['s', o.z + (cy + 1) * T - p.z],
    ['w', p.x - (o.x + cx * T)], ['e', o.x + (cx + 1) * T - p.x]
  ]
  for (const [side, gap] of edges) if (gap <= reach && sim.doorEdges.has(`${cx},${cy},${side}`)) return true
  return false
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
  updateEnemyHealthBar(e.healthBar, e.health, e.maxHealth,
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
