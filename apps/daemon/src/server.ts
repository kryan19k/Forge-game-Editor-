import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import {
  ActivityCursor,
  AgentStatus,
  AssetGenerate,
  AssetId,
  AssetImport,
  AssetPlacement,
  CaptureView,
  ClientMessage,
  ComponentSchemas,
  DirectiveStatus,
  EntityId,
  DesignAnswer,
  Mutation,
  PlaytestScript,
  PlanSteps,
  PrefabCreate,
  PrefabPlace,
  PublishedKind,
  TEAM_THREAD,
  TeamAgentId,
  TeamFocus,
  TeamInboxCursor,
  TeamPostKind,
  TeamTarget,
  TeamText,
  type DesignBrief,
  type Author,
  type PlaytestReport,
  type ServerMessage,
} from '@forge/contracts';
import { formatReport, lintDatabase, runPlaytest } from '@forge/game-runtime/sim';
import { describeComponents, outlineScene } from '@forge/scene';
import Fastify, { type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { starterInfo, starters, templates } from '@forge/templates';
import type { Producer } from './producer';
import type { ProjectHub } from './hub';
import type { ModelAssets } from './model-assets';
import { GLB_BYTE_LIMIT } from './glb';
import { RoomManager } from './rooms';
import type { ApplyOutcome, ProjectStore } from './store';

const DIRECTOR: Author = { kind: 'human', id: 'director', name: 'Director' };

function agentFrom(req: FastifyRequest): Author {
  const id = String(req.headers['x-forge-agent-id'] ?? 'agent').slice(0, 64) || 'agent';
  const name = String(req.headers['x-forge-agent-name'] ?? id).slice(0, 64) || id;
  return { kind: 'agent', id, name };
}

const outcome = (o: ApplyOutcome) =>
  o.ok ? { ok: true, revision: o.entry.revision, txId: o.entry.txId, touched: o.entry.touched } : { ok: false, error: o.error };

export async function createServer(hub: ProjectHub, opts: { port: number; host: string }, producer?: Producer, assets?: ModelAssets) {
  /** The active project. Reassigned when the Director or an agent switches projects. */
  let store: ProjectStore = hub.active;
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 4 * 1024 * 1024 });

  // DNS-rebinding guard: only accept requests addressed to this machine.
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, `[::1]:${opts.port}`]);
  app.addHook('onRequest', async (req, reply) => {
    if (!allowedHosts.has(String(req.headers.host))) return reply.code(403).send({ error: 'forbidden host' });
  });
  await app.register(fastifyCors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/] });
  await app.register(fastifyWebsocket);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  /* ── Studio realtime channel ─────────────────────────────────────────── */

  const sockets = new Set<WebSocket>();
  const bindAssets = (target: ProjectStore) => {
    target.isAssetApproved = (id) => assets?.approved(target.project.projectId, id) ?? false;
  };
  bindAssets(store);
  const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const snapshot = (ws: WebSocket) => {
    const you = store.touchCrew(DIRECTOR, { status: 'working' });
    send(ws, {
      type: 'snapshot',
      project: store.project,
      scene: store.scene,
      history: store.history(),
      crew: [...store.crew.values()],
      directives: [...store.directives.values()],
      comms: store.comms.slice(-200),
      activity: store.readActivity().activity,
      activitySettings: store.activitySettings,
      team: store.team.snapshot(),
      brief: store.brief,
      you,
    });
  };
  store.hasStudio = () => sockets.size > 0;
  hub.on('switched', (next) => {
    store = next;
    bindAssets(next);
    store.hasStudio = () => sockets.size > 0;
    for (const ws of sockets) snapshot(ws);
  });
  hub.on('message', (msg) => {
    if (msg.type === 'capture.request') {
      const target = [...sockets].at(-1);
      if (target) send(target, msg);
      return;
    }
    for (const ws of sockets) send(ws, msg);
  });

  app.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    snapshot(socket);

    socket.on('message', (raw) => {
      let msg: z.output<typeof ClientMessage>;
      try {
        msg = ClientMessage.parse(JSON.parse(String(raw)));
      } catch (err) {
        return send(socket, { type: 'tx.rejected', txId: '', code: 'INVALID', message: `bad message: ${String(err).slice(0, 300)}` });
      }
      const reject = (txId: string, o: ApplyOutcome) => {
        if (!o.ok) send(socket, { type: 'tx.rejected', txId, code: o.error.code, message: o.error.message });
      };
      switch (msg.type) {
        case 'tx.submit':
          // The Studio is always the Director; the author field is not trusted from the wire.
          return reject(msg.tx.txId, store.apply({ ...msg.tx, author: DIRECTOR }));
        case 'history.undo':
          return reject('', store.undo(DIRECTOR));
        case 'history.redo':
          return reject('', store.redo(DIRECTOR));
        case 'history.revert':
          return reject(msg.txId, store.revert(msg.txId, DIRECTOR));
        case 'selection':
          store.humanSelection = msg.entityIds;
          store.touchCrew(DIRECTOR, { focusEntityIds: msg.entityIds });
          return;
        case 'activity.settings':
          store.setActivitySettings(msg.settings);
          return;
        case 'team.message':
        case 'team.review':
        case 'team.pause':
          try {
            if (msg.type === 'team.message') store.team.note(DIRECTOR, msg.thread, 'message', msg.text, msg.focusEntityIds.filter((id) => store.scene.entities[id]));
            else if (msg.type === 'team.review') store.team.review(DIRECTOR, msg.review);
            else store.team.setPaused(DIRECTOR, msg.agentId, msg.paused);
          } catch (error) {
            send(socket, { type: 'team.rejected', message: (error as Error).message });
          }
          return;
        case 'prefab.place': {
          const placed = store.placePrefab(DIRECTOR, msg.request);
          reject('', placed);
          if (placed.ok && placed.rootId) send(socket, { type: 'entity.placed', rootId: placed.rootId });
          return;
        }
        case 'asset.place': {
          if (msg.projectId !== store.project.projectId) return send(socket, { type: 'tx.rejected', txId: '', code: 'SCENE_MISMATCH', message: 'The active project changed.' });
          try {
            if (!assets) throw new Error('Generated assets are unavailable.');
            const { name, mutation } = assets.placement(msg.projectId, msg.request);
            const placed = store.submit(DIRECTOR, 'Place ' + name, [mutation]);
            reject('', placed);
            if (placed.ok) send(socket, { type: 'entity.placed', rootId: mutation.entity.id });
          } catch (error) {
            send(socket, { type: 'tx.rejected', txId: '', code: 'INVALID', message: (error as Error).message });
          }
          return;
        }
        case 'directive.create':
          store.createDirective(DIRECTOR, msg.text, msg.focusEntityIds);
          return;
        case 'capture.response':
          return store.resolveCapture(msg.requestId, msg.dataUrl, msg.error);
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      if (sockets.size === 0) store.dropCrew(DIRECTOR.id);
    });
  });

  /* ── Agent API (used by the MCP server) ──────────────────────────────── */

  app.get('/api/health', async () => ({ ok: true, project: store.project, revision: store.scene.revision, studio: sockets.size > 0 }));

  /* ── Projects & templates ────────────────────────────────────────────── */

  const templateList = () =>
    Object.values(templates).map(({ createScene: _c, ...meta }) => meta);

  app.get('/api/projects', async () => ({ ...hub.list(), templates: templateList() }));

  app.post('/api/projects', async (req, reply) => {
    const body = z
      .object({
        template: z.string().min(1).optional(),
        starter: z.string().min(1).optional(),
        answers: z.record(z.string(), DesignAnswer).default({}),
        name: z.string().trim().min(1).max(60).optional(),
      })
      .refine((b) => b.template || b.starter, 'give a template (sample game) or a starter (genre interview)')
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: z.prettifyError(body.error) });
    try {
      if (body.data.starter) {
        const st = starters[body.data.starter];
        if (!st) return reply.code(400).send({ ok: false, error: `unknown starter ${body.data.starter}; available: ${Object.keys(starters).join(', ')}` });
        const title = body.data.name ?? `Untitled ${st.name}`;
        const seed = st.seed(body.data.answers, title);
        const brief: DesignBrief = {
          starter: st.id,
          genre: st.genre,
          title,
          answers: body.data.answers,
          followUps: [],
          gdd: seed.gdd,
          plan: seed.plan,
          status: 'interview',
          producer: { kind: producer && ['saved', 'environment'].includes(producer.status().source) ? 'embedded' : 'agent' },
          updatedAt: Date.now(),
        };
        const s = hub.createFromScene(`starter:${st.id}`, title, st.build(body.data.answers, title), brief);
        s.log({ kind: 'system', id: 'forge', name: 'FORGE' }, 'info', `New ${st.name} “${title}” forged from the design interview — playable greybox ready`);
        s.createDirective(DIRECTOR, `Build “${title}” from the design brief. Load the ${st.skill} skill, read forge_brief, and bring open questions and build steps to the Director in Team Room.`, []);
        // Auto-run only with explicit credentials; unverified (e.g. a stored login) waits for the Director's click — no surprise billing.
        if (producer && ['saved', 'environment'].includes(producer.status().source)) void produce(s, 'interview');
        return { ok: true, project: s.project, skill: st.skill };
      }
      const s = hub.create(body.data.template!, body.data.name);
      s.log({ kind: 'system', id: 'forge', name: 'FORGE' }, 'info', `New ${s.project.template} project “${s.project.name}” created`);
      return { ok: true, project: s.project, skill: templates[body.data.template!]?.skill };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/projects/:id/open', async (req, reply) => {
    try {
      const s = hub.activate((req.params as { id: string }).id);
      return { ok: true, project: s.project, skill: templates[s.project.template]?.skill };
    } catch (err) {
      return reply.code(404).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/game', async () => ({ revision: store.scene.revision, game: store.scene.game }));

  /* ── Genre starters, design interview, Producer ──────────────────────── */

  app.get('/api/starters', async () => ({ starters: Object.values(starters).map(starterInfo), producer: producer?.status() ?? { available: false, source: 'none' } }));

  const producing = new WeakSet<ProjectStore>();
  /** Run the embedded Producer for the active brief, if credentials exist. Never throws. */
  const produce = async (target: ProjectStore, phase: 'interview' | 'final') => {
    const brief = target.brief;
    const starter = brief ? starters[brief.starter] : undefined;
    if (!brief || !starter || !producer || !producer.status().available || producing.has(target) || target.team.isPaused('producer')) return;
    const by = { kind: 'agent' as const, id: 'producer', name: 'Producer' };
    target.touchCrew(by, { status: 'working', message: phase === 'interview' ? `Drafting the design for “${brief.title}”` : 'Finalizing the design doc' });
    target.setBrief({ ...brief, status: 'designing', producer: { kind: 'embedded' } });
    producing.add(target);
    try {
      const guidance = target.team.snapshot().events.flatMap((event) =>
        event.kind === 'message' && event.author.kind === 'human' &&
        (event.thread === by.id || event.mentions.includes(by.id)) ? [event.text] : []).slice(-10);
      const out = await producer.design(target.brief!, starterInfo(starter), phase, guidance, (summary, complete) => {
        const text = summary.trim().slice(0, 2000);
        if (complete) {
          if (text) target.team.note(by, TEAM_THREAD, 'thought', text, [], { source: 'provider_summary' });
          target.publishThinking(null);
        } else if (text) target.publishThinking({ author: by, text });
      });
      const followUps = out.followUps.map((f, i) => ({ id: `f${Date.now().toString(36)}${i}`, prompt: f.prompt, options: f.options.slice(0, 4), askedBy: 'Producer', at: Date.now() }));
      const cur = target.brief!;
      target.setBrief({ ...cur, gdd: out.gdd, plan: out.plan, followUps: [...cur.followUps, ...followUps], status: followUps.length ? 'interview' : 'ready', producer: { kind: 'embedded' } });
      const result = followUps.length ? 'The draft is ready. Answer the follow-up questions in Design.' : 'The design is ready. Review the build steps before the team starts.';
      target.team.note(by, TEAM_THREAD, 'result', result);
      if (guidance.length) target.team.note(by, by.id, 'result', result);
      for (const question of followUps) {
        const text = TeamText.safeParse(question.prompt.slice(0, 2000));
        if (text.success) target.team.note(by, TEAM_THREAD, 'question', text.data);
      }
      const steps = PlanSteps.safeParse(out.plan.map((step) => step.slice(0, 400)).filter((step) => step.trim()).slice(0, 40));
      if (steps.success) target.team.propose(by, TEAM_THREAD, steps.data);
      target.touchCrew(by, { status: followUps.length ? 'waiting' : 'idle', message: followUps.length ? 'Waiting on your answers' : 'Design ready' });
    } catch (err) {
      const cur = target.brief!;
      target.setBrief({ ...cur, status: 'interview', producer: { kind: 'agent', note: (err as Error).message } });
      target.log(by, 'warn', `PRODUCER unavailable: ${(err as Error).message} — an MCP agent can run the interview via forge_brief / forge_ask`);
      target.touchCrew(by, { status: 'blocked', message: 'No Claude credentials' });
    } finally {
      target.publishThinking(null);
      producing.delete(target);
    }
  };

  app.get('/api/brief', async () => {
    const b = store.brief;
    const st = b ? starters[b.starter] : undefined;
    return { brief: b, questions: st?.questions ?? [], skill: st?.skill ?? templates[store.project.template]?.skill ?? 'forge-game-builder' };
  });

  app.post('/api/brief/followups/:id', async (req, reply) => {
    const body = z.object({ answer: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    const b = store.brief;
    if (!body.success || !b) return reply.code(400).send({ ok: false, error: body.success ? 'no brief' : z.prettifyError(body.error) });
    const id = (req.params as { id: string }).id;
    if (!b.followUps.some((f) => f.id === id)) return reply.code(404).send({ ok: false, error: 'no such question' });
    const followUps = b.followUps.map((f) => (f.id === id ? { ...f, answer: body.data.answer } : f));
    const by = req.headers['x-forge-agent-id'] ? agentFrom(req) : DIRECTOR;
    store.setBrief({ ...b, followUps });
    store.log(by, 'info', `ANSWER ▸ ${b.followUps.find((f) => f.id === id)!.prompt.slice(0, 50)} → ${body.data.answer.slice(0, 80)}`);
    const target = store;
    if (followUps.every((f) => f.answer) && b.producer.kind === 'embedded') void produce(target, 'final');
    return { ok: true };
  });

  app.post('/api/brief/ask', async (req, reply) => {
    const body = z.object({ prompt: z.string().trim().min(3).max(400), options: z.array(z.string().max(120)).max(4).default([]) }).safeParse(req.body);
    const b = store.brief;
    if (!body.success || !b) return reply.code(400).send({ ok: false, error: body.success ? 'this project has no design brief' : z.prettifyError(body.error) });
    const author = agentFrom(req);
    const f = { id: `f${Date.now().toString(36)}${b.followUps.length}`, prompt: body.data.prompt, options: body.data.options, askedBy: author.name, at: Date.now() };
    store.setBrief({ ...b, followUps: [...b.followUps, f], status: 'interview', producer: b.producer.kind === 'embedded' ? b.producer : { kind: 'agent' } });
    if (TeamAgentId.safeParse(author.id).success) store.team.note(author, TEAM_THREAD, 'question', f.prompt);
    store.touchCrew(author, { status: 'waiting', message: 'Waiting on the Director’s answer' });
    return { ok: true, id: f.id };
  });

  app.post('/api/brief', async (req, reply) => {
    const body = z
      .object({ gdd: z.string().max(40000).optional(), plan: z.array(z.string().max(400)).max(40).optional(), status: z.enum(['interview', 'designing', 'ready', 'building']).optional() })
      .safeParse(req.body);
    const b = store.brief;
    if (!body.success || !b) return reply.code(400).send({ ok: false, error: body.success ? 'this project has no design brief' : z.prettifyError(body.error) });
    store.setBrief({ ...b, ...body.data });
    if (body.data.status) store.log(agentFrom(req), 'action', `BRIEF ▸ status ${body.data.status}`);
    return { ok: true };
  });

  app.get('/api/database', async () => ({ revision: store.scene.revision, database: store.scene.database, lint: lintDatabase(store.scene.database) }));

  app.get('/api/prefabs', async () => ({
    revision: store.scene.revision, prefabs: store.scene.database.prefabs,
  }));

  app.post('/api/prefabs', async (req, reply) => {
    const body = PrefabCreate.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const created = store.createPrefab(agentFrom(req), body.data);
    return created.ok ? { ...outcome(created), prefabId: created.prefabId } : outcome(created);
  });

  app.post('/api/prefabs/place', async (req, reply) => {
    const body = PrefabPlace.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const placed = store.placePrefab(agentFrom(req), body.data);
    return placed.ok ? { ...outcome(placed), rootId: placed.rootId } : outcome(placed);
  });

  app.get('/api/assets', async () => assets?.list(store.project.projectId) ?? { projectId: store.project.projectId, configured: false, assets: [] });

  app.get('/api/assets/content/:id', async (req, reply) => {
    const id = AssetId.safeParse((req.params as { id: string }).id);
    const preview = (req.query as { preview?: string }).preview === '1';
    const file = id.success && assets?.content(hub.list().projects.map((project) => project.projectId), id.data, preview);
    if (!file) return reply.code(404).send({ error: 'No model at this version' });
    return reply.header('Cache-Control', preview ? 'no-store' : 'private, max-age=31536000, immutable')
      .type('model/gltf-binary').send(createReadStream(file));
  });

  const directorAssets = (req: FastifyRequest) => !req.headers['x-forge-agent-id'];
  const matchingProject = (req: FastifyRequest) => {
    const { projectId } = req.query as { projectId?: string };
    return projectId === undefined || projectId === store.project.projectId;
  };

  app.post('/api/assets/import', { bodyLimit: GLB_BYTE_LIMIT }, async (req, reply) => {
    if (!directorAssets(req)) return reply.code(403).send({ error: 'Only the Director can import local models.' });
    if (!matchingProject(req)) return reply.code(409).send({ error: 'The active project changed.' });
    const input = AssetImport.safeParse(req.query);
    if (!assets || !input.success || !Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ error: 'Choose a local .glb file.' });
    }
    const projectId = store.project.projectId;
    try {
      return reply.code(201).send(await assets.importGlb(projectId, input.data.fileName, req.body));
    } catch (error) {
      return reply.code(422).send({ error: (error as Error).message });
    }
  });

  app.post('/api/assets/key', async (req, reply) => {
    if (!directorAssets(req)) return reply.code(403).send({ error: 'Agents cannot set credentials' });
    const body = z.object({ key: z.string().trim().min(12).max(300).nullable() }).safeParse(req.body);
    if (!assets || !body.success) return reply.code(400).send({ error: 'Invalid Tripo key' });
    assets.setKey(body.data.key);
    return { configured: assets.list(store.project.projectId).configured };
  });

  app.post('/api/assets/generate', async (req, reply) => {
    if (!directorAssets(req)) return reply.code(403).send({ error: 'The Director starts paid generation from Studio.' });
    if (!matchingProject(req)) return reply.code(409).send({ error: 'The active project changed.' });
    const body = AssetGenerate.safeParse(req.body);
    if (!assets || !body.success) return reply.code(400).send({ error: body.success ? 'Generated assets are unavailable' : z.prettifyError(body.error) });
    try {
      return reply.code(202).send(assets.generate(store.project.projectId, body.data));
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });

  app.post('/api/assets/:id/review', async (req, reply) => {
    if (!directorAssets(req)) return reply.code(403).send({ error: 'Only the Director can review a generated model.' });
    if (!matchingProject(req)) return reply.code(409).send({ error: 'The active project changed.' });
    const id = AssetId.safeParse((req.params as { id: string }).id);
    const body = z.object({ approve: z.boolean() }).safeParse(req.body);
    if (!assets || !id.success || !body.success) return reply.code(400).send({ error: 'Invalid review' });
    try {
      return assets.review(store.project.projectId, id.data, body.data.approve);
    } catch (error) {
      return reply.code(409).send({ error: (error as Error).message });
    }
  });

  app.post('/api/assets/place', async (req, reply) => {
    const body = AssetPlacement.safeParse(req.body);
    if (!assets || !body.success) return reply.code(400).send({ ok: false, error: body.success ? 'Generated assets are unavailable' : z.prettifyError(body.error) });
    try {
      const { name, mutation } = assets.placement(store.project.projectId, body.data);
      const placed = store.submit(agentFrom(req), 'Place ' + name, [mutation]);
      return placed.ok ? { ...outcome(placed), rootId: mutation.entity.id } : outcome(placed);
    } catch (error) {
      return reply.code(409).send({ ok: false, error: (error as Error).message });
    }
  });

  app.get('/api/producer', async () => producer?.status() ?? { available: false, source: 'none' });

  app.post('/api/producer/key', async (req, reply) => {
    // Only the Studio (no agent header) may set the key; it is never returned to any client.
    if (req.headers['x-forge-agent-id']) return reply.code(403).send({ ok: false, error: 'agents cannot set credentials' });
    const body = z.object({ key: z.string().trim().min(20).max(300).nullable() }).safeParse(req.body);
    if (!body.success || !producer) return reply.code(400).send({ ok: false, error: 'invalid key' });
    producer.setKey(body.data.key);
    return { ok: true, status: producer.status() };
  });

  app.post('/api/brief/produce', async () => {
    void produce(store, store.brief?.followUps.length && store.brief.followUps.every((f) => f.answer) ? 'final' : 'interview');
    return { ok: true };
  });

  /* ── Multiplayer rooms ───────────────────────────────────────────────── */

  const rooms = new RoomManager();
  app.addHook('onClose', async () => rooms.closeAll());

  app.get('/api/rooms', async () => ({ rooms: rooms.list() }));

  app.post('/api/rooms', async (req) => {
    const by = req.headers['x-forge-agent-id'] ? agentFrom(req) : DIRECTOR;
    const room = await rooms.create(store.scene, store.project.projectId, store.project.name);
    store.log(by, 'action', `HOSTED session ${room.id} · ${store.project.name} · up to ${store.scene.game.maxPlayers} players (rev ${store.scene.revision})`);
    return { ok: true, room: room.info() };
  });

  app.delete('/api/rooms/:id', async (req, reply) => {
    const room = rooms.get((req.params as { id: string }).id);
    if (!room) return reply.code(404).send({ ok: false, error: 'no such room' });
    room.close('closed by host');
    return { ok: true };
  });

  app.get('/net/:roomId', { websocket: true }, (socket, req) => {
    const room = rooms.get((req.params as { roomId: string }).roomId);
    if (!room) {
      socket.send(JSON.stringify({ t: 'closed', reason: 'no such session' }));
      return socket.close();
    }
    room.attach(socket);
  });

  app.get('/api/scene', async () => ({ project: store.project, scene: store.scene }));

  app.get('/api/scene/outline', async (req) => {
    store.touchCrew(agentFrom(req));
    return { revision: store.scene.revision, outline: outlineScene(store.scene) };
  });

  app.post('/api/scene/entities', async (req, reply) => {
    const body = z.object({ ids: z.array(EntityId).min(1).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const entities = body.data.ids.map((id) => store.scene.entities[id] ?? { id, missing: true });
    return { revision: store.scene.revision, entities };
  });

  app.post('/api/tx', async (req, reply) => {
    const body = z
      .object({
        label: z.string().trim().min(1).max(160),
        mutations: z.array(z.unknown()).min(1).max(500),
        baseRevision: z.number().int().min(0).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: { code: 'INVALID', message: z.prettifyError(body.error) } });
    const author = agentFrom(req);
    const o = store.submit(author, body.data.label, body.data.mutations as never, body.data.baseRevision);
    if (!o.ok) store.log(author, 'warn', `rejected “${body.data.label}”: ${o.error.code} ${o.error.message.slice(0, 160)}`);
    return outcome(o);
  });

  app.post('/api/history/undo', async (req) => outcome(store.undo(agentFrom(req))));

  app.get('/api/history', async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 30) || 30, 400);
    return { revision: store.scene.revision, history: store.history(limit) };
  });

  app.get('/api/activity', async (req, reply) => {
    const query = z.object({ since: z.coerce.number().pipe(ActivityCursor).optional() }).safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: z.prettifyError(query.error) });
    return store.readActivity(query.data.since);
  });

  const teamAgent = (req: FastifyRequest): Author | null => {
    const author = agentFrom(req);
    return TeamAgentId.safeParse(author.id).success && author.id.toLowerCase() !== 'producer' ? author : null;
  };

  app.get('/api/team/inbox', async (req, reply) => {
    const author = teamAgent(req);
    const query = z.object({ since: z.coerce.number().pipe(TeamInboxCursor).optional() }).safeParse(req.query);
    if (!author || !query.success) return reply.code(400).send({ error: 'Invalid agent id or inbox cursor' });
    if (!store.crew.has(author.id)) store.touchCrew(author);
    return { projectId: store.project.projectId, ...store.team.inbox(author.id, query.data.since) };
  });

  app.post('/api/team/message', async (req, reply) => {
    const author = teamAgent(req);
    const body = z.object({ thread: TeamTarget, kind: TeamPostKind, text: TeamText, focusEntityIds: TeamFocus.default([]) }).safeParse(req.body);
    if (!author || !body.success) return reply.code(400).send({ error: author && !body.success ? z.prettifyError(body.error) : 'Invalid agent id' });
    const { thread, kind, text, focusEntityIds } = body.data;
    if (!store.crew.has(author.id)) store.touchCrew(author);
    return store.team.note(author, thread === 'dm' ? author.id : TEAM_THREAD, kind, text, focusEntityIds);
  });

  app.post('/api/team/think', async (req, reply) => {
    const author = teamAgent(req);
    const body = z.object({ thread: TeamTarget, kind: PublishedKind, text: TeamText }).safeParse(req.body);
    if (!author || !body.success) return reply.code(400).send({ error: author && !body.success ? z.prettifyError(body.error) : 'Invalid agent id' });
    const { thread, kind, text } = body.data;
    if (!store.crew.has(author.id)) store.touchCrew(author);
    return store.team.note(author, thread === 'dm' ? author.id : TEAM_THREAD, kind === 'plan' ? 'thought' : kind, text, [], { source: 'published' });
  });

  app.post('/api/team/plan', async (req, reply) => {
    const author = teamAgent(req);
    const body = z.object({ thread: TeamTarget, steps: PlanSteps }).safeParse(req.body);
    if (!author || !body.success) return reply.code(400).send({ error: author && !body.success ? z.prettifyError(body.error) : 'Invalid agent id' });
    if (!store.crew.has(author.id)) store.touchCrew(author);
    return store.team.propose(author, body.data.thread === 'dm' ? author.id : TEAM_THREAD, body.data.steps);
  });

  app.get('/api/selection', async () => ({
    revision: store.scene.revision,
    selection: store.humanSelection
      .map((id) => store.scene.entities[id])
      .filter(Boolean)
      .map((e) => ({ id: e!.id, name: e!.name, position: e!.transform.position, components: describeComponents(e!) })),
  }));

  app.post('/api/presence', async (req, reply) => {
    const body = z
      .object({ status: AgentStatus, message: z.string().max(280).default(''), focusEntityIds: z.array(EntityId).max(100).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const author = agentFrom(req);
    const prev = store.crew.get(author.id)?.message;
    const m = store.touchCrew(author, body.data);
    if (body.data.message && body.data.message !== prev) store.log(author, 'info', body.data.message);
    return { ok: true, crew: m };
  });

  app.get('/api/directives', async () => ({ directives: [...store.directives.values()] }));

  app.post('/api/directives/:id', async (req, reply) => {
    const body = z.object({ status: DirectiveStatus, response: z.string().max(2000).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    const d = store.updateDirective((req.params as { id: string }).id, agentFrom(req), body.data.status, body.data.response);
    return d ? { ok: true, directive: d } : reply.code(404).send({ ok: false, error: 'no such directive' });
  });

  app.post('/api/capture', async (req, reply) => {
    const body = z
      .object({
        view: CaptureView.default('current'),
        helpers: z.boolean().default(false),
        width: z.number().int().min(160).max(1920).default(1024),
        height: z.number().int().min(120).max(1080).default(640),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    try {
      const dataUrl = await store.requestCapture(agentFrom(req), body.data.view, body.data.helpers, body.data.width, body.data.height);
      return { ok: true, dataUrl };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });

  const reports: PlaytestReport[] = [];
  app.post('/api/playtest', async (req, reply) => {
    const body = PlaytestScript.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: z.prettifyError(body.error) });
    const author = agentFrom(req);
    store.touchCrew(author, { status: 'working', message: `Playtesting “${body.data.name}”`, focusEntityIds: [] });
    try {
      const report = await runPlaytest(store.scene, body.data);
      reports.push(report);
      if (reports.length > 20) reports.shift();
      const okSteps = report.steps.filter((s) => s.ok).length;
      const failed = report.steps.find((s) => !s.ok);
      const failNote = failed ? ` · ✗ ${failed.step}: ${failed.note ?? ''}` : '';
      store.log(
        author,
        report.passed ? 'action' : 'warn',
        `PLAYTEST ${report.passed ? 'PASS' : 'FAIL'} “${report.name}” · ${okSteps}/${body.data.steps.length} steps · ${report.simSeconds}s sim${failNote}`,
      );
      return { ok: true, report, text: formatReport(report) };
    } catch (err) {
      store.log(author, 'error', `PLAYTEST crashed: ${(err as Error).message}`);
      return reply.code(500).send({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/playtests', async () => ({ reports }));

  app.get('/api/schema', async () => ({
    mutation: z.toJSONSchema(Mutation, { io: 'input', unrepresentable: 'any' }),
    components: Object.fromEntries(
      Object.entries(ComponentSchemas).map(([k, s]) => [k, z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' })]),
    ),
  }));

  return app;
}
