import { ComponentSchemas, type ComponentName, type Entity, type MutationInput } from '@forge/contracts';
import type { ReactNode } from 'react';
import { submit, useStudio } from '../state/store';
import { ColorField, Scrub, Segmented, TextField, Toggle, Vec3Field } from './fields';
import { Glyph } from './glyphs';

/* Descriptor-driven component modules: one table describes every field. */
type FieldSpec =
  | { path: string; label: string; kind: 'number'; step?: number; min?: number; max?: number; precision?: number; suffix?: string }
  | { path: string; label: string; kind: 'slider'; min: number; max: number; step?: number }
  | { path: string; label: string; kind: 'color' }
  | { path: string; label: string; kind: 'bool' }
  | { path: string; label: string; kind: 'vec3'; step?: number }
  | { path: string; label: string; kind: 'enum'; options: readonly string[] }
  | { path: string; label: string; kind: 'text'; placeholder?: string }
  | { path: string; label: string; kind: 'lines' };

const MODULES: Record<ComponentName, { tag: string; title: string; fields: (v: Record<string, unknown>) => FieldSpec[] }> = {
  mesh: {
    tag: 'MSH',
    title: 'Mesh',
    fields: () => [
      { path: 'shape', label: 'Shape', kind: 'enum', options: ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane'] },
      { path: 'size', label: 'Size', kind: 'vec3', step: 0.02 },
      { path: 'material.color', label: 'Albedo', kind: 'color' },
      { path: 'material.roughness', label: 'Roughness', kind: 'slider', min: 0, max: 1 },
      { path: 'material.metalness', label: 'Metalness', kind: 'slider', min: 0, max: 1 },
      { path: 'material.emissive', label: 'Emissive', kind: 'color' },
      { path: 'material.emissiveIntensity', label: 'Glow', kind: 'number', min: 0, max: 100, step: 0.05 },
      { path: 'material.opacity', label: 'Opacity', kind: 'slider', min: 0, max: 1 },
      { path: 'castShadow', label: 'Casts', kind: 'bool' },
      { path: 'receiveShadow', label: 'Receives', kind: 'bool' },
    ],
  },
  light: {
    tag: 'LGT',
    title: 'Light',
    fields: (v) => [
      { path: 'kind', label: 'Kind', kind: 'enum', options: ['directional', 'point', 'spot', 'hemisphere'] },
      { path: 'color', label: 'Color', kind: 'color' },
      ...(v.kind === 'hemisphere' ? [{ path: 'groundColor', label: 'Ground', kind: 'color' } as const] : []),
      { path: 'intensity', label: 'Intensity', kind: 'number', min: 0, max: 10000, step: 0.1 },
      ...(v.kind === 'point' || v.kind === 'spot' ? [{ path: 'range', label: 'Range', kind: 'number', min: 0, step: 0.1, suffix: 'm' } as const] : []),
      ...(v.kind === 'spot' ? [{ path: 'angle', label: 'Cone', kind: 'number', min: 1, max: 89, step: 0.2, precision: 1, suffix: '°' } as const] : []),
      ...(v.kind !== 'hemisphere' ? [{ path: 'castShadow', label: 'Shadows', kind: 'bool' } as const] : []),
    ],
  },
  collider: {
    tag: 'COL',
    title: 'Collider',
    fields: () => [
      { path: 'shape', label: 'Shape', kind: 'enum', options: ['auto', 'box', 'sphere', 'capsule'] },
      { path: 'isTrigger', label: 'Trigger', kind: 'bool' },
      { path: 'layer', label: 'Layer', kind: 'enum', options: ['world', 'player', 'enemy', 'interact', 'trigger'] },
    ],
  },
  rigidBody: {
    tag: 'RBD',
    title: 'Rigid Body',
    fields: () => [
      { path: 'kind', label: 'Motion', kind: 'enum', options: ['static', 'dynamic', 'kinematic'] },
      { path: 'mass', label: 'Mass', kind: 'number', min: 0.01, step: 0.1, suffix: 'kg' },
      { path: 'gravityScale', label: 'Gravity', kind: 'number', step: 0.01 },
    ],
  },
  spawnPoint: {
    tag: 'SPN',
    title: 'Spawn Point',
    fields: () => [
      { path: 'team', label: 'Team', kind: 'text' },
      { path: 'priority', label: 'Priority', kind: 'number', step: 0.1, precision: 0 },
    ],
  },
  interactable: {
    tag: 'INT',
    title: 'Interactable',
    fields: () => [
      { path: 'verb', label: 'Verb', kind: 'enum', options: ['open', 'pickup', 'use', 'talk', 'inspect'] },
      { path: 'prompt', label: 'Prompt', kind: 'text' },
      { path: 'grantsItem', label: 'Grants', kind: 'text', placeholder: 'item id' },
      { path: 'requiresItem', label: 'Requires', kind: 'text', placeholder: 'item id' },
    ],
  },
  health: {
    tag: 'HP',
    title: 'Health',
    fields: () => [
      { path: 'max', label: 'Max HP', kind: 'number', min: 1, step: 0.5, precision: 0 },
      { path: 'regen', label: 'Regen /s', kind: 'number', min: 0, step: 0.05 },
    ],
  },
  combat: {
    tag: 'CBT',
    title: 'Combat',
    fields: () => [
      { path: 'damage', label: 'Damage', kind: 'number', min: 0, step: 0.1, precision: 1 },
      { path: 'range', label: 'Reach', kind: 'number', min: 0.2, step: 0.02, suffix: 'm' },
      { path: 'cooldown', label: 'Cooldown', kind: 'number', min: 0.05, step: 0.01, suffix: 's' },
    ],
  },
  npc: {
    tag: 'NPC',
    title: 'NPC Brain',
    fields: () => [
      { path: 'behavior', label: 'Behavior', kind: 'enum', options: ['idle', 'wander', 'guard'] },
      { path: 'hostile', label: 'Hostile', kind: 'bool' },
      { path: 'speed', label: 'Speed', kind: 'number', min: 0.1, step: 0.02, suffix: 'm/s' },
      { path: 'aggroRadius', label: 'Aggro', kind: 'number', min: 0, step: 0.05, suffix: 'm' },
      { path: 'wanderRadius', label: 'Wander', kind: 'number', min: 0, step: 0.05, suffix: 'm' },
      { path: 'respawnSeconds', label: 'Respawn', kind: 'number', min: 0, step: 0.1, suffix: 's' },
      { path: 'dialogue', label: 'Dialogue', kind: 'lines' },
    ],
  },
  unit: {
    tag: 'UNT',
    title: 'Unit (gameplay)',
    fields: () => [
      { path: 'level', label: 'Level', kind: 'number', min: 1, step: 0.1, precision: 0 },
      { path: 'xp', label: 'XP reward', kind: 'number', min: 0, step: 0.5, precision: 0 },
      { path: 'loot', label: 'Loot table', kind: 'text', placeholder: 'loot table id' },
      { path: 'abilities', label: 'Abilities', kind: 'lines' },
    ],
  },
  checkpoint: {
    tag: 'CHK',
    title: 'Checkpoint',
    fields: () => [{ path: 'order', label: 'Order', kind: 'number', min: 0, max: 255, step: 0.1, precision: 0 }],
  },
  network: {
    tag: 'NET',
    title: 'Network',
    fields: () => [
      { path: 'authority', label: 'Authority', kind: 'enum', options: ['server', 'owner', 'none'] },
      { path: 'relevancy', label: 'Relevancy', kind: 'number', min: 0, step: 0.25, suffix: 'm' },
    ],
  },
};

const DEFAULTS: Record<ComponentName, Record<string, unknown>> = {
  mesh: { shape: 'box' },
  light: { kind: 'point', intensity: 10, range: 10 },
  collider: {},
  rigidBody: {},
  spawnPoint: {},
  interactable: { verb: 'use', prompt: 'Interact' },
  network: {},
  health: { max: 50 },
  combat: {},
  npc: { behavior: 'wander' },
  checkpoint: { order: 0 },
  unit: {},
};

const getPath = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

const nest = (path: string, value: unknown): Record<string, unknown> =>
  path
    .split('.')
    .reduceRight<unknown>((acc, k) => ({ [k]: acc }), value) as Record<string, unknown>;

function patch(e: Entity, component: ComponentName, path: string, value: unknown, label: string) {
  // Clearing an optional field can't be expressed as a merge — replace the whole component instead.
  const op: MutationInput =
    value === undefined
      ? {
          op: 'set_component',
          entityId: e.id,
          component,
          value: Object.fromEntries(Object.entries(e.components[component] ?? {}).filter(([k]) => k !== path)),
        }
      : { op: 'patch_component', entityId: e.id, component, value: nest(path, value) };
  submit(`${e.name}: ${MODULES[component].title} ${label.toLowerCase()}`, [op]);
}

function renderField(e: Entity, name: ComponentName, f: FieldSpec, v: Record<string, unknown>): ReactNode {
  const cur = getPath(v, f.path);
  const commit = (x: unknown) => patch(e, name, f.path, x, f.label);
  let control: ReactNode;
  switch (f.kind) {
    case 'number':
      control = <Scrub value={Number(cur ?? 0)} onCommit={commit} step={f.step} min={f.min} max={f.max} precision={f.precision ?? 2} suffix={f.suffix} />;
      break;
    case 'slider':
      control = <Scrub value={Number(cur ?? 0)} onCommit={commit} step={f.step ?? 0.005} min={f.min} max={f.max} showFill />;
      break;
    case 'color':
      control = <ColorField value={String(cur ?? '#ffffff')} onCommit={commit} />;
      break;
    case 'bool':
      control = <Toggle value={Boolean(cur)} onChange={commit} />;
      break;
    case 'vec3':
      control = <Vec3Field value={(cur as [number, number, number]) ?? [1, 1, 1]} onCommit={commit} step={f.step} />;
      break;
    case 'enum':
      control =
        f.options.length <= 3 ? (
          <Segmented value={String(cur)} options={f.options} onChange={commit} />
        ) : (
          <select className="native" value={String(cur)} onChange={(ev) => commit(ev.target.value)}>
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      break;
    case 'lines':
      control = (
        <textarea
          className="text lines"
          key={JSON.stringify(cur)}
          defaultValue={((cur as string[] | undefined) ?? []).join('\n')}
          placeholder="One line per interaction"
          onKeyDown={(ev) => ev.stopPropagation()}
          onBlur={(ev) => {
            const next = ev.currentTarget.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            if (JSON.stringify(next) !== JSON.stringify(cur ?? [])) commit(next);
          }}
        />
      );
      break;
    case 'text':
      control =<TextField value={String(cur ?? '')} onCommit={(x) => commit(x === '' ? undefined : x)} placeholder={f.placeholder} />;
      break;
  }
  return (
    <div className="field" key={f.path}>
      <label>{f.label}</label>
      {control}
    </div>
  );
}

export function Inspector() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const crew = useStudio((s) => s.crew);

  const e = selection.length === 1 && scene ? scene.entities[selection[0]!] : undefined;

  if (!e) {
    return (
      <div className="panel">
        <div className="panel-head micro">
          <span className="code">02</span>
          <span className="title">Inspector</span>
        </div>
        <div className="insp-empty">
          <span className="micro">{selection.length > 1 ? `${selection.length} selected` : 'Nothing selected'}</span>
          {selection.length > 1 ? 'Multi-edit is coming. Move them together with the gizmo by grouping first.' : 'Click an entity in the viewport or outliner. Agents can see your selection — try a directive like “make this glow”.'}
        </div>
      </div>
    );
  }

  const workingOn = crew.filter((c) => c.kind === 'agent' && c.focusEntityIds.includes(e.id));
  const attached = (Object.keys(MODULES) as ComponentName[]).filter((n) => e.components[n]);
  const available = (Object.keys(MODULES) as ComponentName[]).filter((n) => !e.components[n]);
  const t = e.transform;
  const setT = (key: 'position' | 'rotation' | 'scale', v: [number, number, number]) =>
    submit(`${e.name}: ${key}`, [{ op: 'set_transform', entityId: e.id, [key]: v }]);

  return (
    <div className="panel">
      <div className="panel-head micro">
        <span className="code">02</span>
        <span className="title">Inspector</span>
        <span className="spacer" />
        <span className="dim">rev {e.rev}</span>
      </div>
      <div className="panel-body">
        <div className="insp-head">
          <input
            className="ent-name"
            key={`${e.id}:${e.name}`}
            defaultValue={e.name}
            spellCheck={false}
            onKeyDown={(ev) => {
              ev.stopPropagation();
              if (ev.key === 'Enter') ev.currentTarget.blur();
            }}
            onBlur={(ev) => {
              const v = ev.currentTarget.value.trim();
              if (v && v !== e.name) submit(`Rename ${e.name} → ${v}`, [{ op: 'rename_entity', entityId: e.id, name: v }]);
            }}
          />
          <div className="ent-meta">
            <span className="ent-id">{e.id}</span>
            {e.locked && <span className="micro flag">● locked</span>}
            {workingOn.map((c) => (
              <span key={c.id} className="micro" style={{ color: c.color }}>
                ◆ {c.name}
              </span>
            ))}
          </div>
        </div>

        <section className="module">
          <div className="module-head">
            <span className="tag">XFM</span>
            <span className="label">Transform</span>
          </div>
          <div className="module-body">
            <div className="field"><label>Position</label><Vec3Field value={t.position} onCommit={(v) => setT('position', v)} /></div>
            <div className="field"><label>Rotation</label><Vec3Field value={t.rotation} onCommit={(v) => setT('rotation', v)} step={0.5} precision={1} /></div>
            <div className="field"><label>Scale</label><Vec3Field value={t.scale} onCommit={(v) => setT('scale', v)} step={0.01} /></div>
          </div>
        </section>

        {attached.map((name) => {
          const v = e.components[name] as unknown as Record<string, unknown>;
          const mod = MODULES[name];
          return (
            <section className="module" key={name}>
              <div className="module-head">
                <span className="tag">{mod.tag}</span>
                <span className="label">{mod.title}</span>
                <button
                  className="x"
                  title={`Remove ${mod.title}`}
                  onClick={() => submit(`${e.name}: remove ${mod.title.toLowerCase()}`, [{ op: 'remove_component', entityId: e.id, component: name }])}
                >
                  <Glyph.close />
                </button>
              </div>
              <div className="module-body">{mod.fields(v).map((f) => renderField(e, name, f, v))}</div>
            </section>
          );
        })}

        {available.length > 0 && (
          <div className="add-comp">
            {available.map((name) => (
              <button
                key={name}
                className="btn"
                onClick={() =>
                  submit(`${e.name}: add ${MODULES[name].title.toLowerCase()}`, [
                    { op: 'set_component', entityId: e.id, component: name, value: ComponentSchemas[name].parse(DEFAULTS[name]) as Record<string, unknown> },
                  ])
                }
              >
                <Glyph.plus /> {MODULES[name].tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
