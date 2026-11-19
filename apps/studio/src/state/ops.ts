import { newEntityId, type EntityId, type EntityInput, type MutationInput, type SceneDoc } from '@forge/contracts';
import { subtree } from '@forge/scene';
import { select, submit, useStudio } from './store';

/** Recipes for things the Director can drop into the scene. */
export type Recipe =
  | 'box' | 'sphere' | 'cylinder' | 'capsule' | 'cone' | 'torus' | 'plane'
  | 'point' | 'spot' | 'directional' | 'hemisphere'
  | 'spawn' | 'trigger' | 'pickup' | 'door' | 'group';

export const RECIPES: Array<{ group: string; items: Array<{ id: Recipe; label: string }> }> = [
  { group: 'Geometry', items: [
    { id: 'box', label: 'Box' }, { id: 'sphere', label: 'Sphere' }, { id: 'cylinder', label: 'Cylinder' },
    { id: 'capsule', label: 'Capsule' }, { id: 'cone', label: 'Cone' }, { id: 'torus', label: 'Torus' }, { id: 'plane', label: 'Plane' },
  ] },
  { group: 'Light', items: [
    { id: 'point', label: 'Point light' }, { id: 'spot', label: 'Spot light' },
    { id: 'directional', label: 'Directional light' }, { id: 'hemisphere', label: 'Sky light' },
  ] },
  { group: 'Gameplay', items: [
    { id: 'spawn', label: 'Spawn point' }, { id: 'trigger', label: 'Trigger volume' },
    { id: 'pickup', label: 'Pickup' }, { id: 'door', label: 'Door' }, { id: 'group', label: 'Empty group' },
  ] },
];

function recipe(kind: Recipe, at: [number, number, number]): EntityInput {
  const [x, , z] = at;
  const label = RECIPES.flatMap((g) => g.items).find((i) => i.id === kind)!.label;
  const id = newEntityId(kind);
  const base = { id, name: label };
  switch (kind) {
    case 'box': case 'sphere': case 'cylinder': case 'capsule': case 'cone': case 'torus':
      return { ...base, transform: { position: [x, kind === 'capsule' ? 1 : 0.5, z] }, components: { mesh: { shape: kind, size: kind === 'capsule' ? [0.8, 2, 0.8] : [1, 1, 1] } } };
    case 'plane':
      return { ...base, transform: { position: [x, 0.01, z] }, components: { mesh: { shape: 'plane', size: [4, 1, 4] } } };
    case 'point':
      return { ...base, transform: { position: [x, 2.5, z] }, components: { light: { kind: 'point', color: '#ffd2a1', intensity: 12, range: 10 } } };
    case 'spot':
      return { ...base, transform: { position: [x, 5, z], rotation: [-60, 0, 0] }, components: { light: { kind: 'spot', intensity: 120, range: 25, angle: 30, castShadow: true } } };
    case 'directional':
      return { ...base, transform: { position: [x + 10, 20, z + 10], rotation: [-50, 45, 0] }, components: { light: { kind: 'directional', intensity: 2, castShadow: true } } };
    case 'hemisphere':
      return { ...base, transform: { position: [x, 10, z] }, components: { light: { kind: 'hemisphere', color: '#9fb4c8', groundColor: '#2a2420', intensity: 0.6 } } };
    case 'spawn':
      return { ...base, transform: { position: [x, 0, z] }, components: { spawnPoint: {} }, tags: ['spawn'] };
    case 'trigger':
      return { ...base, transform: { position: [x, 1, z] }, components: { collider: { shape: 'box', size: [3, 2, 3], isTrigger: true, layer: 'trigger' } } };
    case 'pickup':
      return {
        ...base,
        transform: { position: [x, 0.8, z] },
        components: {
          mesh: { shape: 'torus', size: [0.5, 0.5, 0.5], castShadow: false, material: { color: '#ffb020', emissive: '#ffb020', emissiveIntensity: 3, metalness: 0.6, roughness: 0.3 } },
          collider: { shape: 'sphere', size: [1, 1, 1], isTrigger: true, layer: 'interact' },
          interactable: { verb: 'pickup', prompt: 'Pick up' },
          network: { authority: 'server', replicate: ['state'] },
        },
        tags: ['pickup'],
      };
    case 'door':
      return {
        ...base,
        transform: { position: [x, 1.5, z] },
        components: {
          mesh: { shape: 'box', size: [2.4, 3, 0.2], material: { color: '#2f3a40', metalness: 0.7, roughness: 0.35 } },
          collider: {},
          rigidBody: { kind: 'kinematic' },
          interactable: { verb: 'open', prompt: 'Open door' },
          network: { authority: 'server', replicate: ['transform', 'state'] },
        },
        tags: ['door'],
      };
    case 'group':
      return { ...base, transform: { position: [x, 0, z] } };
  }
}

export function addRecipe(kind: Recipe, at: [number, number, number]): void {
  const e = recipe(kind, at);
  const parent = singleGroupParent();
  submit(`Add ${e.name}`, [{ op: 'create_entity', entity: parent ? { ...e, parentId: parent } : e }]);
  queueMicrotask(() => select([e.id]));
}

/** If exactly one empty group is selected, new things go inside it. */
function singleGroupParent(): EntityId | null {
  const { scene, selection } = useStudio.getState();
  if (!scene || selection.length !== 1) return null;
  const e = scene.entities[selection[0]!];
  return e && Object.keys(e.components).length === 0 ? e.id : null;
}

/** Top-most selected entities (children of selected parents are implied). */
export function selectionRoots(scene: SceneDoc, ids: EntityId[]): EntityId[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    for (let p = scene.entities[id]?.parentId ?? null; p; p = scene.entities[p]?.parentId ?? null) if (set.has(p)) return false;
    return true;
  });
}

export function deleteSelection(): void {
  const { scene, selection } = useStudio.getState();
  if (!scene || !selection.length) return;
  const roots = selectionRoots(scene, selection);
  const name = roots.length === 1 ? scene.entities[roots[0]!]!.name : `${roots.length} entities`;
  submit(`Delete ${name}`, roots.map((entityId) => ({ op: 'delete_entity', entityId })));
  select([]);
}

export function duplicateSelection(): void {
  const { scene, selection } = useStudio.getState();
  if (!scene || !selection.length) return;
  const muts: MutationInput[] = [];
  const newRoots: EntityId[] = [];
  for (const rootId of selectionRoots(scene, selection)) {
    const remap = new Map<EntityId, EntityId>();
    for (const e of subtree(scene, rootId)) {
      const id = newEntityId(e.name);
      remap.set(e.id, id);
      const isRoot = e.id === rootId;
      const { rev: _rev, ...rest } = structuredClone(e);
      const p = rest.transform.position;
      muts.push({
        op: 'create_entity',
        entity: {
          ...rest,
          id,
          locked: false,
          name: isRoot ? `${e.name} copy` : e.name,
          parentId: isRoot ? e.parentId : remap.get(e.parentId!)!,
          transform: { ...rest.transform, position: isRoot ? [p[0] + 1, p[1], p[2] + 1] : p },
        },
      });
      if (isRoot) newRoots.push(id);
    }
  }
  submit(`Duplicate ${newRoots.length === 1 ? scene.entities[selection[0]!]!.name : `${newRoots.length} entities`}`, muts);
  queueMicrotask(() => select(newRoots));
}

export function toggleFlag(ids: EntityId[], flag: 'visible' | 'locked'): void {
  const { scene } = useStudio.getState();
  if (!scene || !ids.length) return;
  const first = scene.entities[ids[0]!];
  if (!first) return;
  const value = !first[flag];
  const verb = flag === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
  submit(`${verb} ${ids.length === 1 ? first.name : `${ids.length} entities`}`, ids.map((entityId) => ({ op: 'set_flags', entityId, [flag]: value })));
}
