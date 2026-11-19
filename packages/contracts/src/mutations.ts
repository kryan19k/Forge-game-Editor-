import { z } from 'zod';
import { ComponentName } from './components';
import { DefTable } from './database';
import { EntityId, Vec3 } from './primitives';
import { Prefab, PrefabId } from './prefab';
import { Entity, Environment } from './scene';

/**
 * Every scene change — from the Studio, an MCP agent, or a QA repair — is a
 * typed mutation inside a transaction. Nothing else may write a scene.
 */
export const Mutation = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create_entity'),
    entity: Entity.omit({ rev: true }),
  }),
  z.object({
    op: z.literal('delete_entity'),
    entityId: EntityId,
  }),
  z.object({
    op: z.literal('set_transform'),
    entityId: EntityId,
    position: Vec3.optional(),
    rotation: Vec3.optional(),
    scale: Vec3.optional(),
  }),
  z.object({
    op: z.literal('rename_entity'),
    entityId: EntityId,
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    op: z.literal('reparent'),
    entityId: EntityId,
    parentId: EntityId.nullable(),
  }),
  z.object({
    op: z.literal('set_component'),
    entityId: EntityId,
    component: ComponentName,
    /** Full component value; validated against the component schema. */
    value: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('patch_component'),
    entityId: EntityId,
    component: ComponentName,
    /** Deep-merged into the existing value, then validated. Creates the component if absent. */
    value: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('remove_component'),
    entityId: EntityId,
    component: ComponentName,
  }),
  z.object({
    op: z.literal('set_flags'),
    entityId: EntityId,
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(32)).max(32).optional(),
  }),
  z.object({
    op: z.literal('set_environment'),
    patch: Environment.partial(),
  }),
  z.object({
    op: z.literal('upsert_def'),
    /** Database table: stats | abilities | statuses | trees | items | loot. */
    table: DefTable,
    /** Full definition (validated against the table's schema); replaces any def with the same id. */
    def: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('remove_def'),
    table: DefTable,
    id: z.string(),
  }),
  z.object({
    op: z.literal('set_database'),
    /** Deep-merged into database.progression / database.loadout (arrays replaced). */
    patch: z.object({ progression: z.record(z.string(), z.unknown()).optional(), loadout: z.record(z.string(), z.unknown()).optional() }),
  }),
  z.object({ op: z.literal('set_prefab'), prefabId: PrefabId, value: Prefab.nullable() }),
  z.object({
    op: z.literal('set_game'),
    /** Deep-merged into game settings (arrays such as objectives are replaced), then validated. */
    patch: z.record(z.string(), z.unknown()),
  }),
]);
export type Mutation = z.output<typeof Mutation>;
export type MutationInput = z.input<typeof Mutation>;
export type MutationOp = Mutation['op'];

export const Author = z.object({
  kind: z.enum(['human', 'agent', 'system']),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
});
export type Author = z.output<typeof Author>;

export const Transaction = z.object({
  txId: z.string().min(1),
  sceneId: z.string().min(1),
  /** Revision the author was looking at. Stale writes to entities changed since are rejected. */
  baseRevision: z.number().int().min(0),
  author: Author,
  label: z.string().trim().min(1).max(160),
  mutations: z.array(Mutation).min(1).max(500),
  createdAt: z.number().int(),
  revertOf: z.string().optional(),
});
export type Transaction = z.output<typeof Transaction>;
export type TransactionInput = z.input<typeof Transaction>;

export const TxErrorCode = z.enum([
  'INVALID',
  'SCENE_MISMATCH',
  'STALE_REVISION',
  'CONFLICT',
  'NOT_FOUND',
  'DUPLICATE_ID',
  'LOCKED',
  'INVARIANT',
]);
export type TxErrorCode = z.infer<typeof TxErrorCode>;

export interface TxError {
  code: TxErrorCode;
  message: string;
  mutationIndex?: number;
}
