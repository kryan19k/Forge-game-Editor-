---
name: forge-game-feel
description: Make FORGE games feel responsive and punchy — layered feedback by importance tier using the knobs FORGE has today (windup telegraphs, hitstun, knockback, hit flashes, emissive accents, lights, timing), plus what to request when a game needs camera shake, hit-stop or particles. Use when actions are mechanically correct but feel weak or floaty.
---

# FORGE · game feel

Load `forge-game-builder` first. Theory (read it): `gamedev:game-feel` and its `references/feedback-recipes.md` — the core principle is **5–8 small responses within ~100 ms, scaled by importance, always returning to rest**.

## Importance tiers → FORGE knobs

| Tier | Examples | FORGE today |
|---|---|---|
| Small | pickup, footstep, UI tick | pickup spin/bob (automatic), emissive 2–3 on the item, feed line |
| Medium | normal hit, ability land | knockback 3–5 m/s, hitstun ~0.2 s, target flash + squash (automatic on `hit`), status chip |
| Large | crit, heavy, kill, boss hit | knockback 6–8, hitstun 0.35–0.45, heavy windup 0.3 s (the anticipation *is* the feel), loot + level-up feed, matching point light pulse |

Rules that carry over directly:
- **Anticipation sells impact**: heavy/boss attacks need a visible windup (0.3–0.6 s). Telegraph enemy attacks ≥ 0.3 s so players feel smart when they dodge/block.
- **Recovery must be short**: light-attack cooldown 0.3–0.45 s; never lock input longer than the hitstun you dealt.
- **Knockback reads as weight**: light 3, heavy 6–8 m/s; bosses take ×0.5 (give them higher HP, not immunity).
- **Juice returns to rest**: emissive pulses and lights that stay on become the new normal.

## Feel by genre (FORGE settings)

- **Action RPG**: `attackCooldown` 0.4–0.5, `damage` so standard enemies die in 3–4 hits; abilities windup 0.15–0.3.
- **Shooter**: primary `ray` ability windup 0, cooldown 0.12–0.2 (arcade) / 0.25–0.35 (tactical); TTK of a standard enemy 0.6–1.2 s; grenade windup 0.3–0.4, knockback 8.
- **Fighting**: the built-in frame data already follows these rules (light 0.10 s windup, heavy 0.30 s). Tune HP for round length (90–120 s rounds ≈ 100 HP).
- **Racing**: speed feel comes from the chase camera FOV widening with speed (automatic) and wide-open straights; keep corners readable with emissive cones/barriers.

## When FORGE doesn't have the effect yet

Camera trauma shake, hit-stop/freeze frames, particle bursts, damage numbers, audio and accessibility toggles (reduce shake/flash) are **not in the runtime yet**. Don't fake them with geometry. Note them in the plan as "game-feel pack" engine requests with the tier table above as the spec (trauma 0.15 / 0.4 / 0.8, hit-stop 0.04 / 0.06 / 0.12 s).

## Verify

Feel is judged by watching: `forge_capture` mid-fight is weak evidence. Ask the Director to play (Ctrl+P) after a feel pass and give the specific thing to judge ("does the heavy feel heavier than the light?").
