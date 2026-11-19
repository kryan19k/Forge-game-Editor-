import { useMemo, useState } from 'react';
import { COMMANDS, directiveCommand } from '../commands';
import { useStudio } from '../state/store';

/** Ctrl+K: every Studio action, plus "direct the crew" as the fallthrough for anything else you type. */
export function Palette() {
  const open = useStudio((s) => s.paletteOpen);
  if (!open) return null;
  return <PaletteInner />;
}

function score(label: string, q: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (l.includes(q)) return 2;
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

function PaletteInner() {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const close = () => useStudio.setState({ paletteOpen: false });

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const avail = COMMANDS.filter((c) => c.enabled?.() ?? true);
    const ranked = query
      ? avail
          .map((c) => ({ c, s: score(c.label, query) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.c)
      : avail;
    return q.trim().length > 2 ? [...ranked.slice(0, 9), directiveCommand(q.trim())] : ranked.slice(0, 12);
  }, [q]);

  const run = (i: number) => {
    const cmd = items[i];
    if (!cmd) return;
    close();
    cmd.run();
  };

  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <input
          autoFocus
          placeholder="Type a command — or tell the crew what you want"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') (e.preventDefault(), setCursor((c) => Math.min(c + 1, items.length - 1)));
            if (e.key === 'ArrowUp') (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
            if (e.key === 'Enter') run(cursor);
          }}
        />
        <ul>
          {items.map((c, i) => (
            <li key={c.id + c.label} className={i === cursor ? 'on' : ''} onPointerEnter={() => setCursor(i)} onClick={() => run(i)}>
              <span className="grp micro">{c.group}</span>
              <span className="lbl">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {items.length === 0 && <li className="dim">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
