import { newId, type Prefab } from '@forge/contracts';
import { prefabFromSelection } from '@forge/scene';
import { useEffect, useRef, useState } from 'react';
import { send, submit, toast, useStudio } from '../state/store';
import { viewportApi } from '../viewport/api';
import { createPrefabPreview } from '../viewport/PrefabPreview';
import { GeneratedAssets } from './GeneratedAssets';

const EMPTY_PREFABS: Record<string, Prefab> = {};
const EMPTY_REVISIONS: Record<string, number> = {};
type Thumbnails = Map<string, { revision: number; url: string | null }>;

function useThumbnails(prefabs: Record<string, Prefab>, revisions: Record<string, number>) {
  const [previews, setPreviews] = useState<Thumbnails>(() => new Map());
  const cached = useRef<Thumbnails>(new Map());

  useEffect(() => {
    const queue = Object.entries(prefabs).filter(([id]) => cached.current.get(id)?.revision !== (revisions[id] ?? 0));
    if (!queue.length) return;
    let stopped = false;
    const build = async () => {
      const renderer = await createPrefabPreview();
      try {
        for (const [id, prefab] of queue) {
          if (stopped) break;
          const url = await renderer.render(prefab);
          if (stopped) break;
          cached.current.set(id, { revision: revisions[id] ?? 0, url });
          setPreviews(new Map(cached.current));
          await new Promise<void>((done) => requestAnimationFrame(() => done()));
        }
      } finally {
        renderer.dispose();
      }
    };
    void build().catch(() => {
      if (!stopped) {
        for (const [id] of queue) {
          if (cached.current.get(id)?.revision !== (revisions[id] ?? 0)) cached.current.set(id, { revision: revisions[id] ?? 0, url: null });
        }
        setPreviews(new Map(cached.current));
      }
    });
    return () => { stopped = true; };
  }, [prefabs, revisions]);
  return previews;
}

export function AssetsPanel() {
  const scene = useStudio((state) => state.scene);
  const projectId = useStudio((state) => state.project?.projectId);
  const selection = useStudio((state) => state.selection);
  const online = useStudio((state) => state.conn === 'online');
  const prefabs = scene?.database.prefabs ?? EMPTY_PREFABS;
  const revisions = scene?.database.prefabRevisions ?? EMPTY_REVISIONS;
  const previews = useThumbnails(prefabs, revisions);
  const [active, setActive] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [form, setForm] = useState<'save' | 'describe' | null>(null);
  const [draft, setDraft] = useState('');
  const [generated, setGenerated] = useState(false);
  const prefab = prefabs[active];

  const save = () => {
    if (!scene || !draft.trim() || !online) return;
    try {
      const value = prefabFromSelection(scene, selection, draft);
      const prefabId = newId('prefab');
      submit('Save prefab ' + value.name, [{ op: 'set_prefab', prefabId, value }]);
      setActive(prefabId);
      setOverrides({});
      setDraft('');
      setForm(null);
    } catch (error) {
      toast('error', 'Save prefab', (error as Error).message);
    }
  };

  const describe = () => {
    if (!draft.trim() || !online) return;
    const text = 'Compose a reusable prefab in the Assets library. Use forge_prefab_create and report the saved prefab when ready.\n\n' + draft.trim();
    send({ type: 'directive.create', text, focusEntityIds: selection.slice(0, 100) });
    toast('info', 'Asset request sent', 'Your request is in #team.');
    setDraft('');
    setForm(null);
  };

  return (
    <section className="panel assets-panel" aria-label="Assets">
      <div className="panel-head micro">
        <span className="code">02</span><span className="title">Assets</span><span className="spacer" />
        <button className="btn" onClick={() => useStudio.setState({ assetsOpen: false })}>Inspector</button>
      </div>
      <div className="team-threads" role="group" aria-label="Asset types">
        <button className="team-thread micro" aria-pressed={!generated} onClick={() => setGenerated(false)}>Prefabs</button>
        <button className="team-thread micro" aria-pressed={generated} onClick={() => setGenerated(true)}>Generated models</button>
      </div>
      {generated ? projectId && <GeneratedAssets projectId={projectId} online={online} /> : <>
      <div className="asset-tools">
        <button className="btn" disabled={!online || !selection.length} onClick={() => { setForm('save'); setDraft(''); }}>Save selection</button>
        <button className="btn" disabled={!online} onClick={() => { setForm('describe'); setDraft(''); }}>Describe an asset…</button>
      </div>
      {form && <form className="asset-form" onSubmit={(event) => { event.preventDefault(); if (form === 'save') save(); else describe(); }}>
        {form === 'save'
          ? <input autoFocus aria-label="Prefab name" placeholder="Prefab name" value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} />
          : <textarea autoFocus aria-label="Asset description" placeholder="Describe the shape, materials, scale, and intended use." value={draft} maxLength={1600} onChange={(event) => setDraft(event.target.value)} />}
        <div className="team-actions">
          <button type="submit" className="btn primary" disabled={!draft.trim() || !online}>{form === 'save' ? 'Save prefab' : 'Send to team'}</button>
          <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </form>}
      <div className="asset-scroll">
        <div className="asset-heading micro"><span>Prefab library</span><span>{Object.keys(prefabs).length}</span></div>
        {!Object.keys(prefabs).length && <p className="asset-empty">Save a scene subtree or describe an asset for the team to build.</p>}
        <div className="asset-grid">
          {Object.entries(prefabs).sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([id, item]) => {
            const preview = previews.get(id);
            const ready = preview?.revision === (revisions[id] ?? 0);
            return (
              <button key={id} className="asset-tile" aria-pressed={active === id} title={item.name} onClick={() => { setActive(id); setOverrides({}); }}>
                <span className="asset-thumb">
                  {ready && preview.url ? <img alt="" src={preview.url} /> : <span className="micro">{ready ? 'No preview' : 'Rendering…'}</span>}
                </span>
                <span className="asset-name">{item.name}</span><span className="asset-count micro">{item.entities.length} {item.entities.length === 1 ? 'entity' : 'entities'}</span>
              </button>
            );
          })}
        </div>
        {prefab && <div className="asset-details">
          <div className="asset-heading micro"><span>{prefab.name}</span></div>
          {prefab.parameters.map((parameter) => {
            const target = prefab.entities.find((entity) => entity.id === parameter.entityId)!;
            const value = overrides[parameter.id] ?? (parameter.kind === 'name' ? target.name : target.components.mesh!.material.color);
            return <label className="asset-parameter" key={parameter.id}>
              {parameter.label}
              <input type={parameter.kind === 'name' ? 'text' : 'color'} maxLength={80} value={value}
                onChange={(event) => setOverrides({ ...overrides, [parameter.id]: event.target.value })} />
            </label>;
          })}
          <button className="btn primary" disabled={!online || Object.values(overrides).some((value) => !value.trim())} onClick={() => {
            const position = viewportApi.current?.placementPoint();
            if (!position) return;
            send({ type: 'prefab.place', request: { prefab: active, position, parameters: overrides, baseRevision: scene?.revision } });
          }}>Place at view</button>
        </div>}
      </div>
      </>}
    </section>
  );
}
