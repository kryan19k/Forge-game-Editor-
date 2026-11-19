import type { DesignAnswer, ProjectInfo, StarterInfo } from '@forge/contracts';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { toast, useStudio } from '../state/store';

interface TemplateMeta {
  id: string;
  code: string;
  name: string;
  genre: string;
  tagline: string;
  features: string[];
  players: string;
  controls: string;
  accent: string;
  skill: string;
}

export const useGallery = create<{ open: boolean }>(() => ({ open: false }));
export const openGallery = () => useGallery.setState({ open: true });

/** Line-drawn genre emblems — each genre gets a mark, not a stock illustration. */
export function Emblem({ genre, color }: { genre: string; color: string }) {
  const p = { fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'square' as const };
  return (
    <svg viewBox="0 0 120 72" className="emblem">
      {genre === 'racing' && (
        <>
          <rect x="14" y="14" width="92" height="44" rx="22" {...p} />
          <rect x="30" y="26" width="60" height="20" rx="10" {...p} opacity={0.5} />
          <path d="M60 14v-6M60 58v6" {...p} />
          <circle cx="98" cy="36" r="3" fill={color} />
        </>
      )}
      {genre === 'fighting' && (
        <>
          <path d="M20 20l24 16-24 16M100 20L76 36l24 16" {...p} />
          <path d="M60 10v52" {...p} strokeDasharray="3 4" opacity={0.6} />
          <rect x="16" y="62" width="88" height="2" fill={color} opacity={0.4} />
        </>
      )}
      {genre === 'rpg' && (
        <>
          <path d="M72 14a24 24 0 1 0 0 44 20 20 0 1 1 0-44z" {...p} />
          <path d="M30 60l10-14 8 9 10-16 14 21" {...p} opacity={0.6} />
          <circle cx="92" cy="22" r="2" fill={color} />
          <circle cx="100" cy="34" r="1.5" fill={color} />
        </>
      )}
      {genre === 'mmorpg' && (
        <>
          <path d="M60 10l8 26-8 26-8-26z" {...p} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return <circle key={i} cx={60 + Math.cos(a) * 40} cy={36 + Math.sin(a) * 22} r="2.2" fill={color} opacity={i % 3 ? 0.55 : 1} />;
          })}
        </>
      )}
      {genre === 'exploration' && (
        <>
          <rect x="38" y="16" width="44" height="44" {...p} />
          <path d="M52 60V38h16v22" {...p} />
          <circle cx="60" cy="30" r="3" fill={color} />
          <path d="M14 36h16M90 36h16" {...p} opacity={0.6} />
        </>
      )}
      {genre === 'sandbox' && (
        <>
          <circle cx="60" cy="36" r="18" {...p} />
          <path d="M60 10v14M60 48v14M34 36h14M72 36h14" {...p} />
          <circle cx="60" cy="36" r="3" fill={color} />
        </>
      )}
    </svg>
  );
}

export function Gallery() {
  const open = useGallery((s) => s.open);
  if (!open) return null;
  return <GalleryInner />;
}

interface Data {
  active: string;
  projects: ProjectInfo[];
  templates: TemplateMeta[];
  starters: StarterInfo[];
  producer: { available: boolean; source: string };
}

function GalleryInner() {
  const project = useStudio((s) => s.project);
  const [data, setData] = useState<Data | null>(null);
  const [interview, setInterview] = useState<StarterInfo | null>(null);
  const [sample, setSample] = useState<TemplateMeta | null>(null);
  const close = () => useGallery.setState({ open: false });

  useEffect(() => {
    void Promise.all([fetch('/api/projects').then((r) => r.json()), fetch('/api/starters').then((r) => r.json())]).then(([p, s]) => setData({ ...p, ...s }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      useGallery.setState({ open: false });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const openProject = async (id: string) => {
    await fetch(`/api/projects/${encodeURIComponent(id)}/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    close();
  };

  const createSample = async (t: TemplateMeta) => {
    const r = (await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: t.id }) })).json()) as { ok: boolean; error?: string };
    if (!r.ok) return toast('error', 'SAMPLE', r.error ?? 'failed');
    toast('info', 'SAMPLE', `${t.name} opened — a finished example to study and remix`);
    close();
  };

  return (
    <div className="scrim gallery-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="gallery" onKeyDown={(e) => e.stopPropagation()}>
        {interview ? (
          <Interview starter={interview} producer={data?.producer} onBack={() => setInterview(null)} onDone={close} />
        ) : (
          <>
            <header className="gallery-head">
              <div>
                <div className="micro dim">New game</div>
                <h1>What are we making?</h1>
              </div>
              <button className="btn ghost" onClick={close}>
                Close <kbd>Esc</kbd>
              </button>
            </header>
            <div className="gallery-body">
              <div className="gallery-main">
                <div className="section-label micro">Start from a genre — FORGE interviews you, then builds the foundation</div>
                <div className="cards">
                  {!data && <div className="dim pad">Loading…</div>}
                  {data?.starters.map((s) => (
                    <button key={s.id} className="card" style={{ '--a': s.accent } as React.CSSProperties} onClick={() => setInterview(s)}>
                      <div className="card-top">
                        <span className="code mono">{s.code}</span>
                        <span className="micro dim">{s.questions.length} questions</span>
                      </div>
                      <Emblem genre={s.genre} color={s.accent} />
                      <div className="card-name">{s.name}</div>
                      <div className="card-tag">{s.tagline}</div>
                      <div className="feats">
                        <span className="micro">interview → greybox</span>
                        <span className="micro">skill: {s.skill}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="section-label micro">Sample games — finished examples to play, study and remix</div>
                <div className="samples">
                  {data?.templates.map((t) => (
                    <button key={t.id} className={`sample${sample?.id === t.id ? ' on' : ''}`} style={{ '--a': t.accent } as React.CSSProperties} onClick={() => setSample(t)} onDoubleClick={() => createSample(t)}>
                      <span className="code mono">{t.code}</span>
                      <span className="nm">{t.name}</span>
                      <span className="micro dim">{t.players}</span>
                    </button>
                  ))}
                  {sample && (
                    <div className="sample-detail" style={{ '--a': sample.accent } as React.CSSProperties}>
                      <div className="dim">{sample.tagline}</div>
                      <div className="feats">
                        {sample.features.map((f) => (
                          <span key={f} className="micro">
                            {f}
                          </span>
                        ))}
                      </div>
                      <button className="btn" onClick={() => createSample(sample)}>
                        Open sample
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <aside className="gallery-side">
                <div className="micro dim projects-label">Your projects</div>
                <div className="projects">
                  {data?.projects.map((p) => (
                    <button key={p.projectId} className={`proj${p.projectId === project?.projectId ? ' on' : ''}`} onClick={() => openProject(p.projectId)}>
                      <span>{p.name}</span>
                      <span className="micro dim">{p.template.replace('starter:', '')}</span>
                    </button>
                  ))}
                </div>
                <div className={`producer-note micro ${data?.producer.available ? 'ok' : ''}`}>
                  Producer: {data?.producer.available ? (data.producer.source === 'unverified' ? 'embedded (credentials unverified)' : 'embedded · Claude') : 'MCP agent'}
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The design interview: one decision at a time, then a summary, then Forge. */
function Interview({ starter, producer, onBack, onDone }: { starter: StarterInfo; producer?: Data['producer']; onBack: () => void; onDone: () => void }) {
  const qs = starter.questions;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DesignAnswer>>(() => Object.fromEntries(qs.filter((q) => q.default !== undefined).map((q) => [q.id, q.default!])));
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const review = i >= qs.length;
  const q = qs[i];

  const pick = (optId: string) => {
    if (!q) return;
    if (q.kind === 'multi') {
      const cur = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
      setAnswers({ ...answers, [q.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId] });
    } else {
      setAnswers({ ...answers, [q.id]: optId });
      setTimeout(() => setI((n) => n + 1), 140);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (!q) return;
      // A focused button already handles Enter natively; don't advance twice.
      if (e.key === 'Enter' && (e.target as HTMLElement).closest('button')) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) pick(q.options[n - 1]!.id);
      if (e.key === 'Enter' && q.kind !== 'single') setI((x) => x + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const summary = useMemo(
    () =>
      qs.map((qq) => {
        const a = answers[qq.id];
        const label = Array.isArray(a) ? a.map((x) => qq.options.find((o) => o.id === x)?.label ?? x).join(', ') : qq.options.find((o) => o.id === a)?.label ?? (a as string | undefined);
        return { q: qq, label: label || '—' };
      }),
    [answers, qs],
  );

  const forge = async () => {
    setBusy(true);
    const r = (await (
      await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ starter: starter.id, answers, name: title.trim() || undefined }) })
    ).json()) as { ok: boolean; error?: string };
    setBusy(false);
    if (!r.ok) return toast('error', 'FORGE', r.error ?? 'failed');
    toast('info', 'FORGED', `${title.trim() || starter.name} — playable greybox built. ${producer?.available ? 'The Producer is drafting your design doc.' : 'Your agent will pick up the brief.'}`);
    useStudio.setState({ designOpen: true });
    onDone();
  };

  return (
    <div className="interview" style={{ '--a': starter.accent } as React.CSSProperties}>
      <aside className="iv-rail">
        <button className="btn ghost" onClick={onBack}>
          ← Genres
        </button>
        <div className="iv-genre">
          <Emblem genre={starter.genre} color={starter.accent} />
          <div className="code mono">{starter.code}</div>
          <div className="nm">{starter.name}</div>
        </div>
        <ol>
          {qs.map((qq, n) => (
            <li key={qq.id} className={`${n === i ? 'on' : ''}${answers[qq.id] !== undefined && answers[qq.id] !== '' ? ' done' : ''}`} onClick={() => setI(n)}>
              <span className="mono">{String(n + 1).padStart(2, '0')}</span> {qq.prompt}
            </li>
          ))}
          <li className={review ? 'on' : ''} onClick={() => setI(qs.length)}>
            <span className="mono">✓</span> Review & forge
          </li>
        </ol>
      </aside>
      <section className="iv-stage">
        <div className="iv-progress">
          <i style={{ width: `${(Math.min(i, qs.length) / qs.length) * 100}%` }} />
        </div>
        {!review && q && (
          <div className="iv-q" key={q.id}>
            <div className="micro dim">
              Question {i + 1} of {qs.length}
              {q.kind === 'multi' ? ' · choose any' : ''}
            </div>
            <h2>{q.prompt}</h2>
            {q.help && <div className="dim help">{q.help}</div>}
            {q.kind === 'text' ? (
              <textarea autoFocus className="iv-text" value={(answers[q.id] as string) ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="Type your answer, or skip" />
            ) : (
              <div className="iv-options">
                {q.options.map((o, n) => {
                  const a = answers[q.id];
                  const on = Array.isArray(a) ? a.includes(o.id) : a === o.id;
                  return (
                    <button key={o.id} className={`iv-opt${on ? ' on' : ''}`} onClick={() => pick(o.id)}>
                      <kbd>{n + 1}</kbd>
                      <span className="lbl">{o.label}</span>
                      {o.hint && <span className="hint">{o.hint}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="iv-nav">
              <button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>
                Back
              </button>
              <button className="btn" onClick={() => setI(i + 1)}>
                {q.kind === 'single' ? 'Skip' : 'Next'} <kbd>↵</kbd>
              </button>
            </div>
          </div>
        )}
        {review && (
          <div className="iv-q">
            <div className="micro dim">Review</div>
            <h2>Name it, then forge the foundation</h2>
            <input className="text iv-title" autoFocus placeholder={`Untitled ${starter.name}`} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && forge()} />
            <div className="iv-summary">
              {summary.map((s) => (
                <div key={s.q.id} className="row">
                  <span className="dim">{s.q.prompt}</span>
                  <b>{s.label}</b>
                </div>
              ))}
            </div>
            <div className="dim help">
              FORGE builds a playable greybox from these answers right now. Then {producer?.available ? 'the embedded Producer (Claude)' : 'your connected agent'} asks a few follow-up questions, writes the design doc and plans the build.
            </div>
            <div className="iv-nav">
              <button className="btn ghost" onClick={() => setI(qs.length - 1)}>
                Back
              </button>
              <button className="btn primary big" disabled={busy} onClick={forge}>
                {busy ? 'Forging…' : 'Forge it'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
