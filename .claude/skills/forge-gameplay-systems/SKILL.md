---
name: forge-gameplay-systems
description: Author and balance FORGE's gameplay framework — stats & modifiers, resources, abilities, status effects, skill/talent/tech trees, items, equipment, loot tables, XP curves, NPC units — via upsert_def / set_database, with the runtime's exact formulas and playtest checks. Use whenever a game needs classes, spells, weapons, skill trees, progression, loot or balance.
---

# FORGE · gameplay systems

Load `forge-game-builder` first. Theory: `gamedev:rpg` (stats, damage, XP), `gamedev:survival-crafting` (tech trees, needs), `gamedev:card-game` (effect resolution). This skill is how those map onto FORGE's database.

## Editing

```json
{ "op": "upsert_def", "table": "abilities", "def": { "id": "chain_spark", "name": "Chain Spark", "target": "ray", "range": 16, "windup": 0.25, "cooldown": 2, "cost": [{ "stat": "mana", "amount": 12 }], "effects": [{ "kind": "damage", "amount": 22, "scaling": { "stat": "power", "factor": 0.6 } }, { "kind": "apply_status", "status": "shocked" }] } }
```
Tables: `stats`, `abilities`, `statuses`, `trees`, `items`, `loot`. `remove_def {table, id}`. `set_database {patch: {progression, loadout}}`. Upserts replace the whole def — send every field you want kept. After any batch, `forge_database` and fix every lint line (dangling ids, unreachable tree nodes) before playtesting. Create referenced defs first in the same transaction (status before the ability that applies it).

## The runtime's exact math (design to it)

- **Stat value** = override ?? (base + Σadd) × (1 + Σmul), clamped to [min, max]. Sources: level-ups (`perLevel`), tree ranks, equipment, active statuses (× stacks). Base is never mutated.
- **Well-known stats** the engine reads: `health` (resource → max HP), any other `resource: true` stat (mana/energy/ammo/stamina: spent by ability `cost`, refilled by `regen`/s), `armor` (incoming × 100/(100+armor): 100 armor halves damage), `power` (+% outgoing damage), `move_speed` (% of walk speed, base 100), `crit_chance` (0–100, ×1.5), `cooldown_reduction` (0–60%). Any other stat is custom: use it in `scaling` (e.g. `{stat: "strength", factor: 0.8}`).
- **Damage** = (amount + scalingStat × factor) × (1 + power/100) × crit × armor factor, rounded once. Basic melee uses `game.player.damage` through the same power/armor pipeline.
- **XP to next level** = xpBase × xpGrowth^(level−1). Kills grant `unit.xp` or `defaultKillXp × unit.level`. Level-up: +`pointsPerLevel` skill points, +`perLevel` stats, full refill.
- **Abilities**: cost and cooldown are paid at cast start; effects land after `windup`; casting slows movement to 40%. `target`: `self`, `melee` (arc°, range), `ray` (first target along aim within range), `aoe` (radius around caster). Harmful abilities hit enemies; purely beneficial ones (heal/restore/positive status) hit self + allies.
- **Statuses** refresh duration on reapply and stack to `maxStacks`; `tick` effects fire every `tickEvery` s × stacks; `stun` blocks actions, `root` blocks movement.

## Proven starting numbers

| Thing | Start here | Why |
|---|---|---|
| Player HP | 100–150 | 8–12 standard hits to die — room to react |
| Standard enemy | HP 40–60, dmg 7–10, cd 1.0–1.2 s | dies in 3–4 player hits |
| Main ability | cd 1–2 s, cost ≈ 15% of resource pool | spammable but not free |
| Big ability | cd 6–12 s, cost 25–35% | a decision, not a reflex |
| Enemy windup | ≥ 0.3 s | readable telegraph |
| Resource regen | pool ÷ 15–20 per s | ~one main cast per second sustained |
| XP curve | xpBase 50–100, growth 1.3–1.4 | level 2 in ~2 fights; level 10 ≈ 30–40 min |
| Crit | 5–15% chance (×1.5 fixed) | spice, not a build-breaker |
| Armor | 0–30 early, ≤150 late | ratio formula never reaches immunity |

## Trees that create choices

- 5–8 nodes for a first tree; 2–3 branches; **cheap ranked nodes** (+8 power ×3) at the root, an **ability unlock** mid-tree, a **capstone** behind `requiresLevel` and two prerequisites (cost 2).
- Every node needs a `pos` (grid units) — x = branch, y = tier — so the Studio and in-game tree render cleanly.
- `currency: "item"` + `currencyItem` turns a tree into a tech/crafting tree (e.g. paid in `scrap`).
- Lint flags unreachable nodes (circular prereqs) — a soft-lock in data.

## Items & loot

- `kind`: material, consumable (`use` effects), equipment (`slot` + `modifiers`, optional `grantsAbility`), quest, currency. Rarity colors the UI.
- Loot tables: weighted entries, `rolls`, min/max counts; add an entry **without** `item` to model "nothing" (weight it ~25–40%). Attach to NPCs via `unit.loot`.
- Starting kit: `set_database {patch: {loadout: {abilities, items, trees}}}`. Bind click to a ranged/caster main attack with `set_game {patch: {player: {primaryAbility: "<id>"}}}`.

## Prove the balance

```json
{ "steps": [
  { "do": "autopilot", "seconds": 90, "until": { "kind": "defeated", "target": "#bandit", "count": 3 } },
  { "do": "expect", "check": { "kind": "health_above", "value": 30 } },
  { "do": "expect", "check": { "kind": "level", "atLeast": 2 } },
  { "do": "command", "command": { "kind": "unlock", "tree": "warrior", "node": "capstone" }, "expectFail": true },
  { "do": "cast", "ability": "chain_spark" },
  { "do": "expect", "check": { "kind": "stat", "stat": "mana", "atMost": 90 } } ] }
```
If the player ends a standard fight below 25% HP, enemies are overtuned; above 90%, undertuned. Change one number at a time and re-run.
