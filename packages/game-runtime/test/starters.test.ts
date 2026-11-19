import type { DesignAnswer, PlaytestScriptInput } from '@forge/contracts';
import { starters } from '@forge/templates';
import { describe, expect, it } from 'vitest';
import { formatReport, lintDatabase, runPlaytest } from '../src/sim';

const defaults = (id: string): Record<string, DesignAnswer> =>
  Object.fromEntries(starters[id]!.questions.filter((q) => q.default !== undefined).map((q) => [q.id, q.default!]));

const proofs: Record<string, PlaytestScriptInput['steps']> = {
  rpg: [
    { do: 'walk_to', entityId: 'ent_guide', stopDistance: 1.8 },
    { do: 'interact' },
    { do: 'autopilot', seconds: 120, until: { kind: 'defeated', target: '#foe', count: 4 } },
    { do: 'walk_to', entityId: 'ent_guide', stopDistance: 1.8, timeout: 40, sprint: true },
    { do: 'interact' },
    { do: 'expect', check: { kind: 'objective_done' } },
  ],
  mmorpg: [
    { do: 'walk_to', entityId: 'ent_warden', stopDistance: 1.8 },
    { do: 'interact' },
    { do: 'autopilot', seconds: 150, until: { kind: 'defeated', target: '#mob', count: 6 } },
    { do: 'walk_to', entityId: 'ent_warden', stopDistance: 1.8, timeout: 60, sprint: true },
    { do: 'interact' },
    { do: 'expect', check: { kind: 'objective_done' } },
  ],
  adventure: [
    { do: 'walk_to', entityId: 'ent_key', stopDistance: 1.3 },
    { do: 'interact' },
    { do: 'walk_to', entityId: 'ent_gate', stopDistance: 2.2 },
    { do: 'interact' },
    { do: 'wait', seconds: 1 },
    { do: 'walk_to', entityId: 'ent_goal', stopDistance: 0.8 },
    { do: 'expect', check: { kind: 'objective_done' } },
  ],
  fighting: [{ do: 'autopilot', seconds: 200, until: { kind: 'event', event: 'round_end' } }],
  racing: [{ do: 'autopilot', seconds: 400, until: { kind: 'race_finished' } }],
  shooter: [
    { do: 'autopilot', seconds: 120, until: { kind: 'defeated', target: '#drone', count: 4 } },
    { do: 'expect', check: { kind: 'event', event: 'ability_cast' } },
  ],
};

describe('genre starters build playable scaffolds from interview answers', () => {
  for (const id of Object.keys(starters)) {
    it(`${id}: default answers → playable greybox`, async () => {
      const scene = starters[id]!.build(defaults(id), `Test ${id}`);
      expect(lintDatabase(scene.database)).toEqual([]);
      const r = await runPlaytest(scene, { name: `${id} scaffold`, steps: proofs[id]! });
      expect(r.passed, formatReport(r)).toBe(true);
    });
  }

  it('answers change the build (racing handling + laps, rpg party size)', () => {
    const loose = starters.racing!.build({ ...defaults('racing'), handling: 'loose', laps: '5', vehicles: 'karts' }, 'R');
    expect(loose.game.laps).toBe(5);
    expect(loose.game.vehicle.turnRate).toBeLessThan(2.1);
    expect(loose.game.vehicle.maxSpeed).toBe(24);
    const solo = starters.rpg!.build({ ...defaults('rpg'), party: 'solo', setting: 'scifi', progression: ['levels'] }, 'S');
    expect(solo.game.maxPlayers).toBe(1);
    expect(solo.database.abilities.map((a) => a.id)).toContain('pulse_shot');
    expect(solo.database.trees).toHaveLength(0);
  });
});
