// Talking to the hall's folk. Stand near one and the hall prompt offers a
// word; each has a few lines that teach one part of the game (the smith on
// armor, the guards on parties, the squire on the yard, the ranger on skills
// and levels, the witch on stamina, the herald on the Pit), with a first line
// that changes for who is asking and how often they have asked. Local only:
// the conversation is between the player and their own client.

import { engine, Transform } from '@dcl/sdk/ecs'
import { getPlayerCharacterState } from './playerCharacter'
import { attendHallFolk, FolkView, hallFolkNear } from './hallFolk'
import { heroClassOf } from './heroClasses'
import { localXp } from './heroXp'
import { getLobbyState, myParty, myPhase } from './party'
import { HUB } from './partyLookup'
import { MAX_LEVEL } from './shared/progression'
import { skillsFor } from './shared/skills'
import { MAX_PARTY, REALMS } from './shared/levels'
import { GAME_VERSION } from './version'
import { t } from './i18n'

export type TalkState = {
  /** Who is near enough to talk to, when nobody is being talked to. */
  near: FolkView | undefined
  /** The conversation open right now. */
  open: { title: string; lines: string[]; index: number } | undefined
}

/** How close a hero stands to be offered a word, and how far they walk before it ends. */
const TALK_REACH = 2.8
const WALK_AWAY = 4.5

const state: TalkState = { near: undefined, open: undefined }
/** How many times each title has been spoken to this session; the opening line changes. */
const visits = new Map<string, number>()
let talkingTo: FolkView | undefined

export function getTalkState(): Readonly<TalkState> {
  return state
}

export function openTalk() {
  const who = state.near
  if (!who || state.open) return
  const n = visits.get(who.title) ?? 0
  visits.set(who.title, n + 1)
  talkingTo = who
  state.open = { title: who.title, lines: linesFor(who.title, n), index: 0 }
  attendHallFolk(who.key)
}

export function nextLine() {
  const open = state.open
  if (!open) return
  if (open.index + 1 >= open.lines.length) closeTalk()
  else open.index++
}

export function closeTalk() {
  if (!state.open) return
  state.open = undefined
  talkingTo = undefined
  attendHallFolk(undefined)
}

function update() {
  const inHall = myPhase() === HUB && !getLobbyState().open && getPlayerCharacterState().visible
  const p = inHall ? Transform.getOrNull(engine.PlayerEntity)?.position : undefined
  if (!p) {
    state.near = undefined
    if (state.open) closeTalk()
    return
  }
  if (state.open && talkingTo) {
    const dx = talkingTo.x - p.x
    const dz = talkingTo.z - p.z
    if (dx * dx + dz * dz > WALK_AWAY * WALK_AWAY) closeTalk()
    state.near = undefined
    return
  }
  state.near = hallFolkNear(p.x, p.z, TALK_REACH)
}

export function initializeHallTalk() {
  engine.addSystem(update)
}

// --- what they say -----------------------------------------------------------------------

/** The hero as the folk see them: class, level, and where the skills stand. */
function hero() {
  const cid = getPlayerCharacterState().characterId
  const cls = heroClassOf(cid)
  const level = localXp().level
  const skills = skillsFor(cls.id)
  const next = skills.find((s) => s.level > level)
  return { cls, level, skills, next }
}

function linesFor(title: string, visit: number): string[] {
  const h = hero()
  const party = myParty()
  const cls = t(h.cls.label)
  switch (title) {
    case 'Quartermaster':
      return [
        visit === 0
          ? t('Hm. A {cls}. Your kit will want work before the deeper fortresses.', { cls })
          : t('Back again? Turn round, let me see what the fortresses left on you.'),
        t('Armor here is earned, not bought. Every set belongs to one calling, and the fortresses drop pieces for whoever is fighting in them. The rarest come up out of the Pit.'),
        t('Open your Inventory and you will see every set your calling can wear, and which pieces you are still missing. What is greyed is still down there somewhere.'),
        t('This on my back? Came off a raider who had no further use for it.')
      ]
    case 'Hall Guard':
      return [
        visit === 0 ? t('Steady. The hall is for the living; save the steel for the fortresses.') : t('You again. Still standing, I see. Good.'),
        t('The war table in the centre of the hall: whoever opens it leads. The leader picks the fortress and how hard it fights; everyone else marks Ready and follows them down.'),
        t('A party is up to {n}. Going alone is allowed, if you are that sort. Harder settings pay better, in experience and in what drops.', { n: MAX_PARTY }),
        t('When the fight is done the leader chooses: descend deeper, fight it again, or return to the hall. Anyone who has had enough can leave for the hall on their own.')
      ]
    case 'Squire':
      return [
        visit === 0 ? t('Ha! Watch this. No, wait. Watch that dummy. I will get it next time.') : t('Did you see that one? No? Watch, I will do it again.'),
        t('The yard is for finding out what your weapon does. Hit the dummies and the numbers come up over the hall: the last blow, the string, the damage a second.'),
        t('E for a light blow, F for a heavy. String the lights together and the third comes out different. Space raises your guard; Ctrl rolls you clear.'),
        t('The round targets on the east wall are for the archers and casters. I keep missing them.')
      ]
    case 'Ranger': {
      const first = h.skills[0]
      const standing = h.level >= MAX_LEVEL
        ? t('Level {level}. The summit. There is nothing left to open for you; now it is all in the using.', { level: h.level })
        : h.next
          ? t('Level {level}. Your next skill, {skill}, opens at level {n}{more}.', {
            level: h.level, skill: h.next.name, n: h.next.level, more: h.next.level - h.level === 1 ? t(': one more to go') : ''
          })
          : t('Level {level}. Every skill of the {cls} is yours; now it is all in the using.', { level: h.level, cls })
      return [
        visit === 0 ? t('Quietly. I am counting my steps.') : t('Still walking. Still counting.'),
        standing,
        t('Skills sit on keys 1 through 4. Each takes stamina and its time to come back; the bar at the foot of the screen shows both.'),
        first ? `${t('For a {cls}, key 1 is {skill}.', { cls, skill: first.name })} ${t(first.blurb)}` : t('Every calling has its own four.'),
        t('Experience comes with every kill and every cleared fortress, and it is shared across the party. Go deeper, or set it harder, and it pays more.')
      ]
    }
    case 'Hedge Witch':
      return [
        visit === 0 ? t('Careful where you stand, dear. Braziers bite.') : t('Oh, it is you. Come to be told again?'),
        t('Stamina is the thing nobody watches until it is gone. Every swing, every roll, every skill drinks from it. Stand still a moment and it comes back.'),
        t('Guard with Space and a blow costs you little. Roll with Ctrl and, timed right, it costs you nothing. Run out of breath and you will manage neither.'),
        t("Fall in a fortress and you are down a while before you are back on your feet. Hearts the enemies drop mend thirty; a Striker's Mend does the same for the whole party.")
      ]
    case 'Herald': {
      const realms = REALMS.map((r) => r.name)
      const list = realms.length > 1 ? t('{list} and {last}', { list: realms.slice(0, -1).join(', '), last: realms[realms.length - 1] }) : realms[0] ?? t('the fortresses')
      return [
        visit === 0
          ? t('Hear me! The Hall of Antrom stands, and {realms} await whoever dares them.', { realms: list })
          : party ? t('Your party gathers, {cls}. The fortresses will not wait forever.', { cls }) : t('Hear me! Again. I am paid by the hearing.'),
        t('Beneath the smithy floor lies the summoning circle. Stand on it and you descend to the Pit of Chains, where the Colossus is bound. Bring friends: four to eight, if you can find them.'),
        t('The Pit is a fight for a party, not a hero. Break the chains, mind the slams, and stay near a Striker if one walks with you.'),
        t('Version {version} of this world, should the scribes ask. They always ask.', { version: GAME_VERSION })
      ]
    }
    case 'Sellsword':
      return [
        visit === 0 ? t('Looking for a blade for hire? Not today. I am between wars.') : t('Still between wars. Ask me tomorrow.'),
        t('Weapons come up out of the fortresses too, and a weapon knows its calling: a sword for a Blade, a bow for a Scout, a staff for a Striker, an axe for a Berserker. What drops is what you can carry.'),
        t('A better weapon hits harder, staggers more, or throws them further. The inventory tells you which. Rarer is usually better. Usually.'),
        t('Killing the fortress boss hands you its reward on the spot now. Used to have to go and pick it up. Progress, of a kind.')
      ]
    default:
      return ['...']
  }
}
