---
description: Network schema freeze — ask before changing anything that travels between clients and the server
alwaysApply: true
---

The wire format is frozen. Before changing any of the following, stop and tell the user it is a schema change, explain why, offer an alternative that avoids it, and wait for approval:

- `src/shared/heroBody.ts`: the `HeroBody` component definition (adding, removing, reordering or retyping any field, including inside `loadout`; renaming the component id).
- `src/shared/messages.ts`: the `Messages` table (adding or removing a message, or changing any field of a message payload).

Why: the SDK serializes these positionally. After a deploy, players still in the world keep the old bundle until they fully leave and rejoin, so a mismatch makes old and new clients (and the server) decode each other's data as garbage — other players' heroes silently disappear.

Not schema changes (safe): everything that only runs locally — AI, combat, camera, animation, UI, models, loot tables, how published values are computed or consumed.

When a schema change is approved: batch it with any other pending ones, bump `GAME_VERSION`, and tell the user that everyone must fully leave and rejoin the world after the deploy.
