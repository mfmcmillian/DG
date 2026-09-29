// What each recent version changed, in a line or two a player would care
// about, newest first. The title's Updates panel reads it. Keep it short: the
// panel shows a handful of versions and a few lines each, and a line is a
// sentence, not a commit message.

export type PatchNote = { version: string; notes: string[] }

export const PATCH_NOTES: PatchNote[] = [
  { version: '2.8.40', notes: [
    'Continue takes in the first fortress behind the title, so the hall no longer stutters for the first few steps.'
  ] },
  { version: '2.8.39', notes: [
    'Smoother frames: the bag is no longer read end to end every frame.'
  ] },
  { version: '2.8.36', notes: [
    'Your party\'s health shows under your own bars in a run; a downed ally reads DOWN.'
  ] },
  { version: '2.8.35', notes: [
    'Every weapon can now fall at any rarity, common to legendary; only the Pride weapons are fixed.',
    'Each find is its own piece: a second copy sits beside the first instead of replacing it, up to 60 weapons and 120 armor.',
    'Each hero in a party rolls their own drops; nobody shares a find.',
    'The Quartermaster buys the extras in your bag for coin.'
  ] },
  { version: '2.8.30', notes: [
    'The screens now fit every display the same way, phones included.',
    'The title and the sheets reach the edges of a phone screen again.'
  ] },
  { version: '2.8.29', notes: [
    'A new front door: the crest, one Play, and this panel.'
  ] },
  { version: '2.8.28', notes: [
    'The rarity tally on the equipment sheet reads from across the room.'
  ] },
  { version: '2.8.27', notes: [
    'Heroes now climb to level 60.',
    'The equipment sheet frames each piece in its rarity colour and tallies the outfit by rarity.'
  ] },
  { version: '2.8.26', notes: [
    'The upgrade pit marks the gear you have on and offers it first.'
  ] },
  { version: '2.8.25', notes: [
    'Legendary gear glows: golden motes around the hero, embers on a legendary weapon.'
  ] },
  { version: '2.8.24', notes: [
    'Berserker swings play with the whole body when fighting as your avatar.',
    'Weapons sit better in the avatar\'s hand.'
  ] },
  { version: '2.8.23', notes: [
    'Other players\' heroes stand on the ground on mobile.'
  ] },
  { version: '2.8.22', notes: [
    'The dungeon camera glides smoothly on mobile.'
  ] }
]
