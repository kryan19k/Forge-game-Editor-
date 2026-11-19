import { hostOnline, togglePlay, usePlay } from '../state/play';
import { redo, toast, undo, useStudio } from '../state/store';
import { openGallery } from './Gallery';
import { Glyph } from './glyphs';

export function TopBar() {
  const project = useStudio((s) => s.project);
  const scene = useStudio((s) => s.scene);
  const conn = useStudio((s) => s.conn);
  const crew = useStudio((s) => s.crew);
  const play = usePlay((s) => s.status);
  const mode = usePlay((s) => s.mode);
  const room = usePlay((s) => s.room);
  const brief = useStudio((s) => s.brief);
  const assetsOpen = useStudio((s) => s.assetsOpen);
  const pending = brief?.followUps.filter((f) => !f.answer).length ?? 0;
  const hot = crew.some((c) => c.kind === 'agent' && c.status === 'working');

  return (
    <header className="topbar area-top">
      <div className="wordmark">
        <span className={`furnace${hot ? ' hot' : ''}`} title={hot ? 'Crew is working' : 'Idle'} />
        FORGE
      </div>
      <div className="crumbs">
        <span className="project" onClick={openGallery} title="Projects & templates">
          {project?.name ?? '—'}
        </span>
        <span className="micro dim">{scene?.game.genre ?? ''}</span>
        <span className="sep">/</span>
        <span className="micro">{scene?.name ?? 'no scene'}</span>
        <button className="swap" onClick={openGallery} title="New game from a template, or switch project">
          New game
        </button>
      </div>
      <div className="top-actions" style={{ borderLeft: 0, borderRight: '1px solid var(--rule)' }}>
        <button className="btn ghost" onClick={undo} title="Undo your last change (Ctrl+Z)">
          <Glyph.undo />
        </button>
        <button className="btn ghost" onClick={redo} title="Redo (Ctrl+Shift+Z)">
          <Glyph.redo />
        </button>
      </div>
      <span className="grow" />
      <div className="crew-strip">
        {crew.map((c) => (
          <span key={c.id} className={`crew-chip ${c.status}`} style={{ '--c': c.color } as React.CSSProperties} title={c.message || c.status}>
            <i /> {c.name}
            <span className="dim">{c.kind === 'human' ? 'dir' : c.status}</span>
          </span>
        ))}
      </div>
      <div className="readout micro">
        <span className="link-state">
          <span className={`link-dot ${conn}`} />
          {conn === 'online' ? 'Linked' : conn}
        </span>
        <span>
          Rev <b className="mono">{scene?.revision ?? '—'}</b>
        </span>
      </div>
      <div className="top-actions">
        <button className={'btn' + (assetsOpen ? ' attn' : '')} aria-pressed={assetsOpen} onClick={() => useStudio.setState({ assetsOpen: !assetsOpen })}>
          Assets
        </button>
        {brief && (
          <button className={`btn${pending ? ' attn' : ''}`} onClick={() => useStudio.setState({ designOpen: true })} title="Design brief, Producer questions and build plan">
            Design {pending > 0 && <b className="badge">{pending}</b>}
          </button>
        )}
        <button className="btn" onClick={() => useStudio.setState({ paletteOpen: true })}>
          Command <kbd>Ctrl K</kbd>
        </button>
        {room && (
          <span className="room-chip" title="Live multiplayer session">
            ● {room.id}
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(room.url);
                toast('info', 'INVITE', `Join link copied — ${room.url}`);
              }}
            >
              Copy invite
            </button>
          </span>
        )}
        {play === 'off' && (
          <button className="btn" disabled={!scene} onClick={hostOnline} title="Host this scene as a multiplayer session">
            Host online
          </button>
        )}
        <button className={`btn primary${play !== 'off' ? ' on' : ''}`} disabled={!scene} onClick={togglePlay} title="Play in editor (Ctrl+P)">
          {play === 'off' ? <Glyph.play /> : <Glyph.close />} {play === 'off' ? 'Play' : play === 'loading' ? 'Loading' : mode === 'online' ? 'Leave' : 'Stop'} <kbd>Ctrl P</kbd>
        </button>
      </div>
    </header>
  );
}
