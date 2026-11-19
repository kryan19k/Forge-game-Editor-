import { AssetRecord, newId, type AssetGenerate, type AssetLibrary, type AssetPlacement, type MutationInput, type Vec3 } from '@forge/contracts';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { inspectGlb } from './glb';
import { readKey, storeKey } from './secrets';
import { TRIPO_MODEL, TripoProvider, type ModelProvider, type TripoTask } from './tripo';

const Job = AssetRecord.extend({ taskId: z.string().optional() });
type Job = z.output<typeof Job>;

export class ModelAssets {
  private readonly projects = new Map<string, Map<string, Job>>();
  private readonly running = new Set<string>();
  private readonly secrets: string;

  constructor(private readonly workspace: string, private readonly provider: ModelProvider = new TripoProvider(), private readonly pollMs = 2000) {
    this.secrets = join(workspace, 'secrets.json');
  }

  setKey(value: string | null): void {
    storeKey(this.secrets, 'tripoApiKey', value);
  }

  list(projectId: string): AssetLibrary {
    return { projectId, configured: !!readKey(this.secrets, 'tripoApiKey'), assets: [...this.registry(projectId).values()].reverse().map((job) => AssetRecord.parse(job)) };
  }

  approved(projectId: string, id: string): boolean {
    return this.registry(projectId).get(id)?.status === 'approved' && existsSync(this.filePath(projectId, id));
  }

  resume(projectId: string): void {
    for (const job of [...this.registry(projectId).values()]) {
      if (job.status !== 'queued' && job.status !== 'generating') continue;
      const key = readKey(this.secrets, 'tripoApiKey');
      if (job.taskId && key) void this.run(projectId, job, key);
      else if (!this.running.has(job.id)) this.save(projectId, { ...job, status: 'failed', error: 'Generation was interrupted before it could be resumed.' });
    }
  }

  generate(projectId: string, request: AssetGenerate): AssetRecord {
    const key = readKey(this.secrets, 'tripoApiKey');
    if (!key) throw new Error('Add a Tripo API key in Assets before generating a model.');
    const registry = this.registry(projectId);
    if ([...registry.values()].some((asset) => asset.status === 'queued' || asset.status === 'generating')) {
      throw new Error('This project already has a generation in progress.');
    }
    const previous = request.versionOf ? registry.get(request.versionOf) : undefined;
    if (request.versionOf && previous?.provider !== 'tripo') throw new Error('The Tripo version source is unavailable in this project.');
    const id = newId('asset');
    const family = previous?.family ?? id;
    const version = Math.max(0, ...[...registry.values()].filter((asset) => asset.family === family).map((asset) => asset.version)) + 1;
    const job: Job = {
      id, family, version, name: request.name, prompt: request.prompt, status: 'queued', progress: 0,
      provider: 'tripo', model: TRIPO_MODEL, createdAt: Date.now(),
    };
    this.save(projectId, job);
    void this.run(projectId, job, key);
    return AssetRecord.parse(job);
  }

  async importGlb(projectId: string, fileName: string, bytes: Uint8Array): Promise<AssetRecord> {
    const metrics = await inspectGlb(bytes);
    const id = newId('asset');
    const name = fileName.slice(0, -4).replace(/[_-]+/g, ' ').slice(0, 80).trim() || 'Model';
    const job: Job = {
      id, family: id, version: 1, name, sourceFile: fileName, provider: 'local', model: 'glTF 2.0',
      status: 'review', progress: 100, createdAt: Date.now(), metrics,
    };
    await this.writeModel(projectId, id, bytes);
    this.save(projectId, job);
    return AssetRecord.parse(job);
  }

  review(projectId: string, id: string, approve: boolean): AssetRecord {
    const job = this.registry(projectId).get(id);
    if (!job || job.status !== 'review' || !job.metrics || !existsSync(this.filePath(projectId, id))) {
      throw new Error('This model is unavailable for review.');
    }
    const reviewed: Job = { ...job, status: approve ? 'approved' : 'rejected' };
    this.save(projectId, reviewed);
    return AssetRecord.parse(reviewed);
  }

  content(projectIds: string[], id: string, preview: boolean): string | null {
    for (const projectId of projectIds) {
      const job = this.registry(projectId).get(id);
      if (job && (job.status === 'approved' || (preview && job.status === 'review'))) {
        const path = this.filePath(projectId, id);
        return existsSync(path) ? path : null;
      }
    }
    return null;
  }

  placement(projectId: string, request: AssetPlacement): { name: string; mutation: Extract<MutationInput, { op: 'create_entity' }> } {
    const job = this.registry(projectId).get(request.asset);
    if (job?.status !== 'approved' || !job.metrics || !existsSync(this.filePath(projectId, request.asset))) {
      throw new Error('Approve the generated model before placing it.');
    }
    const { meters, position } = request;
    const size = job.metrics.dimensions.map((axis) => Math.max(0.02, axis * meters)) as Vec3;
    return {
      name: job.name,
      mutation: { op: 'create_entity', entity: {
        id: 'ent_' + newId('asset'), name: job.name,
        transform: { position: [position[0], position[1] + size[1] / 2, position[2]] },
        components: { mesh: { asset: job.id, size: [meters, meters, meters] }, collider: { shape: 'box', size }, rigidBody: { kind: 'static' } },
      } },
    };
  }

  private async run(projectId: string, initial: Job, key: string): Promise<void> {
    if (this.running.has(initial.id)) return;
    this.running.add(initial.id);
    let job = initial;
    try {
      if (!job.taskId) {
        if (!job.prompt) throw new Error('The Tripo job is missing its prompt.');
        const taskId = await this.provider.submit(key, job.prompt);
        job = { ...job, taskId, status: 'generating' };
        this.save(projectId, job);
      }
      let task: TripoTask | undefined;
      let pollFailures = 0;
      for (let attempt = 0; attempt < 180; attempt++) {
        try {
          task = await this.provider.poll(key, job.taskId!);
          pollFailures = 0;
        } catch (error) {
          if (++pollFailures >= 3) throw error;
          await delay(this.pollMs, undefined, { ref: false });
          continue;
        }
        if (task.status === 'success') break;
        if (task.status !== 'queued' && task.status !== 'running') throw new Error('Tripo ended the task with status ' + task.status + '.');
        if (task.progress !== job.progress) {
          job = { ...job, progress: task.progress };
          this.save(projectId, job);
        }
        await delay(this.pollMs, undefined, { ref: false });
      }
      if (task?.status !== 'success') throw new Error('The Tripo task did not finish before timing out.');
      if (task.credits_consumed !== undefined) job = { ...job, credits: task.credits_consumed };
      const destination = this.filePath(projectId, job.id);
      const url = task.output?.model_url;
      if (!url) throw new Error('Tripo did not return a GLB model URL.');
      const existing = existsSync(destination);
      const bytes = existing ? await readFile(destination) : await this.provider.download(url);
      const metrics = await inspectGlb(bytes);
      if (!existing) await this.writeModel(projectId, job.id, bytes);
      this.save(projectId, { ...job, status: 'review', progress: 100, metrics });
    } catch (error) {
      this.save(projectId, { ...job, status: 'failed', error: String((error as Error).message).replaceAll(key, '[redacted]').slice(0, 300) });
    } finally {
      this.running.delete(job.id);
    }
  }

  private filePath(projectId: string, id: string): string {
    return join(this.workspace, projectId, 'assets', id + '.glb');
  }

  private async writeModel(projectId: string, id: string, bytes: Uint8Array): Promise<void> {
    mkdirSync(join(this.workspace, projectId, 'assets'), { recursive: true });
    const destination = this.filePath(projectId, id);
    const pending = destination + '.tmp';
    await writeFile(pending, bytes);
    await rename(pending, destination);
  }

  private registry(projectId: string): Map<string, Job> {
    let registry = this.projects.get(projectId);
    if (!registry) {
      const file = join(this.workspace, projectId, 'assets', 'registry.json');
      const entries = existsSync(file) ? z.array(Job).parse(JSON.parse(readFileSync(file, 'utf8'))) : [];
      registry = new Map(entries.map((job) => [job.id, job]));
      this.projects.set(projectId, registry);
    }
    return registry;
  }

  private save(projectId: string, job: Job): void {
    const registry = this.registry(projectId);
    const entries = new Map(registry).set(job.id, job);
    const dir = join(this.workspace, projectId, 'assets');
    mkdirSync(dir, { recursive: true });
    const temporary = join(dir, 'registry.json.tmp');
    writeFileSync(temporary, JSON.stringify([...entries.values()], null, 2));
    renameSync(temporary, join(dir, 'registry.json'));
    registry.set(job.id, job);
  }
}
