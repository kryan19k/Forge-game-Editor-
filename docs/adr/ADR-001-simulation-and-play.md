# ADR-001 · One simulation, three hosts

**Status:** accepted · 2026-11-19

## Context
The master plan wants play-in-editor, automated browser playtesting, and (later) multiplayer. Building those as three separate code paths guarantees drift: the game the agent tests would not be the game the player plays.

## Decision
- Gameplay lives in **`GameSimulation`** (`packages/game-runtime/src/sim`): physics (Rapier 0.21 compat/WASM), a kinematic character controller, and the gameplay rules derived from typed components. It imports `three` for math only — no renderer, no DOM.
- It runs at a **fixed 60 Hz** step and is **deterministic** for identical inputs. Input is a plain `PlayerInput` record (move, sprint, jump/interact edges, yaw), so a script, a keyboard, or a network packet are interchangeable.
- Hosts:
  1. **Studio play mode** — `PlaySession` renders the sim with its own scene graph and third-person camera, borrowing the editor's renderer/canvas. The authoring scene is never mutated.
  2. **Headless playtests** — `runPlaytest(doc, script)` executes typed `PlaytestScript`s (walk_to, interact, expect …) synchronously, ~40× real time. Exposed to agents as `forge_playtest` and used as CI tests (`outpost-zero.playtest.test.ts` is the template's definition of done).
  3. **Multiplayer server (future)** — the same sim becomes the authoritative server loop; `PlayerInput` is the wire format; `network` component intent decides replication.
- `walk_to` uses straight-line steering with stuck detection. It is deliberately naïve: "stuck" is a useful finding (blocked path), not a test-harness bug. Navmesh pathing comes with NPC AI.

## Consequences
- An agent can prove "the keycard opens the hub door" without a browser, in a quarter second.
- Rendering-only bugs still need the Studio (`forge_capture`); gameplay bugs don't.
- Rapier determinism is per-platform; cross-platform lockstep is not promised. Server authority (not lockstep) is the multiplayer model.
