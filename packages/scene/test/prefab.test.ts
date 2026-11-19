import { Prefab, SceneDoc, type Author, type MutationInput } from '@forge/contracts';
import { expect, it } from 'vitest';
import { applyTransaction, buildTransaction, instantiatePrefab, prefabFromSelection } from '../src';

const agent: Author = { kind: 'agent', id: 'codex', name: 'Codex' };

function apply(scene: SceneDoc, mutations: MutationInput[]) {
  const result = applyTransaction(scene, buildTransaction(scene, agent, 'Prefab test', mutations));
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

it('stores and restores prefab definitions, and places independently remapped subtrees', () => {
  const empty = SceneDoc.parse({ schemaVersion: 1, sceneId: 'main', name: 'Test', revision: 0, entities: {} });
  const prefab = Prefab.parse({
    name: 'Watchtower',
    entities: [
      { id: 'ent_beam', name: 'Beam', parentId: 'ent_tower', transform: { position: [0, 2, 0] }, components: { mesh: { shape: 'box' } } },
      { id: 'ent_tower', name: 'Watchtower', locked: true },
    ],
    parameters: [{ id: 'beam_color', label: 'Beam color', entityId: 'ent_beam', kind: 'albedo' }],
  });
  const create: MutationInput = { op: 'set_prefab', prefabId: 'prefab_tower', value: prefab };
  const saved = apply(empty, [create]);
  expect(saved.scene.database.prefabs.prefab_tower).toEqual(prefab);
  expect(apply(saved.scene, saved.inverse).scene.database.prefabs).toEqual({});
  const renamed = apply(saved.scene, [{ ...create, value: { ...prefab, name: 'New name' } }]);
  expect(apply(renamed.scene, renamed.inverse).scene.database.prefabs).toEqual(saved.scene.database.prefabs);
  expect(applyTransaction(saved.scene, buildTransaction(empty, agent, 'Stale edit', [create]))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(Prefab.safeParse({ ...prefab, entities: prefab.entities.map((e) => ({ ...e, parentId: 'ent_missing' })) }).success).toBe(false);

  const first = instantiatePrefab(prefab, [3, 0, -4], { beam_color: '#a25c30' });
  const second = instantiatePrefab(prefab, [8, 0, -4]);
  const placed = apply(saved.scene, [...first.mutations, ...second.mutations]);
  expect(first.rootId).not.toBe(second.rootId);
  expect(placed.scene.entities[first.rootId]).toMatchObject({ locked: false, transform: { position: [3, 0, -4] } });
  const beam = Object.values(placed.scene.entities).find((e) => e.parentId === first.rootId)!;
  expect(beam).toMatchObject({ transform: { position: [0, 2, 0] }, components: { mesh: { material: { color: '#a25c30' } } } });
  const captured = prefabFromSelection(placed.scene, [first.rootId, beam.id], 'Copy');
  expect(captured.entities[0]).toMatchObject({ parentId: null, transform: { position: [0, 0, 0] } });
  expect(new Set(captured.entities.map((e) => e.id))).toEqual(new Set([first.rootId, beam.id]));
  expect(apply(placed.scene, placed.inverse).scene.entities).toEqual({});
});
