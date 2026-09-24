// Bright arrows in the hall for whoever needs pointing: a stack of gold
// chevrons bobbing over a place, and a trail of flat chevrons on the floor
// leading to it. A hero who has never cleared a fortress gets them over the
// war table from the moment they arrive, until they open it or clear a run;
// the folk hand them out on request ("Show me the yard"). Local only, and
// nothing here has a collider, so they never get in anyone's way.

import { engine, Entity, Material, MeshRenderer, Transform, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COURTYARD } from './courtyard'
import { getDungeonState, onDungeonLoaded } from './dungeon'
import { PIT_GATE_TAG, WAR_TABLE_TAG } from './dungeon/hub'
import { isHeadless } from './multiplayer'
import { getLobbyState, myParty, myPhase } from './party'
import { HUB } from './partyLookup'

export type GuideTarget = 'table' | 'pit' | 'yard'

const FLOOR_Y = COURTYARD.characterFloorY
/** Where the trail for a first-timer starts: the vestibule spawn (src/dungeon/hub.ts). */
const SPAWN: [number, number] = [45.5, 66]
/** The training yard's dummies, for the squire's pointer (the yard runs x 58..68 along z 47). */
const YARD: [number, number] = [62.5, 47.5]
/** How high the marker floats over the floor, and how far the floor trail's chevrons sit apart. */
const MARKER_HEIGHT = 2.6
const TRAIL_STEP = 3
const TRAIL_MAX = 6
/** A requested pointer (from one of the folk) lasts this long. */
const REQUEST_SECONDS = 25

const GOLD = Color4.create(1, 0.82, 0.32, 1)
const GOLD_GLOW = Color3.create(1, 0.72, 0.2)
const HIDDEN = Vector3.create(0, -50, 0)

type Chevron = { root: Entity; arms: Entity[] }

let marker: { root: Entity; chevrons: Chevron[] } | undefined
let trail: Chevron[] = []
let target: GuideTarget | undefined
/** Seconds left on a requested pointer; Infinity for the first-timer's. */
let remaining = 0
/** Once the newcomer has opened the war table this session, the arrows have done their job. */
let tableOpened = false
let clock = 0
let systemAdded = false

function arm(parent: Entity, x: number, tilt: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, {
    parent, position: Vector3.create(x, 0.14, 0), scale: Vector3.create(0.52, 0.13, 0.13),
    rotation: Quaternion.fromEulerDegrees(0, 0, tilt)
  })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, {
    albedoColor: GOLD, emissiveColor: GOLD_GLOW, emissiveIntensity: 2.4, metallic: 0.2, roughness: 0.5, castShadows: false
  })
  VisibilityComponent.create(e, { visible: false })
  return e
}

/** A "V" of two gold bars in the parent's XY plane, tip at the origin, pointing -Y. */
function chevron(parent: Entity, position: Vector3, rotation: Quaternion): Chevron {
  const root = engine.addEntity()
  Transform.create(root, { parent, position, rotation })
  return { root, arms: [arm(root, -0.18, -42), arm(root, 0.18, 42)] }
}

function setVisible(c: Chevron, visible: boolean) {
  for (const a of c.arms) if (VisibilityComponent.get(a).visible !== visible) VisibilityComponent.getMutable(a).visible = visible
}

function build() {
  if (marker) return
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(HIDDEN) })
  // Three chevrons stacked, the lowest brightest, all pointing down at the place.
  const chevrons = [0, 0.42, 0.84].map((y) => chevron(root, Vector3.create(0, y, 0), Quaternion.Identity()))
  marker = { root, chevrons }
  for (let i = 0; i < TRAIL_MAX; i++) {
    // The outer entity carries the floor position, the yaw and the pulse; inside it the
    // chevron lies flat, its plane turned onto XZ so the point runs along +Z (the way to go).
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.clone(HIDDEN) })
    const flat = chevron(e, Vector3.Zero(), Quaternion.fromEulerDegrees(-90, 0, 0))
    trail.push({ root: e, arms: flat.arms })
  }
}

function placeOf(which: GuideTarget): Vector3 | undefined {
  const tagged = getDungeonState().instance?.tagged
  if (which === 'yard') return Vector3.create(YARD[0], FLOOR_Y, YARD[1])
  const entity = tagged?.[which === 'table' ? WAR_TABLE_TAG : PIT_GATE_TAG]
  const t = entity !== undefined ? Transform.getOrNull(entity) : undefined
  return t ? Vector3.create(t.position.x, FLOOR_Y, t.position.z) : undefined
}

function show(which: GuideTarget, from: [number, number] | undefined) {
  build()
  const place = placeOf(which)
  if (!place || !marker) return
  target = which
  Transform.getMutable(marker.root).position = Vector3.create(place.x, FLOOR_Y + MARKER_HEIGHT, place.z)
  for (const c of marker.chevrons) setVisible(c, true)
  // The floor trail: from where the hero stands (or the door) toward the place, stopping short of it.
  const start = from ?? [Transform.getOrNull(engine.PlayerEntity)?.position.x ?? place.x, Transform.getOrNull(engine.PlayerEntity)?.position.z ?? place.z]
  const dx = place.x - start[0]
  const dz = place.z - start[1]
  const dist = Math.hypot(dx, dz)
  const count = Math.min(TRAIL_MAX, Math.max(0, Math.floor((dist - 2) / TRAIL_STEP)))
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI
  for (let i = 0; i < TRAIL_MAX; i++) {
    const c = trail[i]
    const on = i < count
    setVisible(c, on)
    if (!on) continue
    const d = (i + 1) * TRAIL_STEP
    const t = Transform.getMutable(c.root)
    t.position = Vector3.create(start[0] + (dx / dist) * d, FLOOR_Y + 0.04, start[1] + (dz / dist) * d)
    t.rotation = Quaternion.fromEulerDegrees(0, yaw, 0)
  }
}

function hide() {
  target = undefined
  remaining = 0
  if (!marker) return
  Transform.getMutable(marker.root).position = Vector3.clone(HIDDEN)
  for (const c of marker.chevrons) setVisible(c, false)
  for (const c of trail) setVisible(c, false)
}

/** Point the way to a place for a while (one of the folk offering directions). */
export function showGuide(which: GuideTarget) {
  if (myPhase() !== HUB) return
  show(which, undefined)
  remaining = REQUEST_SECONDS
}

/** A hero who has never cleared anything, and has not yet opened the war table this session. */
function needsTheWay(): boolean {
  if (tableOpened) return false
  const progress = getLobbyState().progress
  return progress.every((n) => n === 0)
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  clock += span
  const lobby = getLobbyState()
  const inHall = myPhase() === HUB
  if (inHall && lobby.open) tableOpened = true
  if (!inHall || lobby.open || myParty()) {
    if (target) hide()
    return
  }
  if (target && target !== 'table') {
    remaining -= span
    if (remaining <= 0) hide()
  } else if (needsTheWay()) {
    if (target !== 'table') {
      show('table', SPAWN)
      remaining = Infinity
    }
  } else if (target === 'table') {
    hide()
  }
  if (!target || !marker) return
  // Bob and turn the marker; ripple the trail toward the place.
  const m = Transform.getMutable(marker.root)
  const place = placeOf(target)
  if (place) m.position = Vector3.create(place.x, FLOOR_Y + MARKER_HEIGHT + Math.sin(clock * 3) * 0.22, place.z)
  m.rotation = Quaternion.fromEulerDegrees(0, (clock * 70) % 360, 0)
  for (let i = 0; i < trail.length; i++) {
    const c = trail[i]
    if (!VisibilityComponent.get(c.arms[0]).visible) continue
    const pulse = 1 + 0.18 * Math.max(0, Math.sin(clock * 4 - i * 0.9))
    Transform.getMutable(c.root).scale = Vector3.create(pulse, pulse, pulse)
  }
}

export function initializeHallGuide() {
  if (isHeadless()) return
  // A new dungeon instance means new tagged entities: drop the arrows and let update() re-place them.
  onDungeonLoaded(() => hide())
  if (!systemAdded) {
    systemAdded = true
    engine.addSystem(update)
  }
}
