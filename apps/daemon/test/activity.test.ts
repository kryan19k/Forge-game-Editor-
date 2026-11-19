import type { ActivityPage, ServerMessage } from '@forge/contracts';
import { buildTransaction } from '@forge/scene';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ProjectHub } from '../src/hub';
import { createServer } from '../src/server';

it('broadcasts Studio activity, serves it to agents by cursor and retains it after reopening', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-activity-'));
  const hub = new ProjectHub(workspace);
  const app = await createServer(hub, { port: 4317, host: '127.0.0.1' });
  const headers = { host: '127.0.0.1:4317', 'x-forge-agent-id': 'codex' };
  const inbox: ServerMessage[] = [];
  await app.ready();
  const ws = await app.injectWS('/ws', { headers }, { onInit: (socket) => {
    socket.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as ServerMessage));
  } });
  try {
    const snapshot = inbox.find((m) => m.type === 'snapshot');
    expect(snapshot?.activitySettings.autoReact).toBe(false);
    expect(snapshot?.activity).toEqual([]);
    const scene = hub.active.scene;
    const tx = buildTransaction(scene, { id: 'spoof', name: 'Spoof', kind: 'agent' }, 'Add watchtower', [
      { op: 'create_entity', entity: { id: 'ent_watchtower_test', name: 'Watchtower', transform: { position: [12, 0, -4] } } },
    ]);
    ws.send(JSON.stringify({ type: 'tx.submit', tx }));
    await expect.poll(() => inbox.find((m) => m.type === 'scene.activity')).toMatchObject({
      entry: {
        txId: tx.txId, revision: scene.revision + 1, author: { name: 'Director', kind: 'human' },
        changes: [{ kind: 'created', entity: { name: 'Watchtower' }, position: [12, 0, -4] }],
      },
    });
    const activity = inbox.find((m) => m.type === 'scene.activity')!.entry;
    const read = async (since: number) => (await app.inject({ url: `/api/activity?since=${since}`, headers })).json<ActivityPage>();
    const page = await read(scene.revision);
    expect(page.activity).toEqual([activity]);
    expect(page.cursor).toBe(activity.revision);
    expect((await read(page.cursor)).activity).toEqual([]);
    ws.send(JSON.stringify({ type: 'tx.submit', tx }));
    await expect.poll(() => inbox.find((m) => m.type === 'tx.rejected')).toMatchObject({ txId: tx.txId });
    expect((await read(scene.revision)).activity).toEqual([activity]);

    ws.send(JSON.stringify({ type: 'activity.settings', settings: { autoReact: true } }));
    await expect.poll(() => inbox.find((m) => m.type === 'activity.settings')).toMatchObject({ settings: { autoReact: true } });
    expect((await read(page.cursor)).settings.autoReact).toBe(true);
    await hub.flush();
    expect(new ProjectHub(workspace).active.readActivity(scene.revision)).toMatchObject({ activity: [activity], settings: { autoReact: true } });
    expect(hub.create('outpost-zero', 'Another project').readActivity()).toMatchObject({ activity: [], settings: { autoReact: false } });
  } finally {
    ws.terminate();
    await hub.flush();
    await app.close();
  }
});
