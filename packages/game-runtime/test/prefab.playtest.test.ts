import { Prefab, SceneDoc, type Author } from '@forge/contracts';
import { applyTransaction, buildTransaction, instantiatePrefab } from '@forge/scene';
import { expect, it } from 'vitest';
import { runPlaytest } from '../src/sim';

it('the player lands on a collider authored in a placed prefab subtree', async () => {
  const base = SceneDoc.parse({ schemaVersion: 1, sceneId: 'main', name: 'Prefab physics', revision: 0, entities: {} });
  const author: Author = { kind: 'agent', id: 'codex', name: 'Codex' };
  const platform = Prefab.parse({
    name: 'Platform',
    entities: [
      { id: 'ent_platform', name: 'Platform' },
      { id: 'ent_deck', name: 'Deck', parentId: 'ent_platform', transform: { position: [0, 1, 0] }, components: {
        mesh: { shape: 'box', size: [4, 0.5, 4] },
        collider: { shape: 'box', size: [4, 0.5, 4] },
        rigidBody: { kind: 'static' },
      } },
    ],
  });
  const placement = instantiatePrefab(platform, [6, 0, 5]);
  const tx = buildTransaction(base, author, 'Place platform', placement.mutations);
  const result = applyTransaction(base, tx);
  if (!result.ok) throw new Error(result.error.message);
  const report = await runPlaytest(result.scene, { name: 'Land on the deck', steps: [
    { do: 'teleport', position: [6, 3, 5] },
    { do: 'wait', seconds: 1 },
    { do: 'expect', check: { kind: 'grounded' } },
    { do: 'expect', check: { kind: 'near', entityId: placement.rootId, within: 2 } },
  ] });
  expect(report.passed, JSON.stringify(report.steps)).toBe(true);
  expect(report.final.player.position[1]).toBeCloseTo(1.25, 1);
});
