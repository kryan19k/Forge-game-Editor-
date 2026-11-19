// Launch the FORGE MCP server from any working directory (Claude Code, Codex, Cursor…).
// Resolves tsx from this repo, then loads the TypeScript entry point.
import { register } from 'tsx/esm/api';

register();
await import('../apps/mcp-server/src/index.ts');
