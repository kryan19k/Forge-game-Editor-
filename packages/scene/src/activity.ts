import { ComponentName, type EntityId, type SceneChange, type SceneDoc } from '@forge/contracts';

function parentRef(scene: SceneDoc, id: EntityId | null) {
  const parent = id && scene.entities[id];
  return parent ? { id: parent.id, name: parent.name } : null;
}

/** Describe the observable changes in a committed transaction, including subtree deletes and undo. */
export function describeSceneChanges(before: SceneDoc, after: SceneDoc, touched: EntityId[]): SceneChange[] {
  const changes: SceneChange[] = [];
  for (const id of touched) {
    const previous = before.entities[id];
    const current = after.entities[id];
    if (!current) {
      if (previous) changes.push({ kind: 'deleted', entity: { id, name: previous.name } });
      continue;
    }
    const entity = { id, name: current.name };
    const parent = parentRef(after, current.parentId);
    if (!previous) {
      changes.push({ kind: 'created', entity, position: current.transform.position, parent });
      continue;
    }
    if (previous.name !== current.name) changes.push({ kind: 'renamed', entity, previousName: previous.name });
    if (previous.parentId !== current.parentId) {
      changes.push({ kind: 'reparented', entity, parent, previousParent: parentRef(before, previous.parentId) });
    }
    for (const component of ComponentName.options) {
      const had = previous.components[component] !== undefined;
      const has = current.components[component] !== undefined;
      if (had !== has) changes.push({ kind: has ? 'component_added' : 'component_removed', entity, component });
    }
  }
  return changes;
}
