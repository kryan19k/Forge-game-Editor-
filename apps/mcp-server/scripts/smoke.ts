/**
 * End-to-end MCP smoke test: spawns the real FORGE MCP server over stdio (exactly
 * how Claude Code runs it), then reads, edits, observes, and undoes through it.
 * Requires the daemon running (`pnpm dev`). Capture needs the Studio open.
 *   pnpm --filter @forge/mcp-server smoke
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({ name: 'forge-smoke', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', join(root, 'src/index.ts')],
    cwd: root,
    env: { ...process.env, FORGE_AGENT_ID: 'smoke', FORGE_AGENT_NAME: 'Smoke Test' } as Record<string, string>,
  }),
);

type Result = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const first = r.content[0];
  console.log(`${r.isError ? '✗' : '✓'} ${name}`, first?.type === 'text' ? first.text!.split('\n')[0]!.slice(0, 140) : `[${first?.type} ${first?.mimeType}]`);
  return r;
};

const tools = await client.listTools();
console.log(`tools: ${tools.tools.map((t) => t.name).join(', ')}`);

const outline = await call('forge_scene_outline');
const rev = Number(/rev (\d+)/.exec(outline.content[0]!.text!)![1]);
await call('forge_status', { status: 'working', message: 'Smoke test: placing a beacon pylon', focusEntityIds: ['ent_courtyard'] });
await call('forge_apply', {
  label: 'Smoke: beacon pylon',
  baseRevision: rev,
  mutations: [
    {
      op: 'create_entity',
      entity: {
        id: 'ent_smoke_pylon',
        name: 'Smoke Pylon',
        parentId: 'ent_courtyard',
        transform: { position: [4, 1.5, 4] },
        components: {
          mesh: { shape: 'cylinder', size: [0.4, 3, 0.4], material: { color: '#4fd1c5', emissive: '#4fd1c5', emissiveIntensity: 2 } },
          light: { kind: 'point', color: '#4fd1c5', intensity: 8, range: 8 },
        },
      },
    },
  ],
});
const bad = await call('forge_apply', {
  label: 'Smoke: must fail (bad roughness)',
  mutations: [{ op: 'patch_component', entityId: 'ent_smoke_pylon', component: 'mesh', value: { material: { roughness: 7 } } }],
});
if (!bad.isError) throw new Error('invalid mutation was accepted');
const stale = await call('forge_apply', {
  label: 'Smoke: must conflict (stale base)',
  baseRevision: rev,
  mutations: [{ op: 'rename_entity', entityId: 'ent_smoke_pylon', name: 'Nope' }],
});
if (!stale.isError) throw new Error('stale write was accepted');

const play = await call('forge_playtest', {
  name: 'Smoke: pylon is reachable and the hub stays locked',
  steps: [
    { do: 'walk_to', entityId: 'ent_smoke_pylon', stopDistance: 1.5 },
    { do: 'expect', check: { kind: 'near', entityId: 'ent_smoke_pylon', within: 1.6 } },
    { do: 'walk_to', entityId: 'ent_hub_door', stopDistance: 2.2 },
    { do: 'interact' },
    { do: 'expect', check: { kind: 'event', event: 'interact_blocked' } },
  ],
});
if (play.isError) throw new Error('playtest failed');

const shot = await call('forge_capture', { view: 'overview', width: 960, height: 600 });
const img = shot.content.find((c) => c.type === 'image');
if (img?.data) writeFileSync(process.env.SMOKE_SHOT ?? join(root, 'smoke-capture.png'), Buffer.from(img.data, 'base64'));

if (process.env.SMOKE_KEEP !== '1') await call('forge_undo');
await call('forge_status', { status: 'idle', message: 'Smoke test complete' });
await client.close();
