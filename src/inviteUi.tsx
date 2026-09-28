/**
 * The invite card: somebody in the hall has asked us along. It sits top
 * centre over the hall and over the war table alike, with the realm and
 * difficulty they picked, and two answers. Left alone it fades with the
 * invite itself (src/party.ts INVITE_SECONDS).
 */
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { playerDisplayName } from './heroNameTag'
import { t } from './i18n'
import { MenuAction } from './menuUi'
import { acceptInvite, declineInvite, incomingInvites, myPhase } from './party'
import { HUB } from './partyLookup'
import { DIFFICULTIES, levelById } from './shared/levels'

const panel = Color4.create(0.05, 0.075, 0.11, 0.94)
const goldLine = Color4.create(0.78, 0.65, 0.40, 0.8)
const gold = Color4.create(1, 0.84, 0.32, 1)
const white = Color4.create(0.94, 0.96, 0.98, 1)
const muted = Color4.create(0.76, 0.80, 0.85, 1)

const WIDTH = 420
const HEIGHT = 74

/** The inviter's name, or a short form of their address while the profile is still on its way. */
function who(address: string): string {
  const name = playerDisplayName(address)
  if (name) return name
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function InviteToast({ width, top, scale: s }: { width: number; top: number; scale: number }) {
  const invite = incomingInvites()[0]
  if (!invite || myPhase() !== HUB) return null
  const where = `${t(levelById(invite.level).name)}  ·  ${t(DIFFICULTIES[invite.diff]?.name ?? '')}`
  const alpha = Math.min(1, invite.left / 0.5)
  return <UiEntity uiTransform={{ positionType: 'absolute', position: { left: (width - WIDTH * s) / 2, top },
    width: WIDTH * s, height: HEIGHT * s, padding: { left: 16 * s, right: 12 * s }, borderRadius: 6 * s, borderWidth: s, borderColor: goldLine,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: alpha, pointerFilter: 'none' }}
    uiBackground={{ color: panel }}>
    <UiEntity uiTransform={{ width: (WIDTH - 200) * s, height: '100%', flexDirection: 'column', justifyContent: 'center', pointerFilter: 'none' }}>
      <Label value={t('{name} asks you along', { name: who(invite.from) })} color={white} font="sans-serif" fontSize={14 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 22 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={where} color={gold} font="sans-serif" fontSize={12 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 18 * s, flexShrink: 0, pointerFilter: 'none' }} />
      <Label value={t('Answer within {n}s', { n: Math.ceil(invite.left) })} color={muted} font="sans-serif" fontSize={10 * s} textAlign="middle-left" textWrap="nowrap"
        uiTransform={{ width: '100%', height: 14 * s, flexShrink: 0, pointerFilter: 'none' }} />
    </UiEntity>
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', pointerFilter: 'none' }}>
      <UiEntity uiTransform={{ margin: { right: 8 * s }, pointerFilter: 'none' }}>
        <MenuAction id="invite-accept" text={t('Join')} primary width={84} height={34} scale={s} fontSize={13} onClick={() => acceptInvite(invite)} />
      </UiEntity>
      <MenuAction id="invite-decline" text={t('Not now')} accent="gold" width={84} height={34} scale={s} fontSize={13} onClick={() => declineInvite(invite)} />
    </UiEntity>
  </UiEntity>
}
