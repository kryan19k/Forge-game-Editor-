# AGENTS.md — working on FORGE

You are working on **FORGE**, an AI-native game engine/studio: "Unity/Unreal, but every operation is an agent-callable, typed, undoable API." Read **`docs/HANDOFF.md`** before your first change — it has the architecture map, current state, the next phase spec and the gotchas. The product vision is in `docs/FORGE_MASTERPLAN.md`; decisions are in `docs/adr/`.

## Commands

```bash
pnpm install
pnpm dev            # daemon :4317 + Studio http://127.0.0.1:4318 (Vite)
pnpm verify         # typecheck + all tests — must be green before you finish any task
pnpm smoke:mcp      # drives the real MCP server end-to-end (needs `pnpm dev` + Studio open for capture)
```

## Non-negotiable rules

1. **Scenes change only through typed transactions** (`packages/contracts` Mutation → `packages/scene` reducer). Never write `workspace/**/scene.json` directly; never bypass the reducer, its conflict check (`rev` vs `baseRevision`) or `LOCKED` protection.
2. **Contracts first.** New data = a Zod schema in `packages/contracts`, then the reducer/sim/UI. Keep inverses exact (undo/revert depends on them) and add a reducer test.
3. **Gameplay lives in `GameSimulation`** (`packages/game-runtime/src/sim`) — deterministic, renderer-free, fixed 60 Hz. It must keep running in Node (headless playtests, multiplayer server). No DOM or `three/webgpu` imports under `src/sim`.
4. **Prove behavior with playtests.** Every gameplay feature gets a test in `packages/game-runtime/test` (use `runPlaytest`), every daemon feature an integration test in `apps/daemon/test`. Don't loosen assertions to get green.
5. **Design language is a requirement, not decoration.** The user explicitly rejects generic "AI slop" UI. Use the tokens and patterns in `apps/studio/src/styles.css` (graphite/bone, molten `#ff6a2b` for the Director, signal colors per agent, hairline rules, mono micro-labels, custom glyphs in `ui/glyphs.tsx`). No stock icon packs, no gradient blobs, no glassmorphism, no rounded card soup.
6. **Honesty about capability.** If the engine can't do something yet, say so and build the faithful version; never fake a mechanic the sim can't back. Update the relevant `.claude/skills/forge-*/SKILL.md` when you add or change an engine capability — the skills are part of the product.
7. **Secrets**: the Claude API key lives only in `workspace/secrets.json` (gitignored), is never returned to clients and can't be set by agents. Keep it that way for any new provider keys (e.g. Tripo).
8. Don't commit `workspace/`, `.env*`, captures or secrets. Commit in small, described steps.

## Windows environment gotchas (this machine)

- Edit files with your file-edit tool or Node scripts. **Never** round-trip files through PowerShell 5.1 `Get-Content`/`Set-Content` — it re-encodes UTF-8 and corrupts characters (─ · “ ” ▸ are used throughout).
- After adding a dependency or a new export to a workspace package, **restart Vite** (stale module graph → "does not provide an export named …").
- The daemon runs via `tsx` without watch in `pnpm --filter @forge/daemon start`; restart it after daemon/contract changes.
- Toolchain: TypeScript 7 (native `tsc`), Vite 8, React 19, three 0.187 (`three/webgpu` WebGPURenderer with WebGL2 fallback), zod 4, Rapier `@dimforge/rapier3d-compat` 0.21, MCP SDK 1.32, `@anthropic-ai/sdk` 1.10.

## Using FORGE as an agent (MCP)

The repo's MCP server (`scripts/forge-mcp.mjs`) exposes `forge_*` tools (scene outline/apply/undo, capture, playtest, database, projects/starters, brief/ask, sessions…) and serves the 13 FORGE skills as MCP prompts. The skills are plain markdown in `.claude/skills/forge-*/SKILL.md` — read `forge-game-builder` first when you build *games* in FORGE (as opposed to building the engine).
