// The raid's HUD: the Colossus's bar and phase at the top, its announcements
// under it, the summoning circle's prompt at the gate (in the hall and in the
// Pit), and the downed lines: a fallen hero's own wait and the allies who can
// raise them, with the raise's progress as an ally stands by.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getWorldRivalState } from '../dungeonEnemies'
import { heroLabel } from '../lobbyUi'
import { localAddress } from '../multiplayer'
import { atPitGate, getLobbyState, inRaid, joinRaid, leaveParty, myParty, myPhase } from '../party'
import { HUB } from '../partyLookup'
import { MAX_RAID, RAID_LEVEL } from '../shared/levels'
import { getPreloadGroup } from '../preload'
import { isRealmPreloaded, preloadCaption, realmGroupId, requestRealmPreload } from '../preloadPlan'
import { raidView } from './colossusClient'

const white = Color4.create(0.94, 0.96, 0.98, 1)
const muted = Color4.create(0.76, 0.80, 0.85, 1)
const panel = Color4.create(0.04, 0.065, 0.10, 0.82)
const hoverPanel = Color4.create(0.13, 0.17, 0.22, 0.96)
const line = Color4.create(0.52, 0.58, 0.66, 0.6)
const track = Color4.create(0.035, 0.045, 0.065, 0.86)
const gold = Color4.create(1, 0.84, 0.32, 1)
const ember = Color4.create(1, 0.5, 0.18, 1)
const stone = Color4.create(0.62, 0.6, 0.58, 1)
const PHASE_COLOR = [Color4.create(0.75, 0.12, 0.2, 1), Color4.create(0.85, 0.3, 0.12, 1), Color4.create(1, 0.55, 0.1, 1)]
let hovered = ''
let pitRequested = false
/** When the hero stepped onto the hall's circle with the Pit ready; 0 off it. Standing this long takes them down. */
let descentStarted = 0
const DESCEND_SECONDS = 2.5

function Action({ id, text, onClick, scale: s, width = 200 }: { key?: string; id: string; text: string; onClick: () => void; scale: number; width?: number }) {
  return <UiEntity uiTransform={{ width: width * s, height: 36 * s, flexShrink: 0,
    justifyContent: 'center', alignItems: 'center', borderRadius: 6 * s, borderWidth: s, borderColor: line, pointerFilter: 'block' }}
    uiBackground={{ color: hovered === id ? hoverPanel : panel }}
    onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
    onMouseDown={() => { hovered = ''; onClick() }}>
    <Label value={text} color={white} font="sans-serif" fontSize={13 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

function Bar({ ratio, color, scale: s, height = 10 }: { ratio: number; color: Color4; scale: number; height?: number }) {
  return <UiEntity uiTransform={{ width: '100%', height: height * s, padding: s, borderRadius: 3 * s, borderWidth: s, borderColor: line, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: track }}>
    <UiEntity uiTransform={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: '100%', pointerFilter: 'none' }} uiBackground={{ color }} />
  </UiEntity>
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

const ROMAN = ['I', 'II', 'III']

/** Top centre: the Colossus, its health and phase, and what it is doing. */
export function ColossusBar({ width, scale: s }: { width: number; scale: number }) {
  const v = raidView()
  if (!v.active) return null
  const barWidth = Math.min(520 * s, width * 0.55)
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const top = Math.max(0, canvas?.screenInsetArea?.top || 0) + 26 * s
  let title = 'THE CHAINED COLOSSUS'
  let sub = ''
  let ratio = v.hp / Math.max(1, v.max)
  let color = PHASE_COLOR[Math.max(0, Math.min(2, v.phase - 1))]
  switch (v.state) {
    case 'dormant':
      sub = 'It sleeps in its chains. Step onto the circle to wake it.'
      ratio = 1
      color = stone
      break
    case 'waking':
      sub = 'The chains groan…'
      break
    case 'fighting':
      sub = `Phase ${ROMAN[v.phase - 1] ?? v.phase}   ·   ${v.n} in the Pit`
      break
    case 'stagger':
      sub = 'STAGGERED  ·  its fists are down'
      color = gold
      break
    case 'dying':
      sub = 'The stone breaks…'
      break
    case 'dead':
      title = 'THE COLOSSUS LIES BROKEN'
      sub = `The chains draw it up again in ${mmss(v.wait)}`
      ratio = 0
      break
  }
  const latest = v.events.length ? v.events[v.events.length - 1] : undefined
  const evAlpha = latest ? Math.min(1, latest.age / 0.3, Math.max(0, (7 - latest.age) / 1.5)) : 0
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - barWidth) / 2, top },
    width: barWidth, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    <Label value={title} color={white} font="serif" fontSize={16 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <Bar ratio={ratio} color={color} scale={s} height={12} />
    <Label value={sub} color={v.state === 'stagger' ? gold : muted} font="sans-serif" fontSize={11 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
    {latest && evAlpha > 0 && latest.kind !== 'revive' && <Label value={latest.kind === 'kill' ? `${latest.text}   +${latest.n} XP` : latest.text}
      color={Color4.create(ember.r, ember.g, ember.b, evAlpha)} font="serif" fontSize={(latest.kind === 'fall' || latest.kind === 'wipe' ? 22 : 15) * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 30 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

/**
 * Bottom centre. In the hall, on the circle: the way down. In the Pit: the
 * way out at the gate, our own wait when down, and the allies we can raise.
 */
export function RaidPrompt({ width, bottom, scale: s }: { width: number; bottom: number; scale: number }) {
  if (getLobbyState().open) return null
  const inHall = myPhase() === HUB
  const raid = inRaid()
  if (!inHall && !raid) return null
  const near = atPitGate()
  const v = raidView()
  const me = localAddress()
  const rival = getWorldRivalState()
  const down = rival.visible && rival.phase === 'defeat'
  const myDown = v.down.find((d) => d.id === me)
  const others = v.down.filter((d) => d.id !== me)
  const rows: ReactEcs.JSX.Element[] = []
  const w = 380 * s

  if (inHall) {
    if (!near || myParty()) {
      descentStarted = 0
      return null
    }
    const inside = getLobbyState().parties.find((p) => p.id === 'raid')?.members.length ?? 0
    if (!pitRequested) {
      pitRequested = true
      requestRealmPreload(RAID_LEVEL.style, true)
    }
    // Standing on the circle is the whole ritual: the Pit's stone and the
    // Colossus load first (the bar is that), then a short descent, then down.
    const group = getPreloadGroup(realmGroupId(RAID_LEVEL.style))
    const ready = isRealmPreloaded(RAID_LEVEL.style)
    const full = inside >= MAX_RAID
    const now = Date.now()
    if (!ready || full) descentStarted = 0
    else if (!descentStarted) descentStarted = now
    const descent = descentStarted ? Math.min(1, (now - descentStarted) / 1000 / DESCEND_SECONDS) : 0
    if (descent >= 1) {
      descentStarted = 0
      joinRaid()
    }
    rows.push(<Label key="cap" value={`${RAID_LEVEL.name}  ·  ${RAID_LEVEL.blurb}  ·  ${inside}/${MAX_RAID} inside`} color={ember} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { bottom: 6 * s }, pointerFilter: 'none' }} />)
    if (full) {
      rows.push(<Label key="full" value="The Pit is full. Wait for a hero to come up." color={muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 24 * s, pointerFilter: 'none' }} />)
    } else {
      const ratio = ready ? 0.25 + 0.75 * descent : 0.25 * (group?.progress ?? 0)
      rows.push(<Label key="wait" value={ready ? 'Descending into the Pit…  step off the circle to stay' : preloadCaption(group, 'Preparing')}
        color={ready ? gold : muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, pointerFilter: 'none' }} />)
      rows.push(<UiEntity key="bar" uiTransform={{ width: 260 * s, margin: { top: 2 * s }, pointerFilter: 'none' }}><Bar ratio={ratio} color={ready ? gold : ember} scale={s} height={8} /></UiEntity>)
    }
  } else {
    const wiped = v.events.some((ev) => ev.kind === 'wipe')
    if (down && wiped) {
      rows.push(<Label key="me" value="The party has fallen. The Pit puts you out in the hall…" color={ember} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, pointerFilter: 'none' }} />)
    } else if (down) {
      const k = myDown?.k ?? 0
      rows.push(<Label key="me" value={k > 0 ? 'An ally is raising you…' : `You are down. An ally standing by you can raise you.  ·  ${Math.ceil(rival.respawnSeconds)}s`}
        color={k > 0 ? gold : white} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, pointerFilter: 'none' }} />)
      if (k > 0) rows.push(<UiEntity key="mebar" uiTransform={{ width: 240 * s, margin: { bottom: 6 * s }, pointerFilter: 'none' }}><Bar ratio={k} color={gold} scale={s} height={8} /></UiEntity>)
    }
    for (const d of others) {
      rows.push(<Label key={`d-${d.id}`} value={d.k > 0 ? `Raising ${heroLabel(d.id)}…` : `${heroLabel(d.id)} is down — stand by them to raise`}
        color={d.k > 0 ? gold : muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 20 * s, pointerFilter: 'none' }} />)
      if (d.k > 0) rows.push(<UiEntity key={`b-${d.id}`} uiTransform={{ width: 240 * s, margin: { bottom: 4 * s }, pointerFilter: 'none' }}><Bar ratio={d.k} color={gold} scale={s} height={6} /></UiEntity>)
    }
    if (near && !down) {
      rows.push(<Label key="gate" value="The circle: back up to the hall." color={muted} font="sans-serif" fontSize={12 * s} textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, margin: { top: rows.length ? 6 * s : 0 }, pointerFilter: 'none' }} />)
      rows.push(<Action key="leave" id="leave-pit" text="Leave the Pit" onClick={leaveParty} scale={s} width={200} />)
    }
  }
  if (!rows.length) return null
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - w) / 2, bottom },
    width: w, flexDirection: 'column', alignItems: 'center', pointerFilter: 'none' }}>
    {rows}
  </UiEntity>
}
