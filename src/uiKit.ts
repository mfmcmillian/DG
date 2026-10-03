/** Curated sprites from Synty INTERFACE Fantasy Menus. */

import { GW_EVENT_END } from './shared/gravewatch'

export const UI_KIT = {
  panelTitle: 'images/ui/kit/panel-title.png',
  panelLarge: 'images/ui/kit/panel-large.png',
  panelMedium: 'images/ui/kit/panel-medium.png',
  btnFrame: 'images/ui/kit/btn-frame.png',
  btnFill: 'images/ui/kit/btn-fill.png',
  btnGoldFrame: 'images/ui/kit/btn-gold-frame.png',
  btnGoldFill: 'images/ui/kit/btn-gold-fill.png',
  flourish: 'images/ui/kit/flourish.png',
  bar: 'images/ui/kit/bar.png',
  crest: 'images/ui/kit/crest.png',
  titleBg: 'images/ui/kit/title-bg.jpg',
  /** The Gravewatch title's first frame: the village under the harvest moon, its windows lit green. */
  titleBgGravewatch: 'images/ui/kit/title-bg-gravewatch.jpg',
  /** The game's crest, drawn for the title: the shield, the crossed swords and the name. */
  titleEmblem: 'images/ui/kit/title-emblem.png'
} as const

export function kitTexture(src: string) {
  return { textureMode: 'stretch' as const, texture: { src } }
}

/** The title's still: the Gravewatch village while the event runs, the castle at dusk after. Each is the first frame of its clip (titleVideo.ts). */
export function titleBackdrop(): string {
  return Date.now() < GW_EVENT_END ? UI_KIT.titleBgGravewatch : UI_KIT.titleBg
}

/**
 * The 768x192 button sprites, nine-sliced: the arrow ends (about a fifth of
 * the width each) and the bars' thickness stay as drawn, only the middle
 * stretches, so a button reads the same at 240 or 440 wide.
 */
export function kitSliced(src: string) {
  return {
    textureMode: 'nine-slices' as const,
    texture: { src },
    textureSlices: { top: 0.16, bottom: 0.16, left: 0.2, right: 0.22 }
  }
}
