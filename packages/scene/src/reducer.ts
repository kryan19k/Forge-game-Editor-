import {
  ComponentSchemas,
  DefSchemas,
  Entity,
  GameDatabase,
  GameSettings,
  Transaction,
  type ComponentName,
  type EntityId,
  type Mutation,
  type SceneDoc,
  type TxError,
  type TxErrorCode,
} from '@forge/contracts';
import { z } from 'zod';
/** Isomorphic deep clone (browser + Node) without DOM/Node typings. */
const clone = <T>(v: T): T => (globalThis as unknown as { structuredClone<U>(x: U): U }).structuredClone(v);

import { checkInvariants, isDescendant, subtree } from './graph';

export type TxResult =
  | { ok: true; scene: SceneDoc; inverse: Mutation[]; touched: EntityId[]; tx: Transaction }
  | { ok: false; error: TxError };

interface Ctx {
  tx: Transaction;
  scene: SceneDoc;
  touched: Set<EntityId>;
  created: Set<EntityId>;
}

class MutationError extends Error {
  constructor(
    readonly code: TxErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: TxErrorCode, message: string, mutationIndex?: number): TxResult => ({
  ok: false,
  error: mutationIndex === undefined ? { code, message } : { code, message, mutationIndex },
});

/**
 * Apply a transaction atomically. Pure: the input scene is never mutated.
 * On success returns the next scene plus the inverse mutations (for undo/revert).
 */
export function applyTransaction(scene: SceneDoc, input: unknown): TxResult {
  const parsed = Transaction.safeParse(input);
  if (!parsed.success) return fail('INVALID', z.prettifyError(parsed.error));
  const tx = parsed.data;

  if (tx.sceneId !== scene.sceneId) return fail('SCENE_MISMATCH', `transaction targets ${tx.sceneId}, scene is ${scene.sceneId}`);
  if (tx.baseRevision > scene.revision)
    return fail('STALE_REVISION', `baseRevision ${tx.baseRevision} is ahead of scene revision ${scene.revision}`);

  const next = clone(scene);
  const ctx: Ctx = { tx, scene: next, touched: new Set(), created: new Set() };
  const inverse: Mutation[] = [];

  for (const [i, m] of tx.mutations.entries()) {
    try {
      inverse.unshift(...applyMutation(ctx, m));
    } catch (err) {
      if (err instanceof MutationError) return fail(err.code, err.message, i);
      throw err;
    }
  }

  const broken = checkInvariants(next);
  if (broken) return fail('INVARIANT', broken);

  next.revision = scene.revision + 1;
  for (const id of ctx.touched) {
    const e = next.entities[id];
    if (e) e.rev = next.revision;
  }
  return { ok: true, scene: next, inverse, touched: [...ctx.touched], tx };
}

function getWritable(ctx: Ctx, id: EntityId): Entity {
  const e = ctx.scene.entities[id];
  if (!e) throw new MutationError('NOT_FOUND', `no entity ${id}`);
  if (!ctx.created.has(id)) {
    if (e.rev > ctx.tx.baseRevision)
      throw new MutationError(
        'CONFLICT',
        `${id} changed at revision ${e.rev}, after your base revision ${ctx.tx.baseRevision}; re-read and retry`,
      );
    if (e.locked && ctx.tx.author.kind === 'agent')
      throw new MutationError('LOCKED', `${id} (“${e.name}”) is locked by a human; agents may not modify it`);
  }
  ctx.touched.add(id);
  return e;
}

function stripRev(e: Entity): Omit<Entity, 'rev'> {
  const { rev: _rev, ...rest } = e;
  return clone(rest);
}

function applyMutation(ctx: Ctx, m: Mutation): Mutation[] {
  const { scene } = ctx;
  switch (m.op) {
    case 'create_entity': {
      const entity = Entity.parse({ ...m.entity, rev: 0 });
      if (scene.entities[entity.id]) throw new MutationError('DUPLICATE_ID', `entity ${entity.id} already exists`);
      if (entity.parentId && !scene.entities[entity.parentId])
        throw new MutationError('NOT_FOUND', `parent ${entity.parentId} does not exist`);
      scene.entities[entity.id] = entity;
      ctx.created.add(entity.id);
      ctx.touched.add(entity.id);
      return [{ op: 'delete_entity', entityId: entity.id }];
    }

    case 'delete_entity': {
      getWritable(ctx, m.entityId);
      const doomed = subtree(scene, m.entityId);
      for (const e of doomed) getWritable(ctx, e.id);
      const restore: Mutation[] = doomed.map((e) => ({ op: 'create_entity', entity: stripRev(e) }));
      // Deleted ids stay in `touched` so history/conflict checks see them.
      for (const e of doomed) delete scene.entities[e.id];
      return restore;
    }

    case 'set_transform': {
      const e = getWritable(ctx, m.entityId);
      const prev: Mutation = { op: 'set_transform', entityId: e.id };
      if (m.position) (prev.position = e.transform.position), (e.transform.position = m.position);
      if (m.rotation) (prev.rotation = e.transform.rotation), (e.transform.rotation = m.rotation);
      if (m.scale) (prev.scale = e.transform.scale), (e.transform.scale = m.scale);
      return [prev];
    }

    case 'rename_entity': {
      const e = getWritable(ctx, m.entityId);
      const prev = e.name;
      e.name = m.name;
      return [{ op: 'rename_entity', entityId: e.id, name: prev }];
    }

    case 'reparent': {
      const e = getWritable(ctx, m.entityId);
      if (m.parentId !== null) {
        if (!scene.entities[m.parentId]) throw new MutationError('NOT_FOUND', `parent ${m.parentId} does not exist`);
        if (m.parentId === e.id || isDescendant(scene, m.parentId, e.id))
          throw new MutationError('INVARIANT', `cannot parent ${e.id} under its own descendant ${m.parentId}`);
      }
      const prev = e.parentId;
      e.parentId = m.parentId;
      return [{ op: 'reparent', entityId: e.id, parentId: prev }];
    }

    case 'set_component':
    case 'patch_component': {
      const e = getWritable(ctx, m.entityId);
      const schema = ComponentSchemas[m.component];
      const prev = e.components[m.component];
      const raw = m.op === 'patch_component' ? deepMerge(prev ?? {}, m.value) : m.value;
      const result = schema.safeParse(raw);
      if (!result.success)
        throw new MutationError('INVALID', `${m.component} on ${e.id}: ${z.prettifyError(result.error)}`);
      (e.components as Record<string, unknown>)[m.component] = result.data;
      return [restoreComponent(e.id, m.component, prev)];
    }

    case 'remove_component': {
      const e = getWritable(ctx, m.entityId);
      const prev = e.components[m.component];
      if (prev === undefined) return [];
      delete e.components[m.component];
      return [restoreComponent(e.id, m.component, prev)];
    }

    case 'set_flags': {
      const e = getWritable(ctx, m.entityId);
      const prev: Mutation = { op: 'set_flags', entityId: e.id };
      if (m.visible !== undefined) (prev.visible = e.visible), (e.visible = m.visible);
      if (m.locked !== undefined) (prev.locked = e.locked), (e.locked = m.locked);
      if (m.tags !== undefined) (prev.tags = e.tags), (e.tags = m.tags);
      return [prev];
    }

    case 'set_environment': {
      const prev: Record<string, unknown> = {};
      const env = scene.environment as Record<string, unknown>;
      for (const [k, v] of Object.entries(m.patch)) {
        if (v === undefined) continue;
        prev[k] = env[k];
        env[k] = v;
      }
      return [{ op: 'set_environment', patch: prev }];
    }

    case 'upsert_def': {
      const schema = DefSchemas[m.table];
      const parsed = schema.safeParse(m.def);
      if (!parsed.success) throw new MutationError('INVALID', `${m.table} definition: ${z.prettifyError(parsed.error)}`);
      const list = scene.database[m.table] as Array<{ id: string }>;
      const def = parsed.data as { id: string };
      const i = list.findIndex((d) => d.id === def.id);
      const prev = i >= 0 ? clone(list[i]!) : undefined;
      if (i >= 0) list[i] = def;
      else list.push(def);
      return [
        prev
          ? { op: 'upsert_def', table: m.table, def: prev as unknown as Record<string, unknown> }
          : { op: 'remove_def', table: m.table, id: def.id },
      ];
    }

    case 'remove_def': {
      const list = scene.database[m.table] as Array<{ id: string }>;
      const i = list.findIndex((d) => d.id === m.id);
      if (i < 0) throw new MutationError('NOT_FOUND', `no ${m.table} definition "${m.id}"`);
      const [prev] = list.splice(i, 1);
      return [{ op: 'upsert_def', table: m.table, def: prev as unknown as Record<string, unknown> }];
    }

    case 'set_database': {
      const prev = { progression: clone(scene.database.progression), loadout: clone(scene.database.loadout) };
      const next = GameDatabase.safeParse({
        ...scene.database,
        progression: deepMerge(prev.progression, m.patch.progression ?? {}),
        loadout: deepMerge(prev.loadout, m.patch.loadout ?? {}),
      });
      if (!next.success) throw new MutationError('INVALID', `database: ${z.prettifyError(next.error)}`);
      scene.database = next.data;
      return [{ op: 'set_database', patch: prev as unknown as { progression: Record<string, unknown>; loadout: Record<string, unknown> } }];
    }

    case 'set_game': {
      const prev = clone(scene.game);
      const result = GameSettings.safeParse(deepMerge(prev, m.patch));
      if (!result.success) throw new MutationError('INVALID', `game settings: ${z.prettifyError(result.error)}`);
      scene.game = result.data;
      // Merging the full previous value back restores it exactly (arrays are replaced).
      return [{ op: 'set_game', patch: prev as unknown as Record<string, unknown> }];
    }
  }
}

function restoreComponent(entityId: EntityId, component: ComponentName, prev: unknown): Mutation {
  return prev === undefined
    ? { op: 'remove_component', entityId, component }
    : { op: 'set_component', entityId, component, value: clone(prev) as Record<string, unknown> };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return clone(patch);
  const out: Record<string, unknown> = clone(base);
  for (const [k, v] of Object.entries(patch)) out[k] = k in out ? deepMerge(out[k], v) : clone(v);
  return out;
}
