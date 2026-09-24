// The hero's saved preferences travel as one free-form JSON string (`prefs`
// in saveHero/savedHero), so new switches never touch the frozen wire schema.
// settings.ts writes it on the client; the host reads the bits it enforces.

/**
 * `camV` is the camera-default generation the save was written under. Saves
 * without it (or below the current one) were written when every hero was saved
 * as `crawler` whether or not they chose it, so their camera is ignored once.
 */
export type Prefs = { camera?: unknown; camV?: unknown; dev?: unknown; open?: unknown; lang?: unknown }

/** Bump when the default camera changes and every existing hero should move to it. */
export const CAMERA_DEFAULT_GENERATION = 2

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

/** Developer panel on: every level is selectable. Does not write fake clears. */
export function prefsHaveDevTools(json: string | undefined): boolean {
  const dev = parsePrefs(json).dev
  return dev === 1 || dev === true
}
