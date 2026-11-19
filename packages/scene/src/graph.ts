import type { Entity, EntityId, SceneDoc } from '@forge/contracts';

export function childrenOf(scene: SceneDoc, parentId: EntityId | null): Entity[] {
  return Object.values(scene.entities).filter((e) => e.parentId === parentId);
}

/** Pre-order subtree (root first), so re-creating in this order is always valid. */
export function subtree(scene: SceneDoc, rootId: EntityId): Entity[] {
  const root = scene.entities[rootId];
  if (!root) return [];
  const out: Entity[] = [root];
  for (const child of childrenOf(scene, rootId)) out.push(...subtree(scene, child.id));
  return out;
}

export function isDescendant(scene: SceneDoc, candidate: EntityId, ancestor: EntityId): boolean {
  let cursor = scene.entities[candidate]?.parentId ?? null;
  let guard = 0;
  while (cursor && guard++ < 10_000) {
    if (cursor === ancestor) return true;
    cursor = scene.entities[cursor]?.parentId ?? null;
  }
  return false;
}

/** Ordered hierarchy for UIs: [entity, depth] in pre-order. */
export function flattenHierarchy(scene: SceneDoc): Array<{ entity: Entity; depth: number }> {
  const out: Array<{ entity: Entity; depth: number }> = [];
  const walk = (parentId: EntityId | null, depth: number) => {
    for (const e of childrenOf(scene, parentId)) {
      out.push({ entity: e, depth });
      walk(e.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function checkInvariants(scene: SceneDoc): string | null {
  for (const [key, e] of Object.entries(scene.entities)) {
    if (key !== e.id) return `entity key ${key} does not match id ${e.id}`;
    if (e.parentId !== null) {
      if (!scene.entities[e.parentId]) return `${e.id} references missing parent ${e.parentId}`;
      if (e.parentId === e.id || isDescendant(scene, e.parentId, e.id)) return `${e.id} is in a parent cycle`;
    }
  }
  return null;
}
