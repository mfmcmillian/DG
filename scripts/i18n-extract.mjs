// Every line the game can ask `t()` for, and what each language table lacks.
//
//   node scripts/i18n-extract.mjs            report coverage per language
//   node scripts/i18n-extract.mjs --write    also write scripts/i18n/keys.json (sorted) and
//                                            add missing keys to each table with "" values
//
// Two sources: literal `t('...')` / `tn(n, '...', '...')` calls in src/, and the
// data tables whose English is passed through `t()` at render time (difficulty
// names, level and realm blurbs, class roles and labels, skill blurbs, weapon
// class and rarity labels, equipment slot labels, camera options, appearance
// names, the hall folk's titles, enemy names, boss phases, the raid's
// announcements and the wardrobe's item descriptions).
// Proper nouns (realm, fortress, skill, set, weapon and champion names) are
// not keys: they read the same in every language.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')
const LANGS = ['es', 'fr', 'de', 'pt', 'ja']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** A JS string literal (single or double quoted) with escapes resolved. */
const STR = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`
const unescape = (s) => s.replace(/\\(.)/g, '$1')

const keys = new Set()
const where = new Map()
function add(key, file) {
  if (!key) return
  keys.add(key)
  if (!where.has(key)) where.set(key, file)
}

for (const file of walk(src)) {
  if (file.endsWith('i18n.ts')) continue
  const text = readFileSync(file, 'utf8')
  const rel = file.slice(root.length + 1)
  // `const X_NAMES = { id: 'Label', ... }` lookup tables read through t()
  for (const table of text.matchAll(/_NAMES = \{([^}]*)\}/g)) for (const m of table[1].matchAll(new RegExp(STR, 'g'))) add(unescape(m[1] ?? m[2]), rel)
  for (const m of text.matchAll(new RegExp(String.raw`\bt\(\s*` + STR, 'g'))) add(unescape(m[1] ?? m[2]), rel)
  for (const m of text.matchAll(new RegExp(String.raw`\btn\([^,]+,\s*` + STR + String.raw`\s*,\s*` + STR, 'g'))) {
    add(unescape(m[1] ?? m[2]), rel)
    add(unescape(m[3] ?? m[4]), rel)
  }
}

// --- data tables read through t() -----------------------------------------------------

function literals(file, pattern) {
  const text = readFileSync(join(root, file), 'utf8')
  for (const m of text.matchAll(pattern)) for (const group of m.slice(1)) if (group !== undefined) add(unescape(group), file)
}
const field = (name) => new RegExp(String.raw`\b${name}:\s*` + STR, 'g')

literals('src/shared/levels.ts', field('blurb'))
literals('src/shared/levels.ts', /\{ id: \d, name: '([^']+)', health/g) // difficulty names
literals('src/shared/skills.ts', field('blurb'))
literals('src/characterPicker.ts', field('role'))
literals('src/heroClasses.ts', field('label'))
literals('src/weapons.ts', field('label'))
literals('src/equipmentCatalog.ts', /\{ id: '[a-z]+', label: '([^']+)' \}/g) // slot labels
literals('src/settings.ts', field('name'))
literals('src/settings.ts', field('blurb'))
literals('src/appearance.ts', field('name'))
literals('src/raid/colossusServer.ts', /announce\('[a-z]+',\s*'([^']+)'/g)
for (const file of ['src/folkBodies.json', 'src/enemyBodies.json']) {
  const json = JSON.parse(readFileSync(join(root, file), 'utf8'))
  for (const entry of Object.values(json)) if (entry && typeof entry.title === 'string') add(entry.title, file)
}
// The wardrobe's item descriptions: the built-in pieces, the outfit sets and the loot weapons.
literals('src/equipmentCatalog.ts', /"description":\s*"((?:[^"\\]|\\.)*)"/g)
for (const file of ['src/outfitCatalog.json', 'src/weaponCatalog.json']) {
  const json = JSON.parse(readFileSync(join(root, file), 'utf8'))
  for (const item of json.items) if (typeof item.description === 'string') add(item.description, file)
}
literals('src/dungeon/rosters.ts', /^\s+name: '([^']+)'/gm) // enemy names, over the boss bar
literals('src/bossBrain.ts', /phase === 3 \? '([^']+)' : phase === 2 \? '([^']+)' : '([^']+)'/g)
add('the hall', 'src/preloadPlan.ts')
add('Dev', 'src/lobbyUi.tsx')

const sorted = [...keys].sort((a, b) => a.localeCompare(b, 'en'))
console.log(`${sorted.length} keys`)

const write = process.argv.includes('--write')
if (write) {
  const dir = join(root, 'scripts', 'i18n')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'keys.json'), JSON.stringify(sorted, null, 2) + '\n')
}

for (const lang of LANGS) {
  const path = join(src, 'locales', `${lang}.json`)
  const table = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const missing = sorted.filter((k) => !table[k])
  const stale = Object.keys(table).filter((k) => !keys.has(k))
  console.log(`${lang}: ${sorted.length - missing.length}/${sorted.length} translated, ${missing.length} missing, ${stale.length} stale`)
  if (write) {
    const next = {}
    for (const k of sorted) next[k] = table[k] ?? ''
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n')
  } else if (missing.length && missing.length <= 40) {
    for (const k of missing) console.log(`  - ${k}`)
  }
}
