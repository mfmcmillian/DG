// Discord: a line in the channel when a player walks into the scene. Runs on
// the headless server only, so one notice goes out per arrival however many
// clients are watching. Same webhook and shape as DecentraCraft's join notice.

import { AvatarBase, engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { EnvVar } from '@dcl/sdk/server'

const DEFAULT_JOIN_WEBHOOK =
  'https://discord.com/api/webhooks/1538574204855656458/py8wHhVdyELkNeTgLSn3ExV5Kuqm2dhWegyeHrzlVFMpc4xhdCjdDLNYvAfBNf_XNwB_'
/** A player who leaves and comes straight back is not announced twice. */
const COOLDOWN_MS = 120000
/** How long to hold a notice waiting for the profile name to arrive. */
const NAME_WAIT_SECONDS = 4

const present = new Set<string>()
const names = new Map<string, string>()
const notifiedAt = new Map<string, number>()
const pending = new Map<string, number>()
let initialized = false

export function initializeJoinNotify() {
  if (initialized) return
  initialized = true
  engine.addSystem(update)
}

async function webhookUrl(): Promise<string> {
  try {
    return (await EnvVar.get('DISCORD_JOIN_WEBHOOK')) || DEFAULT_JOIN_WEBHOOK
  } catch {
    return DEFAULT_JOIN_WEBHOOK
  }
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

function rememberName(address: string, raw: string | undefined) {
  const name = (raw || '').trim()
  if (!name || /^0x[0-9a-f]/i.test(name) || name.toLowerCase() === address) return
  names.set(address, name)
}

function update(dt: number) {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0
  const inScene = new Set<string>()
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (!identity.address) continue
    const address = identity.address.toLowerCase()
    inScene.add(address)
    rememberName(address, AvatarBase.getOrNull(entity)?.name)
  }
  const previous = new Set(present)
  present.clear()
  for (const address of inScene) present.add(address)
  // Only now, with the count including the newcomer, announce them.
  for (const address of inScene) if (!previous.has(address)) arrived(address)

  for (const [address, waited] of [...pending]) {
    const next = waited + step
    if (names.has(address) || next >= NAME_WAIT_SECONDS) {
      pending.delete(address)
      post(address)
    } else {
      pending.set(address, next)
    }
  }
}

function arrived(address: string) {
  const now = Date.now()
  if (now - (notifiedAt.get(address) ?? 0) < COOLDOWN_MS) return
  notifiedAt.set(address, now)
  if (names.has(address)) post(address)
  else pending.set(address, 0)
}

function post(address: string) {
  const name = names.get(address) || shortAddress(address)
  const online = present.size
  void (async () => {
    try {
      const url = await webhookUrl()
      if (!url) return
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Dungeons of Antrom',
          embeds: [
            {
              title: 'Player entered the scene',
              description: `**${name}**\n\`${address}\``,
              color: 0xc9a227,
              footer: { text: `${online} in scene` },
              timestamp: new Date().toISOString()
            }
          ]
        })
      })
      if (!response.ok) console.log(`[Server] discord join notify failed: ${response.status}`)
    } catch (error) {
      console.log(`[Server] discord join notify failed: ${error}`)
    }
  })()
}
