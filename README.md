# Dungeons of Antrom

*You are a champion of Antrom. You raid fortresses with a party for gear you
keep, while every run takes three minutes.*

A co-op dungeon crawler for Decentraland (SDK7): seven fortresses across
three realms (The Dark Fortress, The Fallen Crown, The Dwarven Forge), built
from Synty kits, played over the hero's shoulder (an overhead crawler camera is
the alternative in Settings). Pick one of four
champions, form a party of up to four in the Hall of Antrom, fight room to
room with a light/heavy/block/roll combat kit, slay the Warlord, and wear
what he drops back into the hall. An eight-hero raid, The Pit of Chains,
waits under the hall. Multiplayer runs on the SDK's authoritative server: the
headless host owns enemies, loot and hero health; each hero is a synced
`HeroBody` entity, and every client builds the other players' custom bodies
from it (native avatars are hidden scene-wide).

**Play it:** [dungeons.dcl.eth](https://decentraland.org/jump/?realm=dungeons.dcl.eth)
(a World, 10×10 parcels). The old LAND at -17,123 now shows only a "New location"
button that sends the player there.

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

`scene.json` is the World scene: a `0,0` base, 10x10 parcels, and a
`worldConfiguration` block naming `dungeons.dcl.eth` (listed in Places on
purpose: the storage service finds a World's scene through the Places API).
`npm run deploy` sends it to the Worlds content server; sign at
`localhost:8000` within five minutes. The Worlds server rejects a single upload
over ~200 MB, but skips hashes it already holds, so a first deploy is staged
by holding files back in `.dclignore` and redeploying.

`npm run storage -- env set METRICS_KEY --value ...` and friends run the
storage CLI against the World's drawer; `npm run server-logs -- --world
dungeons.dcl.eth` streams the live server's log.

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
