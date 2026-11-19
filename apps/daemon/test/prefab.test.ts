import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectHub } from '../src/hub';
import { createServer } from '../src/server';

it('saves a prefab from Studio selection, places it transactionally and persists the library', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-prefabs-'));
  const hub = new ProjectHub(workspace);
  const app = await createServer(hub, { port: 4317, host: '127.0.0.1' });
  const headers = { host: '127.0.0.1:4317', 'x-forge-agent-id': 'codex' };
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers, payload });
  await app.ready();
  const ws = await app.injectWS('/ws', { headers });
  try {
    ws.send(JSON.stringify({ type: 'selection', entityIds: ['ent_courtyard'] }));
    await expect.poll(() => hub.active.humanSelection).toEqual(['ent_courtyard']);
    const response = await post('/api/prefabs', { name: 'Courtyard module' });
    const created = response.json<{ ok: boolean; prefabId: string; revision: number }>();
    expect(created.ok).toBe(true);
    const prefab = hub.active.scene.database.prefabs[created.prefabId]!;
    expect(prefab.entities.length).toBeGreaterThan(1);
    const placed = (await post('/api/prefabs/place', { prefab: created.prefabId, position: [30, 0, 0] })).json<{ ok: boolean; rootId: string; touched: string[] }>();
    expect(placed.ok).toBe(true);
    expect(placed.touched).toHaveLength(prefab.entities.length);
    expect(hub.active.scene.entities[placed.rootId]).toMatchObject({ parentId: null, transform: { position: [30, 0, 0] } });
    expect((await post('/api/history/undo', {})).json()).toMatchObject({ ok: true });
    expect(hub.active.scene.entities[placed.rootId]).toBeUndefined();
    await hub.flush();
    expect(new ProjectHub(workspace).active.scene.database.prefabs[created.prefabId]).toEqual(prefab);
  } finally {
    ws.terminate();
    await hub.flush();
    await app.close();
  }
});
