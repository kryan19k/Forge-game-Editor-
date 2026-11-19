import type { ServerMessage, TeamEvent } from '@forge/contracts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ProjectHub } from '../src/hub';
import { Producer } from '../src/producer';
import { createServer } from '../src/server';

const host = '127.0.0.1';
const port = 4317;
const headers = { host: `${host}:${port}` };

async function studio(hub: ProjectHub, producer?: Producer) {
  const app = await createServer(hub, { host, port }, producer);
  const inbox: ServerMessage[] = [];
  await app.ready();
  const ws = await app.injectWS('/ws', { headers }, { onInit: (socket) => {
    socket.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as ServerMessage));
  } });
  return {
    app,
    inbox,
    send: (message: unknown) => ws.send(JSON.stringify(message)),
    close: async () => { ws.terminate(); await hub.flush(); await app.close(); },
  };
}

it('round-trips messages, published thoughts, selections, guidance and plan decisions', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-team-'));
  const hub = new ProjectHub(workspace);
  const { app, send, inbox, close } = await studio(hub);
  const codex = { ...headers, 'x-forge-agent-id': 'codex', 'x-forge-agent-name': 'Codex' };
  const read = async (agentHeaders = codex, since = 0) =>
    (await app.inject({ url: `/api/team/inbox?since=${since}`, headers: agentHeaders })).json<{ events: TeamEvent[]; paused: boolean; cursor: number }>();
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, headers: codex, payload });
  try {
    send({ type: 'team.message', thread: 'codex', text: '@codex. Work on this door.', focusEntityIds: ['ent_hub_door', 'ent_missing'] });
    await expect.poll(async () => (await read()).events).toMatchObject([
      { kind: 'message', author: { id: 'director' }, text: '@codex. Work on this door.', mentions: ['codex'], focusEntityIds: ['ent_hub_door'] },
    ]);
    expect((await read({ ...codex, 'x-forge-agent-id': 'other' })).events).toEqual([]);
    const initial = await read();
    expect((await post('/api/team/message', { thread: 'dm', kind: 'result', text: 'I see the door.' })).statusCode).toBe(200);
    expect((await post('/api/team/think', { kind: 'thought', text: 'Keep the existing lock.' })).statusCode).toBe(200);
    await expect.poll(() => inbox.filter((message) => message.type === 'team.event').slice(-2)).toMatchObject([
      { event: { kind: 'result', thread: 'codex', text: 'I see the door.' } },
      { event: { kind: 'thought', thread: '#team', text: 'Keep the existing lock.', source: 'published' } },
    ]);
    const plan = (await post('/api/team/plan', { steps: ['Frame the door', 'Change the lock'] })).json<
      Extract<TeamEvent, { kind: 'plan' }>
    >();
    const steps = [{ ...plan.steps[1]!, decision: 'rejected' }, { ...plan.steps[0]!, text: 'Frame the doorway', decision: 'approved' }];
    const review = { planId: plan.planId, baseSequence: plan.sequence, steps };
    send({ type: 'team.review', review });
    await expect.poll(async () => (await read(codex, initial.cursor)).events).toMatchObject([
      { kind: 'result' }, { kind: 'thought' }, { kind: 'plan' },
      { kind: 'plan_review', author: { id: 'director' }, planId: plan.planId, steps },
    ]);
    send({ type: 'team.review', review });
    await expect.poll(() => inbox.some((m) => m.type === 'team.rejected')).toBe(true);
    send({ type: 'team.pause', agentId: 'codex', paused: true });
    await expect.poll(async () => (await read()).paused).toBe(true);
    send({ type: 'directive.create', text: 'Place a light in the courtyard.', focusEntityIds: [] });
    await expect.poll(() => hub.active.directives.size).toBe(1);
    const reopened = new ProjectHub(workspace).active;
    expect(reopened.team.inbox('codex')).toMatchObject({ paused: true, events: (await read()).events });
    expect(reopened.directives.size).toBe(1);
    send({ type: 'team.pause', agentId: 'codex', paused: false });
    await expect.poll(async () => (await read()).paused).toBe(false);
  } finally {
    await close();
  }
});

it('shows a live Provider summary and retains the completed summary and proposed plan', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-producer-team-'));
  const producer = new Producer(join(workspace, 'secrets.json'));
  producer.setKey('sk-test-fake-credential');
  const hub = new ProjectHub(workspace);
  const { app, inbox, close } = await studio(hub, producer);
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const input = new ReadableStream<Uint8Array>({ start: (stream) => { controller = stream; } });
  const emit = (type: string, payload: object = {}) =>
    controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`));
  const provider = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true, thinking: { type: 'adaptive', display: 'summarized' } });
    return new Response(input, { headers: { 'content-type': 'text/event-stream' } });
  });
  vi.stubGlobal('fetch', provider);
  try {
    const project = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { starter: 'rpg', name: 'Producer Test' } });
    expect(project.statusCode).toBe(200);
    await expect.poll(() => provider.mock.calls.length).toBe(1);
    emit('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-opus-5-5', stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } });
    emit('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
    emit('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Keep the first mission short.' } });
    await expect.poll(() => inbox.find((m) => m.type === 'team.thinking' && m.thinking !== null)).toMatchObject({
      thinking: { text: 'Keep the first mission short.', author: { id: 'producer' } },
    });
    emit('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'provider-only' } });
    emit('content_block_stop', { index: 0 });
    emit('content_block_start', { index: 1, content_block: { type: 'text', text: '' } });
    emit('content_block_delta', { index: 1, delta: { type: 'text_delta', text: JSON.stringify({ followUps: [], gdd: 'A short mission.', plan: ['Build the village.'] }) } });
    emit('content_block_stop', { index: 1 });
    emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 22 } });
    emit('message_stop');
    controller!.close();
    await expect.poll(() => hub.active.team.snapshot().events.find((event) => event.kind === 'plan')).toMatchObject({
      steps: [{ text: 'Build the village.', decision: 'pending' }],
    });
    expect(hub.active.team.snapshot()).toMatchObject({
      thinking: null,
      events: expect.arrayContaining([expect.objectContaining({ kind: 'thought', source: 'provider_summary', text: 'Keep the first mission short.' })]),
    });
    expect(JSON.stringify(inbox)).not.toContain('provider-only');
  } finally {
    vi.unstubAllGlobals();
    await close();
  }
});
