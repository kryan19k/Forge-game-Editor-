# ADR-005 · Project Team Room

**Status:** accepted · 2026-11-19

Persist a sequence of typed Team Room events in each project's `team.jsonl`. Studio snapshots and WebSocket updates expose the room to the Director. The MCP inbox returns `#team` plus the caller's direct thread by sequence cursor. Agent IDs follow the existing localhost identity model. Direct threads scope ordinary inbox reads.

Plan reviews keep stable step IDs, carry the new order and text and use the latest plan event sequence to detect edits from another Studio window. Pausing is guidance checked at work boundaries. Directives use the same ledger and remain available through the directive tools.

The embedded Producer streams Anthropic's summarized thinking into the room during a design run. The daemon publishes completed summaries to the ledger and keeps provider signatures in the SDK. External agents choose and publish their own updates. The Producer reads direct messages and mentions on its next design run.
