---
name: forge-level-design
description: Design and build FORGE levels that play well — player metrics derived from FORGE's actual controller constants, blockout → playtest → dress, critical path and gating with soft-lock proofs, pacing beats as objectives and encounters, readability with landmarks and light. Use when laying out or reworking any space in a FORGE game.
---

# FORGE · level design

Load `forge-game-builder` first. Theory and checklists: `gamedev:level-design` (+ its `references/pacing-and-flow.md`). This skill gives you FORGE's real numbers and the tools to prove a layout.

## 1. Metrics (FORGE character controller, defaults)

| Metric | Value | Derived from |
|---|---|---|
| Capsule | radius 0.35 m, height 1.8 m | controller |
| Walk / sprint | 4.2 / 7.0 m/s | `game.player.walkSpeed/sprintSpeed` |
| Jump apex | ≈ 1.18 m | v²/2g = 7.2²/(2·22) |
| Air time | ≈ 0.65 s | 2v/g |
| Running gap (sprint) | ≈ 4.5 m max → **design 3.2 m safe**, 4.2 m hard | 7.0 × 0.65 × 0.7 / 0.95 |
| Walking gap | ≈ 2.7 m max → design 1.9 m | 4.2 × 0.65 |
| Auto step | 0.4 m (no jump needed) | KCC autostep |
| Walkable slope | ≤ 50° | KCC |
| Interaction reach | 2.6 m from eye | sim |
| 3rd-person camera | 4.3 m boom + 0.55 m shoulder | PlaySession |

Design rules from those: corridors ≥ **3 m** wide (camera + capsule), doors ≥ **2.4 × 2.6 m**, ceilings ≥ 3.5 m indoors, ledges you want climbable ≤ 1.0 m, gaps players must cross ≤ 3.2 m. If the Director changes jump/speeds, recompute these before touching geometry.

## 2. Blockout → prove → dress

1. **Blockout** with `solid` boxes and primitive props only; correct scale; no decoration.
2. **Prove** the critical path with `walk_to` chains; `walk_to` steers straight, so a "stuck … path is blocked" note is a real layout finding (or add an intermediate waypoint entity to route around on purpose).
3. **Iterate** until the full chain passes, then **dress**: materials, emissive accents, lights, props with no collider where they shouldn't block.

## 3. Critical path, gating, soft-locks

- Gate with `interactable {verb: open, requiresItem}` doors (kinematic), item pickups, `reach` triggers, and objective order.
- For every gate write **two** playtests: the positive path (key → door opens) and the negative (no key → `interact_blocked`, can't `walk_to` past).
- Keys must be obtainable *before* their door on the critical path — a key behind its own door is the classic soft-lock; the negative test catches it.

## 4. Pacing as data

Write the level as beats before building it, then implement each beat as entities + an objective:

| Beat | Intensity | FORGE implementation |
|---|---|---|
| Arrival / teach | 0.1 | spawn facing a landmark; a talk NPC sets the goal |
| First test | 0.4 | 2–3 fodder enemies, wide space, retreat room |
| Breather + reward | 0.1 | pickup/loot, warm light, a vista of the next goal |
| Escalation | 0.7 | mixed enemy types, a gate, less space |
| Climax | 1.0 | elite (HP ×3–4) near the landmark, objective `defeat` |
| Resolution | 0.2 | return-to-NPC `interact` step, final dialogue line |

Intensity should rise in a sawtooth, never flatline high.

## 5. Encounter geometry

- Keep NPC `wanderRadius` circles off the paths players must walk unless the encounter is intended; leave ≥ `aggroRadius` + 3 m of safe approach so players choose when to engage.
- Hostile packs of 2–4; space packs so at most one pack aggroes at a time on the golden path.
- Cover/obstacles ≥ 1.2 m tall to block; low props (≤ 0.4 m) get stepped over — don't use them as walls.

## 6. Readability

Players follow **light, color and landmarks**: one tall emissive landmark (+ point light, range 15–20) visible from spawn toward the goal; warm light for safety, cool/colored light for danger; emissive intensity 2–6 on interactables. Verify with `forge_capture {view: "current"}` from the spawn: can you see where to go?
