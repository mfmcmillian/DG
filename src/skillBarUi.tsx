// The skill bar: four slots along the bottom of the screen, one per key,
// with the cooldown draining out of each and the level a locked one opens at.
// Data comes from src/heroSkills.ts.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { myBuff, skillBar, skillRefusal } from './heroSkills'
import { skillById, skillSummary } from './shared/skills'
import { localXp } from './heroXp'

export const SKILL_BAR_HEIGHT = 84

const SLOT = 54
const GAP = 10
const rim = Color4.create(1, 1, 1, 0.14)
const white = Color4.create(0.95, 0.95, 0.95, 1)
const muted = Color4.create(0.62, 0.62, 0.66, 1)
const shade = Color4.create(0, 0, 0, 0.62)
const lockedFace = Color4.create(0.16, 0.16, 0.19, 1)
const refusedRim = Color4.create(1, 0.35, 0.3, 0.9)
const gold = Color4.create(1, 0.82, 0.35, 1)

function tint(color: [number, number, number], alpha: number, k = 1): Color4 {
  return Color4.create(color[0] * k, color[1] * k, color[2] * k, alpha)
}

/** Refusals in words the bar can show under the slot. */
function refusalText(why: 'locked' | 'cooldown' | 'stamina', level: number): string {
  if (why === 'locked') return `Opens at level ${level}`
  if (why === 'cooldown') return 'Not yet'
  return 'Winded'
}

export function SkillBar({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  const slots = skillBar()
  if (!slots.length) return null
  const refusal = skillRefusal()
  const buff = myBuff()
  const buffDef = buff ? skillById(buff.skill) : undefined
  const barWidth = slots.length * SLOT * s + (slots.length - 1) * GAP * s
  const hovered = refusal ? slots.find((v) => v.slot === refusal.slot) : undefined
  // The next skill to open, for a hero still climbing to it.
  const next = slots.find((v) => !v.unlocked)
  const line = refusal && hovered ? refusalText(refusal.why, hovered.def.level)
    : buff && buffDef ? `${buffDef.name}  ·  ${skillSummary(buffDef)}  ·  ${Math.ceil(buff.left)} s`
    : next ? `${next.def.name} opens at level ${next.def.level}  ·  you are level ${localXp().level}` : ''
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - barWidth) / 2, bottom },
    width: barWidth, height: SKILL_BAR_HEIGHT * s, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', pointerFilter: 'none' }}>
    {line !== '' && <Label value={line} color={refusal ? refusedRim : buff ? gold : muted} font="sans-serif" fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: Math.max(barWidth, 420 * s), height: 16 * s, margin: { bottom: 4 * s }, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ width: barWidth, height: SLOT * s, flexDirection: 'row', justifyContent: 'space-between', pointerFilter: 'none' }}>
      {slots.map((v) => {
        const refused = refusal?.slot === v.slot && refusal.age < 0.5
        const ratio = v.unlocked && v.def.cooldown > 0 ? Math.min(1, v.cooldownLeft / v.def.cooldown) : 0
        const face = v.unlocked ? tint(v.def.color, 1, v.casting ? 1 : 0.55) : lockedFace
        const border = refused ? refusedRim : v.casting ? tint(v.def.color, 1) : rim
        return <UiEntity key={`skill-${v.slot}`} uiTransform={{ width: SLOT * s, height: SLOT * s, borderRadius: 8 * s, borderWidth: 2 * s, borderColor: border,
          flexDirection: 'column', pointerFilter: 'none' }} uiBackground={{ color: face }}>
          {/* Cooldown: a shade that drains down as the wait runs out. */}
          {ratio > 0 && <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: `${ratio * 100}%`, borderRadius: 6 * s, pointerFilter: 'none' }}
            uiBackground={{ color: shade }} />}
          <Label value={`${v.slot + 1}`} color={v.unlocked ? white : muted} font="sans-serif" fontSize={10 * s} textAlign="top-left" textWrap="nowrap"
            uiTransform={{ positionType: 'absolute', position: { left: 5 * s, top: 3 * s }, width: 16 * s, height: 12 * s, pointerFilter: 'none' }} />
          <Label value={v.unlocked ? (ratio > 0 ? `${Math.ceil(v.cooldownLeft)}` : initials(v.def.name)) : `Lv ${v.def.level}`}
            color={v.unlocked ? white : muted} font={v.unlocked && ratio === 0 ? 'serif' : 'sans-serif'} fontSize={(v.unlocked && ratio === 0 ? 20 : 15) * s}
            textAlign="middle-center" textWrap="nowrap"
            uiTransform={{ positionType: 'absolute', position: { left: 0, top: 10 * s }, width: '100%', height: (SLOT - 22) * s, pointerFilter: 'none' }} />
          <Label value={v.def.name} color={v.unlocked ? white : muted} font="sans-serif" fontSize={8 * s} textAlign="bottom-center" textWrap="nowrap"
            uiTransform={{ positionType: 'absolute', position: { left: 0, bottom: 3 * s }, width: '100%', height: 10 * s, pointerFilter: 'none' }} />
        </UiEntity>
      })}
    </UiEntity>
  </UiEntity>
}

/** "Ground Slam" -> "GS", "Lunge" -> "Lu". */
function initials(name: string): string {
  const words = name.split(' ')
  return words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 2)
}
