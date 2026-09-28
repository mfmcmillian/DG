// The hero as the player's own Decentraland avatar (Settings > "Fight as your
// avatar"). The Synty body still exists and still fights: the hit boxes, the
// swing timings, the server's view of the hero are all unchanged. It is only
// not shown. Instead every clip it starts is played on the native avatar as a
// scene emote (animations/<motion>_emote.glb, the same Synty clips retargeted
// onto the avatar rig by scripts/retarget-emotes.py), and the weapon in hand is
// a static copy of the loot model riding the avatar's hand (AvatarAttach,
// models/native/weapons, scripts/export-native-weapons.py).
//
// What the renderer decides for us: locomotion. Idle, walk, run and jump are
// the avatar's own and cannot be replaced, and a full-body emote is cut the
// moment the player moves, or the jump key is read (playerCharacter keeps the
// controller's jump gated for that: Space is the guard). Blocks, the stun and
// the fall root the player already (roamingCombat), so they play through; a
// swing made on the move, or one whose lunge is about to carry the player, is
// masked to the upper body so the legs keep running. The roll has no clip.
//
// Facing: the body turns toward a locked-on enemy on its own (playerCharacter's
// facingOverride); the avatar cannot be turned that way, so before a clip that
// has a lock-on the player is turned with movePlayerTo's avatarTarget
// (playerCharacter.turnPlayer). Hence clips are queued and sent at the end of
// the tick, once the lock-on for that swing is known: turn first, then the clip.
//
// Other heroes: a HeroLook with `native` set means "show my avatar, not a body".
// Their emotes reach us through the renderer, their weapon through the same
// attach. The scene-wide hide area is told to leave every native hero alone.

import {
  AvatarAnchorPointType, AvatarAttach, AvatarEmoteCommand, AvatarMask, EmoteState, engine, Entity, GltfContainer, Transform
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { stopEmote, triggerSceneEmote } from '~system/RestrictedActions'
import { setAvatarHidingExclusions } from './avatarHiding'
import { EquipmentMotion } from './combatAnimations'
import { devToolsOn } from './devAccess'
import { localAddress, playerAddressAsReported } from './multiplayer'
import nativeWeapons from './nativeWeapons.json'
import { getSettings } from './settings'

export function nativeHeroOn(): boolean {
  return getSettings().nativeAvatar
}

/** The last few things worth knowing, for the developer panel and the console. */
const notes: string[] = []
export function nativeNote(text: string) {
  if (!devToolsOn()) return
  notes.unshift(text)
  if (notes.length > 4) notes.length = 4
  console.log(`[native] ${text}`)
}
export function nativeNotes(): readonly string[] {
  return notes
}

type Emote = {
  /** Plays until stopped or the player moves; the body's looping stances. */
  loop: boolean
  /** A one-shot that may start mid-stride: mask it to the upper body then, so it is not cut at once. */
  upperWhenMoving: boolean
  /** A one-shot that holds its last pose (the fall): stopped explicitly when the body moves on. */
  sticky?: boolean
  /** The clip to play instead under the upper-body mask, when a motion's own masked form is no use. */
  upperAs?: EquipmentMotion
}

/** Motions with a retargeted clip. Idle, walk, run and the jumps are the avatar's own locomotion. */
const EMOTES: Partial<Record<EquipmentMotion, Emote>> = {
  combat_idle: { loop: true, upperWhenMoving: false },
  menace: { loop: true, upperWhenMoving: false },
  block: { loop: true, upperWhenMoving: false },
  bow_block: { loop: true, upperWhenMoving: false },
  attack_light: { loop: false, upperWhenMoving: true },
  attack_light2: { loop: false, upperWhenMoving: true },
  attack_light3: { loop: false, upperWhenMoving: true },
  attack_heavy: { loop: false, upperWhenMoving: true },
  stab: { loop: false, upperWhenMoving: true },
  flourish_heavy: { loop: false, upperWhenMoving: true },
  heavy_combo_a: { loop: false, upperWhenMoving: true },
  heavy_combo_b: { loop: false, upperWhenMoving: true },
  heavy_combo_c: { loop: false, upperWhenMoving: true },
  leap: { loop: false, upperWhenMoving: true },
  fencing: { loop: false, upperWhenMoving: true },
  flourish: { loop: false, upperWhenMoving: true },
  menace_enter: { loop: false, upperWhenMoving: true },
  // No roll: the renderer cuts a full-body emote the moment the roll's timed move
  // starts, and a roll masked to the upper body flips the torso on standing legs.
  // The dodge is a dash on the avatar: its own run over the roll's ground.
  stun: { loop: false, upperWhenMoving: false },
  hit: { loop: false, upperWhenMoving: true },
  death: { loop: false, upperWhenMoving: false, sticky: true },
  bow_shoot: { loop: false, upperWhenMoving: true },
  // The volley is the leaping shot and plays whole: the swing roots the player, so the clip is not cut.
  bow_volley: { loop: false, upperWhenMoving: false },
  bow_bash: { loop: false, upperWhenMoving: true },
  cast_bolt: { loop: false, upperWhenMoving: true },
  cast_nova: { loop: false, upperWhenMoving: true }
}

/** The looping (or held) clip we last asked for, so it is not re-triggered every tick and is stopped when the body moves on. */
let activeLoop: EquipmentMotion | undefined

// --- comms budget ------------------------------------------------------------
// Every emote the avatar starts or stops is a reliable message on the Explorer's
// comms transport (Pulse), on top of its own 10/s movement stream, and the server
// drops a client that sends too many (INPUT_RATE_EXCEEDED; the Explorer does not
// reconnect from that one). A rolling budget keeps a fight under it. Nothing is
// held back until the budget runs low; then the least visible clips go first:
// stances and hit reactions, never the swing itself unless the budget is gone.
const COMMS = { windowMs: 4000, messages: 24 }
/** A one-shot costs its start and the stop the renderer sends when it ends; a stance costs its start now and its stop later. */
const ONE_SHOT_COST = 2
/** Messages left below which a stance or a hit reaction is not worth the risk. */
const HEADROOM = 8
const HIT_SPACING_MS = 500
const sentAt: number[] = []
let lastHitAt = 0

function commsLeft(now: number): number {
  while (sentAt.length > 0 && now - sentAt[0] > COMMS.windowMs) sentAt.shift()
  return COMMS.messages - sentAt.length
}

function commsSpend(now: number, count: number) {
  for (let i = 0; i < count; i++) sentAt.push(now)
}

/** Whether this clip may go out now; spends its cost when it may. */
function commsAllow(motion: EquipmentMotion, loop: boolean): boolean {
  const now = Date.now()
  const left = commsLeft(now)
  const cost = loop ? 1 : ONE_SHOT_COST
  let need = cost
  if (loop || motion === 'hit') need = HEADROOM
  if (motion === 'hit' && now - lastHitAt < HIT_SPACING_MS) need = Infinity
  if (left < need) {
    nativeNote(`${motion}: held back, ${left} comms msgs left`)
    return false
  }
  if (motion === 'hit') lastHitAt = now
  commsSpend(now, cost)
  return true
}
/** The clip the body started this tick, sent by flushNativeMotion once the tick's lock-on is known. */
let pending: { motion: EquipmentMotion; loop: boolean; upper: boolean } | undefined
let watching = false
let lastAsk: { motion: string; at: number } | undefined

/**
 * The local body started a clip (setEquipmentMotionMirror); play the same on
 * the avatar. `moving` is the body's own reading of the player's locomotion.
 */
export function mirrorLocalMotion(motion: EquipmentMotion, restart: boolean, moving: boolean) {
  if (!nativeHeroOn()) return
  watch()
  const def = EMOTES[motion]
  if (!def) {
    // Back to locomotion: the avatar's own clips take over; end a stance we were holding.
    if (activeLoop !== undefined) {
      activeLoop = undefined
      commsSpend(Date.now(), 1)
      stopEmote({}).catch(() => undefined)
    }
    return
  }
  if (def.loop || def.sticky) {
    if (activeLoop === motion && !restart) return
    activeLoop = motion
  } else {
    activeLoop = undefined
  }
  pending = { motion, loop: def.loop, upper: def.upperWhenMoving && moving }
}

/**
 * End of the player tick: send the clip queued this tick. `turn`, when given,
 * is playerCharacter's move that turns the player to the lock-on the body took
 * this tick; when it returns a promise the clip waits for the turn to finish
 * (the renderer resets the animator when an interpolated move ends, which would
 * cut a clip already playing), so the shot goes where the avatar looks.
 * `carried` says whether the clip's own wind-up is about to move the player (a
 * swing's lunge): the renderer cuts a full-body emote as soon as the avatar
 * travels, so such a clip is masked to the upper body like one made on the move.
 */
export function flushNativeMotion(
  turn: ((motion: EquipmentMotion) => Promise<void> | undefined) | undefined,
  carried?: (motion: EquipmentMotion) => boolean
) {
  if (!pending) return
  const { motion, loop } = pending
  const upper = pending.upper || (!!EMOTES[motion]?.upperWhenMoving && !!carried?.(motion))
  pending = undefined
  if (!commsAllow(motion, loop)) {
    // A stance held back is not being played: let it be asked for again on the next change.
    if (activeLoop === motion) activeLoop = undefined
    return
  }
  const clip = upper ? EMOTES[motion]?.upperAs ?? motion : motion
  const turning = turn?.(motion)
  if (turning) turning.then(() => play(clip, loop, upper), () => play(clip, loop, upper))
  else play(clip, loop, upper)
}

function play(motion: EquipmentMotion, loop: boolean, upper: boolean) {
  lastAsk = { motion, at: Date.now() }
  nativeNote(`${motion}${upper ? ' (upper body)' : ''}${loop ? ' loop' : ''}`)
  // Under the upper-body mask the renderer keeps the locomotion's pelvis, so the
  // masked clip is the variant solved for a rest pelvis: a side-on archer's arms
  // would otherwise swing a quarter turn off the way the avatar walks and shoots.
  triggerSceneEmote({
    src: `animations/${motion}${upper ? '_upper' : ''}_emote.glb`,
    loop,
    ...(upper ? { mask: AvatarMask.AM_UPPER_BODY } : {})
  })
    .then((r) => {
      if (!r.success) nativeNote(`${motion}: renderer refused`)
    })
    .catch((e: unknown) => {
      nativeNote(`${motion}: ${String(e)}`)
    })
}

/** The body is gone or hidden for another reason (menu, title): nothing should keep playing. */
export function stopNativeMotion() {
  pending = undefined
  if (activeLoop === undefined) return
  activeLoop = undefined
  commsSpend(Date.now(), 1)
  stopEmote({}).catch(() => undefined)
}

// --- who the hide area leaves alone --------------------------------------------------

let excluded = ''
let localShown = false

/** playerCharacter's word, each tick: our own avatar is the hero on show right now (not in a menu, body ready). */
export function setLocalNativeShown(shown: boolean) {
  localShown = shown
}

/**
 * Called each tick by remotePlayers with the native heroes it sees (addresses
 * as the renderer spells them); we add ourselves when we are one. Only a change
 * reaches the hide area.
 */
export function syncNativeExclusions(remote: readonly string[]) {
  const me = localShown ? playerAddressAsReported(localAddress()) : undefined
  const ids = me ? [...remote, me] : [...remote]
  ids.sort()
  const key = ids.join('|')
  if (key === excluded) return
  excluded = key
  setAvatarHidingExclusions(ids)
}

// --- the weapon in hand ----------------------------------------------------------------

type NativeWeapon = { src: string; hand: 'l' | 'r' }
const WEAPONS: Readonly<Record<string, NativeWeapon>> = nativeWeapons as Record<string, NativeWeapon>

/**
 * The static weapon models are baked into the avatar's hand-bone space by the
 * export script. These nudge every one of them at once, for when the renderer's
 * anchor frame turns out not to be the glTF joint's. Metres and Euler degrees;
 * the developer panel changes them live (nudgeWeaponTweak) to find the values.
 */
// Found in-world with the developer panel: the avatar's grip sits a touch off the model's.
const WEAPON_TWEAK = { position: Vector3.create(0.1, 0, 0), euler: Vector3.create(15, 330, 0) }

/** Developer: turn or move every held weapon by a step and re-apply; the label shows where it landed. */
export function nudgeWeaponTweak(kind: 'rotate' | 'move', axis: 'x' | 'y' | 'z', amount: number) {
  const v = kind === 'rotate' ? WEAPON_TWEAK.euler : WEAPON_TWEAK.position
  v[axis] = kind === 'rotate' ? ((v[axis] + amount) % 360 + 360) % 360 : Math.round((v[axis] + amount) * 1000) / 1000
  for (const w of held.values()) {
    const t = Transform.getMutable(w.model)
    t.position = Vector3.clone(WEAPON_TWEAK.position)
    t.rotation = tweakRotation()
  }
}

export function weaponTweakLabel(): string {
  const e = WEAPON_TWEAK.euler
  const p = WEAPON_TWEAK.position
  return `rot ${e.x} ${e.y} ${e.z}  pos ${p.x} ${p.y} ${p.z}`
}

function tweakRotation() {
  return Quaternion.fromEulerDegrees(WEAPON_TWEAK.euler.x, WEAPON_TWEAK.euler.y, WEAPON_TWEAK.euler.z)
}

type HeldWeapon = { anchor: Entity; model: Entity; weaponId: string; hand: 'l' | 'r'; avatarId: string }
const held = new Map<string, HeldWeapon>()

/**
 * Show `weaponId` in the hand of the avatar the renderer calls `avatarId`
 * (undefined = take it away). Keyed by the lower-case address.
 */
export function syncNativeWeapon(id: string, avatarId: string | undefined, weaponId: string | undefined) {
  const def = weaponId ? WEAPONS[weaponId] : undefined
  const current = held.get(id)
  if (!def || !avatarId || !weaponId) {
    if (current) removeHeld(id, current)
    return
  }
  if (current && current.weaponId === weaponId && current.avatarId === avatarId && current.hand === def.hand) return
  if (current) removeHeld(id, current)
  const anchor = engine.addEntity()
  Transform.create(anchor)
  AvatarAttach.create(anchor, {
    avatarId,
    anchorPointId: def.hand === 'l' ? AvatarAnchorPointType.AAPT_LEFT_HAND : AvatarAnchorPointType.AAPT_RIGHT_HAND
  })
  const model = engine.addEntity()
  Transform.create(model, { parent: anchor, position: Vector3.clone(WEAPON_TWEAK.position), rotation: tweakRotation() })
  GltfContainer.create(model, { src: def.src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  held.set(id, { anchor, model, weaponId, hand: def.hand, avatarId })
}

function removeHeld(id: string, w: HeldWeapon) {
  engine.removeEntity(w.model)
  engine.removeEntity(w.anchor)
  held.delete(id)
}

// --- timings, for the developer ---------------------------------------------------------

/** How long the renderer takes from our call to the clip showing, in the console when the dev tools are on. */
function watch() {
  if (watching) return
  watching = true
  AvatarEmoteCommand.onChange(engine.PlayerEntity, (cmd) => {
    if (!cmd || !devToolsOn() || !lastAsk) return
    const state = cmd.state ?? EmoteState.ES_STARTED
    const since = Date.now() - lastAsk.at
    const name = cmd.emoteUrn.split('/').pop() ?? cmd.emoteUrn
    if (state === EmoteState.ES_STARTED) nativeNote(`${name} started +${since} ms`)
    else if (state === EmoteState.ES_INTERRUPTED) nativeNote(`${name} interrupted at ${(since / 1000).toFixed(2)} s`)
  })
}
