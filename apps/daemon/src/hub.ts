import type { DesignBrief, ProjectInfo, SceneDoc, ServerMessage } from '@forge/contracts';
import { templates } from '@forge/templates';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectStore } from './store';

interface HubFile {
  active: string;
  projects: ProjectInfo[];
}

/**
 * All projects in the workspace. One is active: it's what the Studio shows and
 * what agents edit. Each project is its own folder with scene + history.
 */
export class ProjectHub extends EventEmitter<{ message: [ServerMessage]; switched: [ProjectStore] }> {
  private readonly stores = new Map<string, ProjectStore>();
  private readonly index: HubFile;
  private activeId: string;

  constructor(private readonly workspace: string, defaultTemplate = 'outpost-zero') {
    super();
    mkdirSync(workspace, { recursive: true });
    const file = join(workspace, 'hub.json');
    this.index = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as HubFile)
      : { active: defaultTemplate, projects: [{ projectId: defaultTemplate, name: templates[defaultTemplate]!.name, template: defaultTemplate }] };
    this.activeId = this.index.active;
    if (!this.index.projects.some((p) => p.projectId === this.activeId)) this.activeId = this.index.projects[0]!.projectId;
    this.save();
  }

  get active(): ProjectStore {
    return this.open(this.activeId);
  }

  list(): { active: string; projects: ProjectInfo[] } {
    return { active: this.activeId, projects: this.index.projects };
  }

  open(projectId: string): ProjectStore {
    let s = this.stores.get(projectId);
    if (s) return s;
    const info = this.index.projects.find((p) => p.projectId === projectId);
    if (!info) throw new Error(`no project ${projectId}`);
    s = new ProjectStore(this.workspace, info.template, info.projectId, info.name);
    s.on('message', (msg) => {
      if (this.stores.get(this.activeId) === s) this.emit('message', msg);
    });
    this.stores.set(projectId, s);
    return s;
  }

  create(templateId: string, name?: string): ProjectStore {
    const t = templates[templateId];
    if (!t) throw new Error(`unknown template ${templateId}; available: ${Object.keys(templates).join(', ')}`);
    const base = (name ?? t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || templateId;
    let projectId = base;
    for (let i = 2; this.index.projects.some((p) => p.projectId === projectId); i++) projectId = `${base}-${i}`;
    this.index.projects.push({ projectId, name: name ?? t.name, template: templateId });
    this.save();
    return this.activate(projectId);
  }

  /** New project from a genre starter: a scene built from interview answers plus its design brief. */
  createFromScene(templateLabel: string, name: string, scene: SceneDoc, brief: DesignBrief): ProjectStore {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'game';
    let projectId = base;
    for (let i = 2; this.index.projects.some((p) => p.projectId === projectId); i++) projectId = `${base}-${i}`;
    this.index.projects.push({ projectId, name, template: templateLabel });
    this.save();
    const s = new ProjectStore(this.workspace, templateLabel, projectId, name, scene, brief);
    s.on('message', (msg) => {
      if (this.stores.get(this.activeId) === s) this.emit('message', msg);
    });
    this.stores.set(projectId, s);
    return this.activate(projectId);
  }

  activate(projectId: string): ProjectStore {
    const s = this.open(projectId);
    this.activeId = projectId;
    this.index.active = projectId;
    this.save();
    this.emit('switched', s);
    return s;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.stores.values()].map((s) => s.flush()));
  }

  sweep(): void {
    this.active.sweepCrew();
  }

  private save(): void {
    writeFileSync(join(this.workspace, 'hub.json'), JSON.stringify(this.index, null, 2));
  }
}
