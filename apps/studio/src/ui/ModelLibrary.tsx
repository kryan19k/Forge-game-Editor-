import { Prefab, type AssetLibrary, type AssetRecord } from '@forge/contracts';
import { assetModelUrl } from '@forge/game-runtime';
import { useEffect, useRef, useState } from 'react';
import { send } from '../state/store';
import { viewportApi } from '../viewport/api';
import { createPrefabPreview } from '../viewport/PrefabPreview';

const STATUS = {
  queued: 'Queued',
  generating: 'Generating',
  review: 'Ready for review',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: 'Failed',
};

async function assetRequest<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/assets' + path, {
    signal,
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The asset request failed.');
  return data as T;
}

function ModelPreview({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let closed = false;
    const render = async () => {
      const preview = await createPrefabPreview((asset) => assetModelUrl(asset, true));
      try {
        if (closed) return;
        const url = await preview.render(Prefab.parse({ name: 'Preview', entities: [
          { id: 'ent_model_preview', name: 'Preview', components: { mesh: { asset: id } } },
        ] }));
        if (!closed) setSrc(url);
      } finally {
        preview.dispose();
      }
    };
    void render().catch(() => { if (!closed) setSrc(null); });
    return () => { closed = true; };
  }, [id]);
  return (
    <div className="asset-thumb generated-preview">
      {src ? <img src={src} alt="Rendered GLB model" /> : <span className="micro">{src === undefined ? 'Rendering…' : 'Preview unavailable'}</span>}
    </div>
  );
}

export function ModelLibrary({ projectId, online }: { projectId: string; online: boolean }) {
  const [library, setLibrary] = useState<AssetLibrary | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [versionOf, setVersionOf] = useState<string>();
  const [modelName, setModelName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [meters, setMeters] = useState('2');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = '?projectId=' + encodeURIComponent(projectId);
  const selected = library?.assets.find((asset) => asset.id === selectedId) ?? library?.assets[0];
  const generating = library?.assets.some((asset) => asset.status === 'queued' || asset.status === 'generating');

  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await assetRequest<AssetLibrary>('', undefined, controller.signal);
        if (data.projectId === projectId) setLibrary(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, online]);

  const action = async (run: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await run();
      const data = await assetRequest<AssetLibrary>('');
      if (data.projectId === projectId) setLibrary(data);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const configure = (value: string | null) => action(async () => {
    await assetRequest('/key', { key: value });
    setKey('');
    setShowKey(false);
  });
  const importFile = (file: File) => action(async () => {
    const response = await fetch('/api/assets/import' + query + '&fileName=' + encodeURIComponent(file.name), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The GLB could not be imported.');
    setSelectedId((result as AssetRecord).id);
  });
  const begin = (source?: AssetRecord) => {
    setVersionOf(source?.id);
    setModelName(source?.name ?? '');
    setPrompt(source?.prompt ?? '');
    setShowForm(true);
  };
  const ready = selected?.status === 'review' || selected?.status === 'approved';
  const scale = Number(meters);

  return (
    <div className="asset-scroll generated-assets">
      <div className="asset-heading micro">
        <span>Model library</span>
        <button className="btn" disabled={!online || !library} onClick={() => { setShowKey(!showKey); setKey(''); }}>Tripo key</button>
      </div>
      <div className="team-actions generated-new">
        <input ref={input} type="file" accept=".glb" aria-label="GLB file" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }} />
        <button className="btn" disabled={!online || busy} onClick={() => input.current?.click()}>Import GLB</button>
        {library?.configured && !showForm && <button className="btn" disabled={busy || !online || generating} onClick={() => begin()}>Generate with Tripo</button>}
      </div>
      {library && !library.configured && <p className="asset-empty">Add a Tripo key to generate models from text.</p>}
      {showKey && <form className="asset-form" onSubmit={(event) => { event.preventDefault(); void configure(key.trim()); }}>
        <input aria-label="Tripo API key" type="password" placeholder="Tripo API key" autoComplete="off" value={key} maxLength={300} onChange={(event) => setKey(event.target.value)} />
        <div className="team-actions">
          <button className="btn primary" disabled={busy || !online || key.trim().length < 12}>Save key</button>
          {library?.configured && <button className="btn" type="button" disabled={busy || !online} onClick={() => void configure(null)}>Remove key</button>}
        </div>
      </form>}
      {showForm && <form className="asset-form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          const asset = await assetRequest<AssetRecord>('/generate' + query, { name: modelName, prompt, versionOf });
          setSelectedId(asset.id);
          setShowForm(false);
        });
      }}>
        <input aria-label="Model name" placeholder="Model name" value={modelName} maxLength={80} onChange={(event) => setModelName(event.target.value)} />
        <textarea aria-label="Model prompt" placeholder="Describe one object, its materials and intended scale." value={prompt} maxLength={1024} onChange={(event) => setPrompt(event.target.value)} />
        <p className="asset-empty">Generation uses Tripo credits. <a href="https://developers.tripo3d.ai/en/docs/billing" target="_blank" rel="noreferrer">Tripo billing</a></p>
        <div className="team-actions">
          <button className="btn primary" disabled={busy || !online || generating || !library?.configured || !modelName.trim() || prompt.trim().length < 3}>Generate</button>
          <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
        </div>
      </form>}
      {error && <p className="asset-error" role="alert">{error}</p>}
      {library && library.assets.length > 0 && (
        <div className="generated-versions" aria-label="Model versions">
          {library.assets.map((asset) => (
            <button key={asset.id} className="generated-version" aria-pressed={asset.id === selected?.id} onClick={() => setSelectedId(asset.id)}>
              <span>{asset.name}</span>
              <span className={'micro model-status ' + asset.status}>V{asset.version} · {STATUS[asset.status]}</span>
            </button>
          ))}
        </div>
      )}
      {selected && <div className="asset-details">
        <div className={'micro model-status ' + selected.status}>{STATUS[selected.status]}{selected.status === 'generating' && ' · ' + selected.progress + '%'}</div>
        {selected.error && <p className="asset-error" role="alert">{selected.error}</p>}
        {ready && <ModelPreview key={selected.id} id={selected.id} />}
        {selected.metrics && <div className="micro dim">{selected.metrics.triangles.toLocaleString()} triangles · {(selected.metrics.bytes / 1024).toFixed(1)} KiB</div>}
        {selected.credits !== undefined && <div className="micro dim">{selected.credits} Tripo credits</div>}
        {selected.prompt && <p className="generated-prompt">{selected.prompt}</p>}
        {selected.sourceFile && <p className="generated-prompt dim">{selected.sourceFile}</p>}
        <div className="team-actions">
          {selected.status === 'review' && [true, false].map((approve) => (
            <button className={'btn' + (approve ? ' primary' : '')} key={String(approve)} disabled={!online || busy}
              onClick={() => void action(async () => { await assetRequest('/' + selected.id + '/review' + query, { approve }); })}>
              {approve ? 'Approve model' : 'Reject model'}
            </button>
          ))}
          {selected.provider === 'tripo' && library?.configured && !generating && !showForm && <button className="btn" disabled={!online || busy} onClick={() => begin(selected)}>New version</button>}
        </div>
        {selected.status === 'approved' && <>
          <label className="asset-parameter">Longest axis (m)<input type="number" min="0.1" max="100" step="0.1" value={meters} onChange={(event) => setMeters(event.target.value)} /></label>
          <button className="btn primary" disabled={!online || !Number.isFinite(scale) || scale < 0.1 || scale > 100} onClick={() => {
            const position = viewportApi.current?.placementPoint();
            if (position) send({ type: 'asset.place', projectId, request: { asset: selected.id, position, meters: scale } });
          }}>Place at view</button>
        </>}
      </div>}
    </div>
  );
}
