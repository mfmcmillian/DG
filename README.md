# Dungeons of Antrom

*You are a champion of Antrom. You raid fortresses with a party for gear you
keep, while every run takes three minutes.*

A co-op dungeon crawler for Decentraland (SDK7): seven fortresses across
three realms (The Dark Fortress, The Fallen Crown, The Dwarven Forge), built
from Synty kits and explored with a top-down crawler camera. Pick one of four
champions, form a party of up to four in the Hall of Antrom, fight room to
room with a light/heavy/block/roll combat kit, slay the Warlord, and wear
what he drops back into the hall. An eight-hero raid, The Pit of Chains,
waits under the hall. Multiplayer runs on the SDK's authoritative server: the
headless host owns enemies, loot and hero health; each hero is a synced
`HeroBody` entity, and every client builds the other players' custom bodies
from it (native avatars are hidden scene-wide).

**Play it:** [Genesis City, -17,123](https://play.decentraland.org/?NETWORK=mainnet&position=-17,123)
(6×6 parcels).

**Design:** the Game Design Document for Decentraland's Creator Success
programme is at [`design/gdd.md`](design/gdd.md); `design/` also holds the
hypothesis log, decisions and ideas that grew with it.

## Controls

- WASD move · E light attack (3-hit combo) · F heavy attack
- Space hold to block · Ctrl dodge roll (brief invulnerability)
- 1–4 skills: four per class, opened at levels 2, 5, 9 and 14; each costs stamina and then cools down
- In the hall, walk up to one of its folk and the prompt offers a word: each explains one part of the game
- Six languages (English, Spanish, French, German, Portuguese, Japanese): the flag row on the title screen and in Settings switches the whole UI; the choice is saved with the champion

## Languages

English is the source and lives in the code: every line the player reads goes
through `t('English text', { params })` (`src/i18n.ts`), and the other
languages are tables keyed by that English text in `src/locales/<lang>.json`.
A key with no entry falls back to English, so a new string never breaks a
language. `node scripts/i18n-extract.mjs` lists every key in the code, flags
what each table is missing or has left over, and checks that `{placeholders}`
survive translation. Realm, fortress, skill, set, weapon and champion names
stay English everywhere; everything else, down to the wardrobe's item
descriptions, is a key.

## Run locally

```
npm install
npm run start
```

`npm run build` type-checks and bundles to `bin/`.

## Deploy

`scene.json` targets LAND: the 6x6 block at `-17,123` in Genesis City.
`npm run deploy:land` deploys it as committed. `npm run deploy:world` deploys
to the World (`spacematt.dcl.eth`) by temporarily rewriting `scene.json` to a
`0,0` base with a `worldConfiguration` block and restoring it afterwards.
The deploy is ~186 MB after `.dclignore`, which fits in a single pass.

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
