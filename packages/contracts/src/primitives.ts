import { z } from 'zod';

/**
 * Entity IDs are stable, human-readable and agent-choosable so a single
 * transaction can create a parent and its children (`ent_hub`, `ent_hub_door`).
 */
export const EntityId = z
  .string()
  .regex(/^ent_[a-z0-9_]{1,48}$/, 'entity ids look like ent_lowercase_words');
export type EntityId = z.infer<typeof EntityId>;

export const DatabaseId = z.string().regex(/^[a-z0-9_]{1,48}$/, 'ids are lowercase_snake');

/** Isomorphic (browser + Node 19+) without pulling DOM or Node typings into contracts. */
const uuid = (): string => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

export function newEntityId(hint = ''): EntityId {
  const slug = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  const rand = uuid().replace(/-/g, '').slice(0, 6);
  return `ent_${slug ? `${slug}_` : ''}${rand}`;
}

export function newId(prefix: string): string {
  return `${prefix}_${uuid().replace(/-/g, '').slice(0, 16)}`;
}

/** Meters, Y-up, right-handed (three.js convention). */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colors are #rrggbb');
export type Color = z.infer<typeof Color>;
