import { useEffect, useRef, useState } from 'react';

const fmt = (v: number, precision: number) => {
  const s = v.toFixed(precision);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') || '0' : s;
};

/**
 * Scrub field: drag horizontally to change (Shift = fine, Ctrl = coarse),
 * click to type. Emits `onPreview` while dragging and one `onCommit` on release
 * so a whole drag is a single transaction on the Tape.
 */
export function Scrub(props: {
  value: number;
  onCommit: (v: number) => void;
  onPreview?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  axis?: string;
  suffix?: string;
  showFill?: boolean;
}) {
  const { value, onCommit, onPreview, step = 0.05, min = -Infinity, max = Infinity, precision = 2, axis, suffix, showFill } = props;
  const [draft, setDraft] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const shown = draft ?? value;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const mult = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
    const next = clamp(+(d.v + dx * step * mult).toFixed(precision + 1));
    setDraft(next);
    onPreview?.(next);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return setEditing(true);
    if (draft !== null && draft !== value) onCommit(+draft.toFixed(precision + 1));
    setDraft(null);
  };

  const fill = showFill && Number.isFinite(min) && Number.isFinite(max) ? ((shown - min) / (max - min)) * 100 : null;

  return (
    <div
      className={`scrub${draft !== null ? ' active' : ''}`}
      style={axis ? ({ '--c': axis } as React.CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {fill !== null && <div className="fill" style={{ width: `${Math.max(0, Math.min(100, fill))}%` }} />}
      {axis && <span className="axis" />}
      {editing ? (
        <TypeIn
          initial={fmt(value, precision)}
          onDone={(txt) => {
            setEditing(false);
            const n = Number(txt);
            if (txt.trim() !== '' && Number.isFinite(n) && clamp(n) !== value) onCommit(clamp(n));
          }}
        />
      ) : (
        <span className="val">
          {fmt(shown, precision)}
          {suffix && <span className="dim">{suffix}</span>}
        </span>
      )}
    </div>
  );
}

function TypeIn({ initial, onDone }: { initial: string; onDone: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.select(), []);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(initial);
      }}
    />
  );
}

export const AXES = ['var(--ax-x)', 'var(--ax-y)', 'var(--ax-z)'] as const;

export function Vec3Field(props: {
  value: readonly [number, number, number];
  onCommit: (v: [number, number, number]) => void;
  step?: number;
  precision?: number;
}) {
  const { value, onCommit, step, precision } = props;
  return (
    <div className="vec">
      {[0, 1, 2].map((i) => (
        <Scrub
          key={i}
          axis={AXES[i]}
          value={value[i]!}
          step={step}
          precision={precision}
          onCommit={(v) => {
            const next = [...value] as [number, number, number];
            next[i] = v;
            onCommit(next);
          }}
        />
      ))}
    </div>
  );
}

export function ColorField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="color-field">
      <span className="swatch" style={{ background: draft }}>
        <input type="color" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />
      </span>
      <span className="hex">{draft}</span>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} className={o === value ? 'on' : ''} onClick={() => o !== value && onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={`toggle${value ? ' on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value} />;
}

export function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="text"
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      onBlur={(e) => e.currentTarget.value !== value && onCommit(e.currentTarget.value)}
    />
  );
}
