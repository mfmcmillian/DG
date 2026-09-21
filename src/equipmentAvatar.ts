import {
  Animator, ColliderLayer, engine, Entity, GltfContainer, GltfContainerLoadingState,
  LoadingState, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { EQUIPMENT_SLOTS, EquipmentItem, EquipmentLoadout, getEquipmentItem } from './equipmentCatalog'
import { COMBAT_CLIPS, EQUIPMENT_CLIPS, EquipmentMotion, JumpMotion } from './combatAnimations'
import { appearanceArmor, appearanceHair, appearancePart, BodyType, CharacterAppearance, getCommittedAppearance, normalizeAppearance } from './appearance'
import roamingModels from './roamingModels.json'
import enemyBodies from './enemyBodies.json'
import folkBodies from './folkBodies.json'

export { EquipmentMotion, EQUIPMENT_CLIPS } from './combatAnimations'

/** One-piece characters: realm enemies (body, weapon and every combat clip in a single GLTF,
 *  built by scripts/export-enemy-bodies.py) and the hall's folk (a hero outfit baked to one GLB with
 *  only its own clips, scripts/build-hall-folk.py). No hair, armor or weapon parts are assembled for them. */
const SOLID_BODIES: Readonly<Record<string, { path: string; height: number; tris: number }>> = { ...enemyBodies, ...folkBodies }

export function isSolidBody(characterId: string): boolean {
  return characterId in SOLID_BODIES
}
export type EquipmentLoading = 'loading' | 'ready' | 'error'
export type EquipmentAvatarOptions = {
  /** Weapon ids to keep loaded alongside the equipped one, so a menu preview can swap instantly. */
  preloadWeapons?: string[]
  appearance?: CharacterAppearance
  presentation?: 'gameplay' | 'menu'
}

type Assembly = {
  bodyType: BodyType
  /** Every part this outfit owns, including weapons kept loaded for instant swaps. */
  entities: Entity[]
  bodyEntities: Entity[]
  weapons: Map<string, Entity[]>
  weaponId: string
  preloadWeapons: boolean
  armed: boolean
}

/** What must be loaded and in step before the outfit counts as ready: the body and the weapon in hand. Spare menu weapons load behind it. */
function requiredParts(assembly: Assembly): Entity[] {
  return [...assembly.bodyEntities, ...(assembly.weapons.get(assembly.weaponId) || [])]
}
type CachedPart = { entity: Entity; lastUsed: number; pose?: EquipmentMotion; readyFrame: number }
type EquipmentAvatar = {
  current?: Assembly
  pending?: Assembly
  motion: EquipmentMotion
  presentation: 'gameplay' | 'menu'
  visible: boolean
  loading: EquipmentLoading
  parts: Map<string, CachedPart>
  pose?: EquipmentMotion
  elapsed: number
  /** Playback rate of the walk/run clips, matched to ground speed so the feet do not slide. */
  stride: number
  /** Hit-stop multiplier over every clip (1 = normal). */
  timeScale: number
  /** The ready outfit switched to a spare weapon that is still downloading or unplayed; show it once in step. */
  weaponSync?: boolean
}

// Retain recently used alternatives, not every body/color combination in the pack.
const MAX_CACHED_PARTS = 24
const ANIMATED_MODELS: Readonly<Record<string, string>> = roamingModels
const avatars = new Map<Entity, EquipmentAvatar>()
const owners = new Map<Entity, Entity>()
let systemAdded = false
let animationFrame = 0

/** Each exported part shares the same origin, bind frame and animation timeline. */
export function setEquipmentAvatar(
  root: Entity, characterId: string, loadout: EquipmentLoadout, pointerCollisions = false,
  options: EquipmentAvatarOptions = {}
) {
  if (!systemAdded) {
    engine.addSystem(updateEquipmentAvatars)
    systemAdded = true
  }
  let avatar = avatars.get(root)
  if (!avatar) {
    avatar = { motion: 'idle', presentation: 'gameplay', visible: true, loading: 'loading', parts: new Map(), elapsed: 0, stride: 1, timeScale: 1 }
    avatars.set(root, avatar)
  }
  avatar.loading = 'loading'
  avatar.presentation = options.presentation ?? 'gameplay'

  const appearance = normalizeAppearance(options.appearance ?? getCommittedAppearance(characterId))
  const paths = bodyPartPaths(characterId, loadout, appearance)

  const assembly: Assembly = {
    bodyType: appearance.bodyType,
    entities: [], bodyEntities: [], weapons: new Map(), weaponId: loadout.weapon,
    preloadWeapons: Array.isArray(options.preloadWeapons), armed: loadout.weapon !== 'none-weapon'
  }
  for (const path of paths) {
    assembly.bodyEntities.push(getOrCreatePart(avatar, root, path, pointerCollisions))
  }
  assembly.entities.push(...assembly.bodyEntities)
  // A menu preview loads the weapons it may be asked to swap to; a fighter loads the one in hand.
  const weapons = assembly.preloadWeapons
    ? [...new Set([...options.preloadWeapons || [], loadout.weapon])].map((id) => getEquipmentItem(id))
    : [getEquipmentItem(loadout.weapon)]
  for (const weapon of weapons) {
    const children = weaponPartPaths(characterId, weapon)
      .map((path) => getOrCreatePart(avatar, root, path, pointerCollisions))
    assembly.weapons.set(weapon.id, children)
    assembly.entities.push(...children)
  }
  avatar.pending = assembly
  if (!requiredParts(assembly).length) avatar.loading = 'error'
  pruneParts(avatar)
}

function bodyPartPaths(characterId: string, loadout: EquipmentLoadout, appearance: CharacterAppearance): string[] {
  const solid = SOLID_BODIES[characterId]
  if (solid) return [solid.path]
  const paths = [appearancePart(appearance, 'core'), appearanceHair(appearance, loadout.head === 'none-head')]
  for (const slot of EQUIPMENT_SLOTS) {
    if (slot.id === 'weapon') continue
    const item = getEquipmentItem(loadout[slot.id])
    if (item.id === `none-${slot.id}`) {
      if (slot.id === 'chest' || slot.id === 'hands' || slot.id === 'legs' || slot.id === 'boots') {
        paths.push(appearancePart(appearance, slot.id))
      }
      continue
    }
    const customArmor = appearanceArmor(appearance, item.id)
    paths.push(...(customArmor ? [customArmor] : item.modelsByCharacter?.[characterId] || item.models))
  }
  return paths
}

function weaponPartPaths(characterId: string, weapon: EquipmentItem): string[] {
  if (SOLID_BODIES[characterId]) return []
  return weapon.modelsByCharacter?.[characterId] || weapon.models
}

/** The GLB files (after the roaming remap) an avatar with this outfit will
 *  actually request, so a preloader can warm exactly those. */
export function equipmentModelPaths(
  characterId: string, loadout: EquipmentLoadout, appearance?: Partial<CharacterAppearance>
): string[] {
  const look = normalizeAppearance(appearance ?? getCommittedAppearance(characterId))
  const paths = [...bodyPartPaths(characterId, loadout, look), ...weaponPartPaths(characterId, getEquipmentItem(loadout.weapon))]
  return paths.map((path) => ANIMATED_MODELS[path] ?? path)
}

/** Inventory weapons are already loaded and advancing on the body's animation timeline. */
export function setEquipmentPreviewWeapon(root: Entity, weaponId: string): boolean {
  const avatar = avatars.get(root)
  const target = avatar?.pending || avatar?.current
  if (!avatar || !target?.preloadWeapons || !target.weapons.has(weaponId)) return false
  for (const assembly of [avatar.current, avatar.pending]) {
    if (!assembly?.preloadWeapons || !assembly.weapons.has(weaponId) || assembly.weaponId === weaponId) continue
    const previousWeapon = assembly.weaponId
    assembly.weaponId = weaponId
    assembly.armed = weaponId !== 'none-weapon'
    if (assembly !== avatar.current) continue
    // Menu idle is shared by armed and unarmed outfits. Cached sword changes
    // keep the existing body and weapon timelines running in that stance.
    const pose = assemblyPose(avatar, assembly)
    if (avatar.motion === 'idle' && avatar.pose !== pose) startPose(avatar, pose)
    for (const child of assembly.weapons.get(previousWeapon) || []) {
      VisibilityComponent.createOrReplace(child, { visible: false })
    }
    const incoming = assembly.weapons.get(weaponId) || []
    if (incoming.every((child) => loadedPart(child) && partInPose(avatar, child, pose))) {
      for (const child of incoming) VisibilityComponent.createOrReplace(child, { visible: avatar.visible })
      avatar.weaponSync = false
    } else {
      // A spare weapon still downloading, or never played: the body stays up and
      // the update system reveals the sword once it is in step with it.
      avatar.weaponSync = true
    }
  }
  return true
}

function partInPose(avatar: EquipmentAvatar, entity: Entity, pose: EquipmentMotion): boolean {
  for (const part of avatar.parts.values()) {
    if (part.entity === entity) return part.pose === pose && part.readyFrame <= animationFrame
  }
  return false
}

export function setEquipmentMotion(root: Entity, motion: EquipmentMotion, reset = false) {
  const avatar = avatars.get(root)
  if (!avatar) return
  if (avatar.motion === motion && !reset) return
  avatar.motion = motion
  const assembly = avatar.current ?? avatar.pending
  if (assembly) startPose(avatar, assemblyPose(avatar, assembly))
}

/** Hit-stop: scale the playing clip's speed on every loaded part (1 = normal). */
export function setEquipmentTimeScale(root: Entity, speed: number) {
  const avatar = avatars.get(root)
  if (!avatar || avatar.timeScale === speed) return
  avatar.timeScale = speed
  // Re-issue the current clip on every part in the same tick. A speed-only write
  // can restart the sword GLB while the body keeps playing, which looks like
  // the weapon has come unsynced from the hand.
  if (avatar.pose) playAll(avatar, avatar.pose, false)
}

/**
 * Locomotion playback rate: 1 plays the walk/run cycles as authored. Stored for
 * the next pose start; never written mid-clip, because a late Animator update
 * on one GLB and not the other desyncs the sword from the body.
 */
export function setEquipmentStride(root: Entity, rate: number) {
  const avatar = avatars.get(root)
  if (!avatar || Math.abs(avatar.stride - rate) < 0.1) return
  avatar.stride = rate
}

const STRIDE_CLIPS = new Set<string>([EQUIPMENT_CLIPS.walk, EQUIPMENT_CLIPS.run])

/** Playback speed for a GLB clip: hit-stop scale, the walk/run stride, and the
 *  current pose's own rate when this is the clip that pose plays (the same GLB
 *  clip can back two poses at different speeds, e.g. `roll` and `dodge_roll`). */
function clipSpeed(avatar: EquipmentAvatar, clip: string): number {
  const pose = avatar.pose
  const rate = pose && EQUIPMENT_CLIPS[pose] === clip ? COMBAT_CLIPS[pose].rate ?? 1 : 1
  return avatar.timeScale * rate * (STRIDE_CLIPS.has(clip) ? avatar.stride : 1)
}

export function getEquipmentMotion(root: Entity): EquipmentMotion {
  return avatars.get(root)?.motion || 'idle'
}

export function getEquipmentJumpMotion(root: Entity): JumpMotion {
  const avatar = avatars.get(root)
  const assembly = avatar?.current ?? avatar?.pending
  return assembly?.bodyType === 'female' ? 'jump_female' : 'jump_male'
}

export function getEquipmentLoading(root: Entity): EquipmentLoading {
  return avatars.get(root)?.loading || 'loading'
}

export function setEquipmentVisible(root: Entity, visible: boolean) {
  const avatar = avatars.get(root)
  if (!avatar) return
  avatar.visible = visible
  if (avatar.current) showAssembly(avatar.current, visible)
}

/** Register interaction handlers on these child mesh entities, not the empty root. */
export function getEquipmentEntities(root: Entity): Entity[] {
  const avatar = avatars.get(root)
  return Array.from(new Set([...(avatar?.current?.entities || []), ...(avatar?.pending?.entities || [])]))
}

export function getEquipmentOwner(entity: Entity): Entity | undefined {
  return owners.get(entity)
}

/** Move a ready outfit and its live cache without reloading or restarting its parts. */
export function transferEquipmentAvatar(sourceRoot: Entity, targetRoot: Entity): boolean {
  const avatar = avatars.get(sourceRoot)
  if (!avatar || avatar.loading !== 'ready' || !avatar.current || avatar.pending) return false
  if (!Transform.has(sourceRoot) || !Transform.has(targetRoot)) return false

  const parts = Array.from(avatar.parts.values())
  const entities = new Set(parts.map((part) => part.entity))
  const required = requiredParts(avatar.current)
  if (!required.length ||
    required.some((entity) => !entities.has(entity) || !loadedPart(entity)) ||
    parts.some((part) => !Transform.has(part.entity) || owners.get(part.entity) !== sourceRoot)) return false
  if (sourceRoot === targetRoot) return true

  // The destination must survive removal of the preview root. Reject a target
  // anywhere inside that hierarchy before changing or deleting either outfit.
  let ancestor: Entity | undefined = targetRoot
  const visited = new Set<Entity>()
  while (ancestor !== undefined && ancestor !== engine.RootEntity) {
    if (ancestor === sourceRoot || entities.has(ancestor) || visited.has(ancestor)) return false
    visited.add(ancestor)
    ancestor = Transform.getOrNull(ancestor)?.parent
  }
  const previous = avatars.get(targetRoot)
  if (previous && Array.from(previous.parts.values()).some((part) => entities.has(part.entity))) return false

  // Source readiness and ownership are established before the old player outfit
  // is released. Local part transforms, hidden alternatives and clip cursors stay.
  destroyEquipmentAvatar(targetRoot)
  for (const part of parts) {
    Transform.getMutable(part.entity).parent = targetRoot
    owners.set(part.entity, targetRoot)
  }
  avatars.delete(sourceRoot)
  avatars.set(targetRoot, avatar)
  // The presentation stance belongs to the menu, not the playable character.
  avatar.presentation = 'gameplay'
  const pose = assemblyPose(avatar, avatar.current)
  if (avatar.pose !== pose) startPose(avatar, pose)
  return true
}

export function destroyEquipmentAvatar(root: Entity) {
  const avatar = avatars.get(root)
  if (!avatar) return
  for (const part of avatar.parts.values()) removePart(part)
  avatars.delete(root)
}

function removePart(part: CachedPart) {
  owners.delete(part.entity)
  engine.removeEntity(part.entity)
}

function getOrCreatePart(avatar: EquipmentAvatar, root: Entity, path: string, pointerCollisions: boolean): Entity {
  const key = `${pointerCollisions ? 1 : 0}:${path}`
  let part = avatar.parts.get(key)
  // A retry replaces failed loads, while the current ready outfit stays intact.
  if (part && failedPart(part.entity)) {
    removePart(part)
    avatar.parts.delete(key)
    part = undefined
  }
  if (!part) {
    part = { entity: createPart(root, path, pointerCollisions), lastUsed: animationFrame, readyFrame: Infinity }
    avatar.parts.set(key, part)
  }
  part.lastUsed = animationFrame
  return part.entity
}

function pruneParts(avatar: EquipmentAvatar) {
  const required = new Set([...(avatar.current?.entities || []), ...(avatar.pending?.entities || [])])
  const unused = Array.from(avatar.parts.entries())
    .filter(([, part]) => !required.has(part.entity))
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [key, part] of unused) {
    if (avatar.parts.size <= MAX_CACHED_PARTS) break
    removePart(part)
    avatar.parts.delete(key)
  }
}

function createPart(root: Entity, path: string, pointerCollisions: boolean): Entity {
  const child = engine.addEntity()
  owners.set(child, root)
  Transform.create(child, { parent: root })
  VisibilityComponent.create(child, { visible: false })
  GltfContainer.create(child, {
    src: ANIMATED_MODELS[path] ?? path,
    visibleMeshesCollisionMask: pointerCollisions ? ColliderLayer.CL_POINTER : 0,
    invisibleMeshesCollisionMask: 0
  })
  Animator.create(child, { states: animatorStates() })
  return child
}

/** One Animator state per distinct clip; several motions may share a clip. */
function animatorStates() {
  const states = new Map<string, { clip: string; playing: boolean; loop: boolean; speed: number }>()
  for (const motion of Object.keys(EQUIPMENT_CLIPS) as EquipmentMotion[]) {
    const clip = EQUIPMENT_CLIPS[motion]
    if (!states.has(clip)) states.set(clip, { clip, playing: false, loop: COMBAT_CLIPS[motion].loop, speed: 1 })
  }
  return [...states.values()]
}

function showAssembly(assembly: Assembly, visible: boolean) {
  const shown = new Set([...assembly.bodyEntities, ...(assembly.weapons.get(assembly.weaponId) || [])])
  for (const child of new Set(assembly.entities)) {
    VisibilityComponent.createOrReplace(child, { visible: visible && shown.has(child) })
  }
}

function assemblyPose(avatar: EquipmentAvatar, assembly: Assembly): EquipmentMotion {
  return avatar.motion === 'idle' && assembly.armed && avatar.presentation === 'gameplay'
    ? 'combat_idle' : avatar.motion
}

function loadedPart(entity: Entity) {
  return GltfContainerLoadingState.getOrNull(entity)?.currentState === LoadingState.FINISHED
}

function failedPart(entity: Entity) {
  const state = GltfContainerLoadingState.getOrNull(entity)?.currentState
  return state === LoadingState.FINISHED_WITH_ERROR || state === LoadingState.NOT_FOUND
}

function playPart(avatar: EquipmentAvatar, part: CachedPart, pose: EquipmentMotion, reset: boolean) {
  const clip = EQUIPMENT_CLIPS[pose]
  const animator = Animator.getMutableOrNull(part.entity)
  if (animator) {
    for (const s of animator.states) s.speed = clipSpeed(avatar, s.clip)
  }
  Animator.playSingleAnimation(part.entity, clip, reset)
  part.pose = pose
  // Send animation state before visibility, giving the renderer an update to
  // evaluate the incoming mesh instead of displaying its unanimated bind pose.
  part.readyFrame = animationFrame + 2
}

/** Body, armor and sword are separate GLBs. They must receive the same play
 *  command on the same tick or the blade drifts off the hand. */
function playAll(avatar: EquipmentAvatar, pose: EquipmentMotion, reset: boolean) {
  for (const part of avatar.parts.values()) {
    if (loadedPart(part.entity)) playPart(avatar, part, pose, reset)
  }
}

function startPose(avatar: EquipmentAvatar, pose: EquipmentMotion) {
  avatar.pose = pose
  avatar.elapsed = 0
  playAll(avatar, pose, true)
}

function updateEquipmentAvatars(dt: number) {
  animationFrame++
  for (const avatar of avatars.values()) {
    let loopBoundary = false
    if (avatar.pose) {
      const clip = COMBAT_CLIPS[avatar.pose]
      const rate = clipSpeed(avatar, EQUIPMENT_CLIPS[avatar.pose])
      const elapsed = avatar.elapsed + (Number.isFinite(dt) && dt > 0 ? dt * rate : 0)
      loopBoundary = clip.loop && elapsed >= clip.duration
      avatar.elapsed = clip.loop ? elapsed % clip.duration : Math.min(elapsed, clip.duration)
    }
    const pending = avatar.pending
    if (avatar.loading === 'error') continue
    if (!pending) {
      // A ready outfit that switched to a spare weapon still on its way (menu swap).
      const current = avatar.current
      if (!current || !avatar.weaponSync || !avatar.pose) continue
      const needed = requiredParts(current)
      if (needed.some(failedPart)) {
        avatar.loading = 'error'
        avatar.weaponSync = false
        continue
      }
      if (!needed.every(loadedPart)) continue
      const neededSet = new Set(needed)
      const parts = Array.from(avatar.parts.values()).filter((part) => neededSet.has(part.entity))
      // Body and sword must start their clips together; a restart of the menu idle is the price of an instant swap.
      if (parts.some((part) => part.pose !== avatar.pose)) playAll(avatar, avatar.pose, true)
      if (parts.some((part) => part.readyFrame > animationFrame)) continue
      avatar.weaponSync = false
      showAssembly(current, avatar.visible)
      continue
    }
    const needed = requiredParts(pending)
    if (needed.some(failedPart)) {
      avatar.loading = 'error'
      continue
    }
    if (!needed.length || !needed.every(loadedPart)) continue

    const pose = assemblyPose(avatar, pending)
    const required = new Set(needed)
    const incoming = Array.from(avatar.parts.values()).filter((part) => required.has(part.entity))
    if (avatar.pose !== pose || (!avatar.current && incoming.some((part) => part.pose !== pose))) {
      startPose(avatar, pose)
    } else if (loopBoundary && incoming.some((part) => part.pose !== pose)) {
      // SDK Animator has no seek. A late sword or hair piece joins on the next
      // loop by restarting every loaded part together so the blade stays in the hand.
      playAll(avatar, pose, true)
    }
    // An in-progress one-shot cannot be sought through the SDK. A late edit
    // waits for the caller's next looping stance rather than replaying an attack.
    // Creator/inventory/free-roam appearance changes all use looping stances.
    if (incoming.some((part) => part.pose !== pose || part.readyFrame > animationFrame)) continue

    // Reuse shared parts and their live animation cursors, just like cached swords.
    // These visibility writes occur together; shared parts remain visible.
    if (avatar.current) showAssembly(avatar.current, false)
    avatar.current = pending
    avatar.pending = undefined
    avatar.loading = 'ready'
    showAssembly(pending, avatar.visible)
    pruneParts(avatar)
  }
}
