// What each recent version changed, in a line or two a player would care
// about, newest first. The title's Updates panel reads it. Keep it short: the
// panel shows a handful of versions and a few lines each, and a line is a
// sentence, not a commit message.

export type PatchNote = { version: string; notes: string[] }

export const PATCH_NOTES: PatchNote[] = [
  { version: '2.10.0', notes: [
    'Gravewatch, until Nov 7: a new button in the hall. Daily Rounds in the Barrow Yard outside the Crypt and dungeon clears pay embers; embers buy the season\'s three wearables in the Reliquary, minted to your wallet.',
    'The Wheel of Bones, one free spin a day, and Knucklebones against the house, ten rolls a day.',
    'The Rising, Saturdays at 9:15 PM ET: sign up a day ahead and everyone walks into the yard together to fight the Demon, who grows with the crowd. A win unlocks the week\'s wearable for the whole server.'
  ] },
  { version: '2.9.0', notes: [
    'The Crypt opens, the fourth rung of the ladder: a graveyard under the moon, the ossuary and its Bone Warden, the witches\' catacombs, the Gargoyle\'s chapel, and Morvane the Lich in his vault, who raises the dead as you cut him down.',
    'Skeletons, ghouls, bone knights, grave witches and their bone wards; Skeleton Rangers shoot from the back, so close on them first.',
    'Mist on every floor, bats over the yard, candles and braziers that burn, and the wind under the hill.'
  ] },
  { version: '2.8.51', notes: [
    'The ring beside the upgrade pit and the folk takes a tap on a phone now.'
  ] },
  { version: '2.8.50', notes: [
    'The camera has its moments: it drops in on the boss as he takes the room, and follows a legendary up out of your hands. E, a click or a tap skips either.'
  ] },
  { version: '2.8.49', notes: [
    'The title moves: the castle at dusk with its banners, wheel and fires going behind the crest.',
    'New skill pictures on the bar, drawn low-poly to match the hall.'
  ] },
  { version: '2.8.48', notes: [
    'No two weapons swing alike now: each has a temper, every armor set leans its own way, and rare or better finds carry a named affix such as Keen or Vital.',
    'The equipment sheet shows the damage your own hits will do with a piece in hand, green or red against what you wear.',
    'The champion card lists a class\'s health, stamina, hits, reach and weapons in numbers.',
    'In a run the HUD steps back: a smaller card, the clock top centre, one door out, and the how-to strip across the top.',
    'Putting on armor that adds health fills the bar by as much.'
  ] },
  { version: '2.8.42', notes: [
    'The background downloads wait a few seconds after your hero arrives, so the first steps in the hall are smoother.'
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
