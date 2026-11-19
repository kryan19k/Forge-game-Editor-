import { useEffect, useRef } from 'react';
import { onCaptureRequest, pick, send, submit, useStudio } from '../state/store';
import { EditorViewport, type Beacon, type GizmoMode } from '../viewport/EditorViewport';
import { viewportApi } from '../viewport/api';
import { usePlay } from '../state/play';
import { Glyph } from './glyphs';
import { PlayHud } from './PlayHud';

const pad = (n: number, w = 4) => String(n).padStart(w, '0');

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const playStatus = usePlay((s) => s.status);
  const locked = usePlay((s) => s.locked);

  useEffect(() => {
    const vp = new EditorViewport(host.current!, overlay.current!, {
      onPick: pick,
      onTransformCommit: (id, t) => {
        const e = useStudio.getState().scene?.entities[id];
        const mode = useStudio.getState().gizmo;
        submit(`${mode === 'translate' ? 'Move' : mode === 'rotate' ? 'Rotate' : 'Scale'} ${e?.name ?? id}`, [{ op: 'set_transform', entityId: id, ...t }]);
      },
      onStats: (stats) => useStudio.setState({ stats }),
    });
    viewportApi.current = vp;
    void vp.init();

    const push = (s = useStudio.getState()) => {
      if (s.scene) vp.setScene(s.scene);
      vp.setSelection(s.selection);
      vp.setGizmo(s.gizmo, s.space, s.snap);
      vp.setBeacons(beaconsFor(s));
    };
    push();
    const unsub = useStudio.subscribe((s, prev) => {
      if (s.scene !== prev.scene && s.scene) vp.setScene(s.scene);
      if (s.selection !== prev.selection) vp.setSelection(s.selection);
      if (s.gizmo !== prev.gizmo || s.space !== prev.space || s.snap !== prev.snap) vp.setGizmo(s.gizmo, s.space, s.snap);
      if (s.crew !== prev.crew || s.selection !== prev.selection || s.scene !== prev.scene) vp.setBeacons(beaconsFor(s));
    });

    onCaptureRequest((req) => {
      try {
        const dataUrl = vp.capture(req.view, req.helpers, req.width, req.height);
        send({ type: 'capture.response', requestId: req.requestId, dataUrl });
        useStudio.setState({ shutter: { at: Date.now(), label: `${req.by.name} captured · ${req.view}`, color: req.by.color } });
      } catch (err) {
        send({ type: 'capture.response', requestId: req.requestId, error: String(err) });
      }
    });

    return () => {
      unsub();
      onCaptureRequest(null);
      viewportApi.current = null;
      vp.dispose();
    };
  }, []);

  return (
    <div className={`viewport area-view${playStatus !== 'off' ? ' playing' : ''}${locked ? '' : ' unlocked'}`} ref={host}>
      <div className="vp-overlay" ref={overlay}>
        <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
        <HudTop />
        <HudBottom />
        <Shutter />
        <Toasts />
        <PlayHud />
      </div>
      <ToolDock />
      <Offline />
    </div>
  );
}

function beaconsFor(s: ReturnType<typeof useStudio.getState>): Beacon[] {
  const out: Beacon[] = [];
  if (s.scene && s.selection.length) {
    const first = s.scene.entities[s.selection[0]!];
    out.push({
      key: 'selection',
      color: '#ff6a2b',
      label: s.selection.length === 1 ? (first?.name ?? '') : `${s.selection.length} selected`,
      entityIds: s.selection,
      agent: false,
    });
  }
  for (const c of s.crew) {
    if (c.kind !== 'agent' || !c.focusEntityIds.length || c.status === 'idle') continue;
    out.push({ key: `agent:${c.id}`, color: c.color, label: `${c.name} ▸ ${c.message || c.status}`, entityIds: c.focusEntityIds, agent: true });
  }
  return out;
}

function HudTop() {
  const stats = useStudio((s) => s.stats);
  const scene = useStudio((s) => s.scene);
  return (
    <>
      <div className="hud tl">
        <span>Perspective</span>
        <span>
          <b>{stats?.backend === 'webgpu' ? 'WebGPU' : stats ? 'WebGL2' : '—'}</b>
        </span>
      </div>
      <div className="hud tr">
        <span>
          Rev <b>{scene ? pad(scene.revision) : '----'}</b>
        </span>
        <span>
          Ent <b>{scene ? Object.keys(scene.entities).length : 0}</b>
        </span>
      </div>
    </>
  );
}

function HudBottom() {
  const stats = useStudio((s) => s.stats);
  const snap = useStudio((s) => s.snap);
  const space = useStudio((s) => s.space);
  return (
    <>
      <div className="hud bl">
        <span className={stats && stats.fps < 50 ? 'warn' : ''}>
          <b>{stats?.fps ?? '--'}</b> fps
        </span>
        <span>
          <b>{stats?.drawCalls ?? '--'}</b> draws
        </span>
        <span>
          <b>{stats ? (stats.triangles / 1000).toFixed(1) : '--'}k</b> tris
        </span>
      </div>
      <div className="hud br">
        <span>{space}</span>
        <span>snap <b>{snap ? 'on' : 'off'}</b></span>
        <span>meters · y-up</span>
      </div>
    </>
  );
}

const TOOLS: Array<{ mode: GizmoMode; key: string; label: string; G: () => React.ReactNode }> = [
  { mode: 'translate', key: 'W', label: 'Move', G: Glyph.move },
  { mode: 'rotate', key: 'E', label: 'Rotate', G: Glyph.rotate },
  { mode: 'scale', key: 'R', label: 'Scale', G: Glyph.scale },
];

function ToolDock() {
  const gizmo = useStudio((s) => s.gizmo);
  const space = useStudio((s) => s.space);
  const snap = useStudio((s) => s.snap);
  return (
    <div className="tool-dock">
      {TOOLS.map((t) => (
        <button key={t.mode} className={gizmo === t.mode ? 'on' : ''} onClick={() => useStudio.setState({ gizmo: t.mode })} title={`${t.label} (${t.key})`}>
          <t.G /> {t.label} <kbd>{t.key}</kbd>
        </button>
      ))}
      <span className="sep" />
      <button onClick={() => useStudio.setState({ space: space === 'world' ? 'local' : 'world' })} title="Toggle gizmo space">
        {space}
      </button>
      <button className={snap ? 'on' : ''} onClick={() => useStudio.setState({ snap: !snap })} title="Snap (X)">
        <Glyph.magnet /> Snap
      </button>
      <span className="sep" />
      <button onClick={() => viewportApi.current?.frame()} title="Frame selection (F)">
        <Glyph.frame /> Frame <kbd>F</kbd>
      </button>
    </div>
  );
}

function Shutter() {
  const shutter = useStudio((s) => s.shutter);
  if (!shutter) return null;
  return (
    <div key={shutter.at} className="shutter flash" style={{ '--c': shutter.color } as React.CSSProperties}>
      <span className="tag">◉ {shutter.label}</span>
    </div>
  );
}

function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="toast-rail">
      {toasts.map((t) => (
        <div key={t.id} className="toast" style={{ '--c': t.tone === 'error' ? 'var(--rose)' : 'var(--teal)' } as React.CSSProperties}>
          <b>{t.title}</b>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

function Offline() {
  const conn = useStudio((s) => s.conn);
  const scene = useStudio((s) => s.scene);
  if (scene && conn === 'online') return null;
  if (scene) return null;
  return (
    <div className="vp-offline">
      <div>
        <h2>{conn === 'connecting' ? 'LINKING' : 'NO DAEMON'}</h2>
        <div className="micro">{conn === 'connecting' ? 'Connecting to forge daemon on :4317' : 'Run `pnpm dev` in the forge repo — retrying'}</div>
      </div>
    </div>
  );
}
