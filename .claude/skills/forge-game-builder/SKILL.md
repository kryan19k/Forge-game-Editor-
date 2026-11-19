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
5. `forge_status(idle, "<result>")`; check `forge_directives`; answer the Director's directives with a one-line result.

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

Meters, Y-up, right-handed; rotations Euler XYZ **degrees**; yaw 0 faces **−Z**, yaw −90 faces +X. Entity ids `ent_lowercase_words` (choose them so one transaction can create parents and children). Def ids `lowercase_snake`. Unit primitives scale by `mesh.size` (diameter for round shapes); a box of height h on the ground sits at `y = h/2`.

## Efficiency rules (tokens, time, Director attention)

- Batch related mutations into one transaction (create a whole encounter at once); don't drip-feed 20 single edits.
- Read narrowly: `forge_get_entities` for the few you'll touch, not the whole outline every step.
- Playtest the smallest script that proves the change; keep a full-chain regression for the end.
- Capture only after visual changes; `overview` for layout, `focus` for detail.
- Ask the Director (`forge_ask`) only for decisions only they can make; never for things a playtest can answer.
