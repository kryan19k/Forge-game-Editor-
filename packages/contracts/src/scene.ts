import { z } from 'zod';
import { Components } from './components';
import { Color, EntityId, Vec3 } from './primitives';
import { GameDatabase } from './database';

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

export const Environment = z.object({
  background: Color.default('#0b0c0e'),
  fogColor: Color.default('#0b0c0e'),
  /** Exponential fog density; 0 disables fog. */
  fogDensity: z.number().min(0).max(1).default(0.015),
  exposure: z.number().min(0).max(8).default(1),
  toneMapping: z.enum(['agx', 'aces', 'neutral', 'none']).default('agx'),
});
export type Environment = z.output<typeof Environment>;

/* ── Game settings: genre, controller, rules, quests ───────────────────── */

export const Genre = z.enum(['exploration', 'rpg', 'mmorpg', 'fighting', 'racing', 'sandbox']);
export type Genre = z.infer<typeof Genre>;

/** Data-driven quest step. Objectives activate in order; each must complete before the next. */
export const Objective = z.object({
  id: z.string().min(1).max(48),
  label: z.string().min(1).max(120),
  /**
   * interact: use/talk to entity `target` · collect: hold `count` of item `target`
   * defeat: defeat `count` NPCs matching `target` (entity id or #tag) · reach: enter trigger entity `target`
   */
  kind: z.enum(['interact', 'collect', 'defeat', 'reach']),
  target: z.string().min(1).max(64),
  count: z.number().int().min(1).max(999).default(1),
});
export type Objective = z.output<typeof Objective>;

export const GameSettings = z.object({
  genre: Genre.default('exploration'),
  /** How the player moves: on foot, in a car, or as a 2.5D fighter locked to the arena axis. */
  controller: z.enum(['character', 'vehicle', 'fighter']).default('character'),
  camera: z.enum(['third_person', 'chase', 'side']).default('third_person'),
  /** objectives: finish all objectives · race: finish `laps` first · ko: win the majority of `rounds` · none: persistent world. */
  win: z.enum(['objectives', 'race', 'ko', 'none']).default('objectives'),
  maxPlayers: z.number().int().min(1).max(64).default(1),
  /** AI-controlled opponents using the player controller (rival racers, sparring fighter). */
  bots: z.number().int().min(0).max(15).default(0),
  laps: z.number().int().min(1).max(20).default(3),
  rounds: z.number().int().min(1).max(9).default(3),
  pvp: z.boolean().default(false),
  respawnSeconds: z.number().min(0).max(60).default(3),
  /** Seed for all simulation randomness — same seed, same game. */
  seed: z.number().int().default(1),
  player: z
    .object({
      health: z.number().positive().max(100000).default(100),
      damage: z.number().min(0).max(10000).default(12),
      attackRange: z.number().positive().max(20).default(1.9),
      attackCooldown: z.number().positive().max(10).default(0.45),
      walkSpeed: z.number().positive().max(40).default(4.2),
      sprintSpeed: z.number().positive().max(60).default(7),
      jump: z.number().min(0).max(40).default(7.2),
      /** Ability cast by the attack button (click / J) instead of the default melee swing, e.g. a rifle or firebolt. */
      primaryAbility: z.string().optional(),
      /** Ability cast by heavy attack (right-click / K). */
      secondaryAbility: z.string().optional(),
    })
    .default(() => ({ health: 100, damage: 12, attackRange: 1.9, attackCooldown: 0.45, walkSpeed: 4.2, sprintSpeed: 7, jump: 7.2 })),
  vehicle: z
    .object({
      maxSpeed: z.number().positive().max(150).default(34),
      acceleration: z.number().positive().max(200).default(16),
      braking: z.number().positive().max(300).default(28),
      turnRate: z.number().positive().max(10).default(2.1),
    })
    .default(() => ({ maxSpeed: 34, acceleration: 16, braking: 28, turnRate: 2.1 })),
  objectives: z.array(Objective).max(32).default([]),
});
export type GameSettings = z.output<typeof GameSettings>;

export const SceneDoc = z.object({
  schemaVersion: z.literal(1),
  sceneId: z.string().min(1),
  name: z.string().min(1).max(80),
  revision: z.number().int().min(0),
  environment: Environment.default(() => Environment.parse({})),
  game: GameSettings.default(() => GameSettings.parse({})),
  /** Gameplay framework definitions: stats, abilities, statuses, trees, items, loot, progression. */
  database: GameDatabase.default(() => GameDatabase.parse({})),
  /** Insertion order is the sibling order. */
  entities: z.record(EntityId, Entity),
});
export type SceneDoc = z.output<typeof SceneDoc>;
