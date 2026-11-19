import { TEAM_THREAD, type Author, type TeamNote } from '@forge/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { select, send, useStudio } from '../state/store';
import { SceneActivityCard } from './SceneActivityCard';
import { TeamPlanCard } from './TeamPlanCard';

const NOTE_LABELS = { message: 'Message', thought: 'Published thought', progress: 'Progress', question: 'Question', result: 'Result' };
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Note({ note, color, focus }: { note: TeamNote; color: string; focus: (id: string) => string | undefined }) {
  const label = note.directive ? 'Directive · ' + note.directive.status : note.source === 'provider_summary' ? 'Provider summary' : NOTE_LABELS[note.kind];
  return (
    <article className={'team-card team-' + note.kind} style={{ '--c': color } as React.CSSProperties}>
      <header className="micro"><span>{note.author.name}</span><span>{label}</span><time>{time(note.at)}</time></header>
      <div className="team-note-text">
        {note.text.split(/(@[a-zA-Z0-9][\w.-]*)/g).map((part, i) => note.mentions.includes(part.slice(1).replace(/\.+$/, '')) && part.startsWith('@')
          ? <mark key={i}>{part}</mark> : part)}
      </div>
      {note.focusEntityIds.length > 0 && (
        <div className="team-actions team-focus">
          {note.focusEntityIds.map((id) => {
            const name = focus(id);
            return <button key={id} className="btn" title={id} disabled={!name} onClick={() => select([id])}>{name ?? id}</button>;
          })}
        </div>
      )}
    </article>
  );
}

export function TeamRoom({ wide, onToggleWidth }: { wide: boolean; onToggleWidth: () => void }) {
  const [thread, setThread] = useState<string>(TEAM_THREAD);
  const [drafts, setDrafts] = useState(new Map<string, string>());
  const team = useStudio((s) => s.team);
  const crew = useStudio((s) => s.crew);
  const comms = useStudio((s) => s.comms);
  const activity = useStudio((s) => s.activity);
  const autoReact = useStudio((s) => s.activitySettings.autoReact);
  const online = useStudio((s) => s.conn === 'online');
  const entities = useStudio((s) => s.scene?.entities);
  const selection = useStudio((s) => s.selection);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const inTeam = thread === TEAM_THREAD;
  const paused = team.paused.includes(thread);
  const draft = drafts.get(thread) ?? '';

  const agents = useMemo(() => {
    const roster = new Map<string, { name: string; color?: string }>();
    for (const e of team.events) {
      if (e.thread !== TEAM_THREAD && !roster.has(e.thread)) roster.set(e.thread, { name: e.thread });
      if (e.author.kind === 'agent') roster.set(e.author.id, { name: e.author.name });
    }
    for (const member of crew) if (member.kind === 'agent') roster.set(member.id, member);
    return roster;
  }, [crew, team.events]);
  const colorOf = (author: Author) => author.kind === 'human' ? 'var(--molten)' : agents.get(author.id)?.color ?? 'var(--bone-3)';
  const feed = useMemo(() => {
    const entries = team.events.filter((entry) => entry.thread === thread);
    const plans = new Map(entries.flatMap((entry) => 'planId' in entry ? [[entry.planId, entry.sequence] as const] : []));
    const current = entries.filter((entry) => !('planId' in entry) || plans.get(entry.planId) === entry.sequence);
    return inTeam ? [...current, ...activity, ...comms].sort((a, b) => a.at - b.at) : current;
  }, [activity, comms, inTeam, team.events, thread]);

  useEffect(() => {
    const el = log.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [feed, team.thinking]);

  const setDraft = (text: string) => setDrafts((current) => new Map(current).set(thread, text));
  const post = (withFocus: boolean) => {
    if (!online || (!draft.trim() && !withFocus)) return;
    send({ type: 'team.message', thread, text: draft.trim() || 'Focus here', focusEntityIds: withFocus ? selection.slice(0, 100) : [] });
    follow.current = true;
    setDraft('');
  };

  return (
    <section className="panel team-room" aria-label="Team Room">
      <div className="panel-head micro">
        <span className="code">03</span><span className="title">Team Room</span><span className="spacer" />
        <button className="btn" onClick={onToggleWidth} aria-pressed={wide}>{wide ? 'Narrow' : 'Widen'}</button>
      </div>
      <div className="team-threads" role="group" aria-label="Team threads">
        {[TEAM_THREAD, ...agents.keys()].map((id) => (
          <button key={id} className="team-thread micro" aria-pressed={id === thread}
            style={{ '--c': agents.get(id)?.color ?? 'var(--molten)' } as React.CSSProperties}
            onClick={() => { follow.current = true; setThread(id); }}>
            {id !== TEAM_THREAD && <i aria-hidden="true" />}{id === TEAM_THREAD ? id : agents.get(id)?.name}
          </button>
        ))}
      </div>
      <div className="team-context">
        <p>{thread === 'producer' ? 'The Producer reads this guidance on its next design run.' : 'External agents share updates they choose to publish.'}</p>
        {inTeam ? (
          <label className="activity-toggle micro" title="Allow agents to offer follow-ups on scene changes">
            <input type="checkbox" checked={autoReact} disabled={!online}
              onChange={(event) => send({ type: 'activity.settings', settings: { autoReact: event.target.checked } })} />
            Agent follow-ups
          </label>
        ) : <button className={'btn' + (paused ? ' primary' : '')} disabled={!online}
          title="Ask this agent to wait for your go-ahead"
          onClick={() => send({ type: 'team.pause', agentId: thread, paused: !paused })}>{paused ? 'Resume' : 'Pause'}</button>}
      </div>
      <div className="comms team-feed" ref={log} role="log" aria-label={inTeam ? 'Team messages' : 'Direct messages'} onScroll={(event) => {
        const el = event.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}>
        {feed.length === 0 && <p className="team-empty dim">{inTeam ? 'Send a message to the team.' : 'Start a direct conversation.'}</p>}
        {feed.map((entry) => {
          if ('changes' in entry) return <SceneActivityCard key={entry.txId} entry={entry} color={colorOf(entry.author)} />;
          if ('source' in entry && 'level' in entry) return (
            <div key={entry.id} className={'comms-row ' + entry.level}
              style={{ '--c': entry.source.kind === 'system' ? 'var(--bone-3)' : colorOf(entry.source as Author) } as React.CSSProperties}>
              <span className="t">{time(entry.at)}</span><span className="who">{entry.source.name}</span><span className="msg">{entry.text}</span>
            </div>
          );
          if ('planId' in entry) return <TeamPlanCard key={entry.sequence} plan={entry} color={colorOf(entry.proposedBy)} online={online} />;
          if (entry.kind === 'guidance') return <p className="team-guidance micro" key={entry.sequence}>{entry.paused ? 'Director requested a pause' : 'Director resumed work'} · {time(entry.at)}</p>;
          return <Note key={entry.sequence} note={entry} color={colorOf(entry.author)} focus={(id) => entities?.[id]?.name} />;
        })}
        {inTeam && team.thinking && (
          <article className="team-card team-thought" style={{ '--c': colorOf(team.thinking.author) } as React.CSSProperties}>
            <header className="micro"><span>{team.thinking.author.name}</span><span>Provider summary · live</span></header>
            <div className="team-note-text">{team.thinking.text}</div>
          </article>
        )}
      </div>
      <form className="team-compose" onSubmit={(event) => { event.preventDefault(); post(false); }}>
        <textarea ref={composer} aria-label="Team message" placeholder={inTeam ? 'Message #team…' : 'Message ' + (agents.get(thread)?.name ?? thread) + '…'}
          value={draft} maxLength={2000} onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              post(false);
            }
          }} />
        <div className="team-actions">
          <button type="button" className="btn" disabled={!online || !selection.length} onClick={() => post(true)} title="Send this message with the current selection">Focus here{selection.length ? ' · ' + selection.length : ''}</button>
          {inTeam && agents.size > 0 && <select aria-label="Mention an agent" value="" onChange={(event) => {
            setDraft((draft.trimEnd() + ' @' + event.target.value + ' ').trimStart().slice(0, 2000));
            composer.current?.focus();
          }}><option value="" disabled>@mention</option>{[...agents].map(([id, agent]) => <option key={id} value={id}>{agent.name}</option>)}</select>}
          <span className="team-spacer" />
          <button type="submit" className="btn primary" disabled={!online || !draft.trim()}>Send <kbd>↵</kbd></button>
        </div>
      </form>
    </section>
  );
}
