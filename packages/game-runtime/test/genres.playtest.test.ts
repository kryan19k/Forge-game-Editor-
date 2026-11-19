import type { PlaytestScriptInput } from '@forge/contracts';
import { templates } from '@forge/templates';
import { describe, expect, it } from 'vitest';
import { GameSimulation, formatReport, runPlaytest } from '../src/sim';

/** Every genre template must be playable to completion — these are their definitions of done. */
const run = async (id: string, script: PlaytestScriptInput) => {
  const r = await runPlaytest(templates[id]!.createScene(), script);
  expect(r.passed, formatReport(r)).toBe(true);
  return r;
};

describe('genre templates are playable end-to-end', () => {
  it('RPG · Hollow Vale: full quest chain with dialogue, gathering and combat', async () => {
    await run('hollow-vale', {
      name: 'Hollow Vale quest',
      steps: [
        { do: 'walk_to', entityId: 'ent_elder', stopDistance: 1.8 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'dialogue_seen', entityId: 'ent_elder' } },
        { do: 'walk_to', entityId: 'ent_herb_1', stopDistance: 1.4 },
        { do: 'interact' },
        { do: 'autopilot', seconds: 60, until: { kind: 'defeated', target: '#wolf', count: 2 } },
        { do: 'walk_to', entityId: 'ent_herb_2', stopDistance: 1.4 },
        { do: 'interact' },
        { do: 'walk_to', entityId: 'ent_herb_3', stopDistance: 1.4 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'has_item', item: 'moonherb', count: 3 } },
        { do: 'walk_to', entityId: 'ent_elder', stopDistance: 1.8 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'objective_done' } },
        { do: 'expect', check: { kind: 'match', result: 'won' } },
        { do: 'expect', check: { kind: 'health_above', value: 0 } },
      ],
    });
  });

  it('RPG · wolves fight back', async () => {
    const r = await runPlaytest(templates['hollow-vale']!.createScene(), {
      steps: [{ do: 'walk_to', entityId: 'ent_wolf_1', stopDistance: 1.2, timeout: 20 }, { do: 'wait', seconds: 3 }],
    });
    expect(r.events.some((e) => e.type === 'hit' && e.actorId === 'npc:ent_wolf_1')).toBe(true);
  });

  it('MMO · Shardlands: quest loop against respawning field mobs', async () => {
    await run('shardlands', {
      steps: [
        { do: 'walk_to', entityId: 'ent_ilsa', stopDistance: 1.8 },
        { do: 'interact' },
        { do: 'autopilot', seconds: 150, until: { kind: 'defeated', target: '#slime', count: 5 } },
        { do: 'walk_to', entityId: 'ent_ilsa', stopDistance: 1.8, timeout: 40, sprint: true },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'objective_done' } },
        { do: 'wait_until', check: { kind: 'event', event: 'npc_respawn' }, timeout: 30 },
      ],
    });
  });

  it('Fighting · Iron Ring: rounds resolve into a decided match', async () => {
    await run('iron-ring', {
      steps: [
        { do: 'expect', check: { kind: 'event', event: 'player_joined' } },
        { do: 'wait_until', check: { kind: 'event', event: 'round_start' }, timeout: 5 },
        { do: 'autopilot', seconds: 200, until: { kind: 'event', event: 'round_end' } },
      ],
    });
    const sim = await GameSimulation.create(templates['iron-ring']!.createScene());
    sim.addPlayer('p1');
    sim.setAutopilot('p1', true);
    for (let i = 0; i < 400 && !sim.matchOver; i++) sim.advance(1);
    expect(sim.matchOver).toBe(true);
    const wins = sim.state('p1').fight!.wins;
    expect(Math.max(...Object.values(wins))).toBe(2);
    sim.dispose();
  });

  it('Fighting · a second human takes the bot’s seat', async () => {
    const sim = await GameSimulation.create(templates['iron-ring']!.createScene());
    sim.addPlayer('p1');
    sim.addPlayer('p2');
    expect([...sim.actors.values()].filter((a) => a.kind === 'bot')).toHaveLength(0);
    expect([...sim.actors.values()].filter((a) => a.kind === 'player')).toHaveLength(2);
    sim.dispose();
  });

  it('Racing · Dust Circuit: 3 laps through every checkpoint', async () => {
    const r = await run('dust-circuit', {
      steps: [
        { do: 'autopilot', seconds: 400, until: { kind: 'race_finished' } },
        { do: 'expect', check: { kind: 'lap', count: 3 } },
      ],
    });
    expect(r.events.filter((e) => e.type === 'lap' && e.actorId === 'p1')).toHaveLength(3);
  });

  it('Racing · countdown holds the grid', async () => {
    const r = await runPlaytest(templates['dust-circuit']!.createScene(), {
      steps: [{ do: 'drive', seconds: 1.5, throttle: 1 }, { do: 'expect', check: { kind: 'near', entityId: 'ent_grid_1', within: 0.5 } }],
    });
    expect(r.passed, formatReport(r)).toBe(true);
  });
});
