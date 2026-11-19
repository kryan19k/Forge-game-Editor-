import { SceneDoc, type Author, type MutationInput } from '@forge/contracts';
import { describe, expect, it } from 'vitest';
import { applyTransaction, buildTransaction, outlineScene, type TxResult } from '../src';

const human: Author = { kind: 'human', id: 'kory', name: 'Kory' };
const agent: Author = { kind: 'agent', id: 'claude', name: 'Claude' };

const empty = () => SceneDoc.parse({ schemaVersion: 1, sceneId: 'main', name: 'Test', revision: 0, entities: {} });

function apply(scene: SceneDoc, author: Author, mutations: MutationInput[], base?: number) {
  return applyTransaction(scene, buildTransaction(scene, author, 'test', mutations, base === undefined ? {} : { baseRevision: base }));
}
function ok(r: TxResult) {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}

const box = (id: string, parentId: string | null = null): MutationInput => ({
  op: 'create_entity',
  entity: { id, name: id, parentId, components: { mesh: { shape: 'box' } } },
});

describe('applyTransaction', () => {
  it('creates entities with defaults and bumps revision', () => {
    const r = ok(apply(empty(), human, [box('ent_crate')]));
    expect(r.scene.revision).toBe(1);
    const e = r.scene.entities.ent_crate!;
    expect(e.transform.scale).toEqual([1, 1, 1]);
    expect(e.components.mesh?.material.roughness).toBe(0.75);
    expect(e.rev).toBe(1);
  });

  it('is atomic: a failing mutation leaves the scene untouched', () => {
    const s0 = empty();
    const r = apply(s0, human, [box('ent_a'), box('ent_b', 'ent_missing')]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
      expect(r.error.mutationIndex).toBe(1);
    }
    expect(Object.keys(s0.entities)).toHaveLength(0);
  });

  it('rejects invalid component values with a readable error', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a')])).scene;
    const r = apply(s1, human, [{ op: 'patch_component', entityId: 'ent_a', component: 'mesh', value: { material: { roughness: 4 } } }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID');
  });

  it('patch_component deep-merges', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a')])).scene;
    const s2 = ok(
      apply(s1, human, [{ op: 'patch_component', entityId: 'ent_a', component: 'mesh', value: { material: { color: '#ff0000' } } }]),
    ).scene;
    expect(s2.entities.ent_a!.components.mesh?.material).toMatchObject({ color: '#ff0000', roughness: 0.75 });
  });

  it('inverse restores the exact previous scene content (delete subtree)', () => {
    const s1 = ok(apply(empty(), human, [box('ent_hub'), box('ent_door', 'ent_hub'), box('ent_light', 'ent_door')])).scene;
    const del = ok(apply(s1, human, [{ op: 'delete_entity', entityId: 'ent_hub' }]));
    expect(Object.keys(del.scene.entities)).toHaveLength(0);
    const restored = ok(apply(del.scene, human, del.inverse)).scene;
    const strip = (s: SceneDoc) => Object.values(s.entities).map(({ rev: _r, ...e }) => e);
    expect(strip(restored)).toEqual(strip(s1));
  });

  it('inverse undoes a multi-mutation edit in reverse order', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a')])).scene;
    const edit = ok(
      apply(s1, human, [
        { op: 'set_transform', entityId: 'ent_a', position: [1, 2, 3] },
        { op: 'set_transform', entityId: 'ent_a', position: [9, 9, 9] },
        { op: 'rename_entity', entityId: 'ent_a', name: 'Moved' },
        { op: 'set_environment', patch: { fogDensity: 0.5 } },
      ]),
    );
    const back = ok(apply(edit.scene, human, edit.inverse)).scene;
    expect(back.entities.ent_a!.transform.position).toEqual([0, 0, 0]);
    expect(back.entities.ent_a!.name).toBe('ent_a');
    expect(back.environment.fogDensity).toBe(s1.environment.fogDensity);
  });

  it('detects conflicts on entities changed after the base revision', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a'), box('ent_b')])).scene; // rev 1
    const s2 = ok(apply(s1, human, [{ op: 'set_transform', entityId: 'ent_a', position: [1, 0, 0] }])).scene; // rev 2
    // Agent still looking at rev 1: editing ent_b is fine, ent_a conflicts.
    expect(apply(s2, agent, [{ op: 'rename_entity', entityId: 'ent_b', name: 'B' }], 1).ok).toBe(true);
    const r = apply(s2, agent, [{ op: 'rename_entity', entityId: 'ent_a', name: 'A' }], 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
  });

  it('protects locked entities from agents but not humans', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a'), { op: 'set_flags', entityId: 'ent_a', locked: true }])).scene;
    const r = apply(s1, agent, [{ op: 'delete_entity', entityId: 'ent_a' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LOCKED');
    expect(apply(s1, human, [{ op: 'delete_entity', entityId: 'ent_a' }]).ok).toBe(true);
  });

  it('rejects parent cycles', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a'), box('ent_b', 'ent_a')])).scene;
    const r = apply(s1, human, [{ op: 'reparent', entityId: 'ent_a', parentId: 'ent_b' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVARIANT');
  });

  it('rejects duplicate ids and malformed ids', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a')])).scene;
    const dup = apply(s1, human, [box('ent_a')]);
    expect(!dup.ok && dup.error.code).toBe('DUPLICATE_ID');
    const bad = apply(s1, human, [box('Crate!')]);
    expect(!bad.ok && bad.error.code).toBe('INVALID');
  });

  it('never mutates the input scene', () => {
    const s1 = ok(apply(empty(), human, [box('ent_a')])).scene;
    const frozen = JSON.stringify(s1);
    ok(apply(s1, human, [{ op: 'set_transform', entityId: 'ent_a', position: [5, 5, 5] }]));
    expect(JSON.stringify(s1)).toBe(frozen);
  });

  it('outlines the scene compactly', () => {
    const s1 = ok(apply(empty(), human, [box('ent_hub'), box('ent_door', 'ent_hub')])).scene;
    expect(outlineScene(s1)).toContain('  ent_door "ent_door" @ 0,0,0');
  });
});
