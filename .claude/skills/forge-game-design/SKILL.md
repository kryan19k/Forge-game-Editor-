---
name: forge-game-design
description: Run FORGE's design interview and turn answers into a buildable game — genre starters (forge_starters / forge_project_create), follow-up questions (forge_ask), the GDD and build plan (forge_brief_update), core loops per genre, scope control and honest mapping to engine capabilities. Use when a user wants to make a new game, refine a concept, or when a project has a design brief.
---

# FORGE · game design

Load `forge-game-builder` first. Theory: `gamedev:rpg`, `gamedev:roguelike`, `gamedev:survival-crafting`, `gamedev:tower-defense`, `gamedev:fps-shooter`, `gamedev:platformer` each list a genre's core loop, must-have systems and design knobs — read the relevant one before designing that genre.

## 1. Interview, don't assume

Start every new game from a **genre starter** — it is a question set plus a scaffold builder, not a finished game.

1. `forge_starters` → pick the closest starter (rpg, mmorpg, adventure, fighting, racing, shooter). If the user's genre isn't listed, pick the nearest controller match and say what will be custom.
2. Ask the starter's questions (or let the Director use the Studio wizard). Offer the options; accept free text.
3. `forge_project_create {starter, answers, name}` builds a **playable greybox** immediately and writes a brief.
4. Ask **3–5 follow-ups** with `forge_ask` — only decisions that change what gets built, each with 2–4 suggested answers. Good: "Do storms destroy bases or only move resources?" Bad: "What color should the sky be?" (decide it yourself).
5. When answers arrive (`forge_brief`), write the GDD and plan with `forge_brief_update`, then `status: building`.

If the embedded Producer is active it asks follow-ups itself — read its questions in `forge_brief` and don't duplicate them.

## 2. The GDD (one screen, buildable)

```markdown
# <Title>
**Pitch:** one sentence a player would repeat to a friend.
**Core loop:** verb → verb → reward → growth (e.g. explore → fight → loot → upgrade → harder zone)
**Pillars (3):** the feelings every feature must serve.
**Player:** controller, camera, the 3–5 actions they repeat most.
**Systems:** which FORGE systems carry the loop (database tables, objectives, NPC brains, win rule).
**Content for the first slice:** named zones, enemies (with HP/damage), NPCs, quest steps, items.
**Numbers:** time-to-kill, XP pace, session length, player count.
**Future milestones:** what the design needs that FORGE doesn't have yet.
```

Every feature must answer "which pillar?" — cut the rest from the first slice.

## 3. Map genre must-haves onto FORGE

| Genre must-have | FORGE system today |
|---|---|
| Stats, leveling, gear | database stats/modifiers, progression, items (equipment) |
| Abilities, spells, weapons | database abilities (+ `game.player.primaryAbility`) |
| Skill / talent / tech trees | database trees (skill_points or item currency) |
| Quests | `game.objectives` chain (interact, collect, defeat, reach) |
| Dialogue | `npc.dialogue` lines (linear per NPC; branching = future) |
| Enemies, waves, respawn | `npc` hostile + `respawnSeconds`, `unit` loot/xp |
| Economy / loot | loot tables + currency items |
| Win/lose | `game.win` objectives / race / ko / none |
| Multiplayer | rooms; `maxPlayers`, `bots`, `pvp` |
| Crafting, building, save/load, branching dialogue, pathfinding, audio | **not yet** — list under Future milestones |

## 4. Scope: build the vertical slice first

A slice is one complete loop at shipping quality in a small space: one hub + one zone, 2 enemy types, a 4–6 step quest, 3–4 abilities, one tree with 5–8 nodes. Prove it with a full-chain playtest before adding breadth. Plans with more than ~8 tasks are two milestones — split them.

## 5. The build plan

Ordered, concrete, verifiable tasks — each ends with how it's proven:

1. "Replace greybox hub with the harbor town; landmark visible from spawn — capture overview."
2. "Add sea-wraith (HP 50, dmg 9, aggro 8) ×4 at the reef — playtest: autopilot defeats #wraith 4, health_above 30."
3. "Tree 'Tidecaller' 6 nodes, capstone at level 5 — lint clean, playtest unlock order."

Put the plan in the brief; mark progress in your status messages.
