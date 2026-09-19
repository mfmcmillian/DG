// Which party (phase) an address is in. The server registry and the client's
// lobby mirror both install a resolver here, so the enemy simulation, loot and
// remote-player code can ask without depending on either of them.

/** Everyone who is not in a running party shares the hub. */
export const HUB = 'hub'

let resolver: (address: string) => string = () => HUB

export function setPartyLookup(fn: (address: string) => string) {
  resolver = fn
}

/** The party id of a running or finished run this address is in, else `HUB`. */
export function partyOf(address: string): string {
  return resolver(address.toLowerCase())
}
