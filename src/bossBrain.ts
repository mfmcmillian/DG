import { attackRange, COMBAT_RULES, WeaponMotion } from './combatActions'

export type BossPhase = 1 | 2 | 3
export type BossAttack = WeaponMotion | 'slam' | 'roll'

export type BossBrain = {
  mode: 'intro' | 'approach' | 'telegraph' | 'cooldown' | 'block' | 'shift'
  timer: number
  telegraphDuration: number
  attack: BossAttack
  queue: BossAttack[]
  phase: BossPhase
  introStep: number
  shiftPlayed: number
}

export type BossDecision = {
  advance: boolean
  block: boolean
  attack?: BossAttack
  pose?: 'menace_enter' | 'menace' | 'flourish' | 'stun'
  telegraph: string
  telegraphProgress: number
  telegraphAttack?: BossAttack
  hyperArmor: boolean
  notice?: string
}

const PHASE_TWO = 0.65
const PHASE_THREE = 0.32
/** Metres a leaping strike can close; from further out the Warlord walks. */
export const LEAP_RANGE = 7

export function createBossBrain(): BossBrain {
  return {
    mode: 'intro', timer: 0, telegraphDuration: 0, attack: 'fencing', queue: [],
    phase: 1, introStep: 0, shiftPlayed: 0
  }
}

export function resetBossBrain(brain: BossBrain) {
  brain.mode = 'intro'
  brain.timer = 0
  brain.telegraphDuration = 0
  brain.queue = []
  brain.phase = 1
  brain.introStep = 0
  brain.shiftPlayed = 0
}

export function bossPhaseFor(health: number, maxHealth: number): BossPhase {
  const ratio = maxHealth <= 0 ? 1 : health / maxHealth
  if (ratio <= PHASE_THREE) return 3
  if (ratio <= PHASE_TWO) return 2
  return 1
}

export function bossPhaseLabel(phase: BossPhase): string {
  return phase === 3 ? 'NO MERCY' : phase === 2 ? 'THE ONSLAUGHT' : 'THE DUEL'
}

export function updateBossBrain(
  brain: BossBrain, dt: number, distance: number, available: boolean, health: number, maxHealth: number
): BossDecision {
  const nextPhase = bossPhaseFor(health, maxHealth)
  const decision: BossDecision = {
    advance: false, block: false, telegraph: '', telegraphProgress: 0,
    hyperArmor: nextPhase === 3
  }

  if (nextPhase > brain.phase) {
    brain.phase = nextPhase
    brain.mode = 'shift'
    brain.timer = nextPhase === 3 ? 0.9 : 1.77
    brain.queue = []
    brain.shiftPlayed = nextPhase
    decision.pose = nextPhase === 3 ? 'stun' : 'flourish'
    decision.notice = nextPhase === 3 ? 'The Warlord will not fall' : 'The Warlord changes stance'
    return decision
  }

  if (brain.mode === 'intro') {
    return intro(brain, dt, decision)
  }

  if (brain.mode === 'shift') {
    brain.timer -= dt
    decision.pose = brain.shiftPlayed === 3 && brain.timer > 0.85 ? 'stun' : 'flourish'
    if (brain.timer <= 0) {
      brain.mode = 'cooldown'
      brain.timer = 0.25
      brain.queue = nextPhase === 3
        ? ['leap', 'slam', 'heavy_combo_a', 'heavy_combo_b', 'heavy_combo_c']
        : ['slam', 'heavy_combo_a', 'heavy_combo_b']
    }
    return decision
  }

  if (!available) {
    // Recovering from a swing or reeling from a blow: he cannot start anything,
    // but a target that keeps its distance still gets walked down (updateBoss
    // slows the stride while he recovers).
    if ((brain.mode === 'approach' || brain.mode === 'cooldown') && distance > LEAP_RANGE) decision.advance = true
    return decision
  }

  if (brain.mode === 'block') {
    brain.timer -= dt
    decision.block = true
    if (brain.timer <= 0) {
      decision.block = false
      brain.mode = 'cooldown'
      brain.timer = 0.2
    }
    return decision
  }

  if (brain.mode === 'telegraph') {
    brain.timer -= dt
    decision.telegraph = telegraphLabel(brain.attack, brain.phase)
    decision.telegraphAttack = brain.attack
    decision.telegraphProgress = brain.telegraphDuration > 0 ? 1 - Math.max(0, brain.timer) / brain.telegraphDuration : 1
    if (brain.timer <= 0) {
      decision.attack = brain.attack
      brain.mode = 'cooldown'
      brain.timer = cooldownFor(brain.attack, brain.phase)
    }
    return decision
  }

  if (brain.mode === 'cooldown') {
    brain.timer -= dt
    if (brain.timer > 0) return decision
    brain.mode = 'approach'
  }

  const next = brain.queue.shift() ?? chooseAttack(brain.phase, distance)
  // A leap covers LEAP_RANGE, and a roll is only worth it about that close;
  // beyond it he closes on foot first, in every phase, rather than
  // telegraphing leaps that never land or side-stepping at a distant archer.
  const reach = next === 'roll' || next === 'leap' ? LEAP_RANGE : next === 'slam' ? 3.2 : attackRange(next)
  if (distance > Math.max(reach, COMBAT_RULES.approachRange)) {
    brain.queue.unshift(next)
    decision.advance = true
    return decision
  }

  if (brain.phase === 1 && next !== 'roll' && distance < 2.4 && Math.random() < 0.16) {
    brain.mode = 'block'
    brain.timer = 0.55 + Math.random() * 0.25
    decision.block = true
    return decision
  }

  if (next === 'heavy_combo_a') brain.queue.unshift('heavy_combo_b', 'heavy_combo_c')
  if (next === 'attack_light') brain.queue.unshift('attack_light2', 'attack_light3')
  if (brain.phase === 3 && next === 'leap') brain.queue.unshift('slam')

  brain.attack = next
  brain.mode = 'telegraph'
  brain.telegraphDuration = telegraphFor(next, brain.phase)
  brain.timer = brain.telegraphDuration
  decision.telegraph = telegraphLabel(next, brain.phase)
  decision.telegraphAttack = next
  return decision
}

function intro(brain: BossBrain, dt: number, decision: BossDecision): BossDecision {
  if (brain.introStep === 0) {
    brain.introStep = 1
    brain.timer = 1.333
    decision.pose = 'menace_enter'
    decision.notice = 'The Warlord answers'
    return decision
  }
  brain.timer -= dt
  if (brain.introStep === 1) {
    decision.pose = 'menace_enter'
    if (brain.timer <= 0) {
      brain.introStep = 2
      brain.timer = 1.767
      decision.pose = 'menace'
    }
    return decision
  }
  if (brain.introStep === 2) {
    decision.pose = 'menace'
    if (brain.timer <= 0) {
      brain.introStep = 3
      brain.timer = 1.767
      decision.pose = 'flourish'
    }
    return decision
  }
  decision.pose = 'flourish'
  if (brain.timer <= 0) {
    brain.mode = 'approach'
    brain.introStep = 4
  }
  return decision
}

function chooseAttack(phase: BossPhase, distance: number): BossAttack {
  // Out of reach: leap. Later phases mix in a side-roll, but only when he is
  // already close; from further out a roll just keeps a kiting archer safe.
  if (distance > 3.6) return phase === 1 || distance > 5 || Math.random() < 0.6 ? 'leap' : 'roll'
  if (phase === 1) {
    const roll = Math.random()
    if (roll < 0.28) return 'fencing'
    if (roll < 0.55) return 'attack_light'
    if (roll < 0.72) return 'stab'
    if (roll < 0.88) return 'flourish_heavy'
    return 'slam'
  }
  if (phase === 2) {
    const roll = Math.random()
    if (distance > 2.8 && roll < 0.4) return 'leap'
    if (roll < 0.3) return 'heavy_combo_a'
    if (roll < 0.5) return 'stab'
    if (roll < 0.7) return 'flourish_heavy'
    if (roll < 0.85) return 'slam'
    return 'attack_light'
  }
  const roll = Math.random()
  if (distance > 2.6 && roll < 0.35) return 'leap'
  if (roll < 0.22) return 'roll'
  if (roll < 0.5) return 'heavy_combo_a'
  if (roll < 0.7) return 'flourish_heavy'
  if (roll < 0.85) return 'slam'
  return 'stab'
}

function telegraphFor(attack: BossAttack, phase: BossPhase): number {
  const haste = phase === 3 ? 0.72 : phase === 2 ? 0.86 : 1
  if (attack === 'slam' || attack === 'flourish_heavy') return 1.15 * haste
  if (attack === 'leap' || attack === 'heavy_combo_a') return 0.85 * haste
  if (attack === 'roll') return 0.28
  return 0.42 * haste
}

function cooldownFor(attack: BossAttack, phase: BossPhase): number {
  const haste = phase === 3 ? 0.55 : phase === 2 ? 0.75 : 1
  if (attack === 'slam' || attack === 'flourish_heavy' || attack === 'heavy_combo_c') return 0.55 * haste
  if (attack === 'roll' || attack === 'leap') return 0.18
  return 0.28 * haste
}

function telegraphLabel(attack: BossAttack, phase: BossPhase): string {
  if (attack === 'slam') return phase === 3 ? 'The floor will break' : 'Ground slam incoming'
  if (attack === 'leap') return 'Leaping strike'
  if (attack === 'flourish_heavy') return 'Wide cleave incoming'
  if (attack === 'heavy_combo_a' || attack === 'heavy_combo_b' || attack === 'heavy_combo_c') return 'Heavy combination'
  if (attack === 'stab') return 'Thrust incoming'
  if (attack === 'roll') return ''
  return 'Steel incoming'
}
