// Usage (bundled with esbuild, see scripts/render-layout.py):
//   node dump-layout.js <seed> <out.json> [tight|open] [cutaway]
import { writeFileSync } from 'fs'
import { StyleId, STYLES } from '../src/dungeon/config'
import { generateDungeon } from '../src/dungeon/generator'
import { layoutDungeon } from '../src/dungeon/layout'

const seed = Number(process.argv[2] ?? 1337)
const out = process.argv[3] ?? 'layout.json'
const style = STYLES[(process.argv[4] as StyleId) ?? 'tight']
const dungeon = generateDungeon(seed, {
  size: style.size,
  entranceSize: style.entranceSize,
  minLeaf: style.minLeaf,
  maxLeaf: style.maxLeaf,
  minRoom: style.minRoom,
  torchEvery: style.torchEvery
})
const cutaway = process.argv[5] === 'cutaway' && style.cutawayWall !== undefined
const layout = layoutDungeon(dungeon, style, { cutaway })
// The layout carries both camera modes; resolve to the one asked for, as the builder does.
const placements = layout.placements
  .filter((p) => !('only' in p && p.only) || (p.only === 'cutaway') === cutaway)
  .map((p) => (p.kind === 'kit' && p.lowId && cutaway ? { ...p, id: p.lowId } : p))
writeFileSync(
  out,
  JSON.stringify({
    seed,
    style: { id: style.id, tile: style.tile, size: style.size, wallHeight: style.wallHeight },
    stats: layout.stats,
    entrance: dungeon.entrance,
    boss: dungeon.boss,
    spawns: layout.spawns,
    placements
  })
)
console.log(
  `seed ${seed} [${style.id}]: ${dungeon.rooms.length} rooms, ${layout.stats.entities} entities, ~${layout.stats.triangles} tris, ${layout.spawns.length} spawns -> ${out}`
)
