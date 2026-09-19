// The hall's lobby: pick a fortress and a difficulty, make a party or join one,
// and start. Shown over the hub (no camera change); the host's `parties`
// broadcast is what every row here reflects.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { playerDisplayName } from './heroNameTag'
import { isClientSynced, localAddress } from './multiplayer'
import { menuColors, MenuAction as Action } from './menuUi'
import {
  createParty, getLobbyPick, getLobbyState, isLeader, joinParty, leaveParty, myParty, openParties, PartyInfo,
  setLobbyPickDiff, setLobbyPickLevel, setReady, soloRun, startRun
} from './party'
import { getSettings, openSettings } from './settings'
import { openInventory } from './inventory'
import { IconButton } from './hudButtons'
import { closeLobby, openLobby } from './party'
import {
  DIFFICULTIES, LEVELS, levelUnlocked, MAX_PARTY, previousLevel
} from './shared/levels'

const { white, muted, gold, panel, card, line, goldLine, coral, cyan } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
const FRAME = { width: 1040, height: 820 }
const LEFT = 500
const RIGHT = 420
let hovered = ''

function layout() {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const screenWidth = canvas?.width || 1600
  const screenHeight = canvas?.height || 900
  const inset = canvas?.screenInsetArea
  const left = Math.max(0, inset?.left || 0) + 24
  const right = Math.max(0, inset?.right || 0) + 24
  const top = Math.max(0, inset?.top || 0) + 48
  const bottom = Math.max(0, inset?.bottom || 0) + 24
  const scale = Math.min((screenWidth - left - right) / FRAME.width, (screenHeight - top - bottom) / FRAME.height, 1.1)
  const width = FRAME.width * scale
  const height = FRAME.height * scale
  return { scale, width, height, x: left + (screenWidth - left - right - width) / 2, y: top + (screenHeight - top - bottom - height) / 2 }
}

export function heroLabel(address: string): string {
  const name = playerDisplayName(address)
  if (name) return name
  if (address === localAddress()) return 'You'
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || '—'
}

/** "Your party" / "Ada's party". */
export function partyTitle(party: PartyInfo): string {
  return party.leader === localAddress() ? 'Your party' : `${heroLabel(party.leader)}'s party`
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function Heading({ title, scale: s }: { title: string; scale: number }) {
  return <Label value={title} color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 20 * s, margin: { bottom: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
}

/** Is this level open to the player: cleared up to it, or the developer panel. */
function isOpen(progress: readonly number[], level: number): boolean {
  return getSettings().devTools || levelUnlocked(progress, level)
}

/** The one linear ladder. Locked-via-dev rows show a gold Dev mark. */
function LevelList({ scale: s, canPick }: { scale: number; canPick: boolean }) {
  const progress = getLobbyState().progress
  const current = getLobbyPick().level
  return <UiEntity uiTransform={{ width: LEFT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <Heading title="DUNGEON" scale={s} />
    {LEVELS.map((level, step) => {
      const byProgress = levelUnlocked(progress, level.id)
      const unlocked = isOpen(progress, level.id)
      const best = progress[level.id] ?? 0
      const active = current === level.id
      const key = `level-${level.id}`
      const hover = hovered === key && unlocked && canPick
      const status = !unlocked ? 'Locked' : !byProgress ? 'Dev' : best > 0 ? `Cleared on ${DIFFICULTIES[best - 1]?.name ?? ''}` : ''
      const blurb = unlocked ? level.blurb : `Clear ${previousLevel(level.id)?.name ?? 'the dungeon before'} to open the way.`
      const inner = LEFT - 32 - 40 - 12
      return <UiEntity key={key} uiTransform={{ width: '100%', height: 68 * s, margin: { bottom: 6 * s }, padding: { left: 16 * s, right: 16 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: active ? gold : hover ? goldLine : line, flexDirection: 'row', alignItems: 'center',
        opacity: unlocked ? 1 : 0.55, flexShrink: 0, pointerFilter: unlocked && canPick ? 'block' : 'none' }}
        uiBackground={{ color: active ? Color4.create(0.16, 0.12, 0.06, 0.96) : hover ? card : panel }}
        onMouseEnter={() => { hovered = key }} onMouseLeave={() => { if (hovered === key) hovered = '' }}
        onMouseDown={!unlocked || !canPick ? undefined : () => { hovered = ''; setLobbyPickLevel(level.id) }}>
        <Label value={`${step + 1}`} font="serif" color={active ? gold : muted} fontSize={26 * s} textAlign="middle-center" textWrap="nowrap"
          uiTransform={{ width: 40 * s, height: '100%', flexShrink: 0, pointerFilter: 'none' }} />
        <UiEntity uiTransform={{ width: inner * s, height: '100%', flexDirection: 'column', justifyContent: 'center', margin: { left: 12 * s }, pointerFilter: 'none' }}>
          <UiEntity uiTransform={{ width: '100%', height: 22 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
            <Label value={level.name} font="serif" color={white} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
              uiTransform={{ width: (inner - 150) * s, height: '100%', pointerFilter: 'none' }} />
            <Label value={status} color={!unlocked ? coral : !byProgress ? gold : cyan} fontSize={11 * s} textAlign="middle-right" textWrap="nowrap"
              uiTransform={{ width: 150 * s, height: '100%', pointerFilter: 'none' }} />
          </UiEntity>
          <Label value={blurb} color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
      </UiEntity>
    })}
  </UiEntity>
}

function DifficultyRow({ scale: s, canPick }: { scale: number; canPick: boolean }) {
  const current = getLobbyPick().diff
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <Heading title="DIFFICULTY" scale={s} />
    <UiEntity uiTransform={{ width: '100%', height: 38 * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {DIFFICULTIES.map((diff) => <Action key={`diff-${diff.id}`} id={`diff-${diff.id}`} text={diff.name} accent="gold" width={(RIGHT - 20) / 3} height={38} scale={s}
        active={current === diff.id} disabled={!canPick} fontSize={14}
        onClick={() => setLobbyPickDiff(diff.id)} />)}
    </UiEntity>
    <Label value={describeDifficulty(current)} color={muted} fontSize={11.5 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 20 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

function describeDifficulty(id: number): string {
  const d = DIFFICULTIES[id] ?? DIFFICULTIES[0]
  const parts = [`Enemy health ×${d.health}`, `damage ×${d.damage}`, `coins ×${d.coins}`]
  if (d.extra) parts.push(`+${d.extra} enemy per room`)
  return parts.join('  ·  ')
}

function OpenParties({ scale: s }: { scale: number }) {
  const open = openParties()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 18 * s }, pointerFilter: 'none' }}>
    <Heading title="OPEN PARTIES" scale={s} />
    {open.length === 0 && <Label value="Nobody else is forming a party right now." color={muted} fontSize={11.5 * s}
      textAlign="middle-left" textWrap="nowrap" uiTransform={{ width: '100%', height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    {open.slice(0, 3).map((p) => <UiEntity key={p.id} uiTransform={{ width: '100%', height: 44 * s, margin: { bottom: 6 * s }, padding: { left: 12 * s, right: 8 * s },
      borderRadius: 4 * s, borderWidth: s, borderColor: line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: panel }}>
      <UiEntity uiTransform={{ width: (RIGHT - 130) * s, height: '100%', flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
        <Label value={`${partyTitle(p)} · ${p.members.length}/${MAX_PARTY}`} color={white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 20 * s, flexShrink: 0, pointerFilter: 'none' }} />
        <Label value={`${LEVELS[p.level]?.name ?? ''} · ${DIFFICULTIES[p.diff]?.name ?? ''}`} color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />
      </UiEntity>
      <Action id={`join-${p.id}`} text="Join" accent="gold" width={84} height={30} scale={s} fontSize={13}
        disabled={p.members.length >= MAX_PARTY} onClick={() => joinParty(p.id)} />
    </UiEntity>)}
  </UiEntity>
}

function PartyCard({ scale: s, party }: { scale: number; party: PartyInfo }) {
  const me = localAddress()
  const leader = isLeader()
  const allReady = party.members.every((m) => party.ready.includes(m))
  const meReady = party.ready.includes(me)
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 18 * s }, pointerFilter: 'none' }}>
    <Heading title={partyTitle(party).toUpperCase()} scale={s} />
    {party.members.map((m) => {
      const ready = party.ready.includes(m)
      return <UiEntity key={m} uiTransform={{ width: '100%', height: 36 * s, margin: { bottom: 4 * s }, padding: { left: 12 * s, right: 12 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: panel }}>
        <Label value={`${m === party.leader ? '♛ ' : ''}${m === me ? 'You' : heroLabel(m)}`} color={white} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (RIGHT - 150) * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={ready ? 'Ready' : 'Not ready'} color={ready ? cyan : muted} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
          uiTransform={{ width: 100 * s, height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
    {Array.from({ length: MAX_PARTY - party.members.length }).map((_, i) => <UiEntity key={`slot-${i}`}
      uiTransform={{ width: '100%', height: 36 * s, margin: { bottom: 4 * s }, padding: { left: 12 * s }, borderRadius: 4 * s, borderWidth: s,
        borderColor: Color4.create(0.32, 0.39, 0.44, 0.25), flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value="Open seat" color={Color4.create(0.5, 0.55, 0.6, 0.8)} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>)}
    <UiEntity uiTransform={{ width: '100%', height: 44 * s, margin: { top: 12 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {leader
        ? <Action id="party-start" text={allReady ? 'Start run' : 'Waiting for the party…'} onClick={startRun}
          width={RIGHT - 150} height={44} scale={s} fontSize={15} primary disabled={!allReady} />
        : <Action id="party-ready" text={meReady ? 'Not ready' : 'Ready'} onClick={() => setReady(!meReady)}
          width={RIGHT - 150} height={44} scale={s} fontSize={15} primary={!meReady} accent="gold" active={meReady} />}
      <Action id="party-leave" text="Leave party" width={136} height={44} scale={s} fontSize={13} accent="gold" onClick={leaveParty} />
    </UiEntity>
    {!leader && <Label value="The leader picks the dungeon and starts the run." color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

function NoParty({ scale: s }: { scale: number }) {
  const synced = isClientSynced()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 18 * s }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Action id="lobby-create" text="Make a party" onClick={() => createParty(getLobbyPick().level, getLobbyPick().diff)}
        width={(RIGHT - 10) / 2} height={44} scale={s} fontSize={15} primary disabled={!synced} />
      <Action id="lobby-solo" text="Go alone" onClick={() => soloRun(getLobbyPick().level, getLobbyPick().diff)}
        width={(RIGHT - 10) / 2} height={44} scale={s} fontSize={15} accent="gold" disabled={!synced} />
    </UiEntity>
    <Label value={synced ? 'A party holds up to four. Others in the hall can join before you start.' : 'Connecting to the hall…'}
      color={synced ? muted : coral} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 18 * s, margin: { top: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <OpenParties scale={s} />
  </UiEntity>
}

/**
 * Inventory and Settings from the lobby: the panel steps aside for them and
 * comes back the moment they close, so gearing up never means leaving the hall.
 */
function LobbyTools({ scale: s }: { scale: number }) {
  const swapTo = (open: (options: { onClose: () => void }) => boolean) => {
    closeLobby()
    if (!open({ onClose: openLobby })) openLobby()
  }
  return <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ margin: { right: 10 * s }, pointerFilter: 'none' }}>
      <IconButton id="lobby-inventory" label="Inventory" icon="images/hud/inventory.png" scale={s} tooltip="below"
        onClick={() => swapTo(openInventory)} />
    </UiEntity>
    <IconButton id="lobby-settings" label="Settings" icon="images/hud/settings.png" scale={s} tooltip="below"
      onClick={() => swapTo(openSettings)} />
  </UiEntity>
}

export function LobbyUi() {
  const { scale: s, width, height, x, y } = layout()
  const party = myParty()
  const canPick = !party || isLeader()
  const banner = getLobbyState().banner
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}
    uiBackground={{ color: veil }}>
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheet }}>
      <UiEntity uiTransform={{ width: '100%', height: 62 * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', pointerFilter: 'none' }}>
          <Label value="KINGDOM OF ANTROM" color={gold} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 420 * s, height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value="Choose a dungeon" font="serif" color={white} fontSize={32 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 600 * s, height: 42 * s, flexShrink: 0, pointerFilter: 'none' }} />
        </UiEntity>
        <LobbyTools scale={s} />
      </UiEntity>
      <UiEntity uiTransform={{ width: 200 * s, height: 2 * s, margin: { bottom: banner ? 8 * s : 16 * s }, flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: gold }} />
      {banner && <UiEntity uiTransform={{ width: '100%', height: 30 * s, margin: { bottom: 12 * s }, padding: { left: 14 * s, right: 14 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: goldLine, alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: Color4.create(0.16, 0.12, 0.06, 0.96) }}>
        <Label value={banner} color={gold} fontSize={13 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
      </UiEntity>}
      <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ width: LEFT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
          <LevelList scale={s} canPick={canPick} />
        </UiEntity>
        <UiEntity uiTransform={{ width: RIGHT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
          <DifficultyRow scale={s} canPick={canPick} />
          {party ? <PartyCard scale={s} party={party} /> : <NoParty scale={s} />}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  </UiEntity>
}
