---
name: forge-performance
description: Keep FORGE games fast — browser frame budgets (draw calls, triangles, lights, shadows), simulation cost per tick (actors, NPCs, physics), multiplayer bandwidth, and how to measure each in FORGE before and after a change. Use when a scene grows large, the Studio HUD shows low FPS, playtests run slowly, or before hosting big sessions.
---

# FORGE · performance

Load `forge-game-builder` first. Method (read it): `gamedev:performance-optimization` — **measure first, find the bottleneck, fix the biggest cost, re-measure, set budgets.**

## Measure in FORGE

| What | Where |
|---|---|
| FPS, draw calls, triangles, backend (WebGPU/WebGL2) | Studio viewport HUD (bottom-left) — ask the Director to read it, or check after `forge_capture` |
| Simulation cost | `forge_playtest` report header: "Xs simulated in Yms" → cost per tick ≈ Y / (X × 60) ms |
| Entity count | `forge_scene_outline` header |
| Network | snapshot ≈ actors × ~220 B × 30 Hz per client |

## Budgets (desktop browser, mid-range GPU)

| Resource | Budget | Notes |
|---|---|---|
| Frame | 16.7 ms (60 FPS) | CPU sim + render submit; GPU in parallel |
| Draw calls | ≤ 250 (≤ 120 for mobile-class) | each visible mesh ≈ 1 call; shadows re-draw casters |
| Triangles | ≤ 300k visible | primitives are cheap; spheres/torus 1–3k each |
| Shadow-casting lights | 1 directional + ≤ 2 spots | point-light shadows cost 6 passes each — avoid |
| Point lights | ≤ 8 meaningful | prefer emissive materials for small glows |
| Sim tick | ≤ 4 ms at 60 Hz | measured reference: Shardlands (1 player, 10 NPCs) ≈ 0.15 ms/tick — measure yours from the playtest header |
| Hostile NPCs active | ≤ 30 per room | each runs a brain + controller every tick |
| Snapshot | ≤ 30 KB/s per client | ~32 players + 30 NPCs |

## Fixes in order of payoff

1. **Fewer shadow casters**: `castShadow: false` on small props, floors, emissive strips (they rarely need it).
2. **Fewer lights**: replace decorative point lights with emissive materials; keep lights for gameplay readability.
3. **Merge greybox walls**: one long box beats ten short ones (draw calls and colliders).
4. **Cap NPC density**: fewer, stronger enemies (HP ×2) instead of more; stagger respawns.
5. **Visibility**: hide (`set_flags visible: false`) dressing that's never seen; hidden entities skip render *and* physics.
6. **Network**: `network.relevancy` documents intent; until interest management lands, keep rooms ≤ 32 players for busy scenes.

## Report numbers

Always state before/after: "draws 410 → 230, FPS 41 → 60 on the Director's machine" or "sim 3.1 → 1.4 ms/tick (playtest 60 s in 480 → 210 ms)". "Should be faster" is not a result.
