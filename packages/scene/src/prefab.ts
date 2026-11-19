import { Color, Entity, Prefab, newEntityId, type EntityId, type MutationInput, type SceneDoc, type Vec3 } from '@forge/contracts';
import { isDescendant, subtree } from './graph';

export function prefabFromSelection(scene: SceneDoc, selection: EntityId[], name: string, parameters: Prefab['parameters'] = []): Prefab {
  const ids = selection.filter((id) => scene.entities[id]);
  const root = ids.find((id) => ids.every((other) => other === id || isDescendant(scene, other, id)));
  if (!root) throw new Error('Select one subtree to save as a prefab.');
  return Prefab.parse({
    name, parameters,
    entities: subtree(scene, root).map((entity) => entity.id === root
      ? { ...entity, parentId: null, transform: { ...entity.transform, position: [0, 0, 0] } }
      : entity),
  });
}

export function instantiatePrefab(prefab: Prefab, position: Vec3, overrides: Record<string, string> = {}): { rootId: EntityId; mutations: MutationInput[] } {
  const targets = new Map(prefab.entities.map((entity) => [entity.id, Entity.parse(entity)]));
  for (const [id, value] of Object.entries(overrides)) {
    const binding = prefab.parameters.find((parameter) => parameter.id === id);
    if (!binding) throw new Error(`No prefab parameter ${id}`);
    const target = targets.get(binding.entityId)!;
    if (binding.kind === 'name') target.name = Entity.shape.name.parse(value);
    else target.components.mesh!.material.color = Color.parse(value);
  }
  const root = [...targets.values()].find((entity) => entity.parentId === null)!;
  const mutations: MutationInput[] = [];
  const create = (entity: Entity, parentId: EntityId | null): EntityId => {
    const id = newEntityId(entity.name);
    const { rev: _rev, ...template } = entity;
    mutations.push({
      op: 'create_entity',
      entity: { ...template, id, locked: false, parentId, transform: { ...entity.transform, position: parentId === null ? position : entity.transform.position } },
    });
    for (const child of targets.values()) if (child.parentId === entity.id) create(child, id);
    return id;
  };
  return { rootId: create(root, null), mutations };
}
