---
name: forge-adventure
description: Build action-adventure and exploration games in FORGE (starter "adventure", sample outpost-zero) — critical path with keys, doors and reach goals, secrets off the golden path, light puzzles from interactables and triggers, landmark-driven navigation. Use for Zelda-like, exploration or puzzle-adventure projects in FORGE.
---

# FORGE · action-adventure

Load `forge-game-builder` and `forge-level-design`. Theory: `gamedev:level-design`, `gamedev:puzzle`.

## Building blocks

- **Locks & keys**: pickup `grantsItem: "x_key"` + kinematic door `interactable {verb: open, requiresItem: "x_key"}` (slides along its local +X into the adjoining wall — leave wall room).
- **Goals**: `reach` objectives on trigger volumes (`collider {isTrigger: true, size}`); `interact` objectives on terminals/shrines (`verb: use`).
- **Ability gates** (abilities as keys): grant an ability on pickup via an equipment item with `grantsAbility`, then require its effect — e.g. a `knockback` ability to push a dynamic crate off a ledge.
- **Guides**: talk NPCs with 2–3 lines that point at the landmark, not at the answer.

## Structure

Hub → 3 spokes, each ending in a key; the keys open the final gate (collect objective `count: 3`). Each spoke teaches one idea, tests it, then rewards it. Place one optional secret per spoke (behind a dynamic crate, on a ledge ≤ 1 m, around a corner with a light leak).

## Puzzles that work in FORGE today

- Order puzzles: objective chain of `interact` steps (levers in sequence).
- Physical: dynamic crates (`rigidBody dynamic`, mass 20–60) the player pushes to bridge or block.
- Exploration: `reach` triggers on vantage points that reveal the next landmark.

Branching dialogue, switches that move platforms, and save points are future engine work — note them, don't fake them.

## Prove it

Full chain: every key → every door → final `reach`, then negative tests for each door. Capture from spawn: the first landmark must be visible.
