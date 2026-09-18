/** Curated sprites from Synty INTERFACE Fantasy Menus. */

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
  titleBg: 'images/ui/kit/title-bg.png'
} as const

export function kitTexture(src: string) {
  return { textureMode: 'stretch' as const, texture: { src } }
}
