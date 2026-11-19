---
name: forge-shooter
description: Build third-person shooters in FORGE (starter "shooter") — weapons as abilities bound to the attack buttons, ammo as a resource, time-to-kill tuning, waves via respawning hostiles, arena cover layout, PvP free-for-all. Use when making or tuning any shooting game in FORGE.
---

# FORGE · shooter

Load `forge-game-builder` and `forge-gameplay-systems`. Theory: `gamedev:fps-shooter` (+ `references/shooting-and-feel.md`). FORGE today is **third-person**; first-person camera, spread/recoil patterns and headshots are future engine work — design TTK and positioning around that.

## Weapons are abilities

- Primary fire: `target: "ray"`, `windup: 0`, range 30–50, cost 1 `ammo`, bound with `set_game {patch: {player: {primaryAbility: "rifle"}}}` (click / J).
- Secondary: grenade-style `aoe` radius 4–5, windup 0.3–0.4, knockback 8, bound to `secondaryAbility` (right-click / K).
- Ammo: a `resource` stat (`ammo`, base 24–40, regen 4–8/s ≈ auto-reload) — or regen 0 + ammo pickups (`consumable` with `restore {stat: ammo}`).
- More weapons = more abilities on bar slots 1–6; swap the bound primary per class via loadouts.

## Time-to-kill (the core knob)

TTK = HP ÷ (damage × shots/s). Targets: arcade 0.6–1.0 s, tactical 1.0–1.6 s for standard enemies; PvP player-vs-player 1.2–2.0 s so fights are readable. Example: drone 30 HP, rifle 9 dmg at 0.18 s cooldown → 4 shots ≈ 0.72 s.

## Waves and modes

- **Waves (co-op)**: hostile NPCs with `respawnSeconds` 8–15 near spawn rings outside cover; objective `defeat #drone N`; raise pressure by adding packs, not HP.
- **Free-for-all**: `game.pvp: true`, `win: none`, `maxPlayers` 8, multiple spaced spawns; `respawnSeconds` 3.

## Arena layout

Ring of cover (boxes ≥ 1.2 m tall, 2.5–3.5 m wide), 2–3 lanes into the center, a landmark at center for orientation, spawns at the edge facing inward. Sightlines ≤ weapon range; at least one flank route per lane. Prove with `autopilot until defeated #drone 6` and `expect health_above 20`.
