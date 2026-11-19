# ADR-002 · Genre runtime and server-authoritative multiplayer

**Status:** accepted · 2026-11-19

## Genres are data + three controllers, not five engines
- `scene.game` (GameSettings) declares genre, **controller** (`character` | `vehicle` | `fighter`), camera, win rule (`objectives` | `race` | `ko` | `none`), tuning, bots, and an ordered **quest chain** (`objectives`: interact / collect / defeat / reach).
- New components: `npc` (AI brain + dialogue), `health`, `combat`, `checkpoint`. Everything stays in the closed, typed component set; agents edit genres through the same transactions (`set_game`).
- `GameSimulation` is now multi-actor: players, bots and NPCs are all actors with a kinematic controller. Bots and `autopilot` share one AI per controller (racing line, sparring bot, hostile hunter), so every template can prove itself completable headlessly.
- Templates (`outpost-zero`, `hollow-vale`, `shardlands`, `iron-ring`, `dust-circuit`) each ship with playtests in `packages/game-runtime/test` — a template that can't be finished by the sim doesn't ship.

## Multiplayer: authoritative rooms
- A **room** (daemon, `apps/daemon/src/rooms.ts`) snapshots the active project's scene and runs one `GameSimulation` at 60 Hz. Clients send only `PlayerInput` (30 Hz + immediate on button edges); the server broadcasts snapshots at 30 Hz with **per-player HUD state**.
- The renderer consumes a `GameSource`: `LocalSource` (solo play) or `NetSource` (network). Same `PlaySession`, same HUD.
- `NetSource` interpolates remote actors/props 100 ms in the past and renders the local player from the newest snapshot. **No client-side prediction yet**: on localhost/LAN the input delay is one round-trip + ≤ 33 ms; over the internet it will feel heavy. Prediction + reconciliation (re-simulating the local actor from acked inputs — the sim is deterministic, `ack` is already in snapshots) is the next networking milestone.
- Bots are seat-fillers: a joining human takes a bot's spawn when the arena/grid is full.
- The daemon binds 127.0.0.1 only (Host-header guarded). LAN/internet hosting needs an explicit opt-in bind and auth on `/net` — deliberately not on by default.

## Consequences
- "MMO" in FORGE means a shared, persistent-for-the-session world of up to 64 players per room — honest scope, stated in the `forge-mmo` skill.
- The fighting moveset and vehicle model are runtime constants today; per-character movesets and vehicle classes become components later.
