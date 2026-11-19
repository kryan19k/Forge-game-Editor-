import { z } from 'zod';
import { ComponentName } from './components';
import { Author } from './mutations';
import { EntityId, Vec3 } from './primitives';

const EntityRef = z.object({ id: EntityId, name: z.string() });
const change = { entity: EntityRef };

export const SceneChange = z.discriminatedUnion('kind', [
  z.object({ ...change, kind: z.literal('created'), position: Vec3, parent: EntityRef.nullable() }),
  z.object({ ...change, kind: z.literal('deleted') }),
  z.object({ ...change, kind: z.literal('renamed'), previousName: z.string() }),
  z.object({ ...change, kind: z.literal('reparented'), parent: EntityRef.nullable(), previousParent: EntityRef.nullable() }),
  z.object({ ...change, kind: z.literal('component_added'), component: ComponentName }),
  z.object({ ...change, kind: z.literal('component_removed'), component: ComponentName }),
]);
export type SceneChange = z.infer<typeof SceneChange>;

export const SceneActivity = z.object({
  revision: z.number().int().nonnegative(),
  txId: z.string(),
  author: Author,
  at: z.number(),
  changes: z.array(SceneChange).min(1),
});
export type SceneActivity = z.infer<typeof SceneActivity>;

export const ActivityCursor = z.number().int().nonnegative();

export const ActivitySettings = z.object({ autoReact: z.boolean().default(false) });
export type ActivitySettings = z.infer<typeof ActivitySettings>;

export interface ActivityPage {
  projectId: string;
  cursor: number;
  hasMore: boolean;
  truncated: boolean;
  settings: ActivitySettings;
  activity: SceneActivity[];
}
