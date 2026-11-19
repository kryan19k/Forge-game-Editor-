---
name: forge-rpg
description: Build and extend RPGs in FORGE (starter "rpg", sample hollow-vale) — quest chains, talking NPCs, hostile NPC combat, classes/abilities/skill trees/loot via the gameplay database, and playtests that prove a quest is completable. Use when making or editing an RPG/action-RPG in FORGE.
---

# FORGE · RPG

Load `forge-game-builder` first for the workflow. For deeper design (XP curves, damage formulas, branching dialogue) see `gamedev:rpg` and `gamedev:dialogue-systems`; this skill is how those ideas map onto FORGE today.

## What the runtime gives you

- **Controller** `character`, camera `third_person`, win `objectives`.
- **Combat**: player light attack (click) / heavy (right-click, 1.8× damage, slower). Tune `game.player.damage`, `attackRange`, `attackCooldown`, `health`.
- **NPCs**: `npc` component. Friendly + `interactable {verb: talk}` + `dialogue` lines → each talk advances one line (last line repeats). When the final quest step completes on that NPC they deliver their **last** line — write it as the quest's closing beat.
- **Hostiles**: `npc.hostile`, `health`, `combat {damage, range, cooldown}`. They wander near home, aggro inside `aggroRadius`, chase at 1.3× speed, telegraph attacks (0.35 s windup), and leash home beyond ~2.5× aggro.
- **Quests**: `game.objectives` is an ordered chain; only the first unfinished step is active. Kinds: `interact` (talk/use entity), `collect` (item count across players), `defeat` (entity id or `#tag`, counts kills even before the step activates), `reach` (enter a trigger entity).

## Recipe: add a side quest

One transaction:
1. Quest giver NPC (`capsule` 0.7×1.8×0.7, distinct color, `npc.idle`, 3–4 dialogue lines: hook → instruction → reminder → thanks).
2. The objective content (pickups with `grantsItem`, or hostiles tagged e.g. `#bandit`).
3. `set_game` with the **full** objectives list (arrays replace) — append steps after the main chain or interleave deliberately.

Then a playtest that walks the whole chain and ends with `expect objective_done` and `expect match won`.

## Encounter tuning (start here, adjust by playtest)

| Enemy | HP | Damage | Cooldown | Speed | Aggro |
|---|---|---|---|---|---|
| Fodder (slime, rat) | 25–35 | 4–6 | 1.2–1.4 s | 1.6–2.0 | 5–6 m |
| Standard (wolf, bandit) | 40–60 | 7–10 | 1.0–1.2 s | 2.2–2.6 | 7–8 m |
| Elite | 120–200 | 14–20 | 1.4 s | 2.0 | 10 m |

Player defaults: 100–150 HP, 12–14 damage, 0.45 s cooldown → a standard enemy dies in 3–4 hits. Two standard enemies at once should leave a careful player above ~40% HP: assert it with `expect health_above`.

## Level layout

- Hub (safe, warm light, NPCs) → path → wild zone (cooler light, enemies) → return. Put the quest giver within sight of the spawn.
- Keep pickups ≥ 4 m from enemy homes so collection and combat are distinct beats, or deliberately guard them.
- Space wanderers so their `wanderRadius` circles don't overlap paths the player must walk.

## Prove it

```json
{ "name": "Side quest: bandit camp", "steps": [
  { "do": "walk_to", "entityId": "ent_captain", "stopDistance": 1.8 }, { "do": "interact" },
  { "do": "autopilot", "seconds": 90, "until": { "kind": "defeated", "target": "#bandit", "count": 3 } },
  { "do": "expect", "check": { "kind": "health_above", "value": 30 } },
  { "do": "walk_to", "entityId": "ent_captain", "stopDistance": 1.8 }, { "do": "interact" },
  { "do": "expect", "check": { "kind": "objective_done" } } ] }
```

## Character growth (gameplay framework)

Classes, spells, skill trees, XP/levels, gear and loot are database data — load `forge-gameplay-systems` for the formulas and tuning tables. RPG recipe:
- Stats `health` (resource, perLevel 10–12), `mana`/`energy` (resource, regen), `power`, `armor`, `move_speed`.
- 3–4 starting abilities on the bar (one spammable ray/melee, one heal, one AoE behind a tree node); `primaryAbility` for caster builds.
- One tree per class/path (5–8 nodes, capstone behind level 5); `loadout.trees` limits which a player sees.
- Hostiles get `unit {xp, loot, level}`; loot tables with a weighted "nothing" entry; currency + consumables.
- `progression.enabled: true`, xpBase 50–100, growth 1.3–1.4.
In-game the player opens the tree with **T** and the bag with **I**.

Not yet in the runtime (say so rather than faking it): branching dialogue choices, shops/vendors that trade, crafting, save/load. Propose them as next milestones.
