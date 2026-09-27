// Bogmaw's traps: the spike pits and deep mud of the Marsh Road, the ballistas
// on the Palisade's towers, the logs swinging over the Bone Yard, the war
// balloon bombing the King's Camp. Positions are BOG_TRAPS (src/dungeon/bogmaw.ts).
//
// The host runs the traps' clocks and delivers their blows (tickBogTrapsHost);
// what it decides goes out as `enemyFx` messages with an enemy index of -1 and
// the trap's own index in `j`, and every client (the solo host included) shows
// them (presentBogTrapFx). Between messages the clients animate on their own:
// a pit's spikes rise and sink on the message's cue, a log swings on a clock the
// host re-syncs every few periods, a bomb falls for the seconds the message
// names. Mud is the one trap with no host at all: it only slows the local hero.

import { ColliderLayer, engine, Entity, GltfContainer, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { BOG_ANCHOR, BOG_TRAPS } from './dungeon/bogmaw'
import { KIT } from './dungeon/kit'
import { createDecal, Decal, destroyDecal, fxSound, fxWoodHit, updateDecal } from './combatFx'
import { launchShot } from './projectiles'
import { EnemyFxNet, NetFighter } from './multiplayer'
import { setMudSlow } from './playerCharacter'

const FLOOR_Y = COURTYARD.characterFloorY

// --- the numbers ---------------------------------------------------------------

/** A pit's cycle: the warning rattle, the spikes up, down again; and what they do to whoever stands over them. */
const PIT_PERIOD = 3.6
const PIT_WARN = 0.7
const PIT_RISE = 0.15
const PIT_HOLD = 0.9
const PIT_SINK = 0.5
const PIT_RADIUS = 1.35
const PIT_DAMAGE = 20
/** A pit only cycles while a hero is this near (the road is quiet until walked). */
const PIT_ARM = 16

const BALLISTA_EVERY = 4.2
const BALLISTA_AIM = 0.8
const BOLT_SPEED = 28
const BOLT_DAMAGE = 20
const BOLT_TOLERANCE = 1.3

const LOG_PERIOD = 2.9
const LOG_SWING = (62 * Math.PI) / 180
const LOG_DAMAGE = 24
const LOG_HALF_LENGTH = 3.1
const LOG_COOL = 1.2
/** The host re-syncs the clients' swing clocks every this many periods. */
const LOG_SYNC_PERIODS = 4

const BOMB_EVERY = 4.5
const BOMB_FIRST = 3
const BOMB_FALL = 1.7
const BOMB_RADIUS = 3.2
const BOMB_DAMAGE = 26

const BALLOON_PERIOD = 45

// --- the host ------------------------------------------------------------------

type PendingBolt = { at: number; target: string; from: Vector3; aim: Vector3 }
type PendingBomb = { at: number; x: number; z: number }

export type BogTrapHost = {
  /** Each pit's place in its cycle; negative before the first cue, so the pits do not all fire together. */
  pitClock: number[]
  /** The cue for this cycle has gone out to the clients. */
  pitLive: boolean[]
  pitHit: boolean[]
  ballistaTimer: number
  ballistaTurn: number
  /** A ballista is aiming: the shot leaves when the timer runs out. */
  aiming: { at: number; index: number; target: string } | undefined
  bolts: PendingBolt[]
  logClock: number
  logCool: number[]
  logSyncAt: number
  bombTimer: number
  bombs: PendingBomb[]
}

export type TrapHostContext = {
  dt: number
  elapsed: number
  fighters: NetFighter[]
  /** The stage the party is on, in BOG_STAGES order (0 the road, 1 the palisade, 2 the yard, 3 the rise, 4 the King). */
  stage: number
  /** The Goblin King is awake and alive: his balloon crew is at work. */
  kingLive: boolean
  damageScale: number
  strike: (target: NetFighter, damage: number, stagger: number, yaw: number) => void
  block: (target: NetFighter, yaw: number) => void
  /** Whether the fighter faces the point (a raised guard turns what comes from the front). */
  faces: (target: NetFighter, from: Vector3) => boolean
  emit: (fx: Omit<EnemyFxNet, 'party'>) => void
}

export function createBogTrapHost(): BogTrapHost {
  return {
    pitClock: BOG_TRAPS.pits.map((_, i) => -(i % 4) * 0.9),
    pitLive: BOG_TRAPS.pits.map(() => false),
    pitHit: BOG_TRAPS.pits.map(() => false),
    ballistaTimer: BALLISTA_EVERY * 0.5,
    ballistaTurn: 0,
    aiming: undefined,
    bolts: [],
    logClock: 0,
    logCool: BOG_TRAPS.logs.map(() => 0),
    logSyncAt: 0,
    bombTimer: BOMB_EVERY - BOMB_FIRST,
    bombs: []
  }
}

function fx(kind: string, j: number, at: Vector3, to: Vector3 = Vector3.Zero(), r = 0): Omit<EnemyFxNet, 'party'> {
  return { kind, i: -1, j, x: at.x, y: at.y, z: at.z, tx: to.x, ty: to.y, tz: to.z, r }
}

function onFloor(f: NetFighter): boolean {
  return f.health > 0 && Math.abs(f.position.y - FLOOR_Y) < 1.2
}

function inside(f: NetFighter, box: { x0: number; x1: number; z0: number; z1: number }): boolean {
  return f.position.x >= box.x0 && f.position.x <= box.x1 && f.position.z >= box.z0 && f.position.z <= box.z1
}

function outward(from: { x: number; z: number }, f: NetFighter): number {
  return Math.atan2(f.position.x - from.x, f.position.z - from.z)
}

/** Host: advance every trap's clock and deliver what comes due. Call once per sim tick while the run is live. */
export function tickBogTrapsHost(h: BogTrapHost, ctx: TrapHostContext) {
  tickPits(h, ctx)
  tickBallistas(h, ctx)
  tickLogs(h, ctx)
  tickBalloon(h, ctx)
}

function tickPits(h: BogTrapHost, ctx: TrapHostContext) {
  BOG_TRAPS.pits.forEach((pit, i) => {
    const near = ctx.fighters.some((f) => f.health > 0 && Math.hypot(f.position.x - pit.x, f.position.z - pit.z) <= PIT_ARM)
    if (!near) {
      // Nobody about: let the cycle the clients saw run out on its own and start the next one fresh.
      if (h.pitLive[i]) {
        h.pitLive[i] = false
        h.pitHit[i] = false
        h.pitClock[i] = -0.5
      }
      return
    }
    let t = h.pitClock[i] + ctx.dt
    if (t >= 0 && !h.pitLive[i]) {
      h.pitLive[i] = true
      ctx.emit(fx('spikes', i, Vector3.create(pit.x, FLOOR_Y, pit.z), Vector3.Zero(), PIT_WARN))
    }
    const up = t >= PIT_WARN + PIT_RISE * 0.6 && t <= PIT_WARN + PIT_RISE + PIT_HOLD
    if (up && !h.pitHit[i]) {
      for (const f of ctx.fighters) {
        if (!onFloor(f) || Math.hypot(f.position.x - pit.x, f.position.z - pit.z) > PIT_RADIUS) continue
        ctx.strike(f, Math.round(PIT_DAMAGE * ctx.damageScale), 0.6, outward(pit, f))
        h.pitHit[i] = true
      }
    }
    if (t >= PIT_PERIOD) {
      t -= PIT_PERIOD
      h.pitHit[i] = false
      h.pitLive[i] = false
    }
    h.pitClock[i] = t
  })
}

function tickBallistas(h: BogTrapHost, ctx: TrapHostContext) {
  // The shots already in the air land whatever the stage.
  if (h.bolts.length) {
    const due = h.bolts.filter((b) => b.at <= ctx.elapsed)
    if (due.length) {
      h.bolts = h.bolts.filter((b) => b.at > ctx.elapsed)
      for (const bolt of due) {
        const f = ctx.fighters.find((x) => x.address === bolt.target)
        if (!f || f.health <= 0) continue
        if (Math.hypot(f.position.x - bolt.aim.x, f.position.z - bolt.aim.z) > BOLT_TOLERANCE) continue
        const yaw = Math.atan2(f.position.x - bolt.from.x, f.position.z - bolt.from.z)
        if (f.blocking && ctx.faces(f, bolt.from)) ctx.block(f, yaw)
        else ctx.strike(f, Math.round(BOLT_DAMAGE * ctx.damageScale), 0.5, yaw)
      }
    }
  }
  // The crews only work while the yard is contested.
  if (ctx.stage !== 1) {
    h.aiming = undefined
    return
  }
  const targets = ctx.fighters.filter((f) => f.health > 0 && inside(f, BOG_TRAPS.yard))
  if (targets.length === 0) return
  if (h.aiming) {
    if (ctx.elapsed < h.aiming.at) return
    const index = h.aiming.index
    const b = BOG_TRAPS.ballistas[index]
    const f = targets.find((x) => x.address === h.aiming!.target) ?? targets[0]
    h.aiming = undefined
    const from = Vector3.create(b.x, FLOOR_Y + b.y + 1.1, b.z)
    const aim = Vector3.create(f.position.x, f.position.y + 1.0, f.position.z)
    const flight = Vector3.distance(from, aim) / BOLT_SPEED
    h.bolts.push({ at: ctx.elapsed + flight, target: f.address, from, aim })
    ctx.emit(fx('bolt', index, from, aim))
    return
  }
  h.ballistaTimer -= ctx.dt
  if (h.ballistaTimer > 0) return
  h.ballistaTimer = BALLISTA_EVERY
  const index = h.ballistaTurn++ % BOG_TRAPS.ballistas.length
  const b = BOG_TRAPS.ballistas[index]
  let best = targets[0]
  let bestD = Infinity
  for (const f of targets) {
    const d = Math.hypot(f.position.x - b.x, f.position.z - b.z)
    if (d < bestD) {
      bestD = d
      best = f
    }
  }
  h.aiming = { at: ctx.elapsed + BALLISTA_AIM, index, target: best.address }
  ctx.emit(fx('aim', index, Vector3.create(b.x, FLOOR_Y + b.y, b.z), Vector3.create(best.position.x, FLOOR_Y, best.position.z), BALLISTA_AIM))
}

/** Where a log's middle is at this point of the clock, and which way it moves. */
function logPose(index: number, clock: number): { z: number; y: number; theta: number; forward: boolean } {
  const phase = (2 * Math.PI * clock) / LOG_PERIOD + (index % 2) * Math.PI
  const theta = LOG_SWING * Math.sin(phase)
  const forward = Math.cos(phase) > 0
  const log = BOG_TRAPS.logs[index]
  return { z: log.z + BOG_TRAPS.logRope * Math.sin(theta), y: FLOOR_Y + BOG_TRAPS.logPivotY - BOG_TRAPS.logRope * Math.cos(theta), theta, forward }
}

function tickLogs(h: BogTrapHost, ctx: TrapHostContext) {
  h.logClock += ctx.dt
  if (ctx.elapsed >= h.logSyncAt) {
    h.logSyncAt = ctx.elapsed + LOG_PERIOD * LOG_SYNC_PERIODS
    ctx.emit(fx('log', -1, Vector3.Zero(), Vector3.Zero(), h.logClock % LOG_PERIOD))
  }
  BOG_TRAPS.logs.forEach((log, i) => {
    h.logCool[i] = Math.max(0, h.logCool[i] - ctx.dt)
    if (h.logCool[i] > 0) return
    const pose = logPose(i, h.logClock)
    if (pose.y > FLOOR_Y + 2.3) return
    for (const f of ctx.fighters) {
      if (!onFloor(f) || Math.abs(f.position.x - log.x) > LOG_HALF_LENGTH || Math.abs(f.position.z - pose.z) > 1.4) continue
      ctx.strike(f, Math.round(LOG_DAMAGE * ctx.damageScale), 0.9, pose.forward ? 0 : Math.PI)
      ctx.emit(fx('logHit', i, Vector3.create(f.position.x, pose.y + 0.8, pose.z)))
      h.logCool[i] = LOG_COOL
      break
    }
  })
}

function tickBalloon(h: BogTrapHost, ctx: TrapHostContext) {
  if (h.bombs.length) {
    const due = h.bombs.filter((b) => b.at <= ctx.elapsed)
    if (due.length) {
      h.bombs = h.bombs.filter((b) => b.at > ctx.elapsed)
      for (const bomb of due) {
        for (const f of ctx.fighters) {
          if (f.health <= 0 || Math.abs(f.position.y - FLOOR_Y) > 2.5) continue
          const d = Math.hypot(f.position.x - bomb.x, f.position.z - bomb.z)
          if (d > BOMB_RADIUS) continue
          ctx.strike(f, Math.round(BOMB_DAMAGE * ctx.damageScale * (1 - 0.4 * (d / BOMB_RADIUS))), 0.9, outward(bomb, f))
        }
        ctx.emit({ kind: 'blast', i: -1, j: -1, x: bomb.x, y: FLOOR_Y, z: bomb.z, tx: 0, ty: 0, tz: 0, r: BOMB_RADIUS })
      }
    }
  }
  if (!ctx.kingLive) return
  const targets = ctx.fighters.filter((f) => f.health > 0 && inside(f, BOG_TRAPS.camp))
  if (targets.length === 0) return
  h.bombTimer += ctx.dt
  if (h.bombTimer < BOMB_EVERY) return
  h.bombTimer = 0
  const f = targets[Math.floor(Math.random() * targets.length)]
  const x = f.position.x + (Math.random() - 0.5) * 1.6
  const z = f.position.z + (Math.random() - 0.5) * 1.6
  h.bombs.push({ at: ctx.elapsed + BOMB_FALL, x, z })
  ctx.emit(fx('bomb', -1, Vector3.create(x, FLOOR_Y + BOG_TRAPS.balloon.y, z), Vector3.create(x, FLOOR_Y, z), BOMB_FALL))
}

// --- the clients ---------------------------------------------------------------

type Pit = { spikes: Entity; cover: Entity; t: number; warn: number }
type Ballista = { entity: Entity; ring: Decal; aimLeft: number; aimAt: Vector3 }
type Log = { pivot: Entity }
type Bomb = { entity: Entity; shadow: Entity; left: number; total: number; x: number; z: number }

type Visuals = {
  root: Entity
  pits: Pit[]
  ballistas: Ballista[]
  logs: Log[]
  logClock: number
  balloon: Entity
  tether: Entity
  clock: number
  bombs: Bomb[]
}

let visuals: Visuals | undefined
let inMud = false

function kitPiece(parent: Entity, id: keyof typeof KIT, position: Vector3, rotation = Quaternion.Identity(), scale = Vector3.One()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, rotation, scale })
  GltfContainer.create(e, { src: KIT[id].src, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  return e
}

function box(parent: Entity, position: Vector3, scale: Vector3, color: Color4, rotation = Quaternion.Identity()): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, rotation, scale })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: color, roughness: 0.95, metallic: 0 })
  return e
}

const WOOD = Color4.create(0.24, 0.16, 0.09, 1)
const ROPE = Color4.create(0.45, 0.38, 0.24, 1)
const MUD = Color4.create(0.09, 0.07, 0.045, 1)

/** Client: put the traps' models in the camp. Call when Bogmaw is built; clearBogTraps when it goes. */
export function buildBogTraps() {
  clearBogTraps()
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.Zero() })
  const v: Visuals = { root, pits: [], ballistas: [], logs: [], logClock: 0, balloon: root, tether: root, clock: 0, bombs: [] }

  for (const pit of BOG_TRAPS.pits) {
    const cover = engine.addEntity()
    Transform.create(cover, { parent: root, position: Vector3.create(pit.x, FLOOR_Y + 0.03, pit.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(2.9, 2.9, 1) })
    MeshRenderer.setPlane(cover)
    Material.setPbrMaterial(cover, { albedoColor: MUD, roughness: 1, metallic: 0 })
    const spikes = kitPiece(root, 'bog_spikes', Vector3.create(pit.x, FLOOR_Y - 2.1, pit.z), Quaternion.fromEulerDegrees(0, Math.random() * 360, 0))
    v.pits.push({ spikes, cover, t: -1, warn: PIT_WARN })
  }

  for (const b of BOG_TRAPS.ballistas) {
    const entity = kitPiece(root, 'bog_ballista', Vector3.create(b.x, FLOOR_Y + b.y, b.z), Quaternion.fromEulerDegrees(0, -90, 0))
    v.ballistas.push({ entity, ring: createDecal('ring'), aimLeft: 0, aimAt: Vector3.Zero() })
  }

  BOG_TRAPS.logs.forEach((log, i) => {
    const frame = engine.addEntity()
    Transform.create(frame, { parent: root, position: Vector3.create(log.x, FLOOR_Y, log.z) })
    const h = BOG_TRAPS.logPivotY
    box(frame, Vector3.create(-3.4, h / 2, 0), Vector3.create(0.4, h, 0.4), WOOD)
    box(frame, Vector3.create(3.4, h / 2, 0), Vector3.create(0.4, h, 0.4), WOOD)
    box(frame, Vector3.create(0, h + 0.1, 0), Vector3.create(7.4, 0.42, 0.42), WOOD)
    const pivot = engine.addEntity()
    Transform.create(pivot, { parent: frame, position: Vector3.create(0, h, 0) })
    const rope = BOG_TRAPS.logRope
    box(pivot, Vector3.create(-2.1, -rope / 2, 0), Vector3.create(0.08, rope, 0.08), ROPE)
    box(pivot, Vector3.create(2.1, -rope / 2, 0), Vector3.create(0.08, rope, 0.08), ROPE)
    kitPiece(pivot, 'bog_log', Vector3.create(0, -rope - 0.8, 0), Quaternion.fromEulerDegrees(0, 90, 0), Vector3.create(1.1, 1.1, 1.1))
    v.logs.push({ pivot })
    setLog(v, i)
  })

  v.balloon = kitPiece(root, 'bog_balloon', Vector3.create(BOG_TRAPS.balloon.x, FLOOR_Y + BOG_TRAPS.balloon.y, BOG_TRAPS.balloon.z))
  v.tether = box(root, Vector3.Zero(), Vector3.create(0.06, 1, 0.06), ROPE)
  visuals = v
  placeBalloon(v)
}

export function clearBogTraps() {
  if (!visuals) return
  for (const b of visuals.ballistas) destroyDecal(b.ring)
  for (const bomb of visuals.bombs) {
    engine.removeEntity(bomb.entity)
    engine.removeEntity(bomb.shadow)
  }
  engine.removeEntityWithChildren(visuals.root)
  visuals = undefined
  if (inMud) {
    inMud = false
    setMudSlow(false)
  }
}

/** Client: a trap message from the host (or the solo host's own). */
export function presentBogTrapFx(fx: EnemyFxNet) {
  const v = visuals
  if (!v) return
  switch (fx.kind) {
    case 'spikes': {
      const pit = v.pits[fx.j]
      if (pit) {
        pit.t = 0
        pit.warn = fx.r
      }
      return
    }
    case 'aim': {
      const b = v.ballistas[fx.j]
      if (!b) return
      b.aimLeft = fx.r
      b.aimAt = Vector3.create(fx.tx, fx.ty, fx.tz)
      aimBallista(b, fx.tx, fx.tz)
      return
    }
    case 'bolt': {
      const b = v.ballistas[fx.j]
      if (b) {
        b.aimLeft = 0
        updateDecal(b.ring, false)
        aimBallista(b, fx.tx, fx.tz)
      }
      const dx = fx.tx - fx.x
      const dy = fx.ty - fx.y
      const dz = fx.tz - fx.z
      const flat = Math.hypot(dx, dz)
      launchShot({
        origin: Vector3.create(fx.x, fx.y, fx.z), yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, flat), motion: 'bow_shoot', finisher: false, hostile: true,
        profile: { kind: 'bolt', speed: BOLT_SPEED, range: Math.hypot(flat, dy), radius: 0.35, count: 1, spread: 0 }
      })
      fxSound('thunk_wood', 0.7)
      return
    }
    case 'log':
      v.logClock = fx.r
      return
    case 'logHit':
      fxWoodHit(Vector3.create(fx.x, fx.y, fx.z), true, false)
      return
    case 'bomb': {
      const entity = kitPiece(v.root, 'bog_bomb', Vector3.create(fx.x, fx.y, fx.z), Quaternion.fromEulerDegrees(0, Math.random() * 360, 0), Vector3.create(1.6, 1.6, 1.6))
      const shadow = engine.addEntity()
      Transform.create(shadow, { parent: v.root, position: Vector3.create(fx.tx, FLOOR_Y + 0.05, fx.tz), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(0.6, 0.6, 1) })
      MeshRenderer.setPlane(shadow)
      Material.setPbrMaterial(shadow, {
        albedoColor: Color4.create(0, 0, 0, 0.55), roughness: 1, metallic: 0, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false
      })
      v.bombs.push({ entity, shadow, left: fx.r, total: fx.r, x: fx.tx, z: fx.tz })
      return
    }
    default:
      return
  }
}

function aimBallista(b: Ballista, tx: number, tz: number) {
  const t = Transform.getMutable(b.entity)
  t.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(tx - t.position.x, tz - t.position.z) * 180) / Math.PI, 0)
}

function setLog(v: Visuals, i: number) {
  const pose = logPose(i, v.logClock)
  Transform.getMutable(v.logs[i].pivot).rotation = Quaternion.fromEulerDegrees((-pose.theta * 180) / Math.PI, 0, 0)
}

function placeBalloon(v: Visuals) {
  const b = BOG_TRAPS.balloon
  const a = (2 * Math.PI * v.clock) / BALLOON_PERIOD
  const pos = Vector3.create(b.x + Math.cos(a) * b.ring, FLOOR_Y + b.y + Math.sin(v.clock / 3) * 0.6, b.z + Math.sin(a) * b.ring)
  const t = Transform.getMutable(v.balloon)
  t.position = pos
  t.rotation = Quaternion.fromEulerDegrees(0, (-a * 180) / Math.PI, 0)
  // The tether: a thin box from the anchor's top to the basket.
  const from = Vector3.create(BOG_ANCHOR.x, FLOOR_Y + 7.6, BOG_ANCHOR.z)
  const to = Vector3.create(pos.x, pos.y + 0.4, pos.z)
  const dir = Vector3.subtract(to, from)
  const len = Vector3.length(dir)
  const tt = Transform.getMutable(v.tether)
  tt.position = Vector3.lerp(from, to, 0.5)
  tt.scale = Vector3.create(0.06, len, 0.06)
  tt.rotation = Quaternion.fromToRotation(Vector3.Up(), Vector3.normalize(dir))
}

/** Client: animate the traps and slow the local hero in the mud. */
export function tickBogTraps(dt: number) {
  const v = visuals
  if (!v) return
  v.clock += dt
  v.logClock += dt

  for (const pit of v.pits) {
    if (pit.t < 0) continue
    pit.t += dt
    const t = Transform.getMutable(pit.spikes)
    const up = pit.t - pit.warn
    let y: number
    if (up < 0) {
      // The warning: the tips show and rattle.
      y = FLOOR_Y - 1.75 + Math.sin(pit.t * 60) * 0.04
    } else if (up < PIT_RISE) {
      y = FLOOR_Y - 1.75 + 1.75 * (up / PIT_RISE)
      if (up - dt < 0) fxSound('thunk_wood', 0.8)
    } else if (up < PIT_RISE + PIT_HOLD) y = FLOOR_Y
    else if (up < PIT_RISE + PIT_HOLD + PIT_SINK) y = FLOOR_Y - 2.1 * ((up - PIT_RISE - PIT_HOLD) / PIT_SINK)
    else {
      y = FLOOR_Y - 2.1
      pit.t = -1
    }
    t.position = Vector3.create(t.position.x, y, t.position.z)
  }

  for (const b of v.ballistas) {
    if (b.aimLeft <= 0) continue
    b.aimLeft -= dt
    if (b.aimLeft <= 0) updateDecal(b.ring, false)
    else updateDecal(b.ring, true, b.aimAt, 1.1, 1 - b.aimLeft / BALLISTA_AIM, Color3.create(1, 0.75, 0.2))
  }

  for (let i = 0; i < v.logs.length; i++) setLog(v, i)
  placeBalloon(v)

  for (let i = v.bombs.length - 1; i >= 0; i--) {
    const bomb = v.bombs[i]
    bomb.left -= dt
    if (bomb.left <= 0) {
      engine.removeEntity(bomb.entity)
      engine.removeEntity(bomb.shadow)
      v.bombs.splice(i, 1)
      continue
    }
    const k = 1 - bomb.left / bomb.total
    // Falling from rest: the height goes as the square of the time; the shadow grows to the blast's width.
    const y = FLOOR_Y + BOG_TRAPS.balloon.y * (1 - k * k)
    const bt = Transform.getMutable(bomb.entity)
    bt.position = Vector3.create(bomb.x, y, bomb.z)
    bt.rotation = Quaternion.fromEulerDegrees(k * 200, k * 90, 0)
    const size = 0.6 + (BOMB_RADIUS * 2 - 0.6) * k
    Transform.getMutable(bomb.shadow).scale = Vector3.create(size, size, 1)
  }

  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  const wading = !!player && Math.abs(player.y - FLOOR_Y) < 1.5 &&
    BOG_TRAPS.mud.some((m) => Math.hypot(player.x - m.x, player.z - m.z) <= BOG_TRAPS.mudRadius)
  if (wading !== inMud) {
    inMud = wading
    setMudSlow(wading)
  }
}

/** Whether the local hero is wading in deep mud right now (the bubbles in src/bogFx.ts). */
export function localHeroInMud(): boolean {
  return inMud
}
