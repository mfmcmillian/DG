// The hold-to-talk prompt beside the hall's folk. Walk up to one and a small
// ring with an E in it appears at their shoulder; hold E and the ring fills
// clockwise, and when it closes the conversation opens (src/hallTalk.ts).
// Let go early and it empties again. A click on the ring talks straight
// away, for a mouse; on touch the ring is the button. One prompt serves the
// whole hall: it moves to whoever is nearest. Nothing floats over anyone's
// head, and while the prompt is up a press of E is a hold, not a swing
// (src/playerCharacter.ts asks talkPromptActive()).

import {
  Billboard, BillboardMode, ColliderLayer, engine, Entity, InputAction, inputSystem, Material, MaterialTransparencyMode,
  MeshCollider, MeshRenderer, pointerEventsSystem, TextAlignMode, TextShape, Transform, VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getTalkState, openTalk } from './hallTalk'
import { billboardTarget } from './heroNameTag'
import { t } from './i18n'
import { isHeadless } from './multiplayer'

/** How long E is held for the ring to close. */
const HOLD_SECONDS = 0.65
/** How fast the ring empties when E is let go (fraction per second). */
const RELEASE_RATE = 3
const SEGMENTS = 24
const RADIUS = 0.3
/** Where the prompt sits: at the character's shoulder, off to their side as the camera sees them. */
const AT = Vector3.create(0.78, 1.3, 0)

const GOLD = Color4.create(1, 0.84, 0.4, 1)
const GOLD_GLOW = Color3.create(1, 0.74, 0.22)
const DIM = Color4.create(0.2, 0.2, 0.24, 0.55)
const INK = Color4.create(0.05, 0.05, 0.07, 0.82)
const WHITE = Color4.create(1, 1, 1, 1)
const MUTED = Color4.create(0.72, 0.74, 0.8, 1)
const HIDDEN = Vector3.create(0, -50, 0)

type Prompt = { root: Entity; segments: Entity[]; title: Entity; hint: Entity; visible: boolean }

let prompt: Prompt | undefined
let progress = 0
/** E has been seen released since the prompt came up: the next press is a hold for us, not a swing carried over. */
let armed = false
let shownFor = ''
let systemAdded = false

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
  // The faint full ring behind the fill, and a dark disc under the key.
  plane(root, Vector3.create(AT.x, AT.y, 0.01), 0.82, 'images/fx/ring_02.png', DIM)
  const disc = plane(root, Vector3.create(AT.x, AT.y, 0.005), 0.5, 'images/fx/circle_01.png', INK)
  MeshCollider.setPlane(disc, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown({ entity: disc, opts: { button: InputAction.IA_POINTER, showFeedback: false } }, () => {
    if (prompt?.visible) openTalk()
  })
  const key = text(root, Vector3.create(AT.x, AT.y, -0.01), 3.4, WHITE)
  TextShape.getMutable(key).text = 'E'
  // The fill: short gold bars around the ring, lit clockwise from the top as E is held.
  const segments: Entity[] = []
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2
    const e = engine.addEntity()
    Transform.create(e, {
      parent: root,
      position: Vector3.create(AT.x + RADIUS * Math.sin(a), AT.y + RADIUS * Math.cos(a), -0.005),
      scale: Vector3.create(0.072, 0.048, 0.01),
      rotation: Quaternion.fromEulerDegrees(0, 0, (-a * 180) / Math.PI)
    })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: GOLD, emissiveColor: GOLD_GLOW, emissiveIntensity: 2.2, castShadows: false })
    VisibilityComponent.create(e, { visible: false })
    segments.push(e)
  }
  const title = text(root, Vector3.create(AT.x, AT.y - 0.5, -0.01), 1.55, GOLD)
  const hint = text(root, Vector3.create(AT.x, AT.y - 0.66, -0.01), 1.15, MUTED)
  return { root, segments, title, hint, visible: false }
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
}

function update(dt: number) {
  const span = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
  const talk = getTalkState()
  const who = talk.open ? undefined : talk.near
  if (!who) {
    if (prompt) hide(prompt)
    return
  }
  if (!prompt) prompt = build()
  const p = prompt
  if (!p.visible || shownFor !== who.title) {
    p.visible = true
    shownFor = who.title
    progress = 0
    armed = false
    TextShape.getMutable(p.title).text = t(who.title)
    TextShape.getMutable(p.hint).text = t('hold to talk')
  }
  // Follow the character (a walker keeps walking until the word is given) and face the player's camera.
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
      openTalk()
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
