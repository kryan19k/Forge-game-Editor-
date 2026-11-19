import type { PlaytestScriptInput } from '@forge/contracts';
import { outpostZeroScene } from '@forge/templates';
import { describe, expect, it } from 'vitest';
import { formatReport, runPlaytest } from '../src/sim';

/** OUTPOST ZERO definition of done, as executable playtests. */

const lockedDoor: PlaytestScriptInput = {
  name: 'Outpost Zero — door is locked without keycard',
  steps: [
    { do: 'expect', check: { kind: 'grounded' } },
    { do: 'walk_to', entityId: 'ent_hub_door', stopDistance: 2.2 },
    { do: 'interact' },
    { do: 'expect', check: { kind: 'event', event: 'interact_blocked', entityId: 'ent_hub_door' } },
  ],
};

describe('OUTPOST ZERO playtests', () => {
  it('the door is locked without the keycard', async () => {
    const r = await runPlaytest(outpostZeroScene(), lockedDoor);
    expect(r.passed, formatReport(r)).toBe(true);
  });

  it('completes the objective: keycard → door → terminal', async () => {
    const r = await runPlaytest(outpostZeroScene(), {
      name: 'Outpost Zero — full objective run',
      steps: [
        { do: 'walk_to', entityId: 'ent_keycard', stopDistance: 2.0 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'has_item', item: 'keycard_alpha' } },
        { do: 'walk_to', entityId: 'ent_hub_door', stopDistance: 2.2 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'door_open', entityId: 'ent_hub_door' } },
        { do: 'wait', seconds: 1 },
        { do: 'walk_to', entityId: 'ent_terminal', stopDistance: 1.7 },
        { do: 'interact' },
        { do: 'expect', check: { kind: 'objective_done' } },
        { do: 'expect', check: { kind: 'event', event: 'all_objectives_complete' } },
        { do: 'expect', check: { kind: 'no_event', event: 'fell_out_of_world' } },
      ],
    });
    console.log(formatReport(r));
    expect(r.passed, formatReport(r)).toBe(true);
  });

  it('walls block the player (cannot walk through the closed door)', async () => {
    const r = await runPlaytest(outpostZeroScene(), {
      steps: [{ do: 'walk_to', entityId: 'ent_terminal', stopDistance: 1.7, timeout: 15 }],
    });
    expect(r.passed).toBe(false);
    expect(r.steps[0]!.note).toMatch(/stuck|timed out/);
  });

  it('is deterministic', async () => {
    const script = { steps: [{ do: 'move', direction: 'forward', seconds: 2, sprint: true }, { do: 'turn', degrees: 90 }, { do: 'move', direction: 'forward', seconds: 1 }] };
    const a = await runPlaytest(outpostZeroScene(), script);
    const b = await runPlaytest(outpostZeroScene(), script);
    expect(a.final.player.position).toEqual(b.final.player.position);
  });
});
