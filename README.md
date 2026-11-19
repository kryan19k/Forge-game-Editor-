# FORGE

A studio where humans and AI agents build playable 3D browser games together — on the same live scene, through typed, transactional, undoable edits.

```
┌────────────┐  WebSocket   ┌──────────────┐   HTTP    ┌────────────┐  stdio  ┌──────────────┐
│  Studio    │ ◀──────────▶ │   Daemon     │ ◀───────▶ │ MCP server │ ◀─────▶ │ Claude Code  │
│ (Vite/R19) │  snapshot+tx │ authoritative│  agent API│  (forge)   │         │ Codex / any  │
└────────────┘              │ scene + tape │           └────────────┘         └──────────────┘
                            └──────┬───────┘
                                   │ pure reducer (@forge/scene) · zod contracts (@forge/contracts)
                                   ▼
                            workspace/<project>/scene.json + history.jsonl
```

## Run it

```bash
pnpm install
pnpm dev            # daemon on :4317, Studio on http://127.0.0.1:4318
```

Open the Studio, then in this folder start Claude Code — `.mcp.json` registers the `forge` MCP server automatically. Ask it to do something to the scene and watch its beacon move through your viewport.

```bash
pnpm test           # reducer, history/undo, template invariants
pnpm typecheck
pnpm --filter @forge/mcp-server smoke   # drives the real MCP server end-to-end (daemon must be running)
```

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Zod schemas: entities, components, mutations, transactions, wire protocol. The system's backbone. |
| `packages/scene` | Pure transactional reducer: atomic apply, inverse generation, conflict + lock checks, invariants, agent outline. |
| `packages/game-runtime` | Three.js `SceneSync` (doc → object graph) and WebGPU-first renderer with WebGL2 fallback. Shared by Studio and exported games. |
| `packages/templates` | Tested game templates (`outpost-zero`). |
| `apps/daemon` | Authoritative project store: history/tape, per-author undo/redo, revert, crew presence, directives, captures. Binds 127.0.0.1 only. |
| `apps/mcp-server` | `forge_*` MCP tools: outline, get_entities, apply, undo, history, selection, status, directives, capture, schema. |
| `apps/studio` | The editor. |

## Studio controls

Team Room shares project-wide messages and direct agent threads. Send scene selections with **Focus here**, mention agents by ID, and pause or resume an agent from their thread. Review plans to edit, reorder, approve, or reject individual steps. Agents use `forge_team_inbox` and `forge_team_message` to converse and check decisions, and `forge_think` to publish updates.

The team feed shows committed scene activity as entities are added, deleted, renamed, reparented or gain and lose components. Agents can read the same feed using `forge_activity`. The Director can enable agent follow-ups per project.

Open **Assets** to preview reusable prefab subtrees, save a selection, or place an instance at the viewport's ground point. **Describe an asset** sends a directive to #team. MCP agents create and place prefabs with `forge_prefab_create` and `forge_prefab_place`.

In **Assets → Models**, use **Import GLB** to bring in a self-contained static model from disk. Review its preview and approve it before placing it. Placed models use a box collider fitted to the mesh bounds. Agents can list models and place approved versions with `forge_assets` and `forge_asset_place`.

The same panel supports optional Tripo generation. Generation uses Tripo credits. The daemon stores the key in `workspace/secrets.json` and keeps each generated version under its own asset ID.

`W/E/R` move/rotate/scale · `Q` world/local · `X` snap · `F` frame (`Shift F` all) · `Ctrl D` duplicate · `Del` delete · `L` lock from agents · `H` hide · `F2` rename · `Ctrl Z / Ctrl ⇧ Z` undo/redo · `Ctrl K` command palette (type anything else to direct the crew). Drag any number field to scrub; click to type.

## Play mode

Press **Play** (`Ctrl P`) to snapshot the scene into a live game: WASD move · Shift sprint · Space jump · E interact · mouse look (click to capture) · Esc to release, Esc again to stop. Play never mutates the authoring scene.

The game is a `GameSimulation` (`@forge/game-runtime/sim`): Rapier physics, kinematic character controller, doors, pickups, inventory, triggers, objectives — fixed 60 Hz, deterministic, renderer-free. The same simulation runs:

- in the Studio (`PlaySession` renders it with a third-person camera),
- headless in Node for agents (`forge_playtest`) and CI (`packages/game-runtime/test`) — ~40× real time.

Component semantics: `collider` (+ `rigidBody` static/dynamic/kinematic) is solid · `interactable` `pickup` grants `grantsItem` · `open` on a kinematic body is a sliding door (`requiresItem` locks it) · an interactable tagged `#objective` is a mission objective · `spawnPoint` places the player · trigger colliders fire enter/exit events.

## Making a new game

**New game** → pick a genre starter (**RPG, MMORPG, Action-Adventure, Fighting, Racing, Arena Shooter**) → answer the design interview (keys 1–9, Enter) → **Forge it**. FORGE builds a playable greybox configured from your answers (rules, controller, camera, a starter gameplay database) and writes a design brief. Then the Producer (embedded Claude with your API key, or your MCP agent) asks follow-ups in **Design**, writes the GDD and the build plan, and agents build from it.

## Gameplay framework

Stats & modifiers, resources, abilities (bar keys 1–6, or bound to click), status effects, XP/levels, skill/tech trees (in-game **T**), items, equipment, consumables (bag **I**), loot tables — all data in `scene.database`, edited by transactions, deterministic in solo, headless and multiplayer. See `forge-gameplay-systems` skill and ADR-003.

## Sample games

Finished examples (also regression fixtures), proven by headless playtests:

| Code | Template | Genre | Controller / camera | Proven by |
|---|---|---|---|---|
| EXP-01 | Outpost Zero | exploration | character · third-person | keycard → door → terminal |
| RPG-01 | Hollow Vale | rpg | character · third-person | talk → gather ×3 → wolves ×2 → return |
| MMO-01 | Shardlands | mmorpg (shared world) | character · third-person | warden → 5 slimes → return, mobs respawn |
| FGT-01 | Iron Ring | fighting | fighter · side | best-of-3 resolves, 2nd human takes bot seat |
| RCE-01 | Dust Circuit | racing | vehicle · chase | 3 laps through 8 checkpoints vs 3 AI |

Genre rules live in `scene.game` (controller, camera, win rule, tuning, bots, laps, rounds, quest chain) and are edited like everything else (`set_game`).

## Multiplayer

**Host online** in the Studio (or `forge_sessions {host: true}`) starts an authoritative session of the current scene on the daemon and joins you as the Director. **Copy invite** gives `http://127.0.0.1:4318/play.html?room=CODE` — the standalone player client. Server runs the sim at 60 Hz, clients send inputs, snapshots at 30 Hz. See ADR-002 for scope (no client prediction yet; localhost-bound by default).

## Skills (agent playbooks)

`.claude/skills/` holds the core `forge-game-builder`, the craft skills `forge-game-design`, `forge-gameplay-systems`, `forge-level-design`, `forge-game-feel`, `forge-performance`, `forge-qa-playtesting`, and genre skills `forge-rpg`, `forge-mmo`, `forge-adventure`, `forge-shooter`, `forge-fighting`, `forge-racing`. Claude Code loads them automatically in this repo; the MCP server also serves them as **prompts**, so Codex and other MCP clients get the same playbooks. They reference the general `gamedev:*` skills for theory and add FORGE specifics, tuning tables and playtest recipes.

## Rules the system enforces

- Every change is a typed transaction: validated, atomic, versioned, and on the Tape with its author.
- Stale writes to entities someone changed since your base revision are rejected (`CONFLICT`) — no silent clobbering.
- Entities the Director locks cannot be touched by agents (`LOCKED`).
- Undo is per author and refuses to undo over someone else's later change; any entry can be reverted from the Tape.

See `docs/adr/` for decisions and `FORGE_MASTERPLAN.md` (Desktop) for the full plan.
