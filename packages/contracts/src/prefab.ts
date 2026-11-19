import { z } from 'zod';
import { Entity } from './entity';
import { DatabaseId, EntityId, Vec3 } from './primitives';

export const PrefabId = z.string().regex(/^prefab_[a-z0-9_]{1,40}$/);
const PrefabName = Entity.shape.name;
const PrefabEntities = z.array(Entity.omit({ rev: true })).min(1).max(96);
const PrefabParameters = z.array(z.object({
  id: DatabaseId,
  label: z.string().trim().min(1).max(40),
  entityId: EntityId,
  kind: z.enum(['name', 'albedo']),
})).max(12);

export const Prefab = z.object({ name: PrefabName, entities: PrefabEntities, parameters: PrefabParameters.default([]) }).superRefine((prefab, ctx) => {
  const issues = (message: string) => ctx.addIssue({ code: 'custom', message });
  const byId = new Map(prefab.entities.map((entity) => [entity.id, entity]));
  if (byId.size !== prefab.entities.length) issues('Prefab entity IDs must be unique');
  const roots = prefab.entities.filter((entity) => entity.parentId === null);
  if (roots.length !== 1) issues('A prefab requires one root entity');
  const visited = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const entity = pending.pop()!;
    if (visited.has(entity.id)) continue;
    visited.add(entity.id);
    pending.push(...prefab.entities.filter((child) => child.parentId === entity.id));
  }
  if (visited.size !== byId.size) issues('Every prefab member must descend from the root');
  const ids = new Set<string>();
  const bindings = new Set<string>();
  for (const parameter of prefab.parameters) {
    const target = byId.get(parameter.entityId);
    const binding = `${parameter.entityId}/${parameter.kind}`;
    if (ids.has(parameter.id)) issues(`Duplicate prefab parameter ${parameter.id}`);
    if (bindings.has(binding)) issues(`Duplicate prefab parameter binding ${binding}`);
    if (!target || (parameter.kind === 'albedo' && (!target.components.mesh || target.components.mesh.asset))) issues(`Invalid target for parameter ${parameter.id}`);
    ids.add(parameter.id);
    bindings.add(binding);
  }
});
export type Prefab = z.output<typeof Prefab>;

export const PrefabCreate = z.object({ name: PrefabName, entities: PrefabEntities.optional(), parameters: PrefabParameters.default([]) });
export type PrefabCreate = z.output<typeof PrefabCreate>;
export const PrefabPlace = z.object({
  prefab: PrefabId,
  position: Vec3,
  parameters: z.record(DatabaseId, z.string().max(80)).default({}),
  baseRevision: z.number().int().nonnegative().optional(),
});
export type PrefabPlace = z.output<typeof PrefabPlace>;
