import type { HistoryEntry } from '@forge/contracts';
import { useEffect, useMemo, useRef } from 'react';
import { revert, select, useStudio } from '../state/store';
import { viewportApi } from '../viewport/api';
import { Glyph } from './glyphs';

const STEP = 14; // px per revision
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

/**
 * The Tape: every transaction on a seismograph strip. Height = size of change,
 * color = who made it, hollow = reverted. Click a tick to inspect / revert / focus.
 */
export function Tape() {
  const history = useStudio((s) => s.history);
  const crew = useStudio((s) => s.crew);
  const cursor = useStudio((s) => s.tapeCursor);
  const scene = useStudio((s) => s.scene);
  const track = useRef<HTMLDivElement>(null);

  const colorOf = useMemo(() => {
    const m = new Map(crew.map((c) => [c.id, c.color]));
    return (h: HistoryEntry) => m.get(h.author.id) ?? (h.author.kind === 'human' ? '#ff6a2b' : '#847d72');
  }, [crew]);

  const first = history[0]?.revision ?? 0;
  const last = scene?.revision ?? 0;
  const width = (last - first + 2) * STEP + 80;
  const selected = history.find((h) => h.txId === cursor) ?? history.at(-1);

  // Follow the playhead while new transactions arrive.
  useEffect(() => {
    const el = track.current;
    if (el && el.scrollWidth - el.scrollLeft - el.clientWidth < 160) el.scrollLeft = el.scrollWidth;
  }, [history.length]);

  const authors = useMemo(() => {
    const seen = new Map<string, HistoryEntry['author']>();
    for (const h of history) seen.set(h.author.id, h.author);
    return [...seen.values()];
  }, [history]);

  return (
    <div className="tape area-tape">
      <div className="tape-info">
        <div className="panel-head micro">
          <span className="code">04</span>
          <span className="title">Tape</span>
          <span className="spacer" />
          <span className="dim">{history.length} tx</span>
        </div>
        {selected ? (
          <>
            <div className="tx-meta micro">
              <span style={{ color: colorOf(selected) }}>{selected.author.name}</span>
              <span>rev {selected.revision}</span>
              <span>{time(selected.createdAt)}</span>
              <span>{selected.mutationCount} op</span>
            </div>
            <div className="tx-label" title={selected.label}>
              {selected.revertedBy ? <s className="dim">{selected.label}</s> : selected.label}
            </div>
            <div className="tx-actions">
              <button
                className="btn"
                disabled={!selected.touched.some((id) => scene?.entities[id])}
                onClick={() => {
                  const ids = selected.touched.filter((id) => scene?.entities[id]);
                  select(ids);
                  requestAnimationFrame(() => viewportApi.current?.frame(ids));
                }}
              >
                <Glyph.frame /> Focus
              </button>
              <button className="btn" disabled={!!selected.revertedBy} onClick={() => revert(selected.txId)} title="Revert this transaction (conflict-checked)">
                <Glyph.undo /> {selected.revertedBy ? 'Reverted' : 'Revert'}
              </button>
            </div>
          </>
        ) : (
          <div className="dim" style={{ marginTop: 6 }}>No changes yet. Every edit — yours or an agent’s — lands here.</div>
        )}
      </div>
      <div className="tape-track" ref={track}>
        <div className="tape-inner" style={{ width }}>
          <div className="tape-ruler">
            {Array.from({ length: Math.ceil((last - first + 2) / 10) + 1 }, (_, i) => {
              const rev = Math.floor(first / 10) * 10 + i * 10;
              if (rev < first - 1) return null;
              return (
                <span key={rev} style={{ left: (rev - first + 1) * STEP + 20 }}>
                  {rev}
                </span>
              );
            })}
          </div>
          <div className="tape-base" />
          {history.map((h) => {
            const height = 10 + Math.min(Math.log2(h.mutationCount + 1) * 14, 58);
            return (
              <div
                key={h.txId}
                className={`tape-tick${h.txId === selected?.txId ? ' on' : ''}${h.revertedBy ? ' reverted' : ''}`}
                style={{ left: (h.revision - first + 1) * STEP + 20, height, '--c': colorOf(h) } as React.CSSProperties}
                title={`rev ${h.revision} · ${h.author.name} · ${h.label}`}
                onClick={() => useStudio.setState({ tapeCursor: h.txId })}
              >
                <i />
              </div>
            );
          })}
          <div className="tape-now" style={{ left: (last - first + 1) * STEP + 20 + 7 }} />
          <div className="tape-legend micro">
            {authors.map((a) => (
              <span key={a.id} style={{ '--c': crew.find((c) => c.id === a.id)?.color ?? (a.kind === 'human' ? '#ff6a2b' : '#847d72') } as React.CSSProperties}>
                <i /> {a.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
