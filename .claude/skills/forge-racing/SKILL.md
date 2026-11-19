---
name: forge-racing
description: Build and tune arcade racing games in FORGE (template dust-circuit) — track construction with barrier walls, checkpoint ordering, grid spawns, vehicle tuning, AI rivals, and autopilot playtests proving a track is completable. Use when making or editing a racing/driving game in FORGE.
---

# FORGE · Racing

Load `forge-game-builder` first. For handling feel see `gamedev:physics-tuning` and `gamedev:game-feel`.

## What the runtime gives you

- `controller: "vehicle"`, `camera: "chase"`, `win: "race"`, `laps`, `bots` (AI rivals; they give their grid slot to joining humans).
- Arcade car: `game.vehicle {maxSpeed 34 m/s, acceleration 16, braking 28, turnRate 2.1 rad/s}`. Steering authority fades in below ~9 m/s and softens at top speed; scraping a wall costs ~40% speed. Cars bump each other softly (never lock together).
- 3-second countdown freezes the grid. Place = laps, then checkpoints passed, then distance to the next checkpoint.

## Building a track

1. **Barriers**: solid boxes (height ~1.2 m) on both sides. Keep the drivable width ≥ 12 m (14 m is comfortable for 4 cars).
2. **Checkpoints**: trigger boxes (`collider {shape: box, size, isTrigger: true}` + `checkpoint {order}`) spanning the full track width. `order 0` is start/finish. Put one **at every corner** plus one mid-straight — the AI drives checkpoint to checkpoint (aiming 20% toward the following one), so a missing corner checkpoint makes it cut into the wall.
3. **Grid**: `spawnPoint`s just *behind* checkpoint 0, staggered 6–7 m, all facing the driving direction (yaw −90 faces +X).
4. Track surface is visual (a thin box/plane); the ground collider underneath carries the cars. Avoid steps > 0.3 m on the racing line.

## Prove it is drivable

```json
{ "name": "Track is completable", "steps": [
  { "do": "autopilot", "seconds": 400, "until": { "kind": "race_finished" } },
  { "do": "expect", "check": { "kind": "lap", "count": 3 } } ] }
```

Read the report: lap times per racer appear as `lap` events. A lap more than ~2× slower than the others means a car got stuck — capture `top` view, find the corner, widen it or add a checkpoint at its apex. Also check the countdown: `drive 1.5s` then `expect near ent_grid_1 within 0.5`.

Tuning targets: lap 15–25 s for a short stadium; AI should finish within ~10% of each other. Faster `maxSpeed` needs wider corners or higher `turnRate`.

Not yet: drifting/handbrake, boost pads, surface friction types, rubber-banding, ghost laps. Propose them as milestones.
