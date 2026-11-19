# ADR-003 · Engine core: data-first gameplay framework + genre starters with a design interview

**Status:** accepted · 2026-11-19

## Context
FORGE should make *any* game with deep customization (Unity/Unreal-class, but agent-driven). Prebuilt sample games don't scale to that; neither do hardcoded genre rules. The Director chose: **data + logic graphs first, sandboxed code as an escape hatch**; **gameplay framework** as the first system pack; **genre starters + a layered design interview** (built-in wizard, then an embedded Producer or any MCP agent).

## Decisions
1. **Game Database in the scene** (`scene.database`): stats with layered reversible modifiers, resources, abilities (self/melee/ray/aoe; cost, cooldown, windup), statuses (DoT, buffs, stun/root, stacks), progression trees (skill points or item currency), items/equipment/consumables, loot tables, XP curve, starting loadout. Edited with granular `upsert_def` / `remove_def` / `set_database` transactions (undoable, conflict-checked). Advisory lint catches dangling references and unreachable tree nodes.
2. **Runtime executes it deterministically** inside `GameSimulation` (`sim/gameplay.ts`), so the same data works in solo play, headless playtests and authoritative multiplayer (player commands — unlock/equip/use — are network messages).
3. **Attack buttons can bind abilities** (`game.player.primaryAbility/secondaryAbility`) — a shooter's rifle and a mage's firebolt are data, not new controllers.
4. **Genre starters replace prebuilt games as the main path.** A starter = questions + a scaffold builder producing a playable greybox configured from answers, plus a design brief (`brief.json`). Sample games remain as examples and regression fixtures. Every starter's default build is proven playable by tests.
5. **Interview is layered.** The wizard always works. Follow-ups + GDD + plan come from the embedded **Producer** (Claude API, `claude-opus-5-5`, structured output via Zod; BYOK key stored daemon-side in `workspace/secrets.json`, never returned to clients, never settable by agents) or from any MCP agent via `forge_brief` / `forge_ask` / `forge_brief_update`. The Producer auto-runs only with explicit credentials (saved key or env); otherwise the Director triggers it — no surprise billing.
6. **Agent skills are part of the engine.** `.claude/skills/forge-*` (also served as MCP prompts) distill the user's `gamedev:*` library into FORGE-specific metrics, formulas, budgets and playtest recipes.

## Next
- Logic graph (event → condition → action) for rules the database can't express; sandboxed TS scripts behind it.
- Game-feel pack (trauma shake, hit-stop, particles, damage numbers), audio, navmesh AI, save/load, branching dialogue, crafting — each a typed system with skills + playtest checks.
