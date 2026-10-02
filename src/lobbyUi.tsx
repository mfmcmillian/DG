// The hall's lobby, behind the HUD's Play button. It asks one question first:
// create a party, or join one. Join lists every party in the hall with its
// doors open. Create is one dungeon, three difficulties, one button: Go. It
// makes a party of one whose doors close in a few seconds; anyone in the hall
// can step in before they do, and the leader can close them at once or hold
// them for friends. Medium and Hard ask for a hero level, the way Dungeon
// Quest does; a locked row says which. With a party the party card shows,
// whichever page was up. Shown over the hub (no camera change); the host's
// `parties` broadcast is what every row here reflects.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { uiViewport, wholeCanvas } from './uiScale'
import { playerDisplayName } from './heroNameTag'
import { isClientSynced, localAddress } from './multiplayer'
import { menuColors, MenuAction as Action } from './menuUi'
import {
  comingSoonPick, cycleLobbyPickLevel, doorsWait, getLobbyPick, getLobbyState, goRun, holdDoors, isLeader, joinParty, leaveParty, LOBBY_PAGES, myParty,
  openParties, PartyInfo, setLobbyPage, setLobbyPickDiff, startRun
} from './party'
import { devToolsOn } from './devAccess'
import { IconButton } from './hudButtons'
import { closeLobby, invitePending, invitePlayer } from './party'
import { presence } from './presence'
import { InviteToast } from './inviteUi'
import { DIFFICULTIES, difficultyAllowed, levelById, LEVELS, levelUnlocked, MAX_PARTY } from './shared/levels'
import { localXp } from './heroXp'
import { getPreloadGroup } from './preload'
import { isRealmPreloaded, preloadCaption, realmGroupId, requestRealmPreload } from './preloadPlan'
import { t, tn } from './i18n'

let requestedRealm = ''

/**
 * The run's door waits on its realm: the kit and the roster for the level the
 * lobby has picked. Picking a realm moves it to the front of the download
 * queue; the button holds (with counts) until it is in.
 */
function realmGate(level: number): { ready: boolean; caption: string } {
  if (comingSoonPick(level)) return { ready: false, caption: t('Coming soon') }
  const style = levelById(level).style
  if (requestedRealm !== style) {
    requestedRealm = style
    requestRealmPreload(style, true)
  }
  return { ready: isRealmPreloaded(style), caption: preloadCaption(getPreloadGroup(realmGroupId(style)), t('Preparing')) }
}

const { white, muted, gold, panel, card, line, goldLine, coral, cyan } = menuColors
const veil = Color4.create(0.01, 0.02, 0.03, 0.62)
const sheet = Color4.create(0.025, 0.045, 0.07, 0.97)
/** The create sheet and the party card, at their drawn size. */
const FRAME = { width: 1040, height: 880 }
/** The one question, and the list of parties to step into. */
const FRAME_CHOOSE = { width: 760, height: 440 }
const FRAME_JOIN = { width: 760, height: 560 }
const LEFT = 500
const RIGHT = 420
let hovered = ''

/** In virtual pixels of the UI root (uiScale.ts): the sheet fits the room the screen has, and never grows past its drawn size. */
function layout(frame = FRAME) {
  const { width: screenWidth, height: screenHeight } = uiViewport()
  const left = 24
  const right = 24
  const top = 48
  const bottom = 24
  const scale = Math.min((screenWidth - left - right) / frame.width, (screenHeight - top - bottom) / frame.height, 1)
  const width = frame.width * scale
  const height = frame.height * scale
  return { scale, width, height, screenWidth, screenHeight, x: left + (screenWidth - left - right - width) / 2, y: top + (screenHeight - top - bottom - height) / 2 }
}

export function heroLabel(address: string): string {
  const name = playerDisplayName(address)
  if (name) return name
  if (address === localAddress()) return t('You')
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address || '—'
}

/** "Your party" / "Ada's party". */
export function partyTitle(party: PartyInfo): string {
  return party.leader === localAddress() ? t('Your party') : t("{name}'s party", { name: heroLabel(party.leader) })
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function Heading({ title, scale: s }: { title: string; scale: number }) {
  return <Label value={title} color={gold} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
    uiTransform={{ width: '100%', height: 24 * s, margin: { bottom: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
}

/** Each dungeon's card picture: a diorama of its kit. */
const LEVEL_PICTURES: Record<number, string> = { 0: 'images/levels/fortress.png', 1: 'images/levels/pass.png', 2: 'images/levels/bog.png', 3: 'images/levels/crypt.png' }

/** The ladder is linear: a dungeon opens once the one before it has been cleared (developer tools skip the gate). */
export function lobbyLevelOpen(level: number): boolean {
  return devToolsOn() || levelUnlocked(getLobbyState().progress, level)
}

/** One arrow of the dungeon switcher. */
function LevelArrow({ id, glyph, scale: s, enabled, onClick }: { id: string; glyph: string; scale: number; enabled: boolean; onClick: () => void }) {
  const hover = hovered === id && enabled
  return <UiEntity uiTransform={{ width: 40 * s, height: 40 * s, borderRadius: 4 * s, borderWidth: s, borderColor: hover ? gold : line,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: enabled ? 1 : 0.35, pointerFilter: enabled ? 'block' : 'none' }}
    uiBackground={{ color: hover ? card : panel }}
    onMouseEnter={() => { hovered = id }} onMouseLeave={() => { if (hovered === id) hovered = '' }}
    onMouseDown={enabled ? () => { hovered = ''; onClick() } : undefined}>
    <Label value={glyph} color={enabled ? white : muted} fontSize={24 * s} textAlign="middle-center" textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

/** A realm with no map yet, as a card: its name and blurb, dimmed, with the packs that dress it and "Coming soon". */
function ComingSoonCard({ scale: s, canPick, page }: { scale: number; canPick: boolean; page: number }) {
  const realm = comingSoonPick(page)!
  const picture = { w: LEFT, h: Math.round(LEFT * 400 / 570) }
  const many = LOBBY_PAGES > 1 && canPick
  return <UiEntity uiTransform={{ width: LEFT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <Pager scale={s} page={page} many={many} />
    <UiEntity uiTransform={{ width: picture.w * s, height: picture.h * s, borderRadius: 6 * s, borderWidth: s, borderColor: line, flexShrink: 0,
      alignItems: 'center', justifyContent: 'center', pointerFilter: 'none' }}
      uiBackground={{ color: panel }}>
      <Label value={t('Coming soon')} font="serif" color={gold} fontSize={34 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 46 * s, pointerFilter: 'none' }} />
    </UiEntity>
    <Label value={t(realm.name)} font="serif" color={white} fontSize={34 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 44 * s, margin: { top: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <Label value={t('The map is still being built.')} color={coral} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 26 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  </UiEntity>
}

/** "DUNGEON" and the arrows with "n / total" between them, over the picture. */
function Pager({ scale: s, page, many }: { scale: number; page: number; many: boolean }) {
  return <UiEntity uiTransform={{ width: '100%', height: 40 * s, margin: { bottom: 8 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
    <Label value={t('DUNGEON')} color={gold} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: 200 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <LevelArrow id="level-prev" glyph="‹" scale={s} enabled={many} onClick={() => cycleLobbyPickLevel(-1)} />
      <Label value={`${page + 1} / ${LOBBY_PAGES}`} color={muted} fontSize={18 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: 72 * s, height: 24 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <LevelArrow id="level-next" glyph="›" scale={s} enabled={many} onClick={() => cycleLobbyPickLevel(1)} />
    </UiEntity>
  </UiEntity>
}

/** The picked dungeon, as a card: its picture and its name; a locked one says what to clear first. Arrows step along the ladder. */
function MapCard({ scale: s, canPick }: { scale: number; canPick: boolean }) {
  const page = getLobbyPick().level
  if (comingSoonPick(page)) return <ComingSoonCard scale={s} canPick={canPick} page={page} />
  const level = levelById(page)
  const open = lobbyLevelOpen(level.id)
  const before = level.id > 0 ? LEVELS[level.id - 1] : undefined
  const picture = { w: LEFT, h: Math.round(LEFT * 400 / 570) }
  const many = LOBBY_PAGES > 1 && canPick
  return <UiEntity uiTransform={{ width: LEFT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <Pager scale={s} page={level.id} many={many} />
    <UiEntity uiTransform={{ width: picture.w * s, height: picture.h * s, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexShrink: 0, pointerFilter: 'none', opacity: open ? 1 : 0.55 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: LEVEL_PICTURES[level.id] ?? LEVEL_PICTURES[0] } }} />
    <Label value={level.name} font="serif" color={white} fontSize={34 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 44 * s, margin: { top: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    {!open && before && <Label value={t('Clear {name} first', { name: before.name })} color={coral} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 26 * s, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

/** Easy, Medium, Hard as rows; a row above the hero's level is locked and says so. */
function DifficultyLadder({ scale: s, canPick }: { scale: number; canPick: boolean }) {
  const current = getLobbyPick().diff
  const heroLvl = localXp().level
  const allowed = devToolsOn() ? DIFFICULTIES.length - 1 : difficultyAllowed(heroLvl)
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
    <Heading title={t('HOW HARD')} scale={s} />
    {DIFFICULTIES.map((diff) => {
      const open = diff.id <= allowed
      const active = current === diff.id
      const key = `diff-${diff.id}`
      const hover = hovered === key && open && canPick
      return <UiEntity key={key} uiTransform={{ width: '100%', height: 64 * s, margin: { bottom: 8 * s }, padding: { left: 18 * s, right: 18 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: active ? gold : hover ? goldLine : line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        opacity: open ? 1 : 0.55, flexShrink: 0, pointerFilter: open && canPick ? 'block' : 'none' }}
        uiBackground={{ color: active ? Color4.create(0.16, 0.12, 0.06, 0.96) : hover ? card : panel }}
        onMouseEnter={() => { hovered = key }} onMouseLeave={() => { if (hovered === key) hovered = '' }}
        onMouseDown={!open || !canPick ? undefined : () => { hovered = ''; setLobbyPickDiff(diff.id) }}>
        <Label value={t(diff.name)} font="serif" color={active ? gold : white} fontSize={26 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (RIGHT - 36 - 150) * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={open ? '' : t('Level {n} needed', { n: diff.level })}
          color={coral} fontSize={15 * s} textAlign="middle-right" textWrap="nowrap"
          uiTransform={{ width: 150 * s, height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
  </UiEntity>
}

/** What a difficulty changes, and only that: Easy, which changes nothing, says nothing. */
function describeDifficulty(id: number): string {
  const d = DIFFICULTIES[id] ?? DIFFICULTIES[0]
  const parts: string[] = []
  if (d.health !== 1) parts.push(t('Health ×{n}', { n: d.health }))
  if (d.damage !== 1) parts.push(t('damage ×{n}', { n: d.damage }))
  if (d.coins !== 1) parts.push(t('coins ×{n}', { n: d.coins }))
  if (d.extra) parts.push(t('+{n} per wave', { n: d.extra }))
  return parts.join('  ·  ')
}

/** Most parties the join page lists; the hall rarely has more going at once. */
const JOIN_ROWS = 5

/** One party with its doors open: who leads, where to, how hard, the seats, the doors, and the way in. */
function OpenPartyRow({ scale: s, party: p, width }: { key?: string; scale: number; party: PartyInfo; width: number }) {
  const wait = doorsWait(p)
  const full = p.members.length >= MAX_PARTY
  const allowed = devToolsOn() ? DIFFICULTIES.length - 1 : difficultyAllowed(localXp().level)
  const tooHard = p.diff > allowed
  const diff = DIFFICULTIES[p.diff]
  const seats = Array.from({ length: MAX_PARTY }, (_, i) => i < p.members.length)
  return <UiEntity uiTransform={{ width: '100%', height: 58 * s, margin: { bottom: 8 * s }, padding: { left: 14 * s, right: 10 * s },
    borderRadius: 4 * s, borderWidth: s, borderColor: line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}
    uiBackground={{ color: panel }}>
    <UiEntity uiTransform={{ width: (width - 420) * s, height: '100%', flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
      <Label value={`${partyTitle(p)}  ·  ${LEVELS[p.level]?.name ?? ''}`} color={white} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={tooHard ? `${t(diff?.name ?? '')}  ·  ${t('Level {n} needed', { n: diff?.level ?? 1 })}` : `${t(diff?.name ?? '')}  ·  ${describeDifficulty(p.diff)}`}
        color={tooHard ? coral : muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      {seats.map((taken, i) => <UiEntity key={i} uiTransform={{ width: 10 * s, height: 10 * s, margin: { right: 4 * s }, borderRadius: 2 * s,
        borderWidth: taken ? 0 : s, borderColor: line, flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: taken ? gold : Color4.create(0, 0, 0, 0) }} />)}
      <Label value={`${p.members.length} / ${MAX_PARTY}`} color={muted} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 44 * s, height: 20 * s, margin: { left: 6 * s }, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={full ? t('Full') : wait > 0 ? t('Doors close in {n}s', { n: Math.ceil(wait) }) : t('Waiting for friends')}
        color={full ? coral : wait > 0 && wait < 5 ? gold : muted} fontSize={12 * s} textAlign="middle-right" textWrap="nowrap"
        uiTransform={{ width: 130 * s, height: 20 * s, margin: { right: 14 * s }, flexShrink: 0, pointerFilter: 'none' }} />
      <Action id={`join-${p.id}`} text={t('Join')} accent="gold" width={92} height={32} scale={s} fontSize={13}
        disabled={full || tooHard} onClick={() => joinParty(p.id)} />
    </UiEntity>
  </UiEntity>
}

/** Join: everyone in the hall about to go, and a way to lead instead. */
function JoinPage({ scale: s, width }: { scale: number; width: number }) {
  const open = openParties()
  const synced = isClientSynced()
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexGrow: 1, flexShrink: 0, pointerFilter: 'none' }}>
    <Heading title={open.length > 0 ? `${t('GOING NOW')}  ·  ${open.length}` : t('GOING NOW')} scale={s} />
    {open.slice(0, JOIN_ROWS).map((p) => <OpenPartyRow key={p.id} scale={s} party={p} width={width} />)}
    {open.length === 0 && <UiEntity uiTransform={{ width: '100%', height: 120 * s, borderRadius: 4 * s, borderWidth: s, borderColor: line,
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, pointerFilter: 'none' }} uiBackground={{ color: panel }}>
      <Label value={!synced ? t('Connecting to the hall…') : t('No one is going yet.')} font="serif" color={synced ? white : coral} fontSize={22 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 30 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={t('Lead the way and the hall will see your doors open.')} color={muted} fontSize={12 * s} textAlign="middle-center" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>}
    {open.length > JOIN_ROWS && <Label value={t('+{n} more', { n: open.length - JOIN_ROWS })} color={muted} fontSize={11 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    {open.length > 0 && <Label value={t('Rows come and go as doors open and close around the hall.')} color={muted} fontSize={11 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 16 * s, margin: { top: 2 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    <UiEntity uiTransform={{ flexGrow: 1, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', height: 44 * s, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t('Nobody you want to follow?')} color={muted} fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: 300 * s, height: '100%', pointerFilter: 'none' }} />
      <Action id="join-create-instead" text={t('Create a party instead')} onClick={() => setLobbyPage('create')} width={230} height={44} scale={s} fontSize={15} primary />
    </UiEntity>
  </UiEntity>
}

/** The one question Play asks: lead a party, or follow one. */
function ChoosePage({ scale: s, width }: { scale: number; width: number }) {
  const open = openParties().length
  const cardWidth = (width - 22) / 2
  // Two big choices, a title and one line each: the words are for reading across a room.
  const card = (id: string, title: string, line: string, action: ReactEcs.JSX.Element) =>
    <UiEntity key={id} uiTransform={{ width: cardWidth * s, height: 230 * s, padding: { left: 24 * s, right: 24 * s, top: 24 * s, bottom: 24 * s },
      borderRadius: 6 * s, borderWidth: s, borderColor: goldLine, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}
      uiBackground={{ color: panel }}>
      <Label value={title} font="serif" color={white} fontSize={36 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 46 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={line} color={muted} fontSize={19 * s} textAlign="top-left" textWrap="wrap"
        uiTransform={{ width: '100%', flexGrow: 1, margin: { top: 8 * s, bottom: 12 * s }, pointerFilter: 'none' }} />
      {action}
    </UiEntity>
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
    {card('choose-create', t('Create a party'), t('Pick a fortress and go.'),
      <Action id="choose-create-go" text={t('Create')} onClick={() => setLobbyPage('create')} width={cardWidth - 48} height={60} scale={s} fontSize={24} primary />)}
    {card('choose-join', t('Join a party'),
      open > 0 ? tn(open, 'One party has its doors open.', '{n} parties have their doors open.') : t('No parties open right now.'),
      <Action id="choose-join-go" text={open > 0 ? `${t('Join')}  ·  ${open}` : t('Join')} onClick={() => setLobbyPage('join')} width={cardWidth - 48} height={60} scale={s} fontSize={24} accent="gold" active={open > 0} />)}
  </UiEntity>
}

/** Most hall players the invite list shows before folding the rest into "+n more". */
const INVITE_ROWS = 4

/**
 * Everyone else in the hall who has a champion picked, each with a button to
 * ask them along. Without a party the first invite opens one and holds the
 * doors; with one, the list stops once the seats are taken.
 */
function InviteList({ scale: s, party }: { scale: number; party?: PartyInfo }) {
  const people = presence().filter((p) => p.inHall && !p.me && !!p.cls && !party?.members.includes(p.id))
  if (people.length === 0) return null
  const rows = people.slice(0, INVITE_ROWS)
  const seats = party ? MAX_PARTY - party.members.length : MAX_PARTY - 1
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 18 * s }, pointerFilter: 'none' }}>
    <Heading title={t('IN THE HALL')} scale={s} />
    {rows.map((p) => {
      const pending = invitePending(p.id)
      return <UiEntity key={p.id} uiTransform={{ width: '100%', height: 46 * s, margin: { bottom: 6 * s }, padding: { left: 14 * s, right: 6 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: panel }}>
        <Label value={heroLabel(p.id)} color={white} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (RIGHT - 270) * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={p.cls} color={muted} fontSize={15 * s} textAlign="middle-right" textWrap="nowrap"
          uiTransform={{ width: 130 * s, height: '100%', margin: { right: 8 * s }, pointerFilter: 'none' }} />
        <Action id={`invite-${p.id}`} text={pending ? t('Invited') : t('Invite')} accent="gold" width={100} height={34} scale={s} fontSize={15}
          disabled={pending || seats <= 0} onClick={() => invitePlayer(p.id)} />
      </UiEntity>
    })}
    {people.length > rows.length && <Label value={t('+{n} more', { n: people.length - rows.length })} color={muted} fontSize={15 * s} textAlign="middle-right" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />}
    {seats <= 0 && <Label value={t('The party is full.')} color={muted} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 22 * s, margin: { top: 4 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
  </UiEntity>
}

/**
 * Our party while its doors are open. The leader closes them (Go now), holds
 * them for friends, or cancels; a member only needs to stand there. Readiness
 * is automatic (src/party.ts syncReadiness), so nothing here asks for it.
 */
function PartyCard({ scale: s, party }: { scale: number; party: PartyInfo }) {
  const me = localAddress()
  const leader = isLeader()
  // The leader may be paging through the coming-soon realms: the run still goes to the party's level, but not from that page.
  const gate = realmGate(getLobbyPick().level)
  const wait = doorsWait(party)
  const held = party.wait <= 0
  const countdown = held ? t('Doors held') : t('Doors close in {n}s', { n: Math.ceil(wait) })
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 14 * s }, pointerFilter: 'none' }}>
    <Heading title={`${leader ? t('GOING WITH YOU') : t('GOING WITH {name}', { name: heroLabel(party.leader).toUpperCase() })}  ·  ${t(DIFFICULTIES[party.diff]?.name ?? '').toUpperCase()}`} scale={s} />
    {party.members.map((m) => {
      return <UiEntity key={m} uiTransform={{ width: '100%', height: 44 * s, margin: { bottom: 6 * s }, padding: { left: 14 * s, right: 14 * s },
        borderRadius: 4 * s, borderWidth: s, borderColor: line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}
        uiBackground={{ color: panel }}>
        <Label value={`${m === party.leader ? '♛ ' : ''}${m === me ? t('You') : heroLabel(m)}`} color={white} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: (RIGHT - 150) * s, height: '100%', pointerFilter: 'none' }} />
        <Label value={m === party.leader ? t('Leads') : ''} color={muted} fontSize={15 * s} textAlign="middle-right" textWrap="nowrap"
          uiTransform={{ width: 100 * s, height: '100%', pointerFilter: 'none' }} />
      </UiEntity>
    })}
    {Array.from({ length: MAX_PARTY - party.members.length }).map((_, i) => <UiEntity key={`slot-${i}`}
      uiTransform={{ width: '100%', height: 44 * s, margin: { bottom: 6 * s }, padding: { left: 14 * s }, borderRadius: 4 * s, borderWidth: s,
        borderColor: Color4.create(0.32, 0.39, 0.44, 0.25), flexDirection: 'row', alignItems: 'center', flexShrink: 0, pointerFilter: 'none' }}>
      <Label value={t('Open seat')} color={Color4.create(0.5, 0.55, 0.6, 0.8)} fontSize={15 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
    </UiEntity>)}
    <Label value={countdown} color={!held && wait < 5 ? gold : muted} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 26 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />
    <UiEntity uiTransform={{ width: '100%', height: 52 * s, margin: { top: 8 * s }, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {leader
        ? <Action id="party-start" text={gate.ready ? t('Go now') : gate.caption} onClick={startRun}
          width={150} height={52} scale={s} fontSize={20} primary disabled={!gate.ready} />
        : <Label value={t('{name} says when.', { name: heroLabel(party.leader) })} color={muted} fontSize={16 * s} textAlign="middle-left" textWrap="nowrap"
          uiTransform={{ width: 150 * s, height: '100%', pointerFilter: 'none' }} />}
      {leader && <Action id="party-hold" text={held ? t('Close the doors') : t('Hold the doors')} width={150} height={52} scale={s} fontSize={16} accent="gold" active={held} onClick={holdDoors} />}
      <Action id="party-leave" text={leader ? t('Cancel') : t('Stay here')} width={104} height={52} scale={s} fontSize={16} accent="gold"
        onClick={() => { leaveParty(); setLobbyPage('choose') }} />
    </UiEntity>
    {party.members.length < MAX_PARTY && !comingSoonPick(getLobbyPick().level) && <InviteList scale={s} party={party} />}
  </UiEntity>
}

/** No party yet: the one button, and whoever in the hall could come along. */
function NoParty({ scale: s }: { scale: number }) {
  const synced = isClientSynced()
  const soon = !!comingSoonPick(getLobbyPick().level)
  const gate = realmGate(getLobbyPick().level)
  const open = !soon && lobbyLevelOpen(getLobbyPick().level)
  return <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', flexShrink: 0, margin: { top: 14 * s }, pointerFilter: 'none' }}>
    <Action id="lobby-go" text={!synced ? t('Connecting…') : soon ? t('Coming soon') : !open ? t('Locked') : gate.ready ? t('Go') : gate.caption} onClick={() => goRun(getLobbyPick().level, getLobbyPick().diff)}
      width={RIGHT} height={68} scale={s} fontSize={28} primary disabled={!synced || !open || !gate.ready} />
    {!synced && <Label value={t('Connecting to the hall…')} color={coral} fontSize={16 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: 24 * s, margin: { top: 8 * s }, flexShrink: 0, pointerFilter: 'none' }} />}
    {!soon && <InviteList scale={s} />}
  </UiEntity>
}

/** The one tool on the sheet: the way out. Inventory and Settings are the hall's. */
function LobbyTools({ scale: s }: { scale: number }) {
  return <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
    <IconButton id="lobby-close" label={t('Back to the hall')} icon="images/hud/close.png" scale={s} tooltip="below" onClick={closeLobby} />
  </UiEntity>
}

/** A "‹ Back" under the title, to the page before. */
function BackLink({ scale: s, onClick }: { scale: number; onClick: () => void }) {
  const hover = hovered === 'lobby-back'
  return <UiEntity uiTransform={{ width: 120 * s, height: 26 * s, flexShrink: 0, pointerFilter: 'block' }}
    onMouseEnter={() => { hovered = 'lobby-back' }} onMouseLeave={() => { if (hovered === 'lobby-back') hovered = '' }}
    onMouseDown={() => { hovered = ''; onClick() }}>
    <Label value={`‹ ${t('Back')}`} color={hover ? white : gold} fontSize={18 * s} textAlign="middle-left" textWrap="nowrap"
      uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }} />
  </UiEntity>
}

/** The sheet every page sits on: the crest line, the title, the tools, the gold rule, and whatever the page puts under it. */
function Sheet({ frame, title, back, children }: { frame: { width: number; height: number }; title: string; back?: () => void; children?: ReactEcs.JSX.Element | ReactEcs.JSX.Element[] }) {
  const { scale: s, width, height, x, y, screenWidth, screenHeight } = layout(frame)
  const banner = getLobbyState().banner
  const headHeight = back ? 100 : 74
  return <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { left: 0, top: 0 }, pointerFilter: 'none' }}>
    <UiEntity uiTransform={wholeCanvas()} uiBackground={{ color: veil }} />
    <UiEntity uiTransform={{ width, height, positionType: 'absolute', position: { left: x, top: y },
      padding: { left: 40 * s, right: 40 * s, top: 28 * s, bottom: 28 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
      flexDirection: 'column', pointerFilter: 'none' }}
      uiBackground={{ color: sheet }}>
      <UiEntity uiTransform={{ width: '100%', height: headHeight * s, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, pointerFilter: 'none' }}>
        <UiEntity uiTransform={{ flexDirection: 'column', pointerFilter: 'none' }}>
          <Label value="DUNGEONS OF ANTROM" color={gold} fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 420 * s, height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
          <Label value={title} font="serif" color={white} fontSize={40 * s} textAlign="middle-left" textWrap="nowrap"
            uiTransform={{ width: 600 * s, height: 52 * s, flexShrink: 0, pointerFilter: 'none' }} />
          {back && <BackLink scale={s} onClick={back} />}
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
      {children}
    </UiEntity>
    <InviteToast width={screenWidth} top={Math.min(y + height + 12 * s, screenHeight - 90 * s)} scale={s} />
  </UiEntity>
}

/** The fortress and the ladder, with either the Go button or the party card beside them. */
function CreateOrParty({ party }: { party?: PartyInfo }) {
  const { scale: s } = layout(FRAME)
  const canPick = !party || isLeader()
  return <Sheet frame={FRAME} title={party ? partyTitle(party) : t('Create a party')} back={party ? undefined : () => setLobbyPage('choose')}>
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ width: LEFT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
        <MapCard scale={s} canPick={canPick} />
      </UiEntity>
      <UiEntity uiTransform={{ width: RIGHT * s, flexDirection: 'column', flexShrink: 0, pointerFilter: 'none' }}>
        <DifficultyLadder scale={s} canPick={canPick} />
        {party ? <PartyCard scale={s} party={party} /> : <NoParty scale={s} />}
      </UiEntity>
    </UiEntity>
  </Sheet>
}

export function LobbyUi() {
  const party = myParty()
  if (party) return <CreateOrParty party={party} />
  const page = getLobbyState().page
  if (page === 'create') return <CreateOrParty />
  if (page === 'join') {
    const { scale: s } = layout(FRAME_JOIN)
    return <Sheet frame={FRAME_JOIN} title={t('Join a party')} back={() => setLobbyPage('choose')}>
      <JoinPage scale={s} width={FRAME_JOIN.width - 80} />
    </Sheet>
  }
  const { scale: s } = layout(FRAME_CHOOSE)
  return <Sheet frame={FRAME_CHOOSE} title={t('Play')}>
    <ChoosePage scale={s} width={FRAME_CHOOSE.width - 80} />
  </Sheet>
}
