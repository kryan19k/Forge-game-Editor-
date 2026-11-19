# ADR-004 · Scene activity from committed transactions

**Status:** accepted · 2026-11-19

Compare the affected entities before and after a successful reducer transaction. Record the net structural changes with the existing transaction history and broadcast them to Studio after the transaction. The same path covers Studio and MCP authors, subtree deletion, undo and redo. Positions are relative to the reported parent, in meters.

Readers use an exclusive scene revision cursor within each project. Pages contain whole transactions and report when the cursor predates retained history. Earlier transactions without activity records remain readable in Tape. The project’s opt-in setting is persisted in `activity.json`. Agents poll the feed and decide whether to offer a follow-up.
