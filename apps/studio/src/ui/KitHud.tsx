import type { KitView } from '@forge/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';
import { sendCommand } from '../state/play';

export const useKitPanel = create<{ panel: null | 'tree' | 'inventory'; tree: string | null }>(() => ({ panel: null, tree: null }));

const RARITY: Record<string, string> = { common: '#b9b2a5', uncommon: '#9bd15a', rare: '#59c8ff', epic: '#d68cff', legendary: '#f2b33d' };

/** Toggle panels with T / I; release the mouse while a panel is open. */
export function useKitHotkeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const want = e.code === 'KeyT' ? 'tree' : e.code === 'KeyI' || e.code === 'Tab' ? 'inventory' : e.code === 'Escape' ? null : undefined;
      if (want === undefined) return;
      const cur = useKitPanel.getState().panel;
      if (want === null && !cur) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = want === cur ? null : want;
      useKitPanel.setState({ panel: next });
      if (next) document.exitPointerLock?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}

export function Bar({ value, max, color, label, slim }: { value: number; max: number; color?: string; label?: string; slim?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={`kbar${slim ? ' slim' : ''}${pct < 0.25 ? ' low' : ''}`} style={{ '--c': color ?? '#ff6a2b' } as React.CSSProperties}>
      <i style={{ width: `${pct * 100}%` }} />
      {!slim && (
        <span className="mono">
          {label ? `${label} ` : ''}
          {Math.ceil(value)}/{Math.round(max)}
        </span>
      )}
    </div>
  );
}

/** Vitals + ability bar + XP + statuses for projects that use the gameplay framework. */
export function KitHud({ kit }: { kit: KitView }) {
  const panel = useKitPanel((s) => s.panel);
  return (
    <>
      <div className="kit-vitals">
        {kit.resources.map((r) => (
          <Bar key={r.id} value={r.current} max={r.max} color={r.color ?? (r.id === 'health' ? '#e3608f' : '#59c8ff')} label={r.name} />
        ))}
        {kit.statuses.length > 0 && (
          <div className="kit-statuses">
            {kit.statuses.map((s) => (
              <span key={s.id} className={`micro chip${s.harmful ? ' bad' : ''}`}>
                {s.name}
                {s.stacks > 1 ? ` ×${s.stacks}` : ''} <b className="mono">{Math.ceil(s.remaining)}s</b>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="kit-dock">
        {kit.casting && (
          <div className="cast-bar">
            <span className="micro">{kit.casting.name}</span>
            <i style={{ width: `${kit.casting.progress * 100}%` }} />
          </div>
        )}
        <div className="ability-bar">
          {kit.bar.map((b, i) => (
            <div key={i} className={`slot-a${b ? '' : ' empty'}${b?.blocked && b.cooldown <= 0 ? ' blocked' : ''}`} style={{ '--c': b?.color ?? '#57524b' } as React.CSSProperties} title={b ? `${b.name}${b.blocked ? ` — ${b.blocked}` : ''}` : ''}>
              <kbd>{i + 1}</kbd>
              {b && <span className="name">{b.name}</span>}
              {b && b.cooldown > 0 && (
                <>
                  <span className="sweep" style={{ '--p': `${(b.cooldown / Math.max(0.01, b.cooldownMax)) * 360}deg` } as React.CSSProperties} />
                  <span className="cd mono">{b.cooldown.toFixed(b.cooldown < 1 ? 1 : 0)}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="xp-row">
          <span className="lvl mono">LV {kit.level}</span>
          <Bar value={kit.xp} max={kit.xpNext} color="#f2b33d" slim />
          <span className="micro dim">
            {kit.xp}/{kit.xpNext} xp
          </span>
          {kit.trees.length > 0 && (
            <button className={`micro pts${kit.points ? ' hot' : ''}`} onClick={() => useKitPanel.setState({ panel: panel === 'tree' ? null : 'tree' })}>
              <kbd>T</kbd> {kit.points ? `${kit.points} point${kit.points > 1 ? 's' : ''}` : 'Skills'}
            </button>
          )}
          <button className="micro pts" onClick={() => useKitPanel.setState({ panel: panel === 'inventory' ? null : 'inventory' })}>
            <kbd>I</kbd> Bag
          </button>
        </div>
      </div>

      {panel === 'tree' && <TreePanel kit={kit} />}
      {panel === 'inventory' && <InventoryPanel kit={kit} />}
    </>
  );
}

const CELL_X = 150;
const CELL_Y = 104;

function TreePanel({ kit }: { kit: KitView }) {
  const sel = useKitPanel((s) => s.tree);
  const tree = kit.trees.find((t) => t.id === sel) ?? kit.trees[0];
  if (!tree) return null;
  const xs = tree.nodes.map((n) => n.pos[0]);
  const ys = tree.nodes.map((n) => n.pos[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = (Math.max(...xs) - minX + 1) * CELL_X;
  const h = (Math.max(...ys) - minY + 1) * CELL_Y;
  const at = (p: [number, number]) => [(p[0] - minX) * CELL_X + CELL_X / 2, (p[1] - minY) * CELL_Y + CELL_Y / 2] as const;
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  return (
    <div className="kit-panel" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <div className="micro dim">Progression</div>
          <div className="title">{tree.name}</div>
        </div>
        <div className="tabs">
          {kit.trees.map((t) => (
            <button key={t.id} className={t.id === tree.id ? 'on' : ''} onClick={() => useKitPanel.setState({ tree: t.id })}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="points">
          <b className="mono">{kit.points}</b>
          <span className="micro">{tree.currency}</span>
        </div>
        <button className="btn ghost" onClick={() => useKitPanel.setState({ panel: null })}>
          Close <kbd>T</kbd>
        </button>
      </header>
      <div className="tree-canvas">
        <svg width={w} height={h} className="tree-links">
          {tree.nodes.flatMap((n) =>
            n.requires.map((r) => {
              const from = byId.get(r);
              if (!from) return null;
              const [x1, y1] = at(from.pos);
              const [x2, y2] = at(n.pos);
              return <line key={`${r}-${n.id}`} x1={x1} y1={y1} x2={x2} y2={y2} className={from.rank > 0 ? 'lit' : ''} />;
            }),
          )}
        </svg>
        {tree.nodes.map((n) => {
          const [x, y] = at(n.pos);
          const state = n.rank >= n.ranks ? 'max' : n.rank > 0 ? 'owned' : n.why === null ? 'open' : 'locked';
          return (
            <button
              key={n.id}
              className={`tnode ${state}`}
              style={{ left: x, top: y }}
              title={`${n.name}\n${n.description}${n.why ? `\n— ${n.why}` : ''}`}
              disabled={n.why !== null}
              onClick={() => sendCommand({ kind: 'unlock', tree: tree.id, node: n.id })}
            >
              <span className="nm">{n.name}</span>
              <span className="mono rk">
                {n.rank}/{n.ranks}
              </span>
              {n.why && state !== 'max' && <span className="why">{n.why}</span>}
              {!n.why && <span className="why go">{n.cost} pt</span>}
            </button>
          );
        })}
        <div style={{ width: w, height: h }} />
      </div>
    </div>
  );
}

function InventoryPanel({ kit }: { kit: KitView }) {
  return (
    <div className="kit-panel inv" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <div className="micro dim">Inventory</div>
          <div className="title">Bag</div>
        </div>
        <div className="equip-row">
          {Object.entries(kit.equipment).map(([slot, item]) => (
            <span key={slot} className="micro chip">
              {slot}: {kit.items.find((i) => i.id === item)?.name ?? item}
            </span>
          ))}
        </div>
        <button className="btn ghost" onClick={() => useKitPanel.setState({ panel: null })}>
          Close <kbd>I</kbd>
        </button>
      </header>
      <div className="inv-grid">
        {kit.items.length === 0 && <div className="dim">Empty.</div>}
        {kit.items.map((it) => (
          <button
            key={it.id}
            className={`inv-item${it.equipped ? ' eq' : ''}`}
            style={{ '--r': RARITY[it.rarity] ?? '#b9b2a5' } as React.CSSProperties}
            onClick={() => {
              if (it.kind === 'consumable') sendCommand({ kind: 'use', item: it.id });
              else if (it.kind === 'equipment') sendCommand({ kind: 'equip', item: it.id });
            }}
            title={it.kind === 'consumable' ? 'Click to use' : it.kind === 'equipment' ? 'Click to equip' : it.kind}
          >
            <span className="nm">{it.name}</span>
            <span className="micro dim">
              {it.kind}
              {it.equipped ? ' · equipped' : ''}
            </span>
            {it.count > 1 && <b className="mono ct">×{it.count}</b>}
          </button>
        ))}
      </div>
      <div className="stat-list">
        {kit.stats.map((s) => (
          <span key={s.id} className="micro">
            {s.name} <b className="mono">{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
