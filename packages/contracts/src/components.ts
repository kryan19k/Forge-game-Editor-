import { z } from 'zod';
import { Color, DatabaseId, Vec3 } from './primitives';
import { AssetId } from './assets';

/**
 * Components are a closed, typed set. Agents and humans may only attach
 * components the runtime understands — no free-form blobs in a scene.
 */

export const Shape = z.enum(['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus', 'plane']);

/** Per-entity gameplay profile for NPCs. */
export const UnitComponent = z.object({
  stats: z.record(DatabaseId, z.number()).default({}),
  abilities: z.array(DatabaseId).max(6).default([]),
  loot: DatabaseId.optional(),
  xp: z.number().min(0).optional(),
  level: z.number().int().min(1).max(999).default(1),
});
export type Shape = z.infer<typeof Shape>;

export const Material = z.object({
  color: Color.default('#b8b2a7'),
  roughness: z.number().min(0).max(1).default(0.75),
  metalness: z.number().min(0).max(1).default(0),
  emissive: Color.default('#000000'),
  emissiveIntensity: z.number().min(0).max(100).default(0),
  opacity: z.number().min(0).max(1).default(1),
});
export type Material = z.output<typeof Material>;

const MeshBase = z.object({
  /** Scales unit primitives or a GLB normalized to one meter on its longest axis. */
  size: Vec3.default([1, 1, 1]),
  material: Material.default(() => Material.parse({})),
  castShadow: z.boolean().default(true),
  receiveShadow: z.boolean().default(true),
});
export const MeshComponent = z.union([
  MeshBase.extend({ shape: z.literal('box').default('box'), asset: AssetId }),
  MeshBase.extend({ shape: Shape, asset: z.never().optional() }),
]);

export const LightComponent = z.object({
  kind: z.enum(['directional', 'point', 'spot', 'hemisphere']),
  color: Color.default('#ffffff'),
  /** Sky→ground tint for hemisphere lights. */
  groundColor: Color.default('#202020'),
  intensity: z.number().min(0).max(10000).default(1),
  /** Falloff distance for point/spot lights; 0 = infinite. */
  range: z.number().min(0).default(0),
  /** Cone angle in degrees for spot lights. */
  angle: z.number().min(1).max(89).default(35),
  castShadow: z.boolean().default(false),
});

export const ColliderComponent = z.object({
  shape: z.enum(['auto', 'box', 'sphere', 'capsule']).default('auto'),
  /** Overrides mesh size when set. */
  size: Vec3.optional(),
  isTrigger: z.boolean().default(false),
  layer: z.enum(['world', 'player', 'enemy', 'interact', 'trigger']).default('world'),
});

export const RigidBodyComponent = z.object({
  kind: z.enum(['static', 'dynamic', 'kinematic']).default('static'),
  mass: z.number().positive().default(1),
  gravityScale: z.number().default(1),
});

export const SpawnPointComponent = z.object({
  team: z.string().min(1).max(32).default('any'),
  priority: z.number().int().default(0),
});

export const InteractableComponent = z.object({
  verb: z.enum(['open', 'pickup', 'use', 'talk', 'inspect']),
  prompt: z.string().min(1).max(80),
  /** Item granted on pickup. */
  grantsItem: z.string().max(48).optional(),
  /** Item required to interact (e.g. a keycard). */
  requiresItem: z.string().max(48).optional(),
});

/** Multiplayer is first-class in the data model from day one. */
export const NetworkComponent = z.object({
  authority: z.enum(['server', 'owner', 'none']).default('server'),
  replicate: z.array(z.enum(['transform', 'components', 'state'])).default(['transform']),
  /** Relevancy radius in meters; 0 = always relevant. */
  relevancy: z.number().min(0).default(0),
});

/** Hit points for anything that can be damaged (NPCs; players use game.player.health). */
export const HealthComponent = z.object({
  max: z.number().positive().max(100000).default(100),
  /** HP regenerated per second. */
  regen: z.number().min(0).max(1000).default(0),
});

/** Melee attack capability for NPCs. */
export const CombatComponent = z.object({
  damage: z.number().min(0).max(10000).default(10),
  range: z.number().positive().max(20).default(1.6),
  cooldown: z.number().positive().max(30).default(1),
});

/** A simulated character driven by AI: villagers, monsters, vendors. Its mesh moves with it. */
export const NpcComponent = z.object({
  behavior: z.enum(['idle', 'wander', 'guard']).default('idle'),
  hostile: z.boolean().default(false),
  speed: z.number().positive().max(20).default(2.2),
  aggroRadius: z.number().min(0).max(100).default(8),
  wanderRadius: z.number().min(0).max(100).default(5),
  /** Seconds until a defeated NPC returns (MMO-style field spawns); 0 = never. */
  respawnSeconds: z.number().min(0).max(3600).default(0),
  /** Lines spoken when a player talks to this NPC, one per interaction. */
  dialogue: z.array(z.string().min(1).max(240)).max(24).default([]),
});

/** Race checkpoint (trigger volume). Order 0 is the start/finish line. */
export const CheckpointComponent = z.object({
  order: z.number().int().min(0).max(255),
});

export const ComponentSchemas = {
  mesh: MeshComponent,
  light: LightComponent,
  collider: ColliderComponent,
  rigidBody: RigidBodyComponent,
  spawnPoint: SpawnPointComponent,
  interactable: InteractableComponent,
  network: NetworkComponent,
  health: HealthComponent,
  combat: CombatComponent,
  npc: NpcComponent,
  checkpoint: CheckpointComponent,
  unit: UnitComponent,
} as const;

export const ComponentName = z.enum(
  Object.keys(ComponentSchemas) as [keyof typeof ComponentSchemas, ...(keyof typeof ComponentSchemas)[]],
);
export type ComponentName = z.infer<typeof ComponentName>;

export const Components = z
  .object({
    mesh: MeshComponent.optional(),
    light: LightComponent.optional(),
    collider: ColliderComponent.optional(),
    rigidBody: RigidBodyComponent.optional(),
    spawnPoint: SpawnPointComponent.optional(),
    interactable: InteractableComponent.optional(),
    network: NetworkComponent.optional(),
    health: HealthComponent.optional(),
    combat: CombatComponent.optional(),
    npc: NpcComponent.optional(),
    checkpoint: CheckpointComponent.optional(),
    unit: UnitComponent.optional(),
  })
  .strict();
export type Components = z.output<typeof Components>;
export type ComponentValue<N extends ComponentName> = NonNullable<Components[N]>;
