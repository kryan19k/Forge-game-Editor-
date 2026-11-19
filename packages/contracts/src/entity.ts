import { z } from 'zod';
import { Components } from './components';
import { EntityId, Vec3 } from './primitives';

export const Transform = z.object({
  position: Vec3.default([0, 0, 0]),
  /** Euler XYZ, degrees. */
  rotation: Vec3.default([0, 0, 0]),
  scale: Vec3.default([1, 1, 1]),
});
export type Transform = z.output<typeof Transform>;

export const Entity = z.object({
  id: EntityId,
  name: z.string().trim().min(1).max(80),
  parentId: EntityId.nullable().default(null),
  transform: Transform.default(() => Transform.parse({})),
  components: Components.default({}),
  tags: z.array(z.string().min(1).max(32)).max(32).default([]),
  visible: z.boolean().default(true),
  /** Locked entities cannot be modified by agents — human-protected work. */
  locked: z.boolean().default(false),
  /** Revision at which this entity last changed. Maintained by the reducer. */
  rev: z.number().int().min(0).default(0),
});
export type Entity = z.output<typeof Entity>;
export type EntityInput = z.input<typeof Entity>;
