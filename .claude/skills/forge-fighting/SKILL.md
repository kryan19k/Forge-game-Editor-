---
name: forge-fighting
description: Build and tune 2.5D fighting games in FORGE (template iron-ring) — fighter controller, side camera, rounds/KO rules, arena construction, frame-data style tuning, and playtests with the sparring bot. Use when making or editing a fighting/brawler game in FORGE.
---

# FORGE · Fighting

Load `forge-game-builder` first. For feel (hit-pause, screen shake, juice) see `gamedev:game-feel`; for the camera see `gamedev:camera-systems`.

## What the runtime gives you

- `controller: "fighter"`, `camera: "side"`, `win: "ko"`, `rounds` (best of N), `bots: 1` (a sparring bot fills the second seat and gives it up when a second human joins).
- Fighters are locked to the **X axis** at their spawn's Z; they auto-face the nearest opponent.
- Moves (fixed for now — tune the arena and HP around them):

| Move | Damage | Reach | Windup | Recovery/cooldown | Knockback | Hitstun |
|---|---|---|---|---|---|---|
| Light (J / click) | 7 | 1.6 m | 0.10 s | 0.36 s | 3 m/s | 0.24 s |
| Heavy (K / right-click) | 16 | 1.95 m | 0.30 s | 0.85 s | 7 m/s | 0.45 s |
| Block (hold L) | takes 20% damage, 35% knockback; can't move or attack while blocking | | | | | |

- Round flow: intro (1.6 s "Ready → Fight"), fight, KO pause (2.2 s), reset positions + health. `game.player.health` is fighter HP (100 → ~10 lights or ~6 heavies).

## Arena construction

- Platform ~18 × 8 m, top at y = 1. Spawns at x = ±3, facing each other (`yaw −90` for the left fighter, `90` for the right), teams `p1`/`p2`.
- **Solid end walls** (thin colliders at x ≈ ±8.8) — without them fighters get knocked off the stage.
- Lighting sells the genre: one hard top spot (castShadow) + two colored rim point lights (one per side, matching the fighters' HUD colors), dark fogged background, silhouette crowd.

## Tuning with playtests

The bot blocks ~45% of telegraphed attacks and retreats when low; `autopilot` uses the same brain for the player, so autopilot-vs-bot is an even mirror match — use it to prove rounds resolve, not to prove balance.

```json
{ "name": "Rounds resolve", "steps": [
  { "do": "wait_until", "check": { "kind": "event", "event": "round_start" }, "timeout": 5 },
  { "do": "autopilot", "seconds": 200, "until": { "kind": "event", "event": "round_end" } } ] }
```

To check a specific interaction: `teleport` the player next to the bot, `attack {heavy: true}`, then `expect event hit`.

Not yet: per-character movesets, combos/cancels, specials, hit-pause, juggles, a training-mode frame display. Propose a `fighter` component (moveset table) when the user wants distinct characters.
