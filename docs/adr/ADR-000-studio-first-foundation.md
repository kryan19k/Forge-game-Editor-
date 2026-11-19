# ADR-000 · Studio-first foundation

**Status:** accepted · 2026-11-19

## Context
The master plan sequences runtime → orchestration → Studio. The Director chose **Studio first, with full MCP control from day one**, desktop browser, BYOK, single-player first but multiplayer as a first-class goal.

## Decisions

1. **One authoritative daemon per project.** The Studio (WebSocket) and agents (HTTP via MCP) are both clients. Nobody writes scene files directly. This is the same shape a multiplayer game server takes, so the editor and the future game backend share patterns.
2. **Scenes change only through typed transactions** (`@forge/contracts` `Transaction`/`Mutation`), applied by a pure reducer (`@forge/scene`). The reducer returns inverse mutations, enabling undo/revert without snapshots.
3. **Optimistic concurrency per entity.** Each entity carries `rev`; a transaction whose `baseRevision` is older than a touched entity's `rev` is a `CONFLICT`. Agents can work on unrelated entities without re-reading constantly, but never clobber fresh human work.
4. **Locks are a human right.** `locked` entities reject agent transactions.
5. **Clients replay authoritative transactions** through the same reducer instead of receiving full scenes; a revision mismatch triggers a resync. Deterministic and cheap.
6. **Strict, closed component set** (mesh, light, collider, rigidBody, spawnPoint, interactable, network). Network replication intent is in the data model now so multiplayer doesn't require a schema rewrite later.
7. **Vite + React 19 for the Studio, not Next.js.** The editor is a client-heavy SPA around a WebGPU canvas; SSR adds nothing. Next.js remains an option for marketing/account surfaces.
8. **Imperative viewport.** three.js lives outside React; React renders chrome only. Per-frame overlays (beacons) are DOM-direct.
9. **WebGPURenderer with automatic WebGL2 fallback** (`three/webgpu`), one renderer API (ADR-001 to formalize).
10. **Agents see.** `forge_capture` renders a still from the live Studio so agents verify visually, not just structurally.

## Consequences
- Multi-entity edits are atomic and appear as one Tape entry.
- Undo can be refused (conflict) — surfaced to the user rather than silently corrupting state.
- History is an append-only `history.jsonl` per project: an audit trail from day one.
- Next: play-in-editor runtime (Rapier, controller, interactables), then the asset pipeline.
