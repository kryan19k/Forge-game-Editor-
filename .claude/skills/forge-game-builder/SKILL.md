---
name: forge-game-builder
description: Core playbook for building ANY game in FORGE through the forge_* MCP tools — the transaction workflow, the component/system catalog, game settings, the gameplay database, the playtest-first loop, and which specialist skill to load next. Load this first for any work on a FORGE project.
---

# FORGE game builder

FORGE is an engine where agents are the primary developers: a human **Director** watches the Studio while you edit the same project through typed, validated, undoable transactions. Think Unity/Unreal, but every operation is an API you can call and every claim you make can be proven by a headless playtest.

## The loop (always)

1. `forge_status(working, "<intent>", [focus ids])` — announce before you touch anything.
2. Read: `forge_scene_outline`, `forge_game_settings`, `forge_database`, `forge_brief` (if the project came from a genre interview).
3. Change: `forge_apply` — one transaction per logical change, a label a human would write, and `baseRevision`. On `CONFLICT`, re-read and redo. Never touch `LOCKED` entities.
4. **Prove it**: `forge_playtest` for behavior, `forge_capture` for looks, `forge_database` lint for data. A gameplay claim without a passing playtest is not done.
5. Read `forge_team_inbox` before starting and between tasks. Track its cursor per project and read all pages. If paused, stop starting work and wait for the Director to resume. Reply with `forge_team_message` and use `thread: "dm"` for your direct conversation. Use `@agent-id` to mention a teammate.
6. Check `forge_activity` between tasks. Store its returned cursor per project and use it as `since` on the next call. Read subsequent pages while `hasMore` is true. If `truncated` is true, refresh the scene outline to regain context. Offer unsolicited follow-ups only if the Director enabled `settings.autoReact`. For example, offer to populate a new watchtower with guards and wait for direction before editing.
7. Use `forge_think` at decision points to share a short decision summary, tradeoff or progress update. Use `forge_plan` for ordered proposals that need approval, then read the Director's edits and decisions in the inbox and carry out approved steps in their reviewed order. Claim and close assigned work via `forge_directive_update`. Use `forge_status(idle, "<result>")` when done.

## Load the right specialist skill

| Task | Skill |
|---|---|
| New game, interview, GDD, scope | `forge-game-design` |
| Stats, abilities, skill trees, items, loot, balance | `forge-gameplay-systems` |
| Layout, metrics, pacing, gating, encounters | `forge-level-design` |
| Making actions feel good | `forge-game-feel` |
| Frame rate, sim cost, bandwidth | `forge-performance` |
| Test strategy, regression scripts, diagnosing "stuck" | `forge-qa-playtesting` |
| Genre specifics | `forge-rpg`, `forge-mmo`, `forge-adventure`, `forge-shooter`, `forge-fighting`, `forge-racing` |

Engine-neutral theory lives in the user's `gamedev:*` skills (`gamedev:rpg`, `gamedev:level-design`, `gamedev:game-feel`, `gamedev:game-ai`, `gamedev:performance-optimization`, …). Use them for *why*; use the FORGE skills for *how here*.

## How FORGE is built (what you can change)

- **Entities + closed component set** (`forge_schema {component}` for fields): `mesh`, `light`, `collider`+`rigidBody`, `interactable` (pickup/open/use/talk/inspect), `npc` (AI brain, dialogue, respawn), `health`, `combat`, `unit` (NPC gameplay profile: stats, abilities, loot, xp, level), `spawnPoint`, `checkpoint`, `network`.
- **Game settings** (`scene.game`, `set_game`): genre, controller (`character` | `vehicle` | `fighter`), camera, win rule (`objectives` | `race` | `ko` | `none`), maxPlayers, bots, laps, rounds, pvp, respawn, seed, player tuning (incl. `primaryAbility`/`secondaryAbility` bound to the attack buttons), vehicle tuning, and the **quest chain** (`objectives`: interact / collect / defeat / reach).
- **Gameplay database** (`scene.database`, `upsert_def` / `remove_def` / `set_database`): stats & modifiers, resources, abilities, statuses, progression trees, items, loot tables, XP curve, starting loadout. This is how you add skill trees, classes, weapons, spells, crafting currencies, talents — data, not code.
- **Multiplayer**: every project is server-authoritative-ready; `forge_sessions {host: true}` runs it for real.

When a request needs something none of these express (a new rule, a new controller, branching dialogue), say so plainly, build the closest faithful version, and name the missing engine feature in your status/plan. Never fake a mechanic with geometry tricks the sim can't back.

## Conventions

### Compose reusable prefabs

- Use a single root at the model's placement pivot, typically the center of its footprint at ground level. Parent the parts to that root and use local positions and rotations for each part.
- Establish a readable silhouette with a few large shapes before adding trim. Use a restrained set of material colors and reserve emissive accents for details that carry meaning. Author collision on the parts players touch and avoid per-detail colliders.
- Call `forge_prefab_create` with `name` and typed `entities`, or omit `entities` to save the Director's selected subtree. Expose variations using `parameters` entries with `id`, `label`, `entityId`, and `kind` (`name` or `albedo`).
- Use `forge_prefab_place` with the returned `prefabId` as `prefab` and a world `position`. Optional `parameters` maps parameter IDs to strings. Placement creates an independent copy. Use `forge_capture` to inspect it and `forge_playtest` to verify collision or interactions.

### Place generated models

- Ask the Director to generate and approve a model under **Assets → Generated models**. Share the prompt and its intended gameplay use in Team Room. Paid submission and version review happen in Studio.
- Use `forge_assets` to find the approved version, then `forge_asset_place {asset, position, meters}`. `position` is the ground point and `meters` sets the model's longest axis. Version IDs pin the exact GLB.
- FORGE fits a box collider from the model bounds. For arches, walkable openings, or irregular surfaces, author separate simple colliders and verify them with a playtest. The GLB retains its authored materials. The pipeline accepts static models, so use the existing runtime actors for animated gameplay.

Meters, Y-up, right-handed; rotations Euler XYZ **degrees**; yaw 0 faces **−Z**, yaw −90 faces +X. Entity ids `ent_lowercase_words` (choose them so one transaction can create parents and children). Def ids `lowercase_snake`. Unit primitives scale by `mesh.size` (diameter for round shapes); a box of height h on the ground sits at `y = h/2`.

## Efficiency rules (tokens, time, Director attention)

- Batch related mutations into one transaction (create a whole encounter at once); don't drip-feed 20 single edits.
- Read narrowly: `forge_get_entities` for the few you'll touch, not the whole outline every step.
- Playtest the smallest script that proves the change; keep a full-chain regression for the end.
- Capture only after visual changes; `overview` for layout, `focus` for detail.
- Ask the Director (`forge_ask`) only for decisions only they can make; never for things a playtest can answer.
