import type { NetServerMessage } from '@forge/contracts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ProjectHub } from '../src/hub';
import { createServer } from '../src/server';

const PORT = 4400 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;
let app: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  app = await createServer(new ProjectHub(mkdtempSync(join(tmpdir(), 'forge-mp-'))), { port: PORT, host: '127.0.0.1' });
  await app.listen({ port: PORT, host: '127.0.0.1' });
});
afterAll(async () => app.close());

const post = async (path: string, body: unknown = {}) =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, any>>;

/** A minimal headless game client. */
function client(roomId: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/net/${roomId}`);
  const inbox: NetServerMessage[] = [];
  let seq = 0;
  ws.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as NetServerMessage));
  const opened = new Promise<void>((r) => ws.on('open', () => r()));
  return {
    inbox,
    async join() {
      await opened;
      ws.send(JSON.stringify({ t: 'join', name }));
      return until(() => inbox.find((m) => m.t === 'welcome' || m.t === 'full'));
    },
    input(move: [number, number], extra: Record<string, unknown> = {}) {
      ws.send(JSON.stringify({ t: 'input', seq: ++seq, input: { move, sprint: false, jump: false, interact: false, attack: false, heavy: false, block: false, ability: 0, yaw: 0, ...extra } }));
    },
    lastSnap: () => [...inbox].reverse().find((m): m is Extract<NetServerMessage, { t: 'snap' }> => m.t === 'snap'),
    close: () => ws.close(),
  };
}

async function until<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('multiplayer rooms', () => {
  it('two fighters share an authoritative match; the second human replaces the bot', async () => {
    const proj = await post('/api/projects', { template: 'iron-ring', name: 'MP Fight' });
    expect(proj.ok).toBe(true);
    const { room } = await post('/api/rooms');
    const a = client(room.roomId, 'Alpha');
    const welcomeA = (await a.join()) as Extract<NetServerMessage, { t: 'welcome' }>;
    expect(welcomeA.doc.game.genre).toBe('fighting');
    await until(() => a.lastSnap());
    expect(a.lastSnap()!.actors.some((x) => x.kind === 'bot')).toBe(true);

    const b = client(room.roomId, 'Bravo');
    const welcomeB = (await b.join()) as Extract<NetServerMessage, { t: 'welcome' }>;
    expect(welcomeB.you).not.toBe(welcomeA.you);
    await sleep(150);
    const snap = a.lastSnap()!;
    expect(snap.actors.filter((x) => x.kind === 'player').map((x) => x.name).sort()).toEqual(['Alpha', 'Bravo']);
    expect(snap.actors.some((x) => x.kind === 'bot')).toBe(false);

    // After the round intro, Alpha walks right — Bravo must see it move (server-authoritative).
    await sleep(1700);
    const x0 = b.lastSnap()!.actors.find((x) => x.id === welcomeA.you)!.position[0];
    for (let i = 0; i < 20; i++) (a.input([1, 0]), await sleep(25));
    a.input([0, 0]);
    await sleep(120);
    const x1 = b.lastSnap()!.actors.find((x) => x.id === welcomeA.you)!.position[0];
    expect(x1).toBeGreaterThan(x0 + 0.5);

    // Each client gets its own HUD perspective.
    expect(a.lastSnap()!.hud.player.id).toBe(welcomeA.you);
    expect(b.lastSnap()!.hud.player.id).toBe(welcomeB.you);
    expect(b.lastSnap()!.hud.fight?.opponentId).toBe(welcomeA.you);
    a.close();
    b.close();
  });

  it('racing room fills the grid with bots and rejects players beyond maxPlayers', async () => {
    await post('/api/projects', { template: 'dust-circuit', name: 'MP Race' });
    const { room } = await post('/api/rooms');
    expect(room.maxPlayers).toBe(4);
    const p = client(room.roomId, 'Racer');
    await p.join();
    await until(() => p.lastSnap());
    expect(p.lastSnap()!.actors.filter((x) => x.kind === 'bot')).toHaveLength(3);
    expect(p.lastSnap()!.hud.race?.racers).toBe(4);
    const extra = Array.from({ length: 4 }, (_, i) => client(room.roomId, `X${i}`));
    for (const c of extra.slice(0, 3)) await c.join();
    const fifth = extra[3]!;
    expect((await fifth.join()).t).toBe('full');
    await sleep(100);
    expect(p.lastSnap()!.actors.filter((x) => x.kind === 'player')).toHaveLength(4);
    expect(p.lastSnap()!.actors.filter((x) => x.kind === 'bot')).toHaveLength(0);
    for (const c of [p, ...extra]) c.close();
  });
});
