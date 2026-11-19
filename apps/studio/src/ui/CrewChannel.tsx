import { useEffect, useMemo, useRef, useState } from 'react';
import { send, useStudio } from '../state/store';
import { SceneActivityCard } from './SceneActivityCard';

const hhmmss = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
const STATUS_COLOR = { open: 'var(--bone-2)', claimed: 'var(--amber)', done: 'var(--lime)', rejected: 'var(--rose)' } as const;

/** Radio-log of everything the crew says and does, plus the Director's directive composer. */
export function CrewChannel() {
  const comms = useStudio((s) => s.comms);
  const activity = useStudio((s) => s.activity);
  const { autoReact } = useStudio((s) => s.activitySettings);
  const online = useStudio((s) => s.conn === 'online');
  const crew = useStudio((s) => s.crew);
  const directives = useStudio((s) => s.directives);
  const selection = useStudio((s) => s.selection);
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState(true);
  const log = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => [...comms, ...activity].sort((a, b) => a.at - b.at), [comms, activity]);

  const colorOf = useMemo(() => {
    const m = new Map(crew.map((c) => [c.id, c.color]));
    return (id: string, kind: string) => m.get(id) ?? (kind === 'human' ? '#ff6a2b' : kind === 'system' ? '#847d72' : '#b9b2a5');
  }, [crew]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  const active = directives.filter((d) => d.status === 'open' || d.status === 'claimed').slice(-3);
  const agents = crew.filter((c) => c.kind === 'agent');

  const issue = () => {
    const text = draft.trim();
    if (!text) return;
    send({ type: 'directive.create', text, focusEntityIds: attach ? selection : [] });
    setDraft('');
  };

  return (
    <div className="panel">
      <div className="panel-head micro">
        <span className="code">03</span>
        <span className="title">Crew Channel</span>
        <span className="spacer" />
        <span className="dim">{agents.length ? `${agents.filter((a) => a.status !== 'idle').length}/${agents.length} active` : 'no agents linked'}</span>
      </div>
      <label className="activity-toggle micro" title="Allow agents to offer follow-ups on scene changes">
        <input type="checkbox" checked={autoReact} disabled={!online}
          onChange={(event) => send({ type: 'activity.settings', settings: { autoReact: event.target.checked } })} />
        Agent follow-ups
      </label>
      {active.length > 0 && (
        <div className="dir-list">
          {active.map((d) => (
            <div className="dir-item" key={d.id}>
              <span className="st" style={{ '--c': STATUS_COLOR[d.status] } as React.CSSProperties}>
                {d.status}
                {d.claimedBy ? <><br /><span className="dim">{d.claimedBy}</span></> : null}
              </span>
              <div>
                {d.text}
                {d.response && <div className="resp">{d.response}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="comms" ref={log}>
        {feed.length === 0 && <div className="dim" style={{ padding: '8px 12px' }}>Channel quiet.</div>}
        {feed.map((c) => 'changes' in c ? (
          <SceneActivityCard key={c.txId} entry={c} color={colorOf(c.author.id, c.author.kind)} />
        ) : (
          <div key={c.id} className={`comms-row ${c.level}`} style={{ '--c': colorOf(c.source.id, c.source.kind) } as React.CSSProperties}>
            <span className="t">{hhmmss(c.at)}</span>
            <span className="who">{c.source.name}</span>
            <span className="msg">{c.text}</span>
          </div>
        ))}
      </div>
      <div className="directive-box">
        <textarea
          value={draft}
          placeholder={agents.length ? 'Direct the crew — e.g. “Light the courtyard like a cold dusk”' : 'Queue a directive. Any MCP agent (Claude Code, Codex) picks it up.'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              issue();
            }
          }}
        />
        <div className="row">
          <button className={`btn ghost${attach && selection.length ? '' : ' dim'}`} disabled={!selection.length} onClick={() => setAttach(!attach)} title="Attach your current selection as context">
            {selection.length ? `${attach ? '◆' : '◇'} ${selection.length} selected` : 'no selection'}
          </button>
          <span className="grow" />
          <button className="btn primary" disabled={!draft.trim()} onClick={issue}>
            Issue <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
