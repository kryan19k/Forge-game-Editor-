---
name: forge-qa-playtesting
description: Test FORGE games like a QA lead — the test pyramid (database lint → headless playtests → visual captures → human play), positive + negative scripts for every gate, autopilot completability proofs, regression chains, determinism, and diagnosing failures ("stuck", "nothing in reach", "on cooldown"). Use whenever you finish a change, before saying something works, or when a playtest fails.
---

# FORGE · QA & playtesting

Load `forge-game-builder` first.

## The pyramid (cheap → expensive)

1. **Data**: `forge_database` lint must be empty (dangling refs, unreachable tree nodes).
2. **Behavior**: `forge_playtest` scripts — deterministic, ~40× real time, the source of truth for "it works".
3. **Looks**: `forge_capture` overview/focus/current-from-spawn.
4. **Feel**: ask the Director to play (Ctrl+P / Host online) with one specific question.

## Scripts that prove things

- **Every gate gets two tests**: positive (has key → door opens → reach goal) and negative (no key → `interact_blocked`; `walk_to` beyond the door fails).
- **Completability**: `autopilot {until}` hands the player to the built-in AI (hostile hunter, racing line, sparring bot) — if autopilot can't finish, players will struggle.
- **Balance**: end fights with `expect health_above` and `expect level atLeast`; time-to-kill shows in the report timestamps.
- **Data features**: `cast`, `command {unlock|equip|use}` with `expectFail` for gated nodes; `expect stat/has_ability/status`.
- **Regression chain**: keep one full-loop script per project (spawn → every objective → `objective_done` → `match won`) and re-run it after every milestone.

## Reading failures

| Note | Meaning | Usual fix |
|---|---|---|
| `stuck at x,y,z — path is blocked` | straight-line steering hit geometry | it's real: widen/route; or add an explicit waypoint walk |
| `timed out N m from target` | target moves (NPC) or too far | raise timeout, `sprint: true`, or approach in steps |
| `nothing in reach to interact with` | > 2.6 m, or facing away, or NPC hostile | lower `stopDistance`, `face` first |
| `blocked: Requires X` | gate working as designed | (negative test passes) |
| `on cooldown` / `not enough Mana` | cast timing | `wait` ≥ cooldown; check costs vs regen |
| `gave up after Ns — …` | autopilot couldn't reach the condition | encounter too hard/far — check health in report, tune |
| `objective open: id k/n` | chain step not satisfied | check target id / `#tag` spelling, count |

Fail fast is deliberate: fix the first failing step, re-run; don't loosen assertions to get green.

## Determinism

Same scene + script + `game.seed` ⇒ same report. A flaky result means the scene changed between runs (check revision in the report header) — not randomness.
