import type {
  ActivitySettings,
  SceneActivity,
  TeamSnapshot,
  ClientMessage,
  CommsEntry,
  CrewMember,
  DesignBrief,
  Directive,
  EntityId,
  HistoryEntry,
  MutationInput,
  ProjectInfo,
  SceneDoc,
  ServerMessage,
} from '@forge/contracts';
import { applyTransaction, buildTransaction } from '@forge/scene';
import { create } from 'zustand';
import type { GizmoMode, ViewportStats } from '../viewport/EditorViewport';

export interface Toast {
  id: number;
  tone: 'error' | 'info';
  title: string;
  text: string;
}

export interface StudioState {
  conn: 'connecting' | 'online' | 'offline';
  project: ProjectInfo | null;
  scene: SceneDoc | null;
  history: HistoryEntry[];
  crew: CrewMember[];
  directives: Directive[];
  comms: CommsEntry[];
  activity: SceneActivity[];
  activitySettings: ActivitySettings;
  team: TeamSnapshot;
  me: CrewMember | null;
  selection: EntityId[];
  gizmo: GizmoMode;
  space: 'world' | 'local';
  snap: boolean;
  tapeCursor: string | null;
  paletteOpen: boolean;
  renamingId: EntityId | null;
  stats: ViewportStats | null;
  toasts: Toast[];
  shutter: { at: number; label: string; color: string } | null;
  brief: DesignBrief | null;
  designOpen: boolean;
  assetsOpen: boolean;
}

export const useStudio = create<StudioState>(() => ({
  conn: 'connecting',
  project: null,
  scene: null,
  history: [],
  crew: [],
  directives: [],
  comms: [],
  activity: [],
  activitySettings: { autoReact: false },
  team: { events: [], paused: [], thinking: null },
  me: null,
  selection: [],
  gizmo: 'translate',
  space: 'world',
  snap: false,
  tapeCursor: null,
  paletteOpen: false,
  renamingId: null,
  stats: null,
  toasts: [],
  shutter: null,
  brief: null,
  designOpen: false,
  assetsOpen: false,
}));

const set = useStudio.setState;
const get = useStudio.getState;

/* ── wire ──────────────────────────────────────────────────────────────── */

let ws: WebSocket | null = null;
let retry = 0;
let captureHandler: ((m: Extract<ServerMessage, { type: 'capture.request' }>) => void) | null = null;

export function onCaptureRequest(fn: typeof captureHandler): void {
  captureHandler = fn;
}

export function connect(): void {
  set({ conn: 'connecting' });
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
  };
  sock.onmessage = (ev) => handle(JSON.parse(String(ev.data)) as ServerMessage);
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    set({ conn: 'offline' });
    setTimeout(connect, Math.min(500 * 2 ** retry++, 5000));
  };
}

export function send(msg: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function resync(): void {
  ws?.close();
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case 'snapshot': {
      const sel = get().selection.filter((id) => msg.scene.entities[id]);
      set({
        conn: 'online',
        project: msg.project,
        scene: msg.scene,
        history: msg.history,
        crew: msg.crew,
        directives: msg.directives,
        comms: msg.comms,
        activity: msg.activity,
        activitySettings: msg.activitySettings,
        team: msg.team,
        me: msg.you,
        selection: sel,
        brief: msg.brief,
      });
      return;
    }
    case 'tx.applied': {
      const scene = get().scene;
      if (!scene) return;
      // Deterministic replay of the authoritative transaction through the same reducer.
      const r = applyTransaction(scene, msg.tx);
      if (!r.ok || r.scene.revision !== msg.entry.revision) return resync();
      set((s) => ({
        scene: r.scene,
        history: [...s.history, msg.entry].slice(-600),
        selection: s.selection.filter((id) => r.scene.entities[id]),
      }));
      return;
    }
    case 'history.updated':
      set((s) => ({ history: s.history.map((h) => (h.txId === msg.entry.txId ? msg.entry : h)) }));
      return;
    case 'tx.rejected':
      toast('error', msg.code, msg.message);
      return;
    case 'crew':
      set({ crew: msg.crew });
      return;
    case 'directives':
      set({ directives: msg.directives });
      return;
    case 'comms':
      set((s) => ({ comms: [...s.comms, msg.entry].slice(-400) }));
      return;
    case 'scene.activity':
      set((s) => ({ activity: [...s.activity, msg.entry].slice(-20) }));
      return;
    case 'activity.settings':
      set({ activitySettings: msg.settings });
      return;
    case 'team.event': {
      const event = msg.event;
      set(({ team }) => {
        const thread = team.events.filter((e) => e.thread === event.thread);
        const oldest = thread.length >= 120 ? thread[0]!.sequence : null;
        const paused = event.kind === 'guidance'
          ? event.paused ? [...team.paused, event.agentId] : team.paused.filter((id) => id !== event.agentId)
          : team.paused;
        return { team: { ...team, events: [...team.events.filter((e) => e.sequence !== oldest), event], paused } };
      });
      return;
    }
    case 'team.thinking':
      set(({ team }) => ({ team: { ...team, thinking: msg.thinking } }));
      return;
    case 'team.rejected':
      toast('error', 'Team Room', msg.message);
      return;
    case 'prefab.placed':
      if (get().scene?.entities[msg.rootId]) select([msg.rootId]);
      return;
    case 'brief':
      set({ brief: msg.brief });
      return;
    case 'capture.request':
      captureHandler?.(msg);
      return;
  }
}

/* ── actions ───────────────────────────────────────────────────────────── */

let toastSeq = 0;
export function toast(tone: Toast['tone'], title: string, text: string): void {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, title, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 6500 : 3500);
}

export function submit(label: string, mutations: MutationInput[]): void {
  const { scene, me } = get();
  if (!scene || !mutations.length) return;
  const author = { kind: 'human' as const, id: me?.id ?? 'director', name: me?.name ?? 'Director' };
  send({ type: 'tx.submit', tx: buildTransaction(scene, author, label, mutations) });
}

export function select(ids: EntityId[]): void {
  set({ selection: ids, renamingId: null });
  send({ type: 'selection', entityIds: ids });
}

export function pick(id: EntityId | null, additive: boolean): void {
  const cur = get().selection;
  if (!id) return additive ? undefined : select([]);
  if (additive) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  else select([id]);
}

export const undo = () => send({ type: 'history.undo' });
export const redo = () => send({ type: 'history.redo' });
export const revert = (txId: string) => send({ type: 'history.revert', txId });
