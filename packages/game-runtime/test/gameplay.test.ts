import { GameDatabase, type SceneDoc } from '@forge/contracts';
import { applyTransaction, buildTransaction } from '@forge/scene';
import { hollowValeScene } from '@forge/templates';
import { describe, expect, it } from 'vitest';
import { GameSimulation, formatReport, lintDatabase, runPlaytest } from '../src/sim';

/** A small but complete RPG kit, authored exactly as an agent would via upsert_def. */
export const arcanistDb = GameDatabase.parse({
  stats: [
    { id: 'health', name: 'Health', base: 100, resource: true, perLevel: 10, color: '#e3608f' },
    { id: 'mana', name: 'Mana', base: 60, resource: true, regen: 3, perLevel: 5, color: '#59c8ff' },
    { id: 'power', name: 'Power', base: 0 },
    { id: 'armor', name: 'Armor', base: 0 },
    { id: 'move_speed', name: 'Move Speed', base: 100 },
  ],
  statuses: [
    { id: 'burning', name: 'Burning', duration: 4, tick: [{ kind: 'damage', amount: 3 }], tickEvery: 1, maxStacks: 3 },
    { id: 'chilled', name: 'Chilled', duration: 3, modifiers: [{ stat: 'move_speed', op: 'add', value: -40 }] },
  ],
  abilities: [
    { id: 'firebolt', name: 'Firebolt', target: 'ray', range: 14, windup: 0.2, cooldown: 1.5, cost: [{ stat: 'mana', amount: 10 }], effects: [{ kind: 'damage', amount: 18, scaling: { stat: 'power', factor: 0.5 } }, { kind: 'apply_status', status: 'burning' }] },
    { id: 'frost_nova', name: 'Frost Nova', target: 'aoe', radius: 4, windup: 0.1, cooldown: 6, cost: [{ stat: 'mana', amount: 20 }], effects: [{ kind: 'damage', amount: 8 }, { kind: 'apply_status', status: 'chilled' }] },
    { id: 'mend', name: 'Mend', target: 'self', windup: 0.4, cooldown: 8, cost: [{ stat: 'mana', amount: 15 }], effects: [{ kind: 'heal', amount: 35 }] },
    { id: 'immolate', name: 'Immolate', target: 'melee', range: 2.5, arc: 90, cooldown: 4, cost: [{ stat: 'mana', amount: 12 }], effects: [{ kind: 'damage', amount: 25 }, { kind: 'knockback', force: 6 }] },
  ],
  trees: [
    {
      id: 'pyromancy',
      name: 'Pyromancy',
      nodes: [
        { id: 'kindling', name: 'Kindling', cost: 1, ranks: 3, grants: { modifiers: [{ stat: 'power', op: 'add', value: 10 }] }, pos: [0, 0] },
        { id: 'ignite', name: 'Ignite', cost: 1, requires: ['kindling'], grants: { abilities: ['immolate'] }, pos: [0, 1] },
        { id: 'inferno', name: 'Inferno', cost: 2, requires: ['ignite'], requiresLevel: 4, grants: { modifiers: [{ stat: 'power', op: 'mul', value: 0.25 }] }, pos: [0, 2] },
      ],
    },
  ],
  items: [
    { id: 'health_potion', name: 'Health Potion', kind: 'consumable', use: [{ kind: 'heal', amount: 40 }], rarity: 'common' },
    { id: 'ember_staff', name: 'Ember Staff', kind: 'equipment', slot: 'weapon', modifiers: [{ stat: 'power', op: 'add', value: 15 }], rarity: 'rare' },
    { id: 'wolf_pelt', name: 'Wolf Pelt', kind: 'material' },
  ],
  loot: [{ id: 'wolf_drop', rolls: 2, entries: [{ item: 'wolf_pelt', weight: 3 }, { item: 'health_potion', weight: 1 }] }],
  progression: { enabled: true, xpBase: 50, xpGrowth: 1.4, pointsPerLevel: 1 },
  loadout: { abilities: ['firebolt', 'frost_nova', 'mend'], items: [['health_potion', 2], ['ember_staff', 1]], trees: ['pyromancy'] },
});

/** Hollow Vale with the kit installed and wolves upgraded to units with loot — via real transactions. */
function arcaneVale(): SceneDoc {
  let scene = hollowValeScene();
  const tx = (label: string, mutations: Parameters<typeof buildTransaction>[3]) => {
    const r = applyTransaction(scene, buildTransaction(scene, { kind: 'agent', id: 'test', name: 'Test' }, label, mutations));
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    scene = r.scene;
  };
  const db = arcanistDb;
  tx('Install arcanist kit', [
    ...db.stats.map((def) => ({ op: 'upsert_def' as const, table: 'stats' as const, def })),
    ...db.statuses.map((def) => ({ op: 'upsert_def' as const, table: 'statuses' as const, def })),
    ...db.abilities.map((def) => ({ op: 'upsert_def' as const, table: 'abilities' as const, def })),
    ...db.trees.map((def) => ({ op: 'upsert_def' as const, table: 'trees' as const, def })),
    ...db.items.map((def) => ({ op: 'upsert_def' as const, table: 'items' as const, def })),
    ...db.loot.map((def) => ({ op: 'upsert_def' as const, table: 'loot' as const, def })),
    { op: 'set_database', patch: { progression: db.progression, loadout: db.loadout } },
  ]);
  tx('Wolves become units', [
    { op: 'set_component', entityId: 'ent_wolf_1', component: 'unit', value: { loot: 'wolf_drop', xp: 60, stats: { health: 45, armor: 10 } } },
    { op: 'set_component', entityId: 'ent_wolf_2', component: 'unit', value: { loot: 'wolf_drop', xp: 60, stats: { health: 45, armor: 10 } } },
  ]);
  return scene;
}

describe('gameplay framework', () => {
  it('the kit lints clean, and lint catches soft-locks and dangling references', () => {
    expect(lintDatabase(arcanistDb)).toEqual([]);
    const broken = GameDatabase.parse({
      ...arcanistDb,
      trees: [{ id: 't', name: 'T', nodes: [{ id: 'a', name: 'A', requires: ['b'] }, { id: 'b', name: 'B', requires: ['a'] }] }],
      loadout: { abilities: ['missing_spell'] },
    });
    const issues = lintDatabase(broken);
    expect(issues.some((i) => i.includes('unreachable'))).toBe(true);
    expect(issues.some((i) => i.includes('missing_spell'))).toBe(true);
  });

  it('database edits are transactional and undoable', () => {
    const scene = arcaneVale();
    expect(scene.database.abilities.map((a) => a.id)).toContain('firebolt');
    const edit = applyTransaction(
      scene,
      buildTransaction(scene, { kind: 'agent', id: 't', name: 'T' }, 'Buff firebolt', [
        { op: 'upsert_def', table: 'abilities', def: { ...arcanistDb.abilities[0]!, effects: [{ kind: 'damage', amount: 99 }] } },
        { op: 'remove_def', table: 'items', id: 'wolf_pelt' },
      ]),
    );
    if (!edit.ok) throw new Error(edit.error.message);
    const back = applyTransaction(edit.scene, buildTransaction(edit.scene, { kind: 'agent', id: 't', name: 'T' }, 'undo', edit.inverse));
    if (!back.ok) throw new Error(back.error.message);
    expect(back.scene.database.abilities.find((a) => a.id === 'firebolt')!.effects[0]).toMatchObject({ amount: 18 });
    expect(back.scene.database.items.some((i) => i.id === 'wolf_pelt')).toBe(true);
  });

  it('abilities, statuses, XP, loot, trees, equipment and consumables work end to end', async () => {
    const r = await runPlaytest(arcaneVale(), {
      name: 'Arcanist progression',
      steps: [
        { do: 'expect', check: { kind: 'stat', stat: 'mana', atLeast: 60 } },
        { do: 'command', command: { kind: 'equip', item: 'ember_staff' } },
        { do: 'expect', check: { kind: 'stat', stat: 'power', atLeast: 15 } },
        { do: 'walk_to', entityId: 'ent_wolf_1', stopDistance: 9, timeout: 30 },
        { do: 'face', entityId: 'ent_wolf_1' },
        { do: 'cast', ability: 'firebolt' },
        { do: 'expect', check: { kind: 'stat', stat: 'mana', atMost: 52 } },
        { do: 'wait', seconds: 1.4 },
        { do: 'cast', ability: 'firebolt' },
        { do: 'autopilot', seconds: 60, until: { kind: 'defeated', target: '#wolf', count: 2 } },
        { do: 'expect', check: { kind: 'level', atLeast: 2 } },
        { do: 'expect', check: { kind: 'event', event: 'loot' } },
        { do: 'command', command: { kind: 'unlock', tree: 'pyromancy', node: 'inferno' }, expectFail: true },
        { do: 'command', command: { kind: 'unlock', tree: 'pyromancy', node: 'kindling' } },
        { do: 'expect', check: { kind: 'stat', stat: 'power', atLeast: 25 } },
        { do: 'command', command: { kind: 'use', item: 'health_potion' } },
        { do: 'expect', check: { kind: 'event', event: 'item_used' } },
      ],
    });
    expect(r.passed, formatReport(r)).toBe(true);
    expect(r.events.some((e) => e.type === 'status_applied' && e.detail?.includes('Burning'))).toBe(true);
    expect(r.final.kit!.equipment.weapon).toBe('ember_staff');
  });

  it('cooldowns, costs and statuses are enforced by the sim', async () => {
    const sim = await GameSimulation.create(arcaneVale());
    sim.addPlayer('p1');
    const me = sim.actor('p1')!;
    sim.advance(0.5);
    expect(sim.cast(me, 'mend')).toBeNull();
    expect(sim.cast(me, 'mend')).toBe('already casting');
    sim.advance(0.5);
    expect(sim.cast(me, 'mend')).toBe('on cooldown');
    // Drain mana: firebolt costs 10 each, wait out cooldowns.
    for (let i = 0; i < 6; i++) {
      sim.cast(me, 'firebolt');
      sim.advance(1.6);
    }
    expect(sim.gp.blocked(me.kit!, 'frost_nova')).toMatch(/not enough Mana|on cooldown|^$/);
    // Burning ticks a wolf.
    const wolf = sim.actor('npc:ent_wolf_1')!;
    const hp0 = wolf.health;
    sim.gp.applyStatus(wolf.kit!, 'burning', 'p1');
    sim.advance(2.1);
    expect(wolf.health).toBeLessThan(hp0);
    sim.dispose();
  });

  it('kit view feeds the HUD', async () => {
    const sim = await GameSimulation.create(arcaneVale());
    sim.addPlayer('p1');
    sim.advance(0.2);
    const kit = sim.state('p1').kit!;
    expect(kit.bar.slice(0, 3).map((b) => b?.id)).toEqual(['firebolt', 'frost_nova', 'mend']);
    expect(kit.resources.map((r) => r.id)).toEqual(['health', 'mana']);
    expect(kit.trees[0]!.nodes.find((n) => n.id === 'kindling')!.why).toMatch(/needs 1 point/);
    expect(kit.items.find((i) => i.id === 'health_potion')!.count).toBe(2);
    sim.dispose();
  });
});
