// The hall's one key: E. Walk up to one of the folk and a small ring with an
// E in it appears at their shoulder; hold E and the ring fills clockwise, and
// when it closes the conversation opens (src/hallTalk.ts). The war table has
// the same ring, and closing it opens the table. Let go early and the ring
// empties again. A click on the ring does the same at once, for a mouse; on
// touch the ring is the button. While a conversation is open a press of E
// turns the page. One prompt serves the whole hall: it moves to whatever is
// nearest, the folk before the table. Nothing floats over anyone's head, and
// while the prompt is up a press of E is theirs, not a swing
// (src/playerCharacter.ts asks hallPromptActive()).

import {
  Billboard, BillboardMode, ColliderLayer, engine, Entity, InputAction, inputSystem, Material, MaterialTransparencyMode,
  MeshCollider, MeshRenderer, PointerEventType, pointerEventsSystem, TextAlignMode, TextShape, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { UPGRADE_PIT_REACH, UPGRADE_PIT_TAG, WAR_TABLE_TAG } from './dungeon/hub'
import { getDungeonState } from './dungeon'
import { getTalkState, nextLine, openTalk } from './hallTalk'
import { billboardTarget } from './heroNameTag'
import { t } from './i18n'
import { isHeadless } from './multiplayer'
import { atWarTable, getLobbyState, myPhase, openLobby } from './party'
import { HUB } from './partyLookup'
import { pitCinematicPlaying, pitHoverItem, pitResultHovering, takePitResult } from './pitCinematic'
import { isUpgradePickerOpen, openUpgradePicker } from './upgradeUi'
import { getEquipmentItemOrNull } from './equipmentCatalog'

/** How long E is held for the ring to close. */
const HOLD_SECONDS = 0.65
/** How fast the ring empties when E is let go (fraction per second). */
const RELEASE_RATE = 3
const SEGMENTS = 24
const RADIUS = 0.3
/** Where the prompt sits beside one of the folk: at their shoulder, off to their side as the camera sees them. */
const AT = Vector3.create(0.78, 1.3, 0)
/** ...and over the war table: centred, a little above the map. */
const AT_TABLE = Vector3.create(0, 1.45, 0)
/** ...and at the upgrade pit: beside the fire, clear of the flames. */
const AT_PIT = Vector3.create(1.5, 2.3, 0)
/** ...and beside the weapon hovering over it. */
const AT_HOVER = Vector3.create(1.3, 3.5, 0)

const GOLD = Color4.create(1, 0.84, 0.4, 1)
const GOLD_GLOW = Color3.create(1, 0.74, 0.22)
const DIM = Color4.create(0.2, 0.2, 0.24, 0.55)
const INK = Color4.create(0.05, 0.05, 0.07, 0.82)
const WHITE = Color4.create(1, 1, 1, 1)
const MUTED = Color4.create(0.72, 0.74, 0.8, 1)
const HIDDEN = Vector3.create(0, -50, 0)

type Prompt = { root: Entity; widget: Entity; segments: Entity[]; title: Entity; hint: Entity; visible: boolean }
/** What the ring is up for: where it stands, what it says, and what closing it does. */
type Target = { key: string; x: number; z: number; at: Vector3; title: string; hint: string; run: () => void }

let prompt: Prompt | undefined
let progress = 0
/** E has been seen released since the prompt came up: the next press is a hold for us, not a swing carried over. */
let armed = false
let shownFor = ''
let current: Target | undefined
let systemAdded = false

function targetNow(): Target | undefined {
  const talk = getTalkState()
  if (talk.open) return undefined
  // The pit's shot and its sheet own the screen.
  if (pitCinematicPlaying() || isUpgradePickerOpen()) return undefined
  const pit = pitTarget()
  const who = talk.near
  if (who) {
    // The smith stands at the pit: whichever is nearer has the ring.
    const p = Transform.getOrNull(engine.PlayerEntity)?.position
    const folkNearer = !pit || !p || (who.x - p.x) ** 2 + (who.z - p.z) ** 2 <= (pit.x - p.x) ** 2 + (pit.z - p.z) ** 2
    if (folkNearer) return { key: 'folk:' + who.title, x: who.x, z: who.z, at: AT, title: t(who.title), hint: t('hold to talk'), run: openTalk }
  }
  if (pit) return pit
  if (getLobbyState().open || !atWarTable()) return undefined
  const table = getDungeonState().instance?.tagged[WAR_TABLE_TAG]
  const tr = table !== undefined ? Transform.getOrNull(table) : undefined
  if (!tr) return undefined
  return { key: 'table', x: tr.position.x, z: tr.position.z, at: AT_TABLE, title: t('War table'), hint: t('hold to open'), run: openLobby }
}

function pitTarget(): Target | undefined {
  if (myPhase() !== HUB || getLobbyState().open) return undefined
  const cauldron = getDungeonState().instance?.tagged[UPGRADE_PIT_TAG]
  const tr = cauldron !== undefined ? Transform.getOrNull(cauldron) : undefined
  const p = Transform.getOrNull(engine.PlayerEntity)
  if (!tr || !p) return undefined
  const dx = p.position.x - tr.position.x
  const dz = p.position.z - tr.position.z
  if (dx * dx + dz * dz > UPGRADE_PIT_REACH * UPGRADE_PIT_REACH) return undefined
  const hover = pitHoverItem()
  if (hover && pitResultHovering()) {
    const item = getEquipmentItemOrNull(hover.id)
    return { key: 'pit-take', x: tr.position.x, z: tr.position.z, at: AT_HOVER, title: item ? t(item.name) : t('Upgrade pit'), hint: t('hold to take'), run: () => { takePitResult() } }
  }
  return { key: 'pit', x: tr.position.x, z: tr.position.z, at: AT_PIT, title: t('Upgrade pit'), hint: t('hold to offer a weapon'), run: () => { openUpgradePicker() } }
}

/** The ring is up, or a conversation is open: E belongs to the hall, not to the weapon. */
export function hallPromptActive(): boolean {
  return !!prompt?.visible || !!getTalkState().open
}

function plane(parent: Entity, position: Vector3, scale: number, src: string, color: Color4, glow = 0): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, scale: Vector3.create(scale, scale, 1) })
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, {
    texture: Material.Texture.Common({ src }),
    albedoColor: color,
    emissiveTexture: glow > 0 ? Material.Texture.Common({ src }) : undefined,
    emissiveColor: glow > 0 ? Color3.create(color.r, color.g, color.b) : undefined,
    emissiveIntensity: glow,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  return e
}

function text(parent: Entity, position: Vector3, size: number, color: Color4): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position })
  TextShape.create(e, {
    text: '', fontSize: size, textColor: color,
    outlineColor: Color4.create(0.04, 0.03, 0.02, 1), outlineWidth: 0.1, textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  return e
}

function build(): Prompt {
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(HIDDEN) })
  Billboard.create(root, { billboardMode: BillboardMode.BM_ALL })
  // Everything hangs off one widget entity, moved to where the target wants its ring.
  const widget = engine.addEntity()
  Transform.create(widget, { parent: root, position: Vector3.clone(AT) })
  // The faint full ring behind the fill, and a dark disc under the key.
  plane(widget, Vector3.create(0, 0, 0.01), 0.82, 'images/fx/ring_02.png', DIM)
  const disc = plane(widget, Vector3.create(0, 0, 0.005), 0.5, 'images/fx/circle_01.png', INK)
  MeshCollider.setPlane(disc, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown({ entity: disc, opts: { button: InputAction.IA_POINTER, showFeedback: false } }, () => {
    if (prompt?.visible && current) current.run()
  })
  const key = text(widget, Vector3.create(0, 0, -0.01), 3.4, WHITE)
  TextShape.getMutable(key).text = 'E'
  // The fill: short gold bars around the ring, lit clockwise from the top as E is held.
  const segments: Entity[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2
    const e = engine.addEntity()
    Transform.create(e, {
      parent: widget,
      position: Vector3.create(RADIUS * Math.sin(a), RADIUS * Math.cos(a), -0.005),
      scale: Vector3.create(0.072, 0.048, 0.01),
      rotation: Quaternion.fromEulerDegrees(0, 0, (-a * 180) / Math.PI)
    })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: GOLD, emissiveColor: GOLD_GLOW, emissiveIntensity: 2.2, castShadows: false })
    VisibilityComponent.create(e, { visible: false })
    segments.push(e)
  }
  const title = text(widget, Vector3.create(0, -0.5, -0.01), 1.55, GOLD)
  const hint = text(widget, Vector3.create(0, -0.66, -0.01), 1.15, MUTED)
  return { root, widget, segments, title, hint, visible: false }
}

function setFill(p: Prompt, fraction: number) {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * SEGMENTS)
  for (let i = 0; i < SEGMENTS; i++) {
    const on = i < lit
    if (VisibilityComponent.get(p.segments[i]).visible !== on) VisibilityComponent.getMutable(p.segments[i]).visible = on
  }
}

function hide(p: Prompt) {
  if (!p.visible) return
  p.visible = false
  Transform.getMutable(p.root).position = Vector3.clone(HIDDEN)
  setFill(p, 0)
  progress = 0
  shownFor = ''
  current = undefined
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  // Mid-conversation, a press of E turns the page (a fresh press: the hold that opened it does not count).
  if (getTalkState().open && inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) nextLine()
  const who = targetNow()
  if (!who) {
    if (prompt) hide(prompt)
    return
  }
  if (!prompt) prompt = build()
  const p = prompt
  current = who
  if (!p.visible || shownFor !== who.key) {
    p.visible = true
    shownFor = who.key
    progress = 0
    armed = false
    TextShape.getMutable(p.title).text = who.title
    TextShape.getMutable(p.hint).text = who.hint
    Transform.getMutable(p.widget).position = Vector3.clone(who.at)
  }
  // Follow the target (a walker keeps walking until the word is given) and face the player's camera.
  const root = Transform.getMutable(p.root)
  root.position = Vector3.create(who.x, 0, who.z)
  const target = billboardTarget()
  if (Billboard.get(p.root).targetEntity !== target) Billboard.getMutable(p.root).targetEntity = target

  const pressed = inputSystem.isPressed(InputAction.IA_PRIMARY)
  if (!pressed) {
    armed = true
    progress = Math.max(0, progress - RELEASE_RATE * span)
  } else if (armed) {
    progress += span / HOLD_SECONDS
    if (progress >= 1) {
      setFill(p, 1)
      progress = 0
      armed = false
      who.run()
      return
    }
  }
  setFill(p, progress)
}

export function initializeHallPrompt() {
  if (isHeadless() || systemAdded) return
  systemAdded = true
  engine.addSystem(update)
}
