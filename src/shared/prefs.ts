// The hero's saved preferences travel as one free-form JSON string (`prefs`
// in saveHero/savedHero), so new switches never touch the frozen wire schema.
// settings.ts writes it on the client; the host reads the bits it enforces.

export type Prefs = { camera?: unknown; dev?: unknown; open?: unknown }

export function parsePrefs(json: string | undefined): Prefs {
  if (!json) return {}
  try {
    const value = JSON.parse(json) as unknown
    return value && typeof value === 'object' ? (value as Prefs) : {}
  } catch {
    return {}
  }
}

/** The developer "every dungeon open" switch: the lobby lists every level as open and the host skips the progress lock. */
export function prefsOpenAll(json: string | undefined): boolean {
  const open = parsePrefs(json).open
  return open === 1 || open === true
}
