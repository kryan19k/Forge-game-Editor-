import { newId, type Author, type MutationInput, type SceneDoc, type TransactionInput } from '@forge/contracts';

export * from './graph';
export * from './reducer';
export * from './outline';
export * from './activity';

export function buildTransaction(
  scene: Pick<SceneDoc, 'sceneId' | 'revision'>,
  author: Author,
  label: string,
  mutations: MutationInput[],
  extra: Partial<Pick<TransactionInput, 'revertOf' | 'baseRevision'>> = {},
): TransactionInput {
  return {
    txId: newId('tx'),
    sceneId: scene.sceneId,
    baseRevision: extra.baseRevision ?? scene.revision,
    author,
    label,
    mutations,
    createdAt: Date.now(),
    ...(extra.revertOf ? { revertOf: extra.revertOf } : {}),
  };
}
