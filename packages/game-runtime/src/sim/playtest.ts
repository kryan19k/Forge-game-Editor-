import {
  PlaytestScript,
  type PlaytestCheck,
  type PlaytestReport,
  type PlaytestStep,
  type PlaytestStepResult,
  type SceneDoc,
} from '@forge/contracts';
import { Vector3 } from 'three';
import { GameSimulation, IDLE_INPUT, SIM_DT, yawToward, type PlayerInput } from './simulation';

export { yawToward };

const DIRS = { forward: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] } as const;
const DEG = Math.PI / 180;
const ME = 'p1';

function describe(s: PlaytestStep): string {
  switch (s.do) {
    case 'move':
      return `move ${Array.isArray(s.direction) ? s.direction.join(',') : s.direction} ${s.seconds}s${s.sprint ? ' sprint' : ''}`;
    case 'turn':
      return `turn ${s.degrees}°`;
    case 'face':
      return `face ${s.entityId}`;
    case 'walk_to':
      return `walk_to ${s.entityId}`;
    case 'attack':
      return `attack${s.heavy ? ' heavy' : ''}${s.times > 1 ? ` ×${s.times}` : ''}`;
    case 'drive':
      return `drive ${s.seconds}s throttle ${s.throttle} steer ${s.steer}`;
    case 'autopilot':
      return `autopilot ${s.seconds}s${s.until ? ` until ${checkName(s.until)}` : ''}`;
    case 'wait':
      return `wait ${s.seconds}s`;
    case 'wait_until':
      return `wait_until ${checkName(s.check)}`;
    case 'teleport':
      return `teleport ${s.position.join(',')}`;
    case 'expect':
      return `expect ${checkName(s.check)}`;
    case 'cast':
      return `cast ${s.ability ?? `slot ${s.slot}`}`;
    case 'command':
      return `${s.command.kind} ${Object.values(s.command).slice(1).join('/')}${s.expectFail ? ' (expect refusal)' : ''}`;
    default:
      return s.do;
  }
}

function checkName(c: PlaytestCheck): string {
  return Object.entries(c)
    .map(([k, v]) => (k === 'kind' ? v : `${k}=${v}`))
    .join(' ');
}

export function check(sim: GameSimulation, c: PlaytestCheck, me = ME): { ok: boolean; note: string } {
  const a = sim.actor(me);
  const inv = () => `inventory [${a ? [...a.inventory].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ') : ''}]`;
  switch (c.kind) {
    case 'has_item':
      return { ok: (a?.inventory.get(c.item) ?? 0) >= c.count, note: inv() };
    case 'lacks_item':
      return { ok: !a?.inventory.has(c.item), note: inv() };
    case 'event': {
      const hit = sim.events.find((e) => e.type === c.event && (!c.entityId || e.entityId === c.entityId));
      return { ok: !!hit, note: hit ? `at t=${hit.t}s${hit.detail ? ` (${hit.detail})` : ''}` : `not seen; last: ${sim.events.slice(-4).map((e) => e.type).join(', ')}` };
    }
    case 'no_event': {
      const hit = sim.events.find((e) => e.type === c.event);
      return { ok: !hit, note: hit ? `seen at t=${hit.t}s ${hit.detail ?? ''}` : 'not seen' };
    }
    case 'near': {
      const at = sim.centerOf(c.entityId);
      if (!at || !a) return { ok: false, note: `no entity ${c.entityId}` };
      const f = sim.feet(a);
      const d = Math.hypot(at.x - f.x, at.z - f.z);
      return { ok: d <= c.within, note: `distance ${d.toFixed(2)}m` };
    }
    case 'objective_done': {
      const list = sim.objectiveStates().filter((o) => !c.id || o.def.id === c.id);
      if (!list.length) return { ok: false, note: 'no matching objectives in scene' };
      const open = list.filter((o) => !o.done);
      return { ok: open.length === 0, note: open.length ? `open: ${open.map((o) => `${o.def.id} ${o.progress}/${o.def.count}`).join(', ')}` : `${list.length} done` };
    }
    case 'door_open':
      return { ok: sim.isDoorOpen(c.entityId), note: sim.isDoorOpen(c.entityId) ? 'open' : 'closed' };
    case 'grounded':
      return { ok: !!a?.grounded, note: a ? `feet y=${sim.feet(a).y.toFixed(2)}` : 'no player' };
    case 'health_above':
      return { ok: (a?.health ?? 0) > c.value, note: `health ${Math.round(a?.health ?? 0)}/${a?.maxHealth ?? 0}` };
    case 'defeated': {
      const n = sim.defeatedCount(c.target);
      return { ok: n >= c.count, note: `${n} defeated` };
    }
    case 'lap':
      return { ok: (a?.race.lap ?? 0) >= c.count, note: `lap ${a?.race.lap ?? 0}` };
    case 'race_finished':
      return { ok: !!a?.race.finished, note: a?.race.finished ? `P${sim.state(me).race?.place} in ${sim.state(me).race?.time}s` : `lap ${a?.race.lap ?? 0}, next cp ${a?.race.next ?? '-'}` };
    case 'match': {
      const m = sim.state(me).match;
      return { ok: m?.result === c.result, note: m ? m.result : 'match not decided' };
    }
    case 'dialogue_seen':
      return { ok: sim.sawDialogue(c.entityId), note: sim.sawDialogue(c.entityId) ? 'heard' : 'not heard' };
    case 'level': {
      const lvl = a?.kit?.level ?? 1;
      return { ok: lvl >= c.atLeast, note: `level ${lvl} (xp ${Math.round(a?.kit?.xp ?? 0)})` };
    }
    case 'stat': {
      if (!a?.kit) return { ok: false, note: 'player has no stats (database unused)' };
      const res = sim.gp.stats.get(c.stat)?.resource && c.stat !== 'health' ? (a.kit.current.get(c.stat) ?? 0) : c.stat === 'health' ? a.health : sim.gp.get(a.kit, c.stat);
      const ok = (c.atLeast === undefined || res >= c.atLeast) && (c.atMost === undefined || res <= c.atMost);
      return { ok, note: `${c.stat} = ${Math.round(res * 10) / 10}` };
    }
    case 'has_ability':
      return { ok: !!a?.kit?.abilities.includes(c.ability), note: `knows [${a?.kit?.abilities.join(', ') ?? ''}]` };
    case 'status': {
      const on = !!a?.kit?.statuses.some((s) => s.def.id === c.status);
      return { ok: on === c.present, note: on ? 'active' : 'not active' };
    }
  }
}

/**
 * Run a scripted playtest headlessly as player "p1". Deterministic: same scene +
 * script → same report. Fails fast on the first failed step.
 */
export async function runPlaytest(doc: SceneDoc, scriptInput: unknown): Promise<PlaytestReport> {
  const script = PlaytestScript.parse(scriptInput);
  const t0 = performance.now();
  const sim = await GameSimulation.create(doc);
  sim.addPlayer(ME, 'Playtester');
  const me = sim.actor(ME)!;
  const results: PlaytestStepResult[] = [];
  let yaw = me.yaw;
  const drive = (patch: Partial<PlayerInput> = {}) => () => sim.setInput(ME, { ...IDLE_INPUT, yaw, ...patch });
  const budget = () => sim.time < script.maxSimSeconds;

  try {
    sim.advance(0.5, drive()); // settle onto the ground
    for (const [index, step] of script.steps.entries()) {
      if (!budget()) {
        results.push({ index, step: describe(step), ok: false, note: `simulation budget of ${script.maxSimSeconds}s exhausted`, at: sim.time });
        break;
      }
      let ok = true;
      let note: string | undefined;
      const pos = () => sim.state(ME).player.position.map((n) => n.toFixed(1)).join(',');
      switch (step.do) {
        case 'move': {
          const move = (Array.isArray(step.direction) ? step.direction : DIRS[step.direction]) as [number, number];
          sim.advance(step.seconds, drive({ move, sprint: step.sprint }));
          note = `now at ${pos()}`;
          break;
        }
        case 'turn':
          yaw += step.degrees * DEG;
          sim.advance(SIM_DT, drive());
          break;
        case 'face': {
          const at = sim.centerOf(step.entityId);
          if (!at) (ok = false), (note = `no entity ${step.entityId}`);
          else (yaw = yawToward(sim.feet(me), at)), sim.advance(SIM_DT, drive());
          break;
        }
        case 'walk_to': {
          if (!sim.centerOf(step.entityId)) {
            ok = false;
            note = `no entity ${step.entityId}`;
            break;
          }
          const start = sim.time;
          let lastProgress = sim.time;
          let best = Infinity;
          for (;;) {
            const at = sim.centerOf(step.entityId)!; // NPCs move: re-read every tick
            const feet = sim.feet(me);
            const d = Math.hypot(at.x - feet.x, at.z - feet.z);
            if (d <= step.stopDistance) {
              note = `arrived in ${(sim.time - start).toFixed(1)}s, ${d.toFixed(2)}m away`;
              break;
            }
            if (d < best - 0.05) (best = d), (lastProgress = sim.time);
            if (sim.time - lastProgress > 2.5) {
              ok = false;
              note = `stuck at ${pos()} — ${d.toFixed(2)}m from target; path is blocked`;
              break;
            }
            if (sim.time - start > step.timeout || !budget()) {
              ok = false;
              note = `timed out ${d.toFixed(2)}m from target`;
              break;
            }
            yaw = yawToward(feet, at);
            drive({ move: [0, 1], sprint: step.sprint })();
            sim.step();
          }
          if (ok) {
            const at = sim.centerOf(step.entityId)!;
            yaw = yawToward(sim.feet(me), at);
          }
          sim.advance(0.15, drive());
          break;
        }
        case 'jump':
          drive({ jump: true })();
          sim.step();
          sim.advance(0.8, drive());
          break;
        case 'interact': {
          const before = sim.events.length;
          sim.advance(SIM_DT * 2, drive()); // refresh focus at rest
          const focus = me.focus;
          drive({ interact: true })();
          sim.step();
          sim.advance(0.2, drive());
          const fired = sim.events.slice(before).filter((e) => e.actorId === ME || !e.actorId).map((e) => `${e.type}${e.detail ? ` (${e.detail})` : ''}`);
          if (!focus) (ok = false), (note = 'nothing in reach to interact with');
          else note = `${focus.name}: ${fired.join(', ') || 'no effect'}`;
          break;
        }
        case 'attack': {
          const before = sim.events.length;
          for (let i = 0; i < step.times; i++) {
            drive(step.heavy ? { heavy: true } : { attack: true })();
            sim.step();
            sim.advance(Math.max(me.cooldown, 0.2) + SIM_DT, drive());
          }
          const hits = sim.events.slice(before).filter((e) => e.actorId === ME && (e.type === 'hit' || e.type === 'defeated' || e.type === 'blocked'));
          note = hits.length ? hits.map((e) => `${e.type} ${e.detail ?? ''}`).join(', ') : 'whiffed';
          break;
        }
        case 'cast': {
          const kit = me.kit;
          const id = step.ability ?? (step.slot ? kit?.bar[step.slot - 1] : undefined);
          if (!kit || !id) {
            ok = false;
            note = kit ? `no ability ${step.ability ? `"${step.ability}"` : `in slot ${step.slot}`}` : 'player has no abilities (database unused)';
            break;
          }
          const before = sim.events.length;
          const why = sim.cast(me, id);
          if (why) {
            ok = false;
            note = `${id}: ${why}`;
            break;
          }
          sim.advance((sim.gp.abilities.get(id)?.windup ?? 0) + 0.1, drive());
          const fx = sim.events.slice(before).filter((e) => e.actorId === ME && e.type !== 'ability_cast');
          note = `${sim.gp.abilities.get(id)?.name}: ${fx.map((e) => `${e.type} ${e.detail ?? ''}`.trim()).join(', ') || 'no targets'}`;
          break;
        }
        case 'command': {
          const err = sim.command(ME, step.command);
          ok = step.expectFail ? !!err : !err;
          note = err ? `refused: ${err}` : 'ok';
          sim.advance(SIM_DT, drive());
          break;
        }
        case 'drive':
          sim.advance(step.seconds, drive({ move: [step.steer, step.throttle] }));
          note = `now at ${pos()} · ${me.speed.toFixed(1)} m/s`;
          break;
        case 'autopilot': {
          sim.setAutopilot(ME, true);
          const end = sim.time + step.seconds;
          let met = !step.until;
          while (sim.time < end && budget()) {
            sim.step();
            if (step.until && sim.tick % 6 === 0 && check(sim, step.until).ok) {
              met = true;
              break;
            }
          }
          sim.setAutopilot(ME, false);
          yaw = me.yaw;
          if (step.until && !met) {
            met = check(sim, step.until).ok;
            if (!met) (ok = false), (note = `gave up after ${step.seconds}s — ${check(sim, step.until).note}`);
          }
          if (ok) note = `${step.until ? 'condition met' : 'done'} at ${pos()}`;
          break;
        }
        case 'wait':
          sim.advance(step.seconds, drive());
          break;
        case 'wait_until': {
          const end = sim.time + step.timeout;
          let r = check(sim, step.check);
          while (!r.ok && sim.time < end && budget()) {
            sim.advance(0.1, drive());
            r = check(sim, step.check);
          }
          ok = r.ok;
          note = r.ok ? `after ${(step.timeout - (end - sim.time)).toFixed(1)}s` : `timed out — ${r.note}`;
          break;
        }
        case 'teleport':
          if (step.yaw !== undefined) yaw = step.yaw * DEG;
          sim.teleport(ME, new Vector3(...step.position), yaw);
          sim.advance(0.3, drive());
          break;
        case 'expect': {
          const r = check(sim, step.check);
          ok = r.ok;
          note = r.note;
          break;
        }
      }
      results.push({ index, step: describe(step), ok, ...(note ? { note } : {}), at: Math.round(sim.time * 100) / 100 });
      if (!ok) break;
    }
    const s = sim.state(ME);
    return {
      name: script.name,
      passed: results.length === script.steps.length && results.every((r) => r.ok),
      revision: doc.revision,
      simSeconds: Math.round(sim.time * 100) / 100,
      wallMs: Math.round(performance.now() - t0),
      steps: results,
      events: sim.events,
      final: { player: s.player, inventory: s.inventory, objectives: s.objectives, doors: s.doors, race: s.race, fight: s.fight, match: s.match, kit: s.kit },
    };
  } finally {
    sim.dispose();
  }
}

export function formatReport(r: PlaytestReport): string {
  const notable = r.events.filter((e) => !['checkpoint', 'hit', 'blocked', 'trigger_exit'].includes(e.type));
  const lines = [
    `${r.passed ? 'PASS' : 'FAIL'} “${r.name}” · rev ${r.revision} · ${r.simSeconds}s simulated in ${r.wallMs}ms`,
    ...r.steps.map((s) => `  ${s.ok ? '✓' : '✗'} [${String(s.index).padStart(2)}] t=${s.at}s ${s.step}${s.note ? ` — ${s.note}` : ''}`),
    `events (${r.events.length}): ${notable.slice(-24).map((e) => `${e.t}s ${e.type}${e.entityId ? `(${e.entityId})` : ''}${e.detail ? ` ${e.detail}` : ''}`).join(' · ') || 'none'}`,
    `final: feet ${r.final.player.position.join(',')} · hp ${r.final.player.health}/${r.final.player.maxHealth} · inventory [${r.final.inventory.join(', ')}] · objectives ${
      r.final.objectives.map((o) => `${o.id}:${o.done ? 'done' : `${o.progress}/${o.count}`}`).join(', ') || 'none'
    }${r.final.race ? ` · race P${r.final.race.place}/${r.final.race.racers} lap ${r.final.race.lap}/${r.final.race.laps}` : ''}${
      r.final.fight ? ` · fight ${r.final.fight.phase} round ${r.final.fight.round} wins ${JSON.stringify(r.final.fight.wins)}` : ''
    }${r.final.match ? ` · MATCH ${r.final.match.result.toUpperCase()}` : ''}`,
  ];
  return lines.join('\n');
}
