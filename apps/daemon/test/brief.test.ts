import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectHub } from '../src/hub';
import { createServer } from '../src/server';

const PORT = 4800 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${PORT}`;
let app: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  // No Producer passed: the interview must work through an MCP agent alone.
  app = await createServer(new ProjectHub(mkdtempSync(join(tmpdir(), 'forge-brief-'))), { port: PORT, host: '127.0.0.1' });
  await app.listen({ port: PORT, host: '127.0.0.1' });
});
afterAll(async () => app.close());

const req = async (method: string, path: string, body?: unknown, agent = false) =>
  (await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(agent ? { 'x-forge-agent-id': 'claude-code', 'x-forge-agent-name': 'Claude' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((r) => r.json())) as Record<string, any>;

describe('genre starter → design interview (agent-driven)', () => {
  it('lists starters with their questions', async () => {
    const r = await req('GET', '/api/starters');
    expect(r.starters.map((s: { id: string }) => s.id)).toEqual(['rpg', 'mmorpg', 'adventure', 'fighting', 'racing', 'shooter']);
    expect(r.starters[1].questions.find((q: { id: string }) => q.id === 'style').options.length).toBeGreaterThan(2);
  });

  it('forges an MMORPG from answers, then an agent interviews the Director', async () => {
    const created = await req('POST', '/api/projects', { starter: 'mmorpg', name: 'Skyreach', answers: { setting: 'scifi', style: 'sandbox', session: '16', pvp: 'zones', hook: 'Orbital storms reshape the map weekly' } });
    expect(created.ok).toBe(true);
    expect(created.skill).toBe('forge-mmo');

    const game = await req('GET', '/api/game');
    expect(game.game.genre).toBe('mmorpg');
    expect(game.game.maxPlayers).toBe(16);
    const db = await req('GET', '/api/database');
    expect(db.lint).toEqual([]);
    expect(db.database.abilities.some((a: { id: string }) => a.id === 'pulse_shot')).toBe(true); // sci-fi kit

    let brief = (await req('GET', '/api/brief')).brief;
    expect(brief.title).toBe('Skyreach');
    expect(brief.producer.kind).toBe('agent');
    expect(brief.gdd).toContain('Orbital storms');

    const asked = await req('POST', '/api/brief/ask', { prompt: 'Should storms destroy player bases or only move resources?', options: ['Destroy', 'Move resources'] }, true);
    expect(asked.ok).toBe(true);
    await req('POST', `/api/brief/followups/${asked.id}`, { answer: 'Move resources' });
    brief = (await req('GET', '/api/brief', undefined, true)).brief;
    expect(brief.followUps[0].answer).toBe('Move resources');

    await req('POST', '/api/brief', { gdd: '# Skyreach\nFinal.', plan: ['Build hub', 'Storm event'], status: 'building' }, true);
    brief = (await req('GET', '/api/brief')).brief;
    expect(brief.status).toBe('building');

    // Agents may never set credentials.
    const denied = await fetch(`${base}/api/producer/key`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-agent-id': 'x' }, body: JSON.stringify({ key: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxx' }) });
    expect(denied.status).toBe(403);
  });
});
