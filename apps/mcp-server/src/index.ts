#!/usr/bin/env node
/**
 * FORGE MCP server — gives Claude Code / Codex / any MCP client typed, transactional
 * control of the live Studio scene. Every write goes through the daemon's reducer:
 * validated, conflict-checked, lock-respecting, undoable, and visible to the human
 * in the Studio as it happens.
 */
import { ActivityCursor, AgentStatus, CaptureView, ComponentName, DirectiveStatus, EntityId, Mutation, PlaytestStep } from '@forge/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const BASE = process.env.FORGE_URL ?? 'http://127.0.0.1:4317';
const AGENT_ID = process.env.FORGE_AGENT_ID ?? 'claude-code';
const AGENT_NAME = process.env.FORGE_AGENT_NAME ?? 'Claude';

async function call<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-agent-id': AGENT_ID, 'x-forge-agent-name': AGENT_NAME },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(`FORGE daemon unreachable at ${BASE}. Start it with \`pnpm dev\` in the forge repo.`);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  // Structured `{ ok: false, error }` bodies are returned to the tool; anything else is a transport error.
  if (!res.ok && (json as { ok?: boolean }).ok !== false) throw new Error(`${res.status}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});
const errorText = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });

const server = new McpServer(
  { name: 'forge', version: '0.1.0' },
  {
    instructions: `FORGE is a live, multiplayer-ready 3D game studio. A human Director is usually watching the Studio while you work — your edits, status and focus appear in their viewport in real time.

Conventions: meters, Y-up, right-handed; rotations are Euler XYZ in DEGREES. Entity ids look like ent_lowercase_words and you may choose them, so one transaction can create a parent and its children. Unit primitives are scaled by mesh.size (diameter for round shapes); a 'plane' lies flat on XZ.

Workflow:
1. forge_status(working, "what you're doing", focus ids) so the Director sees intent.
2. forge_scene_outline to read the scene; forge_get_entities for full JSON of specific entities.
3. forge_apply with ONE transaction per logical change and a clear human-readable label. Pass the baseRevision you read: if a human changed those entities meanwhile you get CONFLICT — re-read and retry, never blindly overwrite.
4. forge_capture to SEE the result, and forge_playtest to PROVE gameplay works (walk_to, interact, expect). Check both before reporting done.
5. Check forge_directives for queued instructions from the Director; claim, then mark done with a short response.
6. Check forge_activity between tasks. Keep its cursor per project and continue while hasMore is true. Only offer unsolicited follow-ups on scene activity when settings.autoReact is true.

Genres: start new games with forge_project_create from a template (exploration, rpg, mmorpg, fighting, racing) and load the matching FORGE skill (forge-rpg, forge-mmo, forge-fighting, forge-racing; forge-game-builder for everything) — also available as MCP prompts on this server. Game rules live in scene.game (forge_game_settings; change via set_game).

Gameplay semantics: collider (+ rigidBody static|dynamic|kinematic) makes things solid; interactable verbs: pickup (grantsItem), open (kinematic doors slide along local +X; requiresItem locks them), use/talk/inspect (an interactable tagged #objective becomes a mission objective). spawnPoint places the player. Trigger colliders (isTrigger) fire trigger_enter/exit.

Rules: entities marked LOCKED are the Director's protected work — never try to modify them. Prefer patch_component for small edits. Use forge_undo to roll back your own last transaction.`,
  },
);

server.registerTool(
  'forge_scene_outline',
  {
    title: 'Read scene outline',
    description: 'Compact hierarchy of the live scene: ids, names, positions, component summaries, locks. Includes the current revision.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const r = await call<{ revision: number; outline: string }>('GET', '/api/scene/outline');
    return text(r.outline);
  },
);

server.registerTool(
  'forge_get_entities',
  {
    title: 'Get entities',
    description: 'Full typed JSON for specific entities (transform, every component value, flags, rev).',
    inputSchema: { ids: z.array(EntityId).min(1).max(200) },
    annotations: { readOnlyHint: true },
  },
  async ({ ids }) => text(await call('POST', '/api/scene/entities', { ids })),
);

server.registerTool(
  'forge_apply',
  {
    title: 'Apply scene transaction',
    description:
      'Apply an atomic, typed transaction of scene mutations. All succeed or none do. Ops: create_entity, delete_entity (removes subtree), set_transform, rename_entity, reparent, set_component (full value), patch_component (deep-merge; creates if absent), remove_component, set_flags (visible/tags), set_environment. Components: mesh, light, collider, rigidBody, spawnPoint, interactable, network. Call forge_schema for exact component fields.',
    inputSchema: {
      label: z.string().min(1).max(160).describe('Human-readable change description shown on the Studio timeline'),
      mutations: z.array(Mutation).min(1).max(500),
      baseRevision: z.number().int().min(0).optional().describe('Scene revision your edit is based on (from forge_scene_outline). Omit only for additive edits.'),
    },
    annotations: { destructiveHint: true },
  },
  async ({ label, mutations, baseRevision }) => {
    const r = await call<{ ok: boolean; revision?: number; touched?: string[]; error?: { code: string; message: string; mutationIndex?: number } }>(
      'POST',
      '/api/tx',
      { label, mutations, ...(baseRevision === undefined ? {} : { baseRevision }) },
    );
    if (!r.ok && r.error)
      return errorText(
        `${r.error.code}${r.error.mutationIndex === undefined ? '' : ` at mutation ${r.error.mutationIndex}`}: ${r.error.message}`,
      );
    return text(`applied → revision ${r.revision}; touched ${r.touched?.join(', ')}`);
  },
);

server.registerTool(
  'forge_undo',
  {
    title: 'Undo my last transaction',
    description: "Revert this agent's most recent transaction. Refused if someone has changed the same entities since.",
    inputSchema: {},
    annotations: { destructiveHint: true },
  },
  async () => {
    const r = await call<{ ok: boolean; revision?: number; error?: { code: string; message: string } }>('POST', '/api/history/undo', {});
    return r.ok ? text(`undone → revision ${r.revision}`) : errorText(`${r.error?.code}: ${r.error?.message}`);
  },
);

server.registerTool(
  'forge_history',
  {
    title: 'Recent history',
    description: 'Recent transactions (who changed what, at which revision, reverted or not).',
    inputSchema: { limit: z.number().int().min(1).max(200).default(20) },
    annotations: { readOnlyHint: true },
  },
  async ({ limit }) => text(await call('GET', `/api/history?limit=${limit}`)),
);

server.registerTool(
  'forge_activity',
  {
    title: 'Read scene activity',
    description: 'Read committed entity changes by the Director and agents. A first call returns recent activity. Pass the returned cursor as since for new activity, and keep polling when hasMore is true. Track cursors per projectId. settings.autoReact is the Director’s opt-in for unsolicited follow-ups.',
    inputSchema: { since: ActivityCursor.optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ since }) => text(await call('GET', since === undefined ? '/api/activity' : `/api/activity?since=${since}`)),
);

server.registerTool(
  'forge_selection',
  {
    title: "Director's selection",
    description: 'Entities the human Director currently has selected in the Studio. Use for requests like "make this glow".',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/selection')),
);

server.registerTool(
  'forge_status',
  {
    title: 'Report status',
    description: 'Tell the Director what you are doing. Focus ids put your colored beacon on those entities in the viewport.',
    inputSchema: {
      status: AgentStatus,
      message: z.string().max(280).describe('Short present-tense line, e.g. "Lighting the courtyard"'),
      focusEntityIds: z.array(EntityId).max(100).optional(),
    },
  },
  async (args) => {
    await call('POST', '/api/presence', args);
    return text('status posted');
  },
);

server.registerTool(
  'forge_directives',
  {
    title: 'Read directives',
    description: 'Instructions queued by the Director from the Studio. Work on open ones: claim first, then mark done.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/directives')),
);

server.registerTool(
  'forge_directive_update',
  {
    title: 'Update directive',
    description: 'Claim, complete, or reject a directive with a short response to the Director.',
    inputSchema: { id: z.string(), status: DirectiveStatus, response: z.string().max(2000).optional() },
  },
  async ({ id, ...rest }) => text(await call('POST', `/api/directives/${encodeURIComponent(id)}`, rest)),
);

server.registerTool(
  'forge_capture',
  {
    title: 'Capture viewport',
    description:
      "Screenshot the live Studio viewport so you can see the scene. view: current (Director's camera), overview (frames the whole scene), top, focus (frames the Director's selection).",
    inputSchema: {
      view: CaptureView.default('overview'),
      helpers: z.boolean().default(false).describe('Include editor helpers (grid, light icons, spawn markers)'),
      width: z.number().int().min(160).max(1920).default(1024),
      height: z.number().int().min(120).max(1080).default(640),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await call<{ ok: boolean; dataUrl?: string; error?: string }>('POST', '/api/capture', args);
    if (!r.ok || !r.dataUrl) return errorText(r.error ?? 'capture failed');
    const [, mime = 'image/png', data = ''] = /^data:([^;]+);base64,(.*)$/.exec(r.dataUrl) ?? [];
    return { content: [{ type: 'image' as const, mimeType: mime, data }] };
  },
);

server.registerTool(
  'forge_playtest',
  {
    title: 'Run a headless playtest',
    description:
      'Play the CURRENT scene headlessly with a deterministic script and get a step-by-step report (no Studio needed; runs ~40x real time). Steps: walk_to {entityId, stopDistance?} (reports "stuck" if the path is blocked), interact, move {direction forward|back|left|right|[x,z], seconds}, turn {degrees}, face {entityId}, jump, wait {seconds}, teleport {position}, expect {check}. Checks: has_item, lacks_item, event {event, entityId?}, no_event, near {entityId, within}, objective_done, door_open, grounded. Fails fast at the first failed step.',
    inputSchema: {
      name: z.string().min(1).max(120).describe('What this playtest proves, e.g. "Player can unlock the hub"'),
      steps: z.array(PlaytestStep).min(1).max(300),
      maxSimSeconds: z.number().positive().max(600).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const r = await call<{ ok: boolean; text?: string; report?: { passed: boolean }; error?: string }>('POST', '/api/playtest', args);
    if (!r.ok) return errorText(String(r.error));
    return { ...(r.report?.passed ? {} : { isError: true }), content: [{ type: 'text' as const, text: r.text ?? '' }] };
  },
);

server.registerTool(
  'forge_projects',
  {
    title: 'Projects and genre templates',
    description:
      'List the workspace projects (which one is active) and the genre templates you can start a new game from (exploration, rpg, mmorpg, fighting, racing), each with the FORGE skill to load before building in it.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/projects')),
);

server.registerTool(
  'forge_project_create',
  {
    title: 'New game from a template',
    description:
      'Create a new project from a genre template and make it active (the Director’s Studio switches to it). Returns the skill to load, e.g. forge-rpg. Every template ships playable and passes its own playtests.',
    inputSchema: {
      template: z.string().optional().describe('Sample game id from forge_projects (hollow-vale, dust-circuit…)'),
      starter: z.string().optional().describe('Genre starter id (rpg, mmorpg, adventure, fighting, racing, shooter) — builds a configured greybox from interview answers'),
      answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional().describe('Starter interview answers keyed by question id (see GET starters via forge_projects)'),
      name: z.string().min(1).max(60).optional(),
    },
  },
  async (args) => {
    const r = await call<{ ok: boolean; project?: { projectId: string; name: string }; skill?: string; error?: string }>('POST', '/api/projects', args);
    return r.ok ? text(`Created and opened “${r.project!.name}” (${r.project!.projectId}). Load the ${r.skill} skill before building.`) : errorText(String(r.error));
  },
);

server.registerTool(
  'forge_starters',
  {
    title: 'Genre starters',
    description: 'The genre starters (rpg, mmorpg, adventure, fighting, racing, shooter) with their design-interview questions and options. Use them to interview the user before forge_project_create {starter, answers}.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/starters')),
);

server.registerTool(
  'forge_brief',
  {
    title: 'Read the design brief',
    description:
      'The active project’s design brief: interview answers, follow-up questions (and the Director’s answers), the game design doc and the build plan. Read it before building a starter project; ask open questions with forge_ask.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/brief')),
);

server.registerTool(
  'forge_ask',
  {
    title: 'Ask the Director a design question',
    description:
      'Post a design decision to the Director in the Studio (appears with your suggested answers). Ask only what only they can decide; poll forge_brief for the answer. Keep to the decisions that most change what gets built.',
    inputSchema: { prompt: z.string().min(3).max(400), options: z.array(z.string().max(120)).max(4).optional() },
  },
  async (args) => text(await call('POST', '/api/brief/ask', args)),
);

server.registerTool(
  'forge_brief_update',
  {
    title: 'Update the design brief',
    description: 'Write the game design doc (markdown), the ordered build plan, and/or the status (interview → designing → ready → building).',
    inputSchema: {
      gdd: z.string().max(40000).optional(),
      plan: z.array(z.string().max(400)).max(40).optional(),
      status: z.enum(['interview', 'designing', 'ready', 'building']).optional(),
    },
  },
  async (args) => text(await call('POST', '/api/brief', args)),
);

server.registerTool(
  'forge_database',
  {
    title: 'Gameplay database',
    description:
      'Read the gameplay framework database (stats, abilities, statuses, skill trees, items, loot, progression, loadout) with a lint report of dangling references and unreachable tree nodes. Edit it via forge_apply ops upsert_def {table, def}, remove_def {table, id}, set_database {patch: {progression?, loadout?}}.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/database')),
);

server.registerTool(
  'forge_project_open',
  {
    title: 'Switch project',
    description: 'Make another existing project active. The Director’s Studio follows.',
    inputSchema: { projectId: z.string() },
  },
  async ({ projectId }) => {
    const r = await call<{ ok: boolean; project?: { name: string }; skill?: string; error?: string }>('POST', `/api/projects/${encodeURIComponent(projectId)}/open`, {});
    return r.ok ? text(`Opened “${r.project!.name}”. Skill: ${r.skill}`) : errorText(String(r.error));
  },
);

server.registerTool(
  'forge_game_settings',
  {
    title: 'Read game settings',
    description:
      'Genre, controller (character|vehicle|fighter), camera, win condition (objectives|race|ko|none), player/vehicle tuning, bots, laps, rounds, maxPlayers and the quest objective chain. Change them with forge_apply using op set_game {patch}.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(await call('GET', '/api/game')),
);

server.registerTool(
  'forge_sessions',
  {
    title: 'Multiplayer sessions',
    description: 'List live multiplayer sessions, or host the active project as a new authoritative session (host: true). Players join at http://127.0.0.1:4318/play.html?room=CODE.',
    inputSchema: { host: z.boolean().default(false) },
  },
  async ({ host }) => {
    if (host) {
      const r = await call<{ room: { roomId: string } }>('POST', '/api/rooms', {});
      return text(`Hosted session ${r.room.roomId}. Join: http://127.0.0.1:4318/play.html?room=${r.room.roomId}`);
    }
    return text(await call('GET', '/api/rooms'));
  },
);

server.registerTool(
  'forge_schema',
  {
    title: 'Component schemas',
    description: 'JSON Schema for a component (fields, ranges, defaults) or for the whole Mutation union.',
    inputSchema: { component: ComponentName.optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ component }) => {
    const r = await call<{ mutation: unknown; components: Record<string, unknown> }>('GET', '/api/schema');
    return text(component ? r.components[component] : r.mutation);
  },
);

/* ── Skills as MCP prompts: the same playbooks Claude Code loads from .claude/skills,
      served to any MCP client (Codex, Cursor, …). One source of truth. ───────────── */
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../.claude/skills');
if (existsSync(skillsDir)) {
  for (const dir of readdirSync(skillsDir)) {
    const file = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf8');
    const description = /^description:\s*(.+)$/m.exec(raw)?.[1]?.trim() ?? dir;
    const body = raw.replace(/^---[\s\S]*?---\s*/, '');
    server.registerPrompt(dir, { title: dir, description }, () => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: body } }],
    }));
  }
}

await server.connect(new StdioServerTransport());
