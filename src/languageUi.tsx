// The language row: one flag per language, the current one framed in gold,
// the name of whichever is under the mouse beside them. Sits on the title
// (a new player's first click), under the creator's outfit sheet and in the
// settings sheet. A click switches the whole UI on the spot.

import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { getLanguage, LANGUAGES } from './i18n'
import { setLanguagePreference } from './settings'
import { menuColors } from './menuUi'

const { gold, goldLine, line, muted, white, card } = menuColors
let hovered = ''

/** Flag size at scale 1; the row is `LANGUAGES.length * (FLAG_WIDTH + FLAG_GAP) - FLAG_GAP` wide. */
export const FLAG_WIDTH = 40
export const FLAG_HEIGHT = 28
export const FLAG_GAP = 8
export const LANGUAGE_ROW_WIDTH = LANGUAGES.length * (FLAG_WIDTH + FLAG_GAP) - FLAG_GAP

export function LanguageRow({ scale: s, caption = 'beside', align = 'flex-start' }: {
  scale: number
  /** Where the hovered (else current) language's name goes: beside the flags, under them, or nowhere. */
  caption?: 'beside' | 'below' | 'none'
  align?: 'flex-start' | 'center'
}) {
  const current = getLanguage()
  const shown = LANGUAGES.find((l) => l.id === hovered) ?? LANGUAGES.find((l) => l.id === current)
  const name = <Label value={shown?.name ?? ''} color={hovered && hovered !== current ? white : muted} fontSize={12 * s}
    textAlign={caption === 'below' ? (align === 'center' ? 'middle-center' : 'middle-left') : 'middle-left'} textWrap="nowrap"
    uiTransform={{ width: caption === 'below' ? '100%' : 110 * s, height: caption === 'below' ? 18 * s : FLAG_HEIGHT * s,
      margin: caption === 'below' ? { top: 4 * s } : { left: 12 * s }, flexShrink: 0, pointerFilter: 'none' }} />
  return <UiEntity uiTransform={{ flexDirection: caption === 'below' ? 'column' : 'row', alignItems: caption === 'below' ? align : 'center', flexShrink: 0, pointerFilter: 'none' }}>
    <UiEntity uiTransform={{ width: LANGUAGE_ROW_WIDTH * s, height: FLAG_HEIGHT * s, flexDirection: 'row', justifyContent: 'space-between', flexShrink: 0, pointerFilter: 'none' }}>
      {LANGUAGES.map((l) => {
        const active = l.id === current
        const hover = hovered === l.id
        return <UiEntity key={`lang-${l.id}`} uiTransform={{ width: FLAG_WIDTH * s, height: FLAG_HEIGHT * s, flexShrink: 0, padding: 2 * s,
          borderRadius: 3 * s, borderWidth: (active ? 2 : 1) * s, borderColor: active ? gold : hover ? goldLine : line,
          opacity: active || hover ? 1 : 0.66, pointerFilter: 'block' }}
          uiBackground={{ color: card }}
          onMouseEnter={() => { hovered = l.id }} onMouseLeave={() => { if (hovered === l.id) hovered = '' }}
          onMouseDown={() => setLanguagePreference(l.id)}>
          <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}
            uiBackground={{ textureMode: 'stretch', texture: { src: l.flag }, color: Color4.create(1, 1, 1, 1) }} />
        </UiEntity>
      })}
    </UiEntity>
    {caption !== 'none' && name}
  </UiEntity>
}
