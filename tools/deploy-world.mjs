// Deploy to the World (spacematt.dcl.eth). scene.json is kept as the LAND
// layout (the 6x6 block at -17,123 in Genesis City, where the game lives):
// a World deploy needs a 0,0 base and a worldConfiguration block, so for the
// duration of the deploy this rewrites the parcels and adds the World block,
// then puts the original file back whatever happens.
//
//   npm run deploy:land    -> plain `sdk-commands deploy` with scene.json as committed
//   npm run deploy:world   -> this script

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const SIDE = 6 // the game is laid out for a 6x6 parcel scene (96 m)
const WORLD = { name: 'spacematt.dcl.eth', placesConfig: { optOut: true } }

const path = 'scene.json'
const original = readFileSync(path, 'utf8')
const scene = JSON.parse(original)

const parcels = []
for (let x = 0; x < SIDE; x++) for (let y = 0; y < SIDE; y++) parcels.push(`${x},${y}`)
scene.scene = { base: '0,0', parcels }
scene.worldConfiguration = WORLD
writeFileSync(path, JSON.stringify(scene, null, 2) + '\n')

const restore = () => writeFileSync(path, original)
process.on('exit', restore)
process.on('SIGINT', () => process.exit(130))
process.on('SIGTERM', () => process.exit(143))

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(npx, ['sdk-commands', 'deploy', '--target-content', 'https://worlds-content-server.decentraland.org', ...process.argv.slice(2)], { stdio: 'inherit', shell: true })
restore()
process.exit(result.status ?? 1)
