import {
  ActivitySettings,
  Prefab,
  SceneActivity,
  SceneDoc,
  TEAM_THREAD,
  newId,
  type Author,
  type ActivityPage,
  type CaptureView,
  type CommsEntry,
  type CrewMember,
  type DesignBrief,
  type Directive,
  type DirectiveStatus,
  type EntityId,
  type HistoryEntry,
  type Mutation,
  type MutationInput,
  type ProjectInfo,
  type PrefabCreate,
  type PrefabPlace,
  type ServerMessage,
  type Transaction,
  type TeamThinking,
  type TxError,
} from '@forge/contracts';
import { applyTransaction, buildTransaction, describeSceneChanges, instantiatePrefab, prefabFromSelection } from '@forge/scene';
import { projectFromTemplate } from '@forge/templates';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TeamRoom } from './team';

interface Record_ {
  entry: HistoryEntry;
  tx: Transaction;
  inverse: Mutation[];
  activity?: SceneActivity;
}

export type ApplyOutcome = { ok: true; entry: HistoryEntry } | { ok: false; error: TxError };

const AGENT_PALETTE = ['#f2b33d', '#4fd1c5', '#e3608f', '#9bd15a', '#8ea8ff', '#d68cff'];
export const DIRECTOR_COLOR = '#ff6a2b';
const HISTORY_LIMIT = 2000;
const COMMS_LIMIT = 400;

/**
 * Authoritative state for one project. Every write goes through `apply`,
 * which runs the pure reducer, records history + inverse, persists, and broadcasts.
 */
export class ProjectStore extends EventEmitter<{ message: [ServerMessage] }> {
  project: ProjectInfo;
  scene: SceneDoc;
  private readonly records = new Map<string, Record_>();
  private readonly order: string[] = [];
  private readonly undoTxIds = new Set<string>();
  private readonly redoStacks = new Map<string, string[]>();
  readonly crew = new Map<string, CrewMember>();
  readonly team: TeamRoom;
  get directives(): ReadonlyMap<string, Directive> { return this.team.directives; }
  readonly comms: CommsEntry[] = [];
  humanSelection: EntityId[] = [];
  private saveTimer: NodeJS.Timeout | undefined;
  private historyWrites = Promise.resolve();
  private readonly dir: string;
  activitySettings: ActivitySettings;

  /**
   * @param initial a pre-built scene (genre starters); otherwise the template seeds it.
   *   Ignored when the project already has a scene on disk.
   */
  constructor(workspaceDir: string, templateId: string, projectId = templateId, name?: string, initial?: SceneDoc, brief?: DesignBrief) {
    super();
    this.dir = join(workspaceDir, projectId);
    mkdirSync(this.dir, { recursive: true });
    this.team = new TeamRoom(join(this.dir, 'team.jsonl'), (event) => this.emit('message', { type: 'team.event', event }));
    const settingsPath = join(this.dir, 'activity.json');
    this.activitySettings = ActivitySettings.parse(existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {});
    const scenePath = join(this.dir, 'scene.json');
    const onDisk = existsSync(scenePath);
    const seeded = onDisk || initial ? null : projectFromTemplate(templateId, projectId, name);
    this.project = seeded?.project ?? { projectId, name: name ?? projectId, template: templateId };
    if (onDisk) {
      this.scene = SceneDoc.parse(JSON.parse(readFileSync(scenePath, 'utf8')));
      this.loadHistory();
    } else {
      this.scene = initial ?? seeded!.scene;
      void writeFile(scenePath, JSON.stringify(this.scene, null, 2));
    }
    const briefPath = join(this.dir, 'brief.json');
    if (brief) this.setBrief(brief);
    else if (existsSync(briefPath)) this.brief = JSON.parse(readFileSync(briefPath, 'utf8')) as DesignBrief;
    this.log({ kind: 'system', id: 'forge', name: 'FORGE' }, 'info', `Project ${this.project.name} online · rev ${this.scene.revision}`);
  }

  /* ── transactions ──────────────────────────────────────────────────── */

  apply(txInput: unknown): ApplyOutcome {
    const result = applyTransaction(this.scene, txInput);
    if (!result.ok) return result;
    const { tx } = result;
    const changes = describeSceneChanges(this.scene, result.scene, result.touched);
    this.scene = result.scene;
    const entry: HistoryEntry = {
      txId: tx.txId,
      revision: result.scene.revision,
      author: tx.author,
      label: tx.label,
      mutationCount: tx.mutations.length,
      touched: result.touched,
      createdAt: tx.createdAt,
      ...(tx.revertOf ? { revertOf: tx.revertOf } : {}),
    };
    const activity: SceneActivity | undefined = changes.length
      ? { revision: entry.revision, txId: tx.txId, author: tx.author, at: Date.now(), changes }
      : undefined;
    const record = { entry, tx, inverse: result.inverse, ...(activity ? { activity } : {}) };
    this.remember(record);

    if (tx.revertOf) {
      const target = this.records.get(tx.revertOf);
      if (target) {
        target.entry.revertedBy = tx.txId;
        this.emit('message', { type: 'history.updated', entry: target.entry });
      }
    } else {
      this.redoStacks.delete(tx.author.id);
    }

    this.emit('message', { type: 'tx.applied', tx, entry });
    if (activity) this.emit('message', { type: 'scene.activity', entry: activity });
    if (tx.author.kind === 'agent') {
      this.touchCrew(tx.author, { status: 'working', focusEntityIds: result.touched.filter((id) => this.scene.entities[id]) });
      this.log(tx.author, 'action', `${tx.label} · ${tx.mutations.length} op${tx.mutations.length === 1 ? '' : 's'} → rev ${entry.revision}`);
    }
    this.persist(record);
    return { ok: true, entry };
  }

  submit(author: Author, label: string, mutations: MutationInput[], baseRevision?: number): ApplyOutcome {
    return this.apply(buildTransaction(this.scene, author, label, mutations, baseRevision === undefined ? {} : { baseRevision }));
  }

  createPrefab(author: Author, request: PrefabCreate): ApplyOutcome & { prefabId?: string } {
    try {
      const { name, parameters, entities } = request;
      const value = entities ? Prefab.parse({ name, entities, parameters }) : prefabFromSelection(this.scene, this.humanSelection, name, parameters);
      const prefabId = newId('prefab');
      return { ...this.submit(author, `Save prefab ${name}`, [{ op: 'set_prefab', prefabId, value }]), prefabId };
    } catch (error) {
      return { ok: false, error: { code: 'INVALID', message: (error as Error).message } };
    }
  }

  placePrefab(author: Author, request: PrefabPlace): ApplyOutcome & { rootId?: EntityId } {
    const { prefab, position, parameters, baseRevision } = request;
    const definition = this.scene.database.prefabs[prefab];
    if (!definition) return { ok: false, error: { code: 'NOT_FOUND', message: `no prefab ${prefab}` } };
    if (baseRevision !== undefined && (this.scene.database.prefabRevisions[prefab] ?? 0) > baseRevision) {
      return { ok: false, error: { code: 'CONFLICT', message: 'The prefab changed. Read its latest definition before placing it.' } };
    }
    try {
      const { rootId, mutations } = instantiatePrefab(definition, position, parameters);
      const applied = this.submit(author, `Place ${definition.name}`, mutations, baseRevision);
      return applied.ok ? { ...applied, rootId } : applied;
    } catch (error) {
      return { ok: false, error: { code: 'INVALID', message: (error as Error).message } };
    }
  }

  /** Revert any history entry, refusing if a still-live later change touched the same entities. */
  revert(txId: string, author: Author, label?: string): ApplyOutcome {
    const target = this.records.get(txId);
    if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: `no transaction ${txId} in history` } };
    if (target.entry.revertedBy)
      return { ok: false, error: { code: 'CONFLICT', message: `${txId} was already reverted by ${target.entry.revertedBy}` } };
    if (target.inverse.length === 0) return { ok: false, error: { code: 'INVALID', message: 'transaction has nothing to revert' } };
    return this.revertChecked(target, author, label ?? `Revert: ${target.entry.label}`);
  }

  /** Conflicts are checked by `liveLaterChange`, so the revert is based on the current revision. */
  private applyRevert(target: Record_, author: Author, label: string): ApplyOutcome {
    if (target.inverse.length === 0) return { ok: false, error: { code: 'INVALID', message: 'transaction has nothing to revert' } };
    return this.apply(
      buildTransaction(this.scene, author, label, target.inverse as MutationInput[], {
        revertOf: target.entry.txId,
      }),
    );
  }

  undo(author: Author): ApplyOutcome {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const rec = this.records.get(this.order[i]!)!;
      if (rec.entry.author.id !== author.id || rec.entry.revertedBy || this.undoTxIds.has(rec.entry.txId)) continue;
      const out = this.revertChecked(rec, author, `Undo: ${rec.entry.label}`);
      if (out.ok) {
        this.undoTxIds.add(out.entry.txId);
        const stack = this.redoStacks.get(author.id) ?? [];
        stack.push(out.entry.txId);
        this.redoStacks.set(author.id, stack);
      }
      return out;
    }
    return { ok: false, error: { code: 'NOT_FOUND', message: 'nothing to undo' } };
  }

  redo(author: Author): ApplyOutcome {
    const stack = this.redoStacks.get(author.id);
    const undoId = stack?.pop();
    if (!undoId) return { ok: false, error: { code: 'NOT_FOUND', message: 'nothing to redo' } };
    const rec = this.records.get(undoId);
    if (!rec) return { ok: false, error: { code: 'NOT_FOUND', message: 'redo target fell out of history' } };
    const label = rec.entry.label.replace(/^Undo: /, 'Redo: ');
    const out = this.revertChecked(rec, author, label);
    if (!out.ok) stack!.push(undoId);
    return out;
  }

  private revertChecked(target: Record_, author: Author, label: string): ApplyOutcome {
    const blocker = this.liveLaterChange(target);
    if (blocker)
      return {
        ok: false,
        error: {
          code: 'CONFLICT',
          message: `“${target.entry.label}” can't be undone: “${blocker.entry.label}” by ${blocker.entry.author.name} changed the same entities since`,
        },
      };
    return this.applyRevert(target, author, label);
  }

  /** Later entries that still have an effect (revert pairs cancel out) and overlap the target. */
  private liveLaterChange(target: Record_): Record_ | undefined {
    const touched = new Set(target.entry.touched);
    const prefabs = new Set(target.tx.mutations.flatMap((m) => m.op === 'set_prefab' ? [m.prefabId] : []));
    const later = this.order
      .map((id) => this.records.get(id)!)
      .filter((r) => r.entry.revision > target.entry.revision)
      .reverse();
    const cancelled = new Set<string>();
    for (const r of later) {
      if (cancelled.has(r.entry.txId)) continue;
      const pair = r.entry.revertOf ? this.records.get(r.entry.revertOf) : undefined;
      if (pair && pair.entry.revision > target.entry.revision && !cancelled.has(pair.entry.txId)) {
        cancelled.add(r.entry.txId).add(pair.entry.txId);
        continue;
      }
      if (r.entry.revertOf === target.entry.txId) continue;
      if (r.entry.touched.some((id) => touched.has(id))) return r;
      if (r.tx.mutations.some((m) => m.op === 'set_prefab' && prefabs.has(m.prefabId))) return r;
    }
    return undefined;
  }

  history(limit = 400): HistoryEntry[] {
    return this.order.slice(-limit).map((id) => this.records.get(id)!.entry);
  }

  /* ── crew, comms, directives ───────────────────────────────────────── */

  publishThinking(thinking: TeamThinking | null): void {
    this.team.thinking = thinking;
    this.emit('message', { type: 'team.thinking', thinking });
  }

  readActivity(since?: number): ActivityPage {
    const records = this.order.map((id) => this.records.get(id)!);
    const entries = records.flatMap((record) => record.activity ? [record.activity] : []);
    const matching = since === undefined ? entries.slice(-20) : entries.filter((entry) => entry.revision > since);
    const activity = matching.slice(0, 20);
    const hasMore = matching.length > activity.length;
    const oldestRevision = records[0]?.entry.revision ?? this.scene.revision + 1;
    return {
      projectId: this.project.projectId,
      activity,
      cursor: hasMore ? activity.at(-1)!.revision : this.scene.revision,
      hasMore,
      truncated: since !== undefined && since < oldestRevision - 1,
      settings: this.activitySettings,
    };
  }

  setActivitySettings(settings: ActivitySettings): void {
    writeFileSync(join(this.dir, 'activity.json'), JSON.stringify(settings));
    this.activitySettings = settings;
    this.emit('message', { type: 'activity.settings', settings });
  }

  touchCrew(author: Pick<Author, 'id' | 'name' | 'kind'>, patch: Partial<Pick<CrewMember, 'status' | 'message' | 'focusEntityIds'>> = {}): CrewMember {
    let m = this.crew.get(author.id);
    if (!m) {
      const agents = [...this.crew.values()].filter((c) => c.kind === 'agent').length;
      m = {
        id: author.id,
        name: author.name,
        kind: author.kind === 'human' ? 'human' : 'agent',
        color: author.kind === 'human' ? DIRECTOR_COLOR : AGENT_PALETTE[agents % AGENT_PALETTE.length]!,
        status: 'idle',
        message: '',
        focusEntityIds: [],
        lastSeen: Date.now(),
      };
      this.crew.set(author.id, m);
      if (m.kind === 'agent') this.log({ kind: 'system', id: 'forge', name: 'FORGE' }, 'info', `${m.name} joined the crew`);
    }
    Object.assign(m, patch, { name: author.name, lastSeen: Date.now() });
    this.emit('message', { type: 'crew', crew: [...this.crew.values()] });
    return m;
  }

  dropCrew(id: string): void {
    if (this.crew.delete(id)) this.emit('message', { type: 'crew', crew: [...this.crew.values()] });
  }

  /** Agents with no activity for a while go idle and lose their focus beacons. */
  sweepCrew(now = Date.now()): void {
    let changed = false;
    for (const m of this.crew.values()) {
      if (m.kind === 'agent' && m.status !== 'idle' && now - m.lastSeen > 90_000) {
        m.status = 'idle';
        m.focusEntityIds = [];
        changed = true;
      }
    }
    if (changed) this.emit('message', { type: 'crew', crew: [...this.crew.values()] });
  }

  log(source: CommsEntry['source'], level: CommsEntry['level'], text: string): CommsEntry {
    const entry: CommsEntry = { id: newId('msg'), at: Date.now(), source, level, text };
    this.comms.push(entry);
    if (this.comms.length > COMMS_LIMIT) this.comms.splice(0, this.comms.length - COMMS_LIMIT);
    this.emit('message', { type: 'comms', entry });
    return entry;
  }

  createDirective(createdBy: Author, text: string, focusEntityIds: EntityId[]): Directive {
    const d: Directive = { id: newId('dir'), text, status: 'open', createdAt: Date.now(), createdBy: createdBy.name, focusEntityIds };
    this.team.note(createdBy, TEAM_THREAD, 'message', text, focusEntityIds, { directive: d });
    this.emitDirectives();
    return d;
  }

  updateDirective(id: string, author: Author, status: DirectiveStatus, response?: string): Directive | undefined {
    const d = this.directives.get(id);
    if (!d) return undefined;
    const directive = { ...d, status, ...(status === 'claimed' ? { claimedBy: author.name } : {}), ...(response ? { response } : {}) };
    this.team.note(author, TEAM_THREAD, 'result', response?.trim() || d.text, [], { directive });
    this.emitDirectives();
    return directive;
  }

  private emitDirectives(): void {
    this.emit('message', { type: 'directives', directives: [...this.directives.values()] });
  }

  /* ── captures (agent eyes) ─────────────────────────────────────────── */

  private readonly captures = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  hasStudio: () => boolean = () => false;

  requestCapture(by: Author, view: CaptureView, helpers: boolean, width: number, height: number): Promise<string> {
    if (!this.hasStudio()) return Promise.reject(new Error('No Studio is connected — open the Studio to let agents see the viewport.'));
    const requestId = newId('cap');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.captures.delete(requestId);
        reject(new Error('Studio did not answer the capture request within 15s'));
      }, 15_000);
      this.captures.set(requestId, { resolve, reject, timer });
      const member = this.touchCrew(by);
      this.emit('message', { type: 'capture.request', requestId, view, helpers, width, height, by: { name: member.name, color: member.color } });
    });
  }

  resolveCapture(requestId: string, dataUrl?: string, error?: string): void {
    const pending = this.captures.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.captures.delete(requestId);
    if (dataUrl) pending.resolve(dataUrl);
    else pending.reject(new Error(error ?? 'capture failed'));
  }

  /* ── persistence ───────────────────────────────────────────────────── */

  private remember(rec: Record_): void {
    this.records.set(rec.entry.txId, rec);
    this.order.push(rec.entry.txId);
    while (this.order.length > HISTORY_LIMIT) this.records.delete(this.order.shift()!);
  }

  private persist(rec: Record_): void {
    const line = `${JSON.stringify(rec)}\n`;
    this.historyWrites = this.historyWrites.then(() => appendFile(join(this.dir, 'history.jsonl'), line)).catch((error: unknown) => {
      console.error('FORGE could not save transaction history', error);
    });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void writeFile(join(this.dir, 'scene.json'), JSON.stringify(this.scene, null, 2)), 200);
  }

  private loadHistory(): void {
    const path = join(this.dir, 'history.jsonl');
    if (!existsSync(path)) return;
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).slice(-HISTORY_LIMIT);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as Record_;
        if (rec.activity) {
          const parsed = SceneActivity.safeParse(rec.activity);
          if (parsed.success) rec.activity = parsed.data;
          else delete rec.activity;
        }
        if (rec.entry.revision <= this.scene.revision) this.remember(rec);
      } catch {
        /* skip torn line */
      }
    }
    for (const rec of this.records.values()) {
      if (rec.entry.revertOf) {
        const t = this.records.get(rec.entry.revertOf);
        if (t) t.entry.revertedBy = rec.entry.txId;
        if (rec.entry.label.startsWith('Undo: ')) this.undoTxIds.add(rec.entry.txId);
      }
    }
  }

  /* ── design brief ──────────────────────────────────────────────────── */

  brief: DesignBrief | null = null;

  setBrief(brief: DesignBrief): void {
    this.brief = { ...brief, updatedAt: Date.now() };
    writeFileSync(join(this.dir, 'brief.json'), JSON.stringify(this.brief, null, 2));
    this.emit('message', { type: 'brief', brief: this.brief });
  }

  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    await this.historyWrites;
    await writeFile(join(this.dir, 'scene.json'), JSON.stringify(this.scene, null, 2));
  }
}
