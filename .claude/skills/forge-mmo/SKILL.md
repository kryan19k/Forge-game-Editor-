---
name: forge-mmo
description: Build shared-world / MMO-style games in FORGE (template shardlands) — hubs, respawning field mobs, vendor NPCs, maxPlayers and hosting multiplayer sessions. Use when making or editing an MMORPG, co-op world, or anything players share online in FORGE.
---

# FORGE · MMO / shared world

Load `forge-game-builder` and `forge-rpg` first — an MMO in FORGE is an RPG whose world is shared and never "ends".

## Honest scale

FORGE multiplayer is **server-authoritative rooms**: one simulation per session on the FORGE daemon, up to `game.maxPlayers` (≤ 64). That is a co-op/shared-world hub, not a 10,000-player shard. Design for 4–32 concurrent players per session and say so if the user asks for "MMO scale".

## Settings that make it a shared world

- `win: "none"` — no match end; the world persists for the session.
- `maxPlayers` 16–32, `pvp: false` (default), `respawnSeconds` 5.
- Many `spawnPoint`s in a ring at the hub so joiners don't stack (players take spawns round-robin).
- Field mobs with `npc.respawnSeconds` 15–30 so the world refills — shared objectives count kills from **every** player.
- `network` components on NPCs/props document replication intent (server authority).

## Layout pattern

1. **Hub plaza** — landmark at the center (tall emissive object + point light visible from the fields), vendors at the edges, quest-giver facing the main exit.
2. **Rings of difficulty** outward: fodder near the hub, standard further, elites at the edge with a visible landmark.
3. **Sightlines** back to the hub from every field so players re-orient without a minimap.

## Hosting and testing a session

- `forge_sessions {host: true}` hosts the active project and returns a join link (`/play.html?room=CODE`). The Director can also press **Host online** in the Studio.
- Sessions snapshot the scene at host time — edits after hosting need a new session.
- Headless proof (single player stands in for the group): talk to the warden → `autopilot until defeated #slime 5` → return; then `wait_until event npc_respawn` to prove the field refills.

Classes and progression: use `forge-gameplay-systems` — one tree per class (`loadout.trees`), shared XP curve, loot tables on field mobs. The `mmorpg` starter builds this from the interview.

Not yet in the runtime: persistence across sessions, chat, parties/guilds, trading, interest management beyond `network.relevancy` intent, client-side prediction. Treat them as roadmap items.
