/**
 * Wallets that are us, not players (lower case). The client gives them the
 * developer tools; the server leaves them out of the metrics so a testing
 * session never reads as a returning player.
 */
export const DEVELOPERS: ReadonlySet<string> = new Set<string>(['0xfe2d424af0df49bb3316cb2e9f574b0d09cf98ad'])
