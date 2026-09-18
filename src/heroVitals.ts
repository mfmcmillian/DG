// Server authority over hero health. The headless host is the only writer:
// enemy blows, heart pickups and revives all resolve here and are broadcast,
// so every client (the struck hero included) renders the same number and sees
// the same death at the same moment. Clients keep a mirror that only follows
// these messages. Cross-player effects (heals, shields) plug in the same way.

import { engine, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { MAX_COMBAT_HEALTH } from './combatActions'
import { room } from './shared/messages'

/** Seconds a downed hero lies before the host stands them back up at the entrance. */
export const RECOVER_SECONDS = 4
/** Health restored by one heart. */
export const HEART_HEAL = 30

/** A `respawn` request is honoured this much ahead of the automatic revive (clock drift). */
const RESPAWN_SLACK = 0.75
/** Hearts stay claimable this long after the drop (they bob on the floor until picked). */
const HEART_TTL = 180
/** How far the client's reported heart may be from where the host dropped it. */
const HEART_REPORT_SLACK = 2.5
/** How far the hero's own (server) position may be from the drop. */
const HEART_REACH = 4

type Vitals = { health: number; deadFor: number }
type HeartDrop = { x: number; z: number; hearts: number; age: number; taken: Map<string, number> }

const vitals = new Map<string, Vitals>()
const heartDrops: HeartDrop[] = []
let initialized = false

export function initializeHeroVitals() {
  if (initialized) return
  initialized = true
  room.onMessage('pickup', (msg, context) => {
    if (!context) return
    claimHeart(context.from.toLowerCase(), msg.x, msg.z)
  })
  room.onMessage('respawn', (_msg, context) => {
    if (!context) return
    const id = context.from.toLowerCase()
    const v = vitals.get(id)
    if (v && v.health <= 0 && v.deadFor >= RECOVER_SECONDS - RESPAWN_SLACK) reviveHero(id)
  })
  engine.addSystem(update)
}

function record(id: string): Vitals {
  let v = vitals.get(id)
  if (!v) {
    v = { health: MAX_COMBAT_HEALTH, deadFor: 0 }
    vitals.set(id, v)
  }
  return v
}

/** Authoritative health; a hero the host has not met yet is at full. */
export function heroHealth(id: string): number {
  return vitals.get(id)?.health ?? MAX_COMBAT_HEALTH
}

/** A fresh hero (first sight, character change, return from the title) starts full. */
export function resetHero(id: string) {
  vitals.set(id, { health: MAX_COMBAT_HEALTH, deadFor: 0 })
}

export function dropHero(id: string) {
  vitals.delete(id)
  for (const d of heartDrops) d.taken.delete(id)
}

/**
 * Resolve an enemy blow. Blocked and dodged blows carry no damage; they are
 * still broadcast so the hero (and everyone watching them) gets the feedback.
 */
export function strikeHero(
  id: string, damage: number, stagger: number, yaw: number, opts: { blocked?: boolean; dodged?: boolean } = {}
) {
  const v = record(id)
  if (v.health <= 0) return
  const blocked = !!opts.blocked
  const dodged = !blocked && !!opts.dodged
  const dealt = blocked || dodged ? 0 : Math.max(0, Math.round(damage))
  v.health = Math.max(0, v.health - dealt)
  if (v.health === 0) v.deadFor = 0
  void room.send('hitPlayer', { id, damage: dealt, stagger, yaw, health: v.health, blocked, dodged })
}

/** Returns the amount actually restored (0 when dead or already full). */
export function healHero(id: string, amount: number): number {
  const v = record(id)
  if (v.health <= 0) return 0
  const before = v.health
  v.health = Math.min(MAX_COMBAT_HEALTH, v.health + Math.max(0, Math.round(amount)))
  const healed = v.health - before
  if (healed > 0) void room.send('heal', { id, amount: healed, health: v.health })
  return healed
}

export function reviveHero(id: string) {
  const v = record(id)
  if (v.health > 0) return
  v.health = MAX_COMBAT_HEALTH
  v.deadFor = 0
  void room.send('revive', { id, health: v.health })
}

/** Called alongside every `loot` broadcast so pickups can be checked against a real drop. */
export function rememberHeartDrop(x: number, z: number, hearts: number) {
  if (hearts <= 0) return
  heartDrops.push({ x, z, hearts, age: 0, taken: new Map() })
}

function claimHeart(id: string, x: number, z: number) {
  const v = record(id)
  if (v.health <= 0 || v.health >= MAX_COMBAT_HEALTH) return
  const here = serverPlayerPosition(id)
  let best: HeartDrop | undefined
  let bestDistance = Infinity
  for (const d of heartDrops) {
    if ((d.taken.get(id) ?? 0) >= d.hearts) continue
    const reported = Math.hypot(d.x - x, d.z - z)
    if (reported > HEART_REPORT_SLACK) continue
    if (here && Math.hypot(d.x - here.x, d.z - here.z) > HEART_REACH) continue
    if (reported < bestDistance) {
      bestDistance = reported
      best = d
    }
  }
  if (!best) return
  best.taken.set(id, (best.taken.get(id) ?? 0) + 1)
  healHero(id, HEART_HEAL)
}

function serverPlayerPosition(id: string): { x: number; z: number } | undefined {
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address?.toLowerCase() !== id) continue
    const p = Transform.getOrNull(entity)?.position
    return p ? { x: p.x, z: p.z } : undefined
  }
  return undefined
}

function update(deltaTime: number) {
  const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0
  for (const [id, v] of vitals) {
    if (v.health > 0) continue
    v.deadFor += dt
    if (v.deadFor >= RECOVER_SECONDS) reviveHero(id)
  }
  for (let i = heartDrops.length - 1; i >= 0; i--) {
    heartDrops[i].age += dt
    if (heartDrops[i].age > HEART_TTL) heartDrops.splice(i, 1)
  }
}
