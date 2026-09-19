// Deploy to Genesis City, on the 6x6 block at the south-west corner of the
// -17,123 estate (the parcels DecentraCraft used to occupy). scene.json is kept
// as the World layout (0,0 base, spacematt.dcl.eth): sdk-commands refuses a
// LAND deploy while worldConfiguration is present, so for the duration of the
// deploy this rewrites the parcels and strips the World block, then puts the
// original file back whatever happens.
//
//   npm run deploy:land    -> this script
//   npm run deploy:world   -> the World (worlds content server)

import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const BASE = { x: -17, y: 123 }
const SIDE = 6 // the game is laid out for a 6x6 parcel scene (96 m)

const path = 'scene.json'
const original = readFileSync(path, 'utf8')
const scene = JSON.parse(original)

const parcels = []
for (let x = 0; x < SIDE; x++) for (let y = 0; y < SIDE; y++) parcels.push(`${BASE.x + x},${BASE.y + y}`)
scene.scene = { base: `${BASE.x},${BASE.y}`, parcels }
delete scene.worldConfiguration
writeFileSync(path, JSON.stringify(scene, null, 2) + '\n')

const restore = () => writeFileSync(path, original)
process.on('exit', restore)
process.on('SIGINT', () => process.exit(130))

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(npx, ['sdk-commands', 'deploy', ...process.argv.slice(2)], { stdio: 'inherit', shell: true })
restore()
process.exit(result.status ?? 1)
