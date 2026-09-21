// The local hero's skill bar: what keys 1–4 hold for this champion at this
// level, how the last refused tap should be explained, and the buff on us.
// The fight itself lives in roamingCombat (the cast) and dungeonEnemies (the
// blows); this is the client's view of it for the HUD.

import { engine } from '@dcl/sdk/ecs'
import { getEquippedCharacter } from './characterPicker'
import { fxSound } from './combatFx'
import { heroClassOf } from './heroClasses'
import { activeBuff, Buff } from './heroVitals'
import { localXp } from './heroXp'
import { localAddress } from './multiplayer'
import { getPlayerCharacterState, getPlayerVitals, setPlayerSkillHandlers } from './playerCharacter'
import { SkillDef, skillInSlot, skillsFor } from './shared/skills'

export type SkillSlotView = {
  slot: number
  def: SkillDef
  /** The hero's level has reached it. */
  unlocked: boolean
  /** Seconds left before it may fire again (0 = ready). */
  cooldownLeft: number
  /** Being cast right now. */
  casting: boolean
}

export type SkillRefusal = { slot: number; why: 'locked' | 'cooldown' | 'stamina'; age: number }

const REFUSAL_SECONDS = 1.1
let refusal: SkillRefusal | undefined
let initialized = false

function heroClassId() {
  return heroClassOf(getPlayerCharacterState().characterId ?? getEquippedCharacter().id).id
}

export function initializeHeroSkills() {
  if (initialized) return
  initialized = true
  setPlayerSkillHandlers(
    (slot) => skillInSlot(heroClassId(), slot, localXp().level),
    (slot, why) => {
      refusal = { slot, why, age: 0 }
      if (why !== 'cooldown') fxSound('block', 0.25)
    }
  )
  engine.addSystem((dt: number) => {
    if (!refusal) return
    refusal.age += Number.isFinite(dt) ? dt : 0
    if (refusal.age >= REFUSAL_SECONDS) refusal = undefined
  })
}

/** The four slots of the current champion's kit, for the bar. */
export function skillBar(): SkillSlotView[] {
  const level = localXp().level
  const vitals = getPlayerVitals()
  return skillsFor(heroClassId()).map((def) => ({
    slot: def.slot, def, unlocked: level >= def.level,
    cooldownLeft: vitals.cooldowns[def.slot] ?? 0, casting: vitals.casting === def.id
  }))
}

/** The last tap that did nothing, while its explanation is still worth showing. */
export function skillRefusal(): Readonly<SkillRefusal> | undefined {
  return refusal
}

/** The buff on the local hero, if one is up. */
export function myBuff(): Readonly<Buff> | undefined {
  return activeBuff(localAddress())
}
