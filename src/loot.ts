// Drops: coins, hearts, weapons and armor that pop out of a slain enemy, settle
// on the floor, bob and spin, and are collected by walking over them.
//
// Loot is personal: every client in the party sees the same drop and each
// hero collects its own copy, so nobody races a friend to a legendary.

import { Billboard, engine, Entity, GltfContainer, Material, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { fxGlitter, fxLootBeam, fxNumber, fxSound } from './combatFx'
import { isInCourtyard } from './courtyard'
import { EquipmentItem, getEquipmentItemOrNull, WEAPON_DROP_OFFSET, WEAPON_DROP_OFFSET_LEFT } from './equipmentCatalog'
import { isUsableByHero, unlockInventoryItem } from './inventory'
import { publishPickup } from './multiplayer'
import { getPlayerCombatPose, getPlayerVitals } from './playerCharacter'
import { RARITIES, rarityOf, baseRarityOf } from './weapons'

export type LootKind = 'coin' | 'heart' | 'weapon' | 'armor'

/** How an item lies on the floor: a weapon stands up as its GLB, armor as a card with its icon. */
export function lootKindOf(item: EquipmentItem): LootKind {
  return item.weapon ? 'weapon' : 'armor'
}

type Drop = {
  entity: Entity
  kind: LootKind
  /** Item id for `weapon` and `armor` drops. */
  item?: string
  /** The Warlord's drop: a taller pop and a beam of light while it lies there. */
  boss: boolean
  from: Vector3
  to: Vector3
  /** Seconds since the drop; the pop-out arc lasts POP seconds. */
  age: number
  phase: number
  /** Seconds until the beam fires again (boss drops). */
  beamIn: number
}

/** An item pickup as the HUD shows it: a card that slides in and fades. */
export type LootToast = {
  item: EquipmentItem
  /** Already owned, or not this class's: turned into coin instead. */
  salvaged: number
  /** Salvaged because the piece is cut for another class. */
  wrongClass?: boolean
  age: number
}

/** The card an armor piece lies on: its inventory icon, facing the camera. */
const ARMOR_CARD = 0.62

/** What a run handed over: the weapons unlocked (ids, in order) and how many duplicates were salvaged. */
export type RunLoot = { found: string[]; salvaged: number }

const POP = 0.55
const BOSS_POP = 0.8
const PICKUP_RADIUS = 0.95
const MAX_DROPS = 40
const BEAM_EVERY = 0.5
export const TOAST_SECONDS = 4.2
const MAX_TOASTS = 3
const drops: Drop[] = []
const toasts: LootToast[] = []
const run: RunLoot = { found: [], salvaged: 0 }
const state = { coins: 0 }
let initialized = false

/** Pickup cards for the HUD, newest last. */
export function getLootToasts(): readonly LootToast[] {
  return toasts
}

/** The weapons this run has produced so far (for the results card). */
export function getRunLoot(): Readonly<RunLoot> {
  return run
}

/** A new run starts: forget the last one's haul. */
export function resetRunLoot() {
  run.found.length = 0
  run.salvaged = 0
}

export function initializeLoot() {
  if (initialized) return
  initialized = true
  engine.addSystem(update)
}

export function getLootState(): Readonly<{ coins: number }> {
  return state
}

/** A saved hero brings its purse back. */
export function setCoins(coins: number) {
  state.coins = Math.max(0, Math.floor(coins) || 0)
}

/** Take `amount` coins from the purse; false (and nothing taken) when the hero cannot pay. */
export function spendCoins(amount: number): boolean {
  const n = Math.max(0, Math.floor(amount) || 0)
  if (state.coins < n) return false
  state.coins -= n
  return true
}

export function clearLoot() {
  for (const d of drops) engine.removeEntity(d.entity)
  drops.length = 0
}

/**
 * Scatter `count` drops of a kind around a point on the floor (`item`: the
 * weapon id for weapon drops; `boss`: the Warlord's, which lands with a beam).
 */
export function spawnLoot(origin: Vector3, kind: LootKind, count: number, item?: string, boss = false) {
  const gear = kind === 'weapon' || kind === 'armor' ? (item ? getEquipmentItemOrNull(item) : undefined) : undefined
  if ((kind === 'weapon' || kind === 'armor') && !gear) return
  const weapon = kind === 'weapon' ? gear : undefined
  const armor = kind === 'armor' ? gear : undefined
  for (let i = 0; i < count; i++) {
    if (drops.length >= MAX_DROPS) engine.removeEntity(drops.shift()!.entity)
    const angle = Math.random() * Math.PI * 2
    const radius = 0.5 + Math.random() * 0.9
    let to = Vector3.create(origin.x + Math.sin(angle) * radius, origin.y, origin.z + Math.cos(angle) * radius)
    if (!isInCourtyard(to)) to = Vector3.create(origin.x, origin.y, origin.z)
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.add(origin, Vector3.create(0, 0.9, 0)),
      rotation: Quaternion.Identity(),
      scale: kind === 'coin' ? Vector3.create(1.4, 1.4, 1.4) : boss && gear ? Vector3.create(1.25, 1.25, 1.25) : Vector3.create(1, 1, 1)
    })
    if (armor) {
      // The piece itself is skinned to the hero's rig and would lie in bind pose; its icon reads better.
      const card = engine.addEntity()
      Transform.create(card, { parent: entity, position: Vector3.create(0, ARMOR_CARD * 0.5, 0), scale: Vector3.create(ARMOR_CARD, ARMOR_CARD, 1) })
      MeshRenderer.setPlane(card)
      Material.setPbrMaterial(card, {
        texture: Material.Texture.Common({ src: armor.icon }),
        emissiveTexture: Material.Texture.Common({ src: armor.icon }),
        emissiveColor: Color4.create(0.6, 0.6, 0.6, 1), emissiveIntensity: 1,
        transparencyMode: 2, alphaTest: 0.5, castShadows: false
      })
      Billboard.create(card)
      fxGlitter(Vector3.add(to, Vector3.create(0, 0.5, 0)), RARITIES[rarityOf(armor.id)].color)
    } else if (weapon) {
      // The weapon GLB is authored in the hero's hand; a child carries the offset that stands it up here.
      const model = engine.addEntity()
      const offset = weapon.weapon?.hand === 'l' ? WEAPON_DROP_OFFSET_LEFT : WEAPON_DROP_OFFSET
      Transform.create(model, {
        parent: entity,
        position: Vector3.create(offset.position[0], offset.position[1], offset.position[2]),
        rotation: Quaternion.create(offset.rotation[0], offset.rotation[1], offset.rotation[2], offset.rotation[3])
      })
      GltfContainer.create(model, { src: weapon.models[0], visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
      fxGlitter(Vector3.add(to, Vector3.create(0, 0.5, 0)), RARITIES[rarityOf(weapon.id)].color)
    } else {
      GltfContainer.create(entity, { src: `models/loot/${kind}.glb`, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
    }
    drops.push({
      entity, kind, item: gear?.id, boss: boss && !!gear, from: Vector3.add(origin, Vector3.create(0, 0.9, 0)), to,
      age: 0, phase: Math.random() * Math.PI * 2, beamIn: 0
    })
  }
}

function update(dt: number) {
  if (!Number.isFinite(dt) || dt <= 0) return
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].age += dt
    if (toasts[i].age >= TOAST_SECONDS) toasts.splice(i, 1)
  }
  if (!drops.length) return
  const player = getPlayerCombatPose()
  const vitals = getPlayerVitals()
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]
    d.age += dt
    const t = Transform.getMutable(d.entity)
    const pop = d.boss ? BOSS_POP : POP
    if (d.age < pop) {
      const k = d.age / pop
      const arc = Math.sin(k * Math.PI) * (d.boss ? 1.6 : 0.8)
      t.position = Vector3.create(
        d.from.x + (d.to.x - d.from.x) * k,
        d.from.y + (d.to.y - d.from.y) * k + arc,
        d.from.z + (d.to.z - d.from.z) * k
      )
      t.rotation = Quaternion.fromEulerDegrees(d.kind === 'coin' ? 90 : 0, k * 720, 0)
      continue
    }
    const wobble = d.age + d.phase
    t.position = Vector3.create(d.to.x, d.to.y + (d.kind === 'weapon' ? 0.28 : d.kind === 'armor' ? 0.22 : 0.18) + Math.sin(wobble * 3) * 0.06, d.to.z)
    // The coin is authored flat; stand it up and spin it. The heart is authored
    // upright. A weapon stands on its pommel, leaning a little, and turns slowly.
    t.rotation = d.kind === 'coin'
      ? Quaternion.multiply(Quaternion.fromEulerDegrees(0, wobble * 160, 0), Quaternion.fromEulerDegrees(90, 0, 0))
      : d.kind === 'weapon'
        ? Quaternion.multiply(Quaternion.fromEulerDegrees(0, wobble * 60, 0), Quaternion.fromEulerDegrees(0, 0, 28))
        : Quaternion.fromEulerDegrees(0, wobble * 90, 0)
    if (d.boss && d.item) {
      d.beamIn -= dt
      if (d.beamIn <= 0) {
        d.beamIn = BEAM_EVERY
        fxLootBeam(Vector3.add(d.to, Vector3.create(0, 0.1, 0)), RARITIES[rarityOf(d.item)].color)
      }
    }

    if (!player) continue
    const dx = player.position.x - d.to.x
    const dz = player.position.z - d.to.z
    if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS || Math.abs(player.position.y - d.to.y) > 1.5) continue
    if (d.kind === 'heart' && vitals.health >= vitals.maxHealth) continue
    collect(d)
    drops.splice(i, 1)
  }
}

function toast(item: EquipmentItem, salvaged: number, wrongClass = false) {
  if (toasts.length >= MAX_TOASTS) toasts.shift()
  toasts.push({ item, salvaged, wrongClass, age: 0 })
}

/** Gear changes hands: unlocked if new to this hero, sold on the spot if owned or another class's. */
function award(id: string, at: Vector3) {
  const item = getEquipmentItemOrNull(id)
  // A find is worth what is printed on it; the pit's upgrades to this hero's own copy do not raise the price of a duplicate.
  const rarity = RARITIES[baseRarityOf(id)]
  fxGlitter(at, rarity.color)
  fxGlitter(Vector3.add(at, Vector3.create(0, 0.6, 0)), rarity.color)
  if (!item) {
    // Nothing to hand over (an item since removed from the catalog).
  } else if (!isUsableByHero(item.id)) {
    // Another class's gear (dropped for a party-mate): sold on the spot.
    state.coins += rarity.coins
    run.salvaged++
    fxSound('coin', 0.7)
    fxNumber(Vector3.add(at, Vector3.create(0, 0.9, 0)), `+${rarity.coins}`, 'coin')
    toast(item, rarity.coins, true)
  } else if (unlockInventoryItem(item.id)) {
    fxSound('heal', 0.9)
    fxNumber(Vector3.add(at, Vector3.create(0, 0.9, 0)), item.name, 'note')
    run.found.push(item.id)
    toast(item, 0)
  } else {
    // Already owned: salvaged for coin on the spot.
    state.coins += rarity.coins
    run.salvaged++
    fxSound('coin', 0.7)
    fxNumber(Vector3.add(at, Vector3.create(0, 0.9, 0)), `+${rarity.coins}`, 'coin')
    toast(item, rarity.coins)
  }
}

/**
 * A boss's reward goes straight to the hero the moment it falls: the coins
 * counted and the gear handed over where they stand, nothing to walk back
 * for. (Hearts still land on the floor; a heal is only worth taking when hurt.)
 */
export function grantLootDirect(coin: number, item: string | undefined) {
  const player = Transform.getOrNull(engine.PlayerEntity)
  const at = player ? Vector3.add(player.position, Vector3.create(0, 1.3, 0)) : Vector3.create(0, 1.3, 0)
  if (coin > 0) {
    state.coins += coin
    fxSound('coin', 0.8)
    fxGlitter(at, Color4.create(1, 0.85, 0.3, 1))
    fxNumber(at, `+${coin}`, 'coin')
  }
  if (item) award(item, Vector3.add(at, Vector3.create(0, 0.4, 0)))
}

function collect(d: Drop) {
  const at = Vector3.add(d.to, Vector3.create(0, 0.6, 0))
  if (d.kind === 'coin') {
    state.coins++
    fxSound('coin', 0.6)
    fxGlitter(at, Color4.create(1, 0.85, 0.3, 1))
    fxNumber(at, '+1', 'coin')
  } else if ((d.kind === 'weapon' || d.kind === 'armor') && d.item) {
    award(d.item, at)
  } else {
    // The host owns hero health: it checks the heart against its own drop
    // record and answers with `heal`, which plays the +N. The sparkle is local.
    publishPickup(d.to.x, d.to.z)
    fxSound('heal', 0.8)
    fxGlitter(at, Color4.create(0.5, 1, 0.6, 1))
  }
  engine.removeEntity(d.entity)
}
