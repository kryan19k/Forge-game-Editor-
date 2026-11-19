import { flattenHierarchy } from '@forge/scene';
import { useMemo, useState } from 'react';
import { addRecipe, RECIPES, toggleFlag, type Recipe } from '../state/ops';
import { pick, select, submit, useStudio } from '../state/store';
import { viewportApi } from '../viewport/api';
import { Glyph, glyphFor } from './glyphs';

const RECIPE_GLYPH: Partial<Record<Recipe, () => React.ReactNode>> = {
  box: Glyph.box, sphere: Glyph.sphere, cylinder: Glyph.cylinder, capsule: Glyph.cylinder, cone: Glyph.cylinder,
  torus: Glyph.sphere, plane: Glyph.plane, point: Glyph.light, spot: Glyph.spot, directional: Glyph.sun,
  hemisphere: Glyph.sun, spawn: Glyph.spawn, trigger: Glyph.trigger, pickup: Glyph.pickup, door: Glyph.door, group: Glyph.group,
};

export function AddMenu({ onClose, style }: { onClose: () => void; style?: React.CSSProperties }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 39 }} onPointerDown={onClose} />
      <div className="menu" style={style}>
        {RECIPES.map((g) => (
          <div key={g.group}>
            <div className="grp micro">{g.group}</div>
            {g.items.map((i) => {
              const G = RECIPE_GLYPH[i.id] ?? Glyph.box;
              return (
                <button
                  key={i.id}
                  onClick={() => {
                    addRecipe(i.id, viewportApi.current?.placementPoint() ?? [0, 0, 0]);
                    onClose();
                  }}
                >
                  <G /> {i.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

export function Outliner() {
  const scene = useStudio((s) => s.scene);
  const selection = useStudio((s) => s.selection);
  const crew = useStudio((s) => s.crew);
  const renamingId = useStudio((s) => s.renamingId);
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => (scene ? flattenHierarchy(scene) : []), [scene]);
  const focusByEntity = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of crew) if (c.kind === 'agent') for (const id of c.focusEntityIds) m.set(id, [...(m.get(id) ?? []), c.color]);
    return m;
  }, [crew]);
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter(({ entity: e }) => e.name.toLowerCase().includes(q) || e.id.includes(q) || e.tags.some((t) => t.includes(q))) : rows;

  return (
    <div className="panel area-left">
      <div className="panel-head micro">
        <span className="code">01</span>
        <span className="title">Outliner</span>
        <span className="spacer" />
        <span className="dim">{rows.length}</span>
        <button className="btn" style={{ height: 20, padding: '0 6px' }} onClick={() => setMenu(true)} title="Add entity (Shift+A)">
          <Glyph.plus /> Add
        </button>
      </div>
      {menu && <AddMenu onClose={() => setMenu(false)} style={{ left: 150, top: 76 }} />}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--rule)' }}>
        <input className="text" placeholder="Filter by name, id, #tag" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="panel-body tree" onPointerDown={(e) => e.target === e.currentTarget && select([])}>
        {shown.map(({ entity: e, depth }) => {
          const G = glyphFor(e);
          const sel = selection.includes(e.id);
          const dots = focusByEntity.get(e.id) ?? [];
          return (
            <div
              key={e.id}
              className={`tree-row${sel ? ' selected' : ''}${e.visible ? '' : ' hidden-ent'}`}
              onClick={(ev) => pick(e.id, ev.shiftKey || ev.ctrlKey || ev.metaKey)}
              onDoubleClick={() => {
                useStudio.setState({ renamingId: e.id });
              }}
            >
              <span className="guides">
                {Array.from({ length: depth + 1 }, (_, i) => (
                  <span key={i} />
                ))}
              </span>
              <span className="glyph">
                <G />
              </span>
              <span className="name">
                {renamingId === e.id ? (
                  <input
                    autoFocus
                    defaultValue={e.name}
                    onClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => {
                      ev.stopPropagation();
                      if (ev.key === 'Enter') ev.currentTarget.blur();
                      if (ev.key === 'Escape') useStudio.setState({ renamingId: null });
                    }}
                    onBlur={(ev) => {
                      const v = ev.currentTarget.value.trim();
                      useStudio.setState({ renamingId: null });
                      if (v && v !== e.name) submit(`Rename ${e.name} → ${v}`, [{ op: 'rename_entity', entityId: e.id, name: v }]);
                    }}
                  />
                ) : (
                  e.name
                )}
              </span>
              {dots.length > 0 && (
                <span className="focus-dots">
                  {dots.map((c, i) => (
                    <i key={i} style={{ '--c': c } as React.CSSProperties} />
                  ))}
                </span>
              )}
              <span className="toggles">
                <button className={e.locked ? 'on' : ''} title={e.locked ? 'Unlock (agents may edit)' : 'Lock from agents'} onClick={(ev) => (ev.stopPropagation(), toggleFlag([e.id], 'locked'))}>
                  {e.locked ? <Glyph.lock /> : <Glyph.unlock />}
                </button>
                <button className={e.visible ? '' : 'on'} title={e.visible ? 'Hide' : 'Show'} onClick={(ev) => (ev.stopPropagation(), toggleFlag([e.id], 'visible'))}>
                  {e.visible ? <Glyph.eye /> : <Glyph.eyeOff />}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
