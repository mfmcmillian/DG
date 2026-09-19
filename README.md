# DG — Dark Fortress Dungeon

A co-op dungeon crawler for Decentraland (SDK7). A procedurally generated
Synty *Dark Fortress* dungeon, explored with a top-down crawler camera:
build a hero, fight roaming enemies with a light/heavy/block/roll combat
kit, collect loot, and take down the Warlord boss. Multiplayer runs on the
SDK's authoritative server: the headless host owns enemies, loot and hero
health; each hero is a synced `HeroBody` entity, and every client builds the
other players' custom bodies from it (native avatars are hidden scene-wide).

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
  `shared/heroBody.ts` the synced hero component, `multiplayer.ts` the room
  (server hero ledger, messages), `remotePlayers.ts` the other players'
  bodies, `avatarHiding.ts` the scene-wide hide area; `server.ts` the
  headless host entry; `preload.ts` the loading screen.
- `models/roaming/` — hero bodies, armor, hair and weapons with the roaming,
  combat and roll clips baked in (loaded in place of the originals via
  `src/roamingModels.json`). `models/dungeon/`, `models/loot/`,
  `models/characters/` — dungeon kit, drops and preset heroes.
- `models/roaming/weapons/` + `images/weapons/` — the 164 loot weapons and
  their icons, generated from `scripts/weapons-manifest.json` (Synty source
  packs in `~/Downloads`) by `scripts/build-weapons.py` (run inside Blender),
  which also writes `src/weaponCatalog.json`. `src/weapons.ts` holds classes,
  rarities and drop tables.
- `models/kits/<realm>/` + `src/dungeon/kits/<realm>.json` — one kit per
  realm beyond the Dark Fortress, exported from a Synty source pack by
  `scripts/export-realm-kit.py` driven by `scripts/realms/<realm>.json`
  (which modules, textures, wall-mount and collider flags). `kit.ts` merges
  the kit JSONs into `KIT`; a realm is then a `DungeonStyle` in
  `src/dungeon/config.ts` and a `RealmDefinition` plus its ladder of levels
  in `src/shared/levels.ts` (level ids are flat and only ever appended: the
  saved progress array is indexed by them). The lobby shows realms as tabs;
  each realm's first level is open, the rest unlock down the ladder. The
  developer panel's "Every dungeon open" switch lifts the lock for testing.
  Check a style offline with `scripts/dump-layout.ts` + `scripts/render-layout.py`.
- `scripts/` — the animation pipeline: `export-boss-clips.py` (Blender,
  FBX → bare skeleton GLB per clip), `splice-boss-clips.py` (merge clips into
  existing GLBs), `bake-sword-clips.py` (bake clips onto single-joint weapons),
  `build-weapons.py` (FBX → hand-skinned weapon GLB + icon, for the manifest).
- `.dclignore` — deploy trimming. Assets it excludes as unused are also kept
  out of git (see `.gitignore`); they only exist on the authoring machine.
