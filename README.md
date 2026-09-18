# DG — Dark Fortress Dungeon

A co-op dungeon crawler for Decentraland (SDK7). A procedurally generated
Synty *Dark Fortress* dungeon, explored with a top-down crawler camera:
build a hero, fight roaming enemies with a light/heavy/block/roll combat
kit, collect loot, and take down the Warlord boss. Multiplayer over
MessageBus with host-elected enemy AI; other players appear as their
custom heroes.

Live at **SpaceMatt.dcl.eth** (6×6 parcels).

## Controls

- WASD move · E light attack (3-hit combo) · F heavy attack
- Space hold to block · Ctrl dodge roll (brief invulnerability)

## Run locally

```
npm install
npm run start
```

`npm run build` type-checks and bundles to `bin/`.

## Deploy

`scene.json` targets the World in `worldConfiguration.name`. The full scene
(~490 MB after `.dclignore`) is over the world content server's single-upload
limit, so deploy in two passes — first with `models/roaming/customization/`
temporarily added to `.dclignore`, then again with it removed. Already
uploaded files are deduplicated by hash, so the second pass only sends the
remainder.

```
npm run deploy -- --target-content https://worlds-content-server.decentraland.org
```

## Layout

- `src/` — game code. `dungeon/` holds the generator, kit placement and the
  crawler camera; `roamingCombat.ts` / `combatActions.ts` the combat kit;
  `dungeonEnemies.ts` / `bossBrain.ts` enemy and boss AI;
  `multiplayer.ts` / `remotePlayers.ts` sync and replicas; `preload.ts`
  the loading screen.
- `models/roaming/` — hero bodies, armor, hair and weapons with the roaming,
  combat and roll clips baked in (loaded in place of the originals via
  `src/roamingModels.json`). `models/dungeon/`, `models/loot/`,
  `models/characters/` — dungeon kit, drops and preset heroes.
- `scripts/` — the animation pipeline: `export-boss-clips.py` (Blender,
  FBX → bare skeleton GLB per clip), `splice-boss-clips.py` (merge clips into
  existing GLBs), `bake-sword-clips.py` (bake clips onto single-joint weapons).
- `.dclignore` — deploy trimming. Assets it excludes as unused are also kept
  out of git (see `.gitignore`); they only exist on the authoring machine.
