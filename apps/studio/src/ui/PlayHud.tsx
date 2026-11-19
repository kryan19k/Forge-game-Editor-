import type { SimEvent, SimState } from '@forge/contracts';
import { useEffect, useState } from 'react';
import { stopPlay, usePlay } from '../state/play';
import { useStudio } from '../state/store';
import { KitHud, useKitHotkeys, useKitPanel } from './KitHud';

const label = (item: string) => item.replace(/[_-]+/g, ' ').toUpperCase();
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

const EVENT_TEXT: Partial<Record<SimEvent['type'], (e: SimEvent, name: string) => string>> = {
  pickup: (e) => `Acquired ${label(e.detail ?? '')}`,
  interact_blocked: (e, n) => `${n} — ${e.detail}`,
  door_open: (_, n) => `${n} opened`,
  objective_complete: (e) => `Complete · ${e.detail}`,
  objective_progress: (e) => e.detail ?? '',
  defeated: (_, n) => `${n} defeated`,
  player_down: (e) => `Down ${e.detail ?? ''}`,
  lap: (e) => e.detail ?? 'Lap',
  race_finished: (e) => `Finish · ${e.detail}`,
  round_end: (e) => e.detail ?? 'Round over',
  player_joined: (e) => `${e.detail ?? 'Player'} joined`,
  player_left: () => `Player left`,
  fell_out_of_world: () => 'Fell out of the world — respawned',
};

const CONTROLS = {
  character: 'WASD move · Shift sprint · Space jump · E interact · Click attack · Right-click heavy',
  vehicle: 'W throttle · S brake / reverse · A/D steer',
  fighter: 'A/D move · W jump · J light · K heavy · L block',
} as const;

/** In-game HUD over a live play session. Adapts to the genre's controller. */
export function PlayHud() {
  const status = usePlay((s) => s.status);
  const hud = usePlay((s) => s.hud);
  const locked = usePlay((s) => s.locked);
  const startedAt = usePlay((s) => s.startedAt);
  const revision = usePlay((s) => s.revision);
  const mode = usePlay((s) => s.mode);
  const scene = useStudio((s) => s.scene);
  const panel = useKitPanel((s) => s.panel);
  useKitHotkeys(status === 'running' && !!hud?.kit);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  if (status === 'off') return null;
  if (status === 'loading' || !hud)
    return (
      <div className="play-hud">
        <div className="play-center">
          <div className="play-card micro">{mode === 'online' ? 'Connecting to session…' : 'Compiling physics…'}</div>
        </div>
      </div>
    );

  const controller = scene?.game.controller ?? 'character';
  const nameOf = (id?: string) => (id && (scene?.entities[id]?.name ?? hud.actors.find((a) => a.id === id)?.name)) || id || '';
  const recent = hud.events.filter((e) => hud.time - e.t < 4 && EVENT_TEXT[e.type]).slice(-5);
  const drifted = mode === 'solo' && scene && scene.revision !== revision;
  const elapsed = (Date.now() - startedAt) / 1000;

  return (
    <div className={`play-hud ctrl-${controller}${hud.kit ? ' has-kit' : ''}`}>
      <div className="play-top">
        <span className="live-pill micro">
          <i /> {mode === 'online' ? 'Online' : 'Live'} playtest <b className="mono">{clock(elapsed).slice(0, 5)}</b>
        </span>
        {mode === 'online' && <span className="micro roster-pill">{hud.actors.filter((a) => a.kind === 'player').length} players</span>}
        {drifted && <span className="micro drift">Scene changed · restart for rev {scene!.revision}</span>}
      </div>

      {controller === 'fighter' && hud.fight && <FightHud hud={hud} />}
      {controller === 'vehicle' && hud.race && <RaceHud hud={hud} />}
      {controller === 'character' && <CharacterHud hud={hud} />}
      {hud.kit && <KitHud kit={hud.kit} />}

      <div className="play-feed">
        {recent.map((e, i) => (
          <div key={`${e.t}-${e.type}-${i}`} className={`feed-item ${e.type}`}>
            {EVENT_TEXT[e.type]!(e, nameOf(e.entityId ?? e.actorId))}
          </div>
        ))}
      </div>

      {!hud.player.alive && controller !== 'fighter' && (
        <div className="play-banner down">
          <div className="micro">Down</div>
          <div className="big">Respawning {hud.player.respawnIn.toFixed(0)}</div>
        </div>
      )}

      {hud.match && (
        <div className={`play-banner ${hud.match.result}`}>
          <div className="micro">{hud.match.result === 'won' ? 'Mission' : 'Result'}</div>
          <div className="big">{hud.match.message}</div>
        </div>
      )}

      <div className="play-controls micro">{CONTROLS[controller]}</div>

      {!locked && !panel && (
        <div className="play-center">
          <div className="play-card">
            <div className="big">Paused</div>
            <div className="micro dim">Click to resume · {CONTROLS[controller]}</div>
            <div className="row">
              <button className="btn primary" onClick={() => document.querySelector<HTMLCanvasElement>('.viewport canvas')?.requestPointerLock()}>
                Resume
              </button>
              <button className="btn" onClick={stopPlay}>
                Stop <kbd>Esc</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Health({ hp, max, wide }: { hp: number; max: number; wide?: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  return (
    <div className={`hp${wide ? ' wide' : ''}${pct < 0.3 ? ' low' : ''}`}>
      <i style={{ width: `${pct * 100}%` }} />
      <span className="mono">
        {Math.ceil(hp)}/{max}
      </span>
    </div>
  );
}

function CharacterHud({ hud }: { hud: SimState }) {
  const counts = new Map<string, number>();
  for (const it of hud.inventory) counts.set(it, (counts.get(it) ?? 0) + 1);
  const items = [...counts];
  return (
    <>
      {hud.objectives.length > 0 && (
        <div className="play-objectives">
          <div className="micro dim">Objectives</div>
          {hud.objectives.map((o) => (
            <div key={o.id} className={`obj${o.done ? ' done' : ''}${o.active ? ' active' : ''}`}>
              <i /> <span>{o.label}</span>
              {o.count > 1 && !o.done && (
                <b className="mono">
                  {o.progress}/{o.count}
                </b>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="reticle">
        <i />
        <i />
        <i />
        <i />
      </div>
      {hud.focus && !hud.dialogue && (
        <div className={`play-prompt${hud.focus.blocked ? ' blocked' : ''}`}>
          <kbd>E</kbd>
          <span>{hud.focus.prompt}</span>
          {hud.focus.blocked && <em>{hud.focus.blocked}</em>}
        </div>
      )}
      {hud.dialogue && (
        <div className="play-dialogue">
          <div className="speaker micro">
            {hud.dialogue.speaker}
            <span className="dim">
              {hud.dialogue.index + 1}/{hud.dialogue.total}
            </span>
          </div>
          <div className="line">{hud.dialogue.line}</div>
        </div>
      )}
      <div className="play-vitals">
        <Health hp={hud.player.health} max={hud.player.maxHealth} />
        <div className="play-inventory">
          {Array.from({ length: 4 }, (_, i) => {
            const it = items[i];
            return (
              <div key={i} className={`slot${it ? ' full' : ''}`}>
                <span className="micro dim">{i + 1}</span>
                {it && (
                  <b>
                    {label(it[0])}
                    {it[1] > 1 ? ` ×${it[1]}` : ''}
                  </b>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function RaceHud({ hud }: { hud: SimState }) {
  const r = hud.race!;
  return (
    <>
      <div className="race-board">
        <div className="pos">
          <b>{r.place}</b>
          <span className="micro">
            {ordinal(r.place).slice(-2)} / {r.racers}
          </span>
        </div>
        <div className="cell">
          <span className="micro dim">Lap</span>
          <b className="mono">
            {r.lap}/{r.laps}
          </b>
        </div>
        <div className="cell">
          <span className="micro dim">Time</span>
          <b className="mono">{clock(r.time)}</b>
        </div>
        <div className="cell">
          <span className="micro dim">Best</span>
          <b className="mono">{r.bestLap === null ? '—' : clock(r.bestLap)}</b>
        </div>
      </div>
      <div className="speedo">
        <b className="mono">{Math.round(hud.player.speed * 3.6)}</b>
        <span className="micro">km/h</span>
      </div>
      {r.phase === 'countdown' && (
        <div className="play-banner count">
          <div className="big">{Math.ceil(r.countdown)}</div>
        </div>
      )}
      {r.phase === 'racing' && r.time < 1 && (
        <div className="play-banner count">
          <div className="big">GO</div>
        </div>
      )}
    </>
  );
}

function FightHud({ hud }: { hud: SimState }) {
  const f = hud.fight!;
  const me = hud.actors.find((a) => a.id === hud.player.id);
  const opp = hud.actors.find((a) => a.id === f.opponentId);
  const need = Math.ceil(f.rounds / 2);
  const pips = (id?: string) =>
    Array.from({ length: need }, (_, i) => <i key={i} className={(f.wins[id ?? ''] ?? 0) > i ? 'on' : ''} />);
  return (
    <>
      <div className="fight-bars">
        <div className="side left">
          <div className="name micro">{me?.name ?? 'You'}</div>
          <Health hp={me?.health ?? 0} max={me?.maxHealth ?? 100} wide />
          <div className="pips">{pips(me?.id)}</div>
        </div>
        <div className="round micro">
          Round <b>{f.round}</b>
        </div>
        <div className="side right">
          <div className="name micro">{opp?.name ?? '—'}</div>
          <Health hp={opp?.health ?? 0} max={opp?.maxHealth ?? 100} wide />
          <div className="pips">{pips(opp?.id)}</div>
        </div>
      </div>
      {f.phase === 'intro' && (
        <div className="play-banner count">
          <div className="micro">Round {f.round}</div>
          <div className="big">{f.timer < 0.5 ? 'Fight' : 'Ready'}</div>
        </div>
      )}
      {f.phase === 'ko' && (
        <div className="play-banner ko">
          <div className="big">K.O.</div>
        </div>
      )}
    </>
  );
}
