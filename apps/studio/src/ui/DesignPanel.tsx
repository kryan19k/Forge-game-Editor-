import { useEffect, useState } from 'react';
import { toast, useStudio } from '../state/store';

/** The design brief: Producer/agent follow-ups to answer, the GDD, and the build plan. */
export function DesignPanel() {
  const open = useStudio((s) => s.designOpen);
  const brief = useStudio((s) => s.brief);
  const [producer, setProducer] = useState<{ available: boolean; source: string } | null>(null);
  const [key, setKey] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) void fetch('/api/producer').then((r) => r.json()).then(setProducer);
  }, [open]);

  if (!open) return null;
  const close = () => useStudio.setState({ designOpen: false });
  const pending = brief?.followUps.filter((f) => !f.answer) ?? [];

  const answer = async (id: string, a: string) => {
    if (!a.trim()) return;
    await fetch(`/api/brief/followups/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: a.trim() }) });
  };
  const saveKey = async (k: string | null) => {
    const r = (await (await fetch('/api/producer/key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: k }) })).json()) as { ok: boolean; status?: typeof producer; error?: string };
    if (!r.ok) return toast('error', 'PRODUCER', r.error ?? 'failed');
    setProducer(r.status ?? null);
    setKey('');
    toast('info', 'PRODUCER', k ? 'Claude API key saved locally (workspace/secrets.json, never sent to the browser)' : 'Key removed');
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="design-panel" onKeyDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <div className="micro dim">Design brief</div>
            <h1>{brief?.title ?? 'No brief'}</h1>
          </div>
          {brief && <span className={`micro status st-${brief.status}`}>{brief.status}</span>}
          <button className="btn ghost" onClick={close}>
            Close <kbd>Esc</kbd>
          </button>
        </header>
        {!brief ? (
          <div className="pad dim">This project wasn’t created from a genre interview. Start one from New game → a genre.</div>
        ) : (
          <div className="design-body">
            <section className="dp-main">
              {pending.length > 0 && (
                <div className="dp-questions">
                  <div className="micro" style={{ color: 'var(--amber)' }}>
                    {pending.length} decision{pending.length > 1 ? 's' : ''} waiting on you
                  </div>
                  {pending.map((f) => (
                    <div key={f.id} className="dp-q">
                      <div className="who micro">{f.askedBy} asks</div>
                      <div className="prompt">{f.prompt}</div>
                      {f.options.length > 0 && (
                        <div className="opts">
                          {f.options.map((o) => (
                            <button key={o} className="btn" onClick={() => answer(f.id, o)}>
                              {o}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="row">
                        <input className="text" placeholder="Or answer in your own words" value={drafts[f.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [f.id]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && answer(f.id, drafts[f.id] ?? '')} />
                        <button className="btn primary" onClick={() => answer(f.id, drafts[f.id] ?? '')}>
                          Answer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {brief.status === 'designing' && <div className="dp-working micro">Producer is writing the design…</div>}
              <div className="gdd">{brief.gdd}</div>
              {brief.followUps.some((f) => f.answer) && (
                <div className="dp-answered">
                  <div className="micro dim">Decisions</div>
                  {brief.followUps
                    .filter((f) => f.answer)
                    .map((f) => (
                      <div key={f.id} className="row">
                        <span className="dim">{f.prompt}</span>
                        <b>{f.answer}</b>
                      </div>
                    ))}
                </div>
              )}
            </section>
            <aside className="dp-side">
              <div className="micro dim">Build plan</div>
              <ol className="plan">
                {brief.plan.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
              <div className="micro dim" style={{ marginTop: 18 }}>
                Producer
              </div>
              <div className="producer-box">
                <div className="mono small">
                  {producer?.available ? (producer.source === 'saved' ? 'Claude · key saved in FORGE' : producer.source === 'environment' ? 'Claude · key from environment' : 'Claude · credentials unverified') : 'No Claude credentials — interview runs through your MCP agent'}
                </div>
                {brief.producer.note && <div className="note">{brief.producer.note}</div>}
                <input className="text" type="password" placeholder="Anthropic API key (optional)" value={key} onChange={(e) => setKey(e.target.value)} />
                <div className="row">
                  <button className="btn" disabled={key.trim().length < 20} onClick={() => saveKey(key.trim())}>
                    Save key
                  </button>
                  {producer?.source === 'saved' && (
                    <button className="btn ghost" onClick={() => saveKey(null)}>
                      Remove
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => fetch('/api/brief/produce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })}>
                    Run Producer
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
