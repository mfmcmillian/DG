/**
 * Wallets that are us, not players (lower case). The client gives them the
 * developer tools. The metrics count them like anyone else; the day records
 * name who came, so a report can leave them out afterwards if it wants to.
 */
export const DEVELOPERS: ReadonlySet<string> = new Set<string>(['0xfe2d424af0df49bb3316cb2e9f574b0d09cf98ad'])
