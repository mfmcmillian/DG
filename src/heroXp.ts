// Who stands at what level. One table of wallet -> champion -> experience,
// kept by the host as it awards kills and clears (src/partyServer.ts) and by
// every client from the `xp` broadcasts, so the roster can show levels and a
// blow's damage is scaled the same on both ends. The local hero's bar,
// level-up notice and run tally live here too.

import { engine } from '@dcl/sdk/ecs'
import { getEquippedCharacter, getPickerState } from './characterPicker'
import { fxSound } from './combatFx'
import { localAddress } from './multiplayer'
import { onNet } from './net'
import { inRun } from './party'
import { setStaminaBonus } from './roamingCombat'
import { heroBonuses, HeroBonuses, levelForXp, levelGains, levelProgress, parseXp, XpRecord } from './shared/progression'
import { t } from './i18n'

const table = new Map<string, XpRecord>()

export function xpOf(id: string, cid: string): number {
  return table.get(id.toLowerCase())?.[cid] ?? 0
}

export function heroLevel(id: string, cid: string): number {
  return levelForXp(xpOf(id, cid))
}

export function heroBonusesFor(id: string, cid: string): HeroBonuses {
  return heroBonuses(cid, heroLevel(id, cid))
}

export function xpRecordOf(id: string): XpRecord {
  return { ...(table.get(id.toLowerCase()) ?? {}) }
}

/** Host: what was loaded for a wallet. Client: what `savedHero` brought back. */
export function setXpRecord(id: string, record: XpRecord) {
  table.set(id.toLowerCase(), { ...record })
}

/** Host: add to one champion's total and return the new total. */
export function addXp(id: string, cid: string, amount: number): number {
  const key = id.toLowerCase()
  const record = table.get(key) ?? {}
  record[cid] = (record[cid] ?? 0) + Math.max(0, Math.round(amount))
  table.set(key, record)
  return record[cid]
}

// --- the local hero ------------------------------------------------------------

export type LocalXp = {
  xp: number
  level: number
  /** Experience into this level and the size of the step; span 0 at the cap. */
  into: number
  span: number
  /** Gained since this run started (or since the hall, between runs). */
  runGain: number
  /** Level-up notice: the level reached and seconds it has been up (0 when none). */
  levelUp: number
  levelUpFor: number
}

const local: LocalXp = { xp: 0, level: 1, into: 0, span: 100, runGain: 0, levelUp: 0, levelUpFor: 0 }
const LEVEL_UP_SECONDS = 6
let wasInRun = false
let knownLevel = 0
let initialized = false

export function localXp(): Readonly<LocalXp> {
  return local
}

function refreshLocal() {
  const me = localAddress()
  const cid = getEquippedCharacter().id
  const xp = me ? xpOf(me, cid) : 0
  const p = levelProgress(xp)
  local.xp = xp
  local.level = p.level
  local.into = p.into
  local.span = p.span
  // A new champion (or a first look at the table) sets the baseline; only a climb announces itself.
  if (knownLevel && p.level > knownLevel && getPickerState().hasCreatedCharacter) {
    local.levelUp = p.level
    local.levelUpFor = 0
    fxSound('heal', 0.9)
  }
  knownLevel = p.level
  setStaminaBonus(heroBonuses(cid, p.level).stamina)
}

export function initializeHeroXp() {
  if (initialized) return
  initialized = true
  onNet('savedHero', (msg) => {
    if (msg.id.toLowerCase() !== localAddress()) return
    setXpRecord(msg.id, parseXp(msg.xp))
    knownLevel = 0
    refreshLocal()
  })
  onNet('xp', (msg) => {
    const key = msg.id.toLowerCase()
    const record = table.get(key) ?? {}
    record[msg.cid] = msg.xp
    table.set(key, record)
    if (key === localAddress()) {
      if (msg.cid === getEquippedCharacter().id) local.runGain += msg.gained
      refreshLocal()
    }
  })
  let lastCid = ''
  engine.addSystem((dt) => {
    const running = inRun()
    if (running && !wasInRun) local.runGain = 0
    wasInRun = running
    const cid = getEquippedCharacter().id
    if (cid !== lastCid) {
      lastCid = cid
      knownLevel = 0
      refreshLocal()
    }
    if (local.levelUp) {
      local.levelUpFor += dt
      if (local.levelUpFor > LEVEL_UP_SECONDS) {
        local.levelUp = 0
        local.levelUpFor = 0
      }
    }
  })
}

/** The bonus lines a level-up shows: what this champion gains per level. */
export function bonusLinesText(cid: string): string[] {
  const g = levelGains(cid)
  return [
    t('+{pct}% damage dealt', { pct: (g.might * 100).toFixed(1) }),
    t('-{pct}% damage taken', { pct: (g.toughness * 100).toFixed(1) }),
    t('+{n} stamina', { n: g.stamina })
  ]
}
