// The skill bar: four slots along the bottom of the screen, one per key, each
// showing its skill's picture, with the cooldown draining out of it and the
// level a locked one opens at. A line above the bar describes the slot under
// the pointer, or says why a tap was refused. Data comes from src/heroSkills.ts.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { myBuff, skillBar, skillRefusal, skillSummaryText } from './heroSkills'
import { SkillDef, skillById } from './shared/skills'
import type { HeroClass } from './heroClasses'
import { t } from './i18n'
import { localXp } from './heroXp'
import { tapSkillSlot } from './combatControls'

/** Slot size and the gap between slots. */
const SLOT = 108
const GAP = 20
/** The line above the slots. */
const LINE = 32
/** The padlock on a locked slot. */
const LOCK = 40
export const SKILL_BAR_HEIGHT = SLOT + LINE + 8
const rim = Color4.create(1, 1, 1, 0.14)
const white = Color4.create(0.95, 0.95, 0.95, 1)
const muted = Color4.create(0.62, 0.62, 0.66, 1)
const shade = Color4.create(0, 0, 0, 0.62)
const strip = Color4.create(0, 0, 0, 0.6)
/** Over a locked picture: still readable, plainly not yours yet. */
const veil = Color4.create(0.05, 0.05, 0.08, 0.5)
const lockTint = Color4.create(0.85, 0.85, 0.9, 0.9)
const lockedFace = Color4.create(0.1, 0.1, 0.13, 1)
const refusedRim = Color4.create(1, 0.35, 0.3, 0.9)
const gold = Color4.create(1, 0.82, 0.35, 1)
/** Tint on a picture: full for an open skill, a little cooled for a locked one. */
const pictureOpen = Color4.create(1, 1, 1, 1)
const pictureLocked = Color4.create(0.6, 0.6, 0.66, 1)

function tint(color: [number, number, number], alpha: number, k = 1): Color4 {
  return Color4.create(color[0] * k, color[1] * k, color[2] * k, alpha)
}

/**
 * The skill pictures, images/hud/skills.png: a 4x4 sheet, one row per class in
 * this order, one column per slot (the order the kit opens in).
 */
const SHEET = 'images/hud/skills.png'
const SHEET_ROWS: HeroClass[] = ['blade', 'heavy', 'bow', 'magic']

/** UV corners of a skill's cell: bottom-left, top-left, top-right, bottom-right (v runs up). */
function sheetUvs(def: SkillDef): number[] {
  const row = Math.max(0, SHEET_ROWS.indexOf(def.cls))
  const u0 = def.slot / 4
  const u1 = u0 + 1 / 4
  const vTop = 1 - row / 4
  const vBottom = vTop - 1 / 4
  return [u0, vBottom, u0, vTop, u1, vTop, u1, vBottom]
}

/** The slot under the pointer, for the line above the bar. */
let hoveredSlot: number | undefined

/** Refusals in words the bar can show under the slot. */
function refusalText(why: 'locked' | 'cooldown' | 'stamina', level: number): string {
  if (why === 'locked') return t('Opens at level {n}', { n: level })
  if (why === 'cooldown') return t('Not yet')
  return t('Winded')
}

export function SkillBar({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  const slots = skillBar()
  if (!slots.length) return null
  const refusal = skillRefusal()
  const buff = myBuff()
  const buffDef = buff ? skillById(buff.skill) : undefined
  const barWidth = slots.length * SLOT * s + (slots.length - 1) * GAP * s
  const refusedSlot = refusal ? slots.find((v) => v.slot === refusal.slot) : undefined
  const hovered = hoveredSlot === undefined ? undefined : slots.find((v) => v.slot === hoveredSlot)
  // A refusal answers a tap; otherwise the slot under the pointer is described,
  // a locked one by the level it opens at; a running buff shows its clock.
  const line = refusal && refusedSlot ? refusalText(refusal.why, refusedSlot.def.level)
    : hovered && hovered.unlocked ? `${hovered.def.name}  ·  ${hovered.def.blurb}`
    : hovered ? `${t('{skill} opens at level {n}', { skill: hovered.def.name, n: hovered.def.level })}  ·  ${t('you are level {n}', { n: localXp().level })}`
    : buff && buffDef ? `${buffDef.name}  ·  ${skillSummaryText(buffDef)}  ·  ${Math.ceil(buff.left)} s`
    : ''
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - barWidth) / 2, bottom },
    width: barWidth, height: SKILL_BAR_HEIGHT * s, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'none' }}>
    {line !== '' && <Label value={line} color={refusal ? refusedRim : hovered ? white : gold} font="sans-serif" fontSize={22 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: Math.max(barWidth, 900 * s), height: LINE * s, margin: { bottom: 8 * s }, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ width: barWidth, height: SLOT * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {slots.map((v) => {
        const refused = refusal?.slot === v.slot && refusal.age < 0.5
        const ratio = v.unlocked && v.def.cooldown > 0 ? Math.min(1, v.cooldownLeft / v.def.cooldown) : 0
        const lit = v.casting || hoveredSlot === v.slot
        const border = refused ? refusedRim : lit ? tint(v.def.color, 1) : rim
        // The picture carries the slot: no name (the line above has it), just a
        // small key tag, and on a locked one a veil with the level it opens at.
        // Tappable: on a phone the pad has no 1-4 keys, the slot itself is the button.
        return <UiEntity key={`skill-${v.slot}`} uiTransform={{ width: SLOT * s, height: SLOT * s, borderRadius: 6 * s, borderWidth: 2 * s, borderColor: border,
          flexDirection: 'column' }} uiBackground={{ color: lockedFace }} onMouseDown={() => tapSkillSlot(v.slot)}
          onMouseEnter={() => { hoveredSlot = v.slot }} onMouseLeave={() => { if (hoveredSlot === v.slot) hoveredSlot = undefined }}>
          <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: SHEET }, uvs: sheetUvs(v.def), color: v.unlocked ? pictureOpen : pictureLocked }} />
          {/* Cooldown: a shade that drains down as the wait runs out, the seconds left over it. */}
          {ratio > 0 && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: `${ratio * 100}%`, pointerFilter: 'none' }}
            uiBackground={{ color: shade }} />}
          {ratio > 0 && <Label value={`${Math.ceil(v.cooldownLeft)}`} color={white} font="sans-serif" fontSize={36 * s} textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }} />}
          {/* Locked: a veil over the picture, a padlock, and the level it opens at along the foot. */}
          {!v.unlocked && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%', pointerFilter: 'none' }}
            uiBackground={{ color: veil }} />}
          {!v.unlocked && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (SLOT - LOCK) / 2 * s, top: (SLOT - 22 - LOCK) / 2 * s }, width: LOCK * s, height: LOCK * s, pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: 'images/hud/lock.png' }, color: lockTint }} />}
          {!v.unlocked && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, bottom: 0 }, width: '100%', height: 22 * s, pointerFilter: 'none' }}
            uiBackground={{ color: strip }}>
            <Label value={t('Lv {n}', { n: v.def.level })} color={muted} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
              uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
          </UiEntity>}
          <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: 22 * s, height: 22 * s, pointerFilter: 'none' }}
            uiBackground={{ color: strip }}>
            <Label value={`${v.slot + 1}`} color={v.unlocked ? white : muted} font="sans-serif" fontSize={13 * s} textAlign="middle-center" textWrap="nowrap"
              uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
        </UiEntity>
      })}
    </UiEntity>
  </UiEntity>
}
