// Run an sdk-commands command against the World (dungeons.dcl.eth).
//
// scene.json is kept as the LAND layout (the 10x10 block at -17,123 in
// Genesis City). A World needs a 0,0 base and a worldConfiguration block, and
// the storage CLI reads its scope from the same file, so for the duration of
// the command this rewrites the parcels and adds the World block, then puts
// the original file back whatever happens.
//
//   npm run deploy:land                  -> plain `sdk-commands deploy` with scene.json as committed
//   npm run deploy:world                 -> deploy to the Worlds content server
//   npm run storage:world -- env set METRICS_KEY --value ...
//   npm run storage:world -- player get hero --address 0x...

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const WORLD = { name: 'dungeons.dcl.eth', placesConfig: { optOut: true } }
const WORLDS_CONTENT = 'https://worlds-content-server.decentraland.org'

const path = 'scene.json'
const original = readFileSync(path, 'utf8')
const scene = JSON.parse(original)

// Same shape as the LAND layout, moved so its corner sits on 0,0.
const cells = scene.scene.parcels.map((p) => p.split(',').map(Number))
const minX = Math.min(...cells.map(([x]) => x))
const minY = Math.min(...cells.map(([, y]) => y))
scene.scene = { base: '0,0', parcels: cells.map(([x, y]) => `${x - minX},${y - minY}`) }
scene.worldConfiguration = WORLD
writeFileSync(path, JSON.stringify(scene, null, 2) + '\n')

const restore = () => writeFileSync(path, original)
process.on('exit', restore)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

const args = process.argv.slice(2)
if (args[0] === 'deploy' && !args.includes('--target-content')) args.push('--target-content', WORLDS_CONTENT)

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(npx, ['sdk-commands', ...args], { stdio: 'inherit', shell: true })
restore()
process.exit(result.status ?? 1)
