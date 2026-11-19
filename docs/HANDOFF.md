# FORGE — Engineering Handoff

**Date:** 2026-11-19 · **From:** Claude (sessions 1–4) · **Repo:** FORGE (`main`)
**State at handoff:** `pnpm verify` green — 49 tests (scene 12, templates 5, game-runtime 23, daemon 9), full-workspace typecheck clean, MCP smoke passing, all genres verified in a real browser.

**Phase 6 implementation:** Studio now has scene activity, Team Room, and Assets. See ADRs [004](adr/ADR-004-scene-activity.md), [005](adr/ADR-005-team-room.md), [006](adr/ADR-006-prefab-library.md) and [007](adr/ADR-007-generated-glb-assets.md) for persistence and capability details. The phase requirements below preserve the original acceptance criteria.

---

## 1. What FORGE is (and who it's for)

FORGE is an AI-native game engine and studio for browser 3D games. The owner (Kory) describes the goal as **"Unity or Unreal, but with full agent control"**: make *any* type of game with deep customization, where AI agents are first-class developers working alongside a human **Director** in a live Studio.

What the owner has asked for, in his words and decisions (respect these):
- **Studio first, with full MCP control** while developing. It must look distinctive — "not AI slop, something completely new and different".
- **Full playable games with many features, including multiplayer.**
- **General genre templates, not prebuilt games**: the user picks a genre (e.g. MMORPG) and **the AI asks questions** to figure out what kind of game to make. (Done: starters + interview, §4.4.)
- **Agents need expert skills** to build the best, most efficient games, distilled from his `gamedev:*` skill library. (Done: `.claude/skills/forge-*`.)
- **Skill trees and similar systems must be buildable by users**, so systems are data, not hardcoded features. (Done: gameplay framework, §4.3.)
- Decisions he made explicitly: interview = **layered** (built-in wizard, then an embedded Producer or any MCP agent); extensibility = **data + logic graphs first, sandboxed code as escape hatch**; first system pack = **gameplay framework**.
- **Next asks (not started — your phase):** a clearer way to talk to the agent team, see their internal dialog, and guide them; see when actors are added to the scene; **AI asset creation** beyond the built-in primitives. Full spec in §6.

---

## 2. Run it

```bash
pnpm install
pnpm dev                 # daemon http://127.0.0.1:4317  +  Studio http://127.0.0.1:4318
pnpm verify              # typecheck + tests (run before finishing ANY task)
pnpm smoke:mcp           # real MCP server, end-to-end (daemon running, Studio open)
```

- Standalone game client (multiplayer join): `http://127.0.0.1:4318/play.html?room=CODE`
- Project data lives in `workspace/<projectId>/` (`scene.json`, `history.jsonl`, `brief.json`) plus `workspace/hub.json` (project index) and `workspace/secrets.json` (BYOK keys). **All gitignored, all user data.** Never reseed a project that has history; migrate through transactions.
- Dev-only automation hook in the Studio and player pages: `window.forge` (stores, `startPlay`, `stopPlay`), used by Playwright checks. Playwright is not a repo dependency; Chromium browsers are cached on this machine (`playwright@1.56.1` matches them).

### Connect an agent over MCP

- **Claude Code**: `.mcp.json` at the repo root registers `forge` automatically.
- **Codex / GPT** (`~/.codex/config.toml`):
  ```toml
  [mcp_servers.forge]
  command = "node"
  args = ["/absolute/path/to/forge/scripts/forge-mcp.mjs"]
  env = { FORGE_URL = "http://127.0.0.1:4317", FORGE_AGENT_ID = "codex", FORGE_AGENT_NAME = "Codex" }
  ```
  `scripts/forge-mcp.mjs` works from any working directory (verified). The daemon must be running.

---

## 3. Architecture

```
Studio (Vite/React 19) ──WS /ws──▶ Daemon (Fastify) ◀──HTTP /api── MCP server (stdio) ◀── Claude Code / Codex
   │  play.html ──WS /net/:room──▶   │  ProjectHub → ProjectStore (per project)
   │                                 │  RoomManager → Room (authoritative GameSimulation @60 Hz)
   │                                 │  Producer (Claude API, optional)
   └── LocalSource / NetSource ──▶ PlaySession (three.js renderer, cameras, HUD)
Shared: @forge/contracts (zod) · @forge/scene (pure reducer) · @forge/game-runtime (SceneSync, sim, play) · @forge/templates
```

### Packages and key files

| Path | Responsibility |
|---|---|
| `packages/contracts/src/` | **All schemas.** `primitives.ts` (ids, Vec3, Color) · `components.ts` (closed component set incl. `npc`, `health`, `combat`, `unit`, `checkpoint`) · `scene.ts` (Entity, Environment, **GameSettings** incl. quest `objectives`, SceneDoc) · `database.ts` (**gameplay framework** schemas) · `mutations.ts` (Mutation union, Transaction) · `protocol.ts` (Studio WS messages) · `playtest.ts` (SimEvent, SimState/KitView, PlaytestStep/Check/Script/Report) · `net.ts` (multiplayer wire) · `design.ts` (starters, DesignBrief) |
| `packages/scene/src/reducer.ts` | `applyTransaction(scene, tx)`: pure, atomic, returns next scene + **inverse mutations**; conflict = touched entity `rev > baseRevision`; agents can't touch `locked`; invariants in `graph.ts`; `outline.ts` = token-efficient outline for agents |
| `packages/game-runtime/src/scene-sync.ts` | SceneDoc → three.js object graph (diffed), editor helper proxies, `applyEnvironment` |
| `packages/game-runtime/src/renderer.ts` | WebGPURenderer with automatic WebGL2 fallback |
| `packages/game-runtime/src/sim/simulation.ts` | **GameSimulation**: Rapier world, multi-actor (players, bots, NPCs), controllers `character`/`vehicle`/`fighter`, doors, pickups, triggers, checkpoints/laps, KO rounds, quests, NPC brains, autopilot AI, combat, dialogue, gameplay-framework integration, `state(viewer)` HUD view |
| `packages/game-runtime/src/sim/gameplay.ts` | Gameplay framework runtime: stat blocks and modifiers, resources, abilities, statuses, XP/levels, trees, equipment, `rollLoot`, `lintDatabase` |
| `packages/game-runtime/src/sim/playtest.ts` | `runPlaytest(doc, script)` headless QA runner + `formatReport`; `check()` for every PlaytestCheck |
| `packages/game-runtime/src/play/` | `source.ts` (GameSource, LocalSource) · `net-source.ts` (multiplayer client, interpolation) · `PlaySession.ts` (rendering, avatars/cars, cameras third_person/chase/side, input, nameplates) |
| `packages/templates/src/` | `kit.ts` (authoring helper) · sample games (`outpost-zero`, `hollow-vale`, `shardlands`, `iron-ring`, `dust-circuit`) · **`starters.ts`** (6 genre starters: questions + `build(answers)` + `seed()`) · `index.ts` registry |
| `apps/daemon/src/` | `main.ts` · `hub.ts` (multi-project) · `store.ts` (history, per-author undo/redo/revert, crew presence, comms, directives, captures, brief) · `server.ts` (all REST + WS routes) · `rooms.ts` (multiplayer) · `producer.ts` (embedded Claude Producer) |
| `apps/mcp-server/src/index.ts` | 22 `forge_*` tools + skills served as MCP prompts; `scripts/smoke.ts` end-to-end check |
| `apps/studio/src/` | `state/store.ts` (WS client, replays txs through the same reducer) · `state/play.ts` (solo/online play, `sendCommand`) · `state/ops.ts` (add recipes, duplicate, delete, flags) · `viewport/EditorViewport.ts` (imperative editor: orbit, gizmo, picking, beacons, capture, play hand-off) · `ui/*` (TopBar, Outliner, Inspector, Tape, CrewChannel, Palette, Gallery+Interview, DesignPanel, PlayHud, KitHud) · `player/main.tsx` (standalone client) · `styles.css` (**design tokens**) |
| `.claude/skills/forge-*` | 13 agent skills: builder, game-design, gameplay-systems, level-design, game-feel, performance, qa-playtesting, rpg, mmo, adventure, shooter, fighting, racing |
| `docs/adr/` | ADR-000 (Studio-first foundation), 001 (one sim, three hosts), 002 (genres + multiplayer), 003 (gameplay framework + interview) |

### Core flows (read these before changing them)

1. **Edit**: Studio/agent → `Transaction` → daemon `ProjectStore.apply` → reducer → history entry (+inverse) → broadcast `tx.applied` → every Studio replays it with the same reducer (revision mismatch ⇒ resync).
2. **Undo/revert**: per-author undo; `liveLaterChange` refuses to revert over someone else's later change (revert pairs cancel out).
3. **Play**: snapshot scene → `LocalSource` (in-page sim) or `NetSource` (room) → `PlaySession` renders `frame()` and pushes `hud()` to React at ~10 Hz.
4. **Multiplayer**: `Room` steps the sim with an accumulator, clients send `NetInput` (30 Hz + on edges) and `command`s; server sends per-player `snap` (30 Hz). Bots give their seats to joining humans.
5. **Playtest**: `runPlaytest` creates a fresh sim, adds player `p1`, executes steps synchronously (~40× real time), fails fast, returns a report.
6. **New game**: Studio wizard → `POST /api/projects {starter, answers, name}` → `starter.build()` greybox + brief → directive for agents → Producer (if key) drafts follow-ups/GDD/plan → Director answers in Design panel → final GDD.

---

## 4. What exists (feature inventory)

1. **Studio**: outliner, inspector (descriptor-driven modules for every component), gizmos (W/E/R, snap, local/world), duplicate/delete/lock/hide, Ctrl+K palette, Tape (history seismograph with revert), Crew Channel (radio log + directives), agent beacons in the viewport, gallery, design panel, play mode (Ctrl+P), **Host online**.
2. **MCP for agents**: outline, get_entities, apply, undo, history, selection, status, directives, capture (agents see the viewport), playtest, schema, projects/starters/create/open, game_settings, database (+lint), brief/ask/brief_update, sessions.
3. **Gameplay framework** (`scene.database`): stats with layered reversible modifiers (well-known: `health`, resources, `armor`, `power`, `move_speed`, `crit_chance`, `cooldown_reduction`), abilities (self/melee/ray/aoe, cost/cooldown/windup), statuses (tick, stacks, stun/root), progression (XP curve, skill points), trees (skill-points or item currency, ranks, prereqs, level gates), items (material/consumable/equipment/quest/currency), loot tables, loadout; `primaryAbility`/`secondaryAbility` bind attack buttons. HUD: ability bar (1–6), resource/XP bars, statuses, cast bar, **T** tree panel, **I** bag.
4. **Genre starters + interview**: rpg, mmorpg, adventure, fighting, racing, shooter. Each default build is proven playable (`test/starters.test.ts`). Embedded Producer = `claude-opus-5-5` via `client.messages.parse` + `zodOutputFormat`; credentials = saved BYOK key → env → SDK default chain; **auto-runs only with an explicit key** (no surprise billing); refusal → one client-side retry on `claude-opus-4-8`.
5. **Sample games** (regression fixtures, keep them passing): outpost-zero, hollow-vale, shardlands, iron-ring, dust-circuit.

### Known limitations (honest list)

- **No client-side prediction** in multiplayer (fine on localhost/LAN; heavy over the internet). Snapshots already carry `ack` for it.
- Daemon binds **127.0.0.1 only** (Host-header guarded); no auth on `/net` yet.
- `walk_to` and NPC movement are straight-line (**no navmesh**).
- Dialogue is linear per NPC (**no branching**); no save/load, audio, crafting/building, camera shake/hit-stop/particles.
- Fighter movesets and vehicle model are runtime constants (no per-character data yet).
- Greybox primitives only — **no asset pipeline** yet (GLB import, generation).
- Producer GDD is shown as plain pre-wrapped markdown (no renderer).
- Studio multi-select edits only via gizmo-less operations (inspector edits single entity).

---

## 5. Gotchas that cost time

- **PowerShell 5.1 corrupts UTF-8** when piping files through `Get-Content`/`Set-Content`. Use the edit tool or Node.
- **Bash heredocs in this harness** break on unbalanced apostrophes (e.g. "can't") inside inline `node -e`/heredocs. Put scripts in files.
- **Restart Vite** after adding deps/exports to workspace packages.
- **Rapier KCC** deadlocks when two kinematic cuboids overlap. Cars ignore each other in the controller and use soft separation instead (`moveVehicle`). Keep that pattern for any new kinematic actor type.
- Scene ids: entities `ent_lowercase_words`, database defs `lowercase_snake`; yaw 0 = −Z; rotations in degrees.
- `set_game`/`set_database` deep-merge objects but **replace arrays** (send full `objectives`/`loadout` lists).
- The workspace currently contains the owner's own test projects. Don't delete them.

---

## 6. Next phase: what the owner asked for (spec + acceptance criteria)

### 6.1 Agent team room: talk to the team, see their internal dialog, guide the build

Goal: replace the Crew Channel with a **Team Room** where the Director converses with agents, sees what each agent is thinking/doing, and steers.

- **Threads**: per-agent DM threads + a `#team` thread. Messages are typed (`message`, `thought`, `plan`, `question`, `result`) and persisted per project (`workspace/<id>/team.jsonl`).
- **Internal dialog**: add MCP tool `forge_think {text, kind: "thought"|"plan"|"progress"}` so any agent can publish reasoning and plan steps; skills must instruct agents to post brief thoughts at decision points. For **embedded** agents (the Producer and any future embedded builder), stream Claude's summarized thinking (`thinking: {type: "adaptive", display: "summarized"}`) into the thread live. **Be explicit in the UI** that external agents' private reasoning is only what they publish.
- **Plan cards**: an agent posts a plan (`forge_plan {steps[]}`); the Director can approve, edit, reorder, or reject steps; agents read decisions via `forge_team_inbox`. Directives become messages in `#team`.
- **Guidance controls**: pause/resume an agent (advisory flag agents must check via the inbox), "focus here" (selection → message), and @mentions.
- UI must follow the design language (it replaces the right-bottom panel; consider a wider dockable panel).
- **Accept when**: Director sends a message, agent receives it via MCP and replies; `forge_think` posts render live with agent color; a plan can be approved/rejected and the agent observes the decision; daemon integration test covers the round-trip; screenshot reviewed.

### 6.2 Scene activity awareness ("see when the user adds actors")

- Emit structured **scene activity events** from `ProjectStore.apply` (entity created/deleted/renamed/reparented/component added/removed, by whom) into the Team Room as compact system cards ("Director added *Watchtower* at 12, 0, −4").
- MCP tool `forge_activity {since?}` returns activity since a cursor so agents notice human changes; skills tell agents to check it between tasks and react when relevant (e.g. offer to populate a new tower with guards). Agent auto-react is opt-in per project setting.
- **Accept when**: adding an entity in the Studio shows an activity card, and `forge_activity` returns it to an agent; test covers both.

### 6.3 AI asset creation (beyond cubes, lights, etc.)

Two layers:
1. **AI prefabs (no external service)**: a prefab library in the database (new `prefabs` table: named, reusable entity subtrees with parameters). MCP tools `forge_prefab_create {name, entities}` (from an agent-composed subtree or the current selection) and `forge_prefab_place {prefab, position}`. Studio: an **Assets** panel (grid with generated thumbnails via an offscreen render, using the capture pipeline) plus "Describe an asset…" which creates a directive for agents to compose one from primitives. A skill section on composing good-looking prefabs.
2. **Generated 3D models (Tripo)**: follow `docs/FORGE_MASTERPLAN.md` §11. A provider adapter in the daemon (async job: submit → poll → download GLB into `workspace/<id>/assets/`), an **asset registry** with immutable versions + provenance (prompt, provider, cost), a new mesh source (`mesh.asset: assetId` alongside primitive shapes) loaded with GLTFLoader in `SceneSync`, and validation (size/triangle budget, bounds → auto collider box, scale normalization). The key is BYOK in `workspace/secrets.json` like the Claude key, never exposed. Studio: generation prompt + status + approve/reject in the Assets panel.
- **Accept when**: an agent creates a prefab, places it, and a playtest/capture shows it; with a Tripo key, a text prompt yields a GLB that renders in the Studio and play mode with a correct collider; without a key the UI explains how to add one; tests cover registry, validation and the prefab mutations (mock the provider).

**Ask the owner first:** whether he has a **Tripo API key** (or prefers another provider), and whether to push to a **remote GitHub repo** (local commits only so far).

---

## 7. Backlog after that (rough priority)

1. Logic graph (event → condition → action) for rules beyond the database; sandboxed TS scripts as escape hatch (ADR-003).
2. Game-feel pack: camera trauma shake, hit-stop, particle presets, damage numbers, accessibility toggles (spec in `forge-game-feel`).
3. Navmesh pathfinding + behavior trees/utility AI for NPCs (replace straight-line steering; keep playtest `walk_to`).
4. Multiplayer: client-side prediction + reconciliation, LAN/internet hosting with auth, interest management.
5. Save/load (versioned), branching dialogue, crafting/building, audio buses.
6. Studio: Playtest Lab (history of agent playtests, path traces), markdown rendering for the GDD, multi-select inspector edits, Game/Database panel with a visual skill-tree editor.
7. Export: standalone game build without FORGE credentials (`play.html` is the seed).

## 8. Definition of done (any task)

`pnpm verify` green · new behavior has tests (playtests for gameplay) · contracts versioned and inverses exact · Studio UI matches the design language (take a Playwright screenshot and look at it) · affected `forge-*` skills updated · README/ADR updated for architectural changes · no secrets or workspace data committed · a short summary of what changed and what's still not done.
