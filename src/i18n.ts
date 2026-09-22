// The game's languages. English is the source of truth and lives in the code:
// every line the player reads goes through `t('English text', { params })`,
// and the other languages are tables keyed by that English text
// (src/locales/<lang>.json). A line with no entry falls back to English, so a
// new string never breaks a language, it just shows up untranslated until the
// table catches up. `scripts/i18n-extract.mjs` lists every key in the code and
// what each table is missing.
//
// Proper nouns stay English everywhere: realm and fortress names, skill names,
// armor set names, weapon names and the champions' names. The catalog's item
// descriptions are not translated yet either.

import es from './locales/es.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import pt from './locales/pt.json'
import ja from './locales/ja.json'

export type Language = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ja'

export const LANGUAGES: ReadonlyArray<{ id: Language; name: string; flag: string }> = [
  { id: 'en', name: 'English', flag: 'images/ui/flags/english.png' },
  { id: 'es', name: 'Español', flag: 'images/ui/flags/spanish.png' },
  { id: 'fr', name: 'Français', flag: 'images/ui/flags/french.png' },
  { id: 'de', name: 'Deutsch', flag: 'images/ui/flags/german.png' },
  { id: 'pt', name: 'Português', flag: 'images/ui/flags/portuguese.png' },
  { id: 'ja', name: '日本語', flag: 'images/ui/flags/japanese.png' }
]

type Table = Record<string, string>
const TABLES: Record<Language, Table> = { en: {}, es, fr, de, pt, ja }

let current: Language = 'en'

export function getLanguage(): Language {
  return current
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && value in TABLES
}

/** Switch the whole UI: every panel reads through `t` on each frame, so nothing else needs telling. */
export function setLanguage(language: Language) {
  current = language
}

export type TextParams = Record<string, string | number>

/**
 * The line in the current language, with `{name}` slots filled from `params`.
 * Missing translations (and English) return the text as written.
 */
export function t(text: string, params?: TextParams): string {
  const line = (current !== 'en' && TABLES[current][text]) || text
  if (!params) return line
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => name in params ? String(params[name]) : whole)
}

/** One of two lines by count: `t1` for exactly one, `tn` (with `{n}`) otherwise. */
export function tn(n: number, one: string, many: string, params: TextParams = {}): string {
  return t(n === 1 ? one : many, { n, ...params })
}
