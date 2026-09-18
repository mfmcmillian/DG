import jumpProfiles from './jumpProfiles.json'

export type JumpMotion = 'jump_male' | 'jump_female'
export type NativeJumpMotion = 'jump_male_air' | 'jump_male_land' | 'jump_female_air' | 'jump_female_land'
export type EquipmentMotion = 'idle' | 'walk' | 'run' | 'combat_idle' | 'attack_light' | 'attack_light2' | 'attack_heavy' | 'attack_light3' | 'flourish_heavy' | 'stab' | 'heavy_combo_a' | 'heavy_combo_b' | 'heavy_combo_c' | 'leap' | 'fencing' | 'flourish' | 'menace' | 'menace_enter' | 'roll' | 'dodge_roll' | 'stun' | 'block' | 'hit' | 'death' | JumpMotion | NativeJumpMotion

// Native Space skips the arena clip's anticipation. These matching phases keep
// every outfit part together while Explorer supplies the actual vertical motion.
export const NATIVE_JUMP_CLIPS: Record<JumpMotion, { air: NativeJumpMotion; land: NativeJumpMotion }> = {
  jump_male: { air: 'jump_male_air', land: 'jump_male_land' },
  jump_female: { air: 'jump_female_air', land: 'jump_female_land' }
}

export type JumpProfile = { duration: number; takeoff: number; landing: number }
export const JUMP_PROFILES: Record<JumpMotion, JumpProfile> = jumpProfiles

/** `duration` and `contact` are in the clip's own (authored) time; `rate` is the
 *  playback speed it is shown at, so its real length is duration / rate. */
export type CombatClip = { duration: number; loop: boolean; contact?: number; rate?: number }

// Durations come from the supplied FBXs. Contact times are initial tuning values.
export const COMBAT_CLIPS: Record<EquipmentMotion, CombatClip> = {
  idle: { duration: 1.766667, loop: true },
  walk: { duration: 1.033333, loop: true },
  run: { duration: 0.700000, loop: true },
  combat_idle: { duration: 1.766667, loop: true },
  attack_light: { duration: 0.800000, loop: false, contact: 0.320000 },
  attack_light2: { duration: 0.666667, loop: false, contact: 0.266667 },
  attack_heavy: { duration: 1.366667, loop: false, contact: 0.546667 },
  attack_light3: { duration: 0.733333, loop: false, contact: 0.300000 },
  flourish_heavy: { duration: 2.033333, loop: false, contact: 0.980000 },
  stab: { duration: 1.366667, loop: false, contact: 0.560000 },
  heavy_combo_a: { duration: 2.033333, loop: false, contact: 0.860000 },
  heavy_combo_b: { duration: 1.666667, loop: false, contact: 0.700000 },
  heavy_combo_c: { duration: 1.600000, loop: false, contact: 0.720000 },
  leap: { duration: 1.566667, loop: false, contact: 0.980000 },
  fencing: { duration: 1.200000, loop: false, contact: 0.420000 },
  flourish: { duration: 1.766667, loop: false },
  menace: { duration: 1.766667, loop: true },
  menace_enter: { duration: 1.333333, loop: false },
  roll: { duration: 1.166667, loop: false },
  // The hero's dodge: the Warlord's roll clip hurried to a ~0.78 s evade.
  dodge_roll: { duration: 1.166667, loop: false, rate: 1.5 },
  stun: { duration: 0.900000, loop: false },
  block: { duration: 1.766667, loop: true },
  hit: { duration: 0.833333, loop: false },
  death: { duration: 1.466667, loop: false },
  jump_male: { duration: JUMP_PROFILES.jump_male.duration, loop: false },
  jump_female: { duration: JUMP_PROFILES.jump_female.duration, loop: false },
  jump_male_air: { duration: 20 / 30, loop: false },
  jump_female_air: { duration: 20 / 30, loop: false },
  jump_male_land: { duration: 26 / 30, loop: false },
  jump_female_land: { duration: 26 / 30, loop: false },
}

export const EQUIPMENT_CLIPS: Record<EquipmentMotion, string> = {
  idle: 'A_MOD_BL_Idle_Standing_Masc',
  walk: 'A_MOD_BL_Walk_F_Masc',
  run: 'A_MOD_BL_Run_F_Masc',
  combat_idle: 'combat_idle',
  attack_light: 'attack_light',
  attack_light2: 'attack_light2',
  attack_heavy: 'attack_heavy',
  attack_light3: 'attack_light3',
  flourish_heavy: 'flourish_heavy',
  // The mob heavy attack already is Synty's HeavyStab01; the Warlord's thrust
  // reuses that clip rather than carrying a duplicate in every body part.
  stab: 'attack_heavy',
  heavy_combo_a: 'heavy_combo_a',
  heavy_combo_b: 'heavy_combo_b',
  heavy_combo_c: 'heavy_combo_c',
  leap: 'leap',
  fencing: 'fencing',
  flourish: 'flourish',
  menace: 'menace',
  menace_enter: 'menace_enter',
  roll: 'roll',
  dodge_roll: 'roll',
  stun: 'stun',
  block: 'block',
  hit: 'hit',
  death: 'death',
  jump_male: 'jump_male',
  jump_female: 'jump_female',
  jump_male_air: 'jump_male_air',
  jump_female_air: 'jump_female_air',
  jump_male_land: 'jump_male_land',
  jump_female_land: 'jump_female_land',
}
