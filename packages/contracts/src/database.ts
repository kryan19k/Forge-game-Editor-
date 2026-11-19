import { z } from 'zod';

/**
 * The Game Database — typed, data-driven gameplay definitions that the simulation
 * executes. This is FORGE's "gameplay framework": stats, modifiers, abilities,
 * status effects, progression trees, items and loot. Agents author it through
 * `upsert_def` / `remove_def` transactions; it is deterministic, so it works in
 * headless playtests and authoritative multiplayer unchanged.
 */

const Id = z.string().regex(/^[a-z0-9_]{1,48}$/, 'ids are lowercase_snake');

/* ── Stats & modifiers ─────────────────────────────────────────────────── */

export const StatDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  base: z.number().default(0),
  min: z.number().default(0),
  max: z.number().optional(),
  /** Resources (health, mana, stamina) have a current value that is spent and regenerated, capped by the stat. */
  resource: z.boolean().default(false),
  /** Per-second regeneration of the resource's current value. */
  regen: z.number().default(0),
  /** Gain on each level-up. */
  perLevel: z.number().default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type StatDef = z.output<typeof StatDef>;

/** Layered, reversible: final = (base + Σadd) × (1 + Σmul), override wins. Never edits base. */
export const Modifier = z.object({
  stat: Id,
  op: z.enum(['add', 'mul', 'override']).default('add'),
  value: z.number(),
});
export type Modifier = z.output<typeof Modifier>;

/* ── Effects (what abilities, statuses and consumables DO) ─────────────── */

const Scaling = z.object({ stat: Id, factor: z.number() });

export const EffectSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('damage'), amount: z.number().min(0), scaling: Scaling.optional() }),
  z.object({ kind: z.literal('heal'), amount: z.number().min(0), scaling: Scaling.optional() }),
  z.object({ kind: z.literal('restore'), stat: Id, amount: z.number() }),
  z.object({ kind: z.literal('apply_status'), status: Id }),
  z.object({ kind: z.literal('knockback'), force: z.number() }),
  z.object({ kind: z.literal('grant_item'), item: Id, count: z.number().int().min(1).default(1) }),
]);
export type EffectSpec = z.output<typeof EffectSpec>;

export const StatusDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  duration: z.number().positive().max(3600),
  /** Applied for the duration (buffs/debuffs). */
  modifiers: z.array(Modifier).max(16).default([]),
  /** Effects applied every `tickEvery` seconds (poison, regen). */
  tick: z.array(EffectSpec).max(8).default([]),
  tickEvery: z.number().positive().default(1),
  maxStacks: z.number().int().min(1).max(99).default(1),
  /** Prevents acting (stun) / moving (root). */
  stun: z.boolean().default(false),
  root: z.boolean().default(false),
  harmful: z.boolean().default(true),
});
export type StatusDef = z.output<typeof StatusDef>;

/* ── Abilities ─────────────────────────────────────────────────────────── */

export const AbilityDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  description: z.string().max(240).default(''),
  /**
   * self: affects the caster · melee: arc in front · ray: first target along aim (instant projectile)
   * aoe: everything within `radius` of the caster
   */
  target: z.enum(['self', 'melee', 'ray', 'aoe']),
  range: z.number().min(0).max(100).default(2),
  radius: z.number().min(0).max(50).default(0),
  /** Arc half-angle for melee, degrees. */
  arc: z.number().min(5).max(180).default(70),
  windup: z.number().min(0).max(5).default(0.15),
  cooldown: z.number().min(0).max(600).default(1),
  cost: z.array(z.object({ stat: Id, amount: z.number().positive() })).max(4).default([]),
  effects: z.array(EffectSpec).min(1).max(12),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ff6a2b'),
});
export type AbilityDef = z.output<typeof AbilityDef>;

/* ── Progression trees (skill trees, talent trees, tech trees) ─────────── */

export const TreeNode = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  description: z.string().max(240).default(''),
  cost: z.number().int().min(0).max(99).default(1),
  requires: z.array(Id).max(8).default([]),
  requiresLevel: z.number().int().min(1).max(999).default(1),
  /** Ranks a node can be bought (each rank re-applies `modifiers`). */
  ranks: z.number().int().min(1).max(10).default(1),
  grants: z
    .object({
      modifiers: z.array(Modifier).max(8).default([]),
      abilities: z.array(Id).max(4).default([]),
    })
    .default({ modifiers: [], abilities: [] }),
  /** Layout position on the tree canvas (grid units). */
  pos: z.tuple([z.number(), z.number()]).default([0, 0]),
});
export type TreeNode = z.output<typeof TreeNode>;

export const TreeDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  /** What pays for nodes: skill points from levelling, or an item/currency id. */
  currency: z.enum(['skill_points', 'item']).default('skill_points'),
  currencyItem: Id.optional(),
  nodes: z.array(TreeNode).min(1).max(128),
});
export type TreeDef = z.output<typeof TreeDef>;

/* ── Items & loot ──────────────────────────────────────────────────────── */

export const ItemDef = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  kind: z.enum(['material', 'consumable', 'equipment', 'quest', 'currency']).default('material'),
  stack: z.number().int().min(1).max(9999).default(99),
  slot: z.enum(['weapon', 'offhand', 'head', 'body', 'legs', 'trinket']).optional(),
  /** Equipment: applied while equipped. */
  modifiers: z.array(Modifier).max(8).default([]),
  /** Consumables: effects on use. */
  use: z.array(EffectSpec).max(8).default([]),
  grantsAbility: Id.optional(),
  value: z.number().min(0).default(0),
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']).default('common'),
});
export type ItemDef = z.output<typeof ItemDef>;

export const LootTable = z.object({
  id: Id,
  rolls: z.number().int().min(1).max(10).default(1),
  /** weight 0 entries never drop; "nothing" is modeled with a weighted empty entry (item omitted). */
  entries: z
    .array(z.object({ item: Id.optional(), weight: z.number().min(0), min: z.number().int().min(1).default(1), max: z.number().int().min(1).default(1) }))
    .min(1)
    .max(32),
});
export type LootTable = z.output<typeof LootTable>;

/* ── Progression ───────────────────────────────────────────────────────── */

export const Progression = z.object({
  enabled: z.boolean().default(false),
  /** XP to reach level L+1 = base × growth^(L−1). */
  xpBase: z.number().positive().default(100),
  xpGrowth: z.number().min(1).max(3).default(1.35),
  maxLevel: z.number().int().min(1).max(999).default(30),
  pointsPerLevel: z.number().int().min(0).max(10).default(1),
  /** XP for defeating an NPC without an explicit `unit.xp`. */
  defaultKillXp: z.number().min(0).default(20),
});

/** Ability slots on the player's bar, keys 1–6. */
export const Loadout = z.object({
  abilities: z.array(Id).max(6).default([]),
  /** Starting inventory: [itemId, count]. */
  items: z.array(z.tuple([Id, z.number().int().min(1)])).max(32).default([]),
  /** Trees available to the player. */
  trees: z.array(Id).max(8).default([]),
});

export const GameDatabase = z.object({
  stats: z.array(StatDef).max(64).default([]),
  abilities: z.array(AbilityDef).max(256).default([]),
  statuses: z.array(StatusDef).max(128).default([]),
  trees: z.array(TreeDef).max(16).default([]),
  items: z.array(ItemDef).max(512).default([]),
  loot: z.array(LootTable).max(128).default([]),
  progression: Progression.default(() => Progression.parse({})),
  loadout: Loadout.default(() => Loadout.parse({})),
});
export type GameDatabase = z.output<typeof GameDatabase>;

/** Tables that hold id-keyed definitions (targets of upsert_def / remove_def). */
export const DefTable = z.enum(['stats', 'abilities', 'statuses', 'trees', 'items', 'loot']);
export type DefTable = z.infer<typeof DefTable>;
export const DefSchemas = { stats: StatDef, abilities: AbilityDef, statuses: StatusDef, trees: TreeDef, items: ItemDef, loot: LootTable } as const;

/** Per-entity gameplay profile for NPCs: stat overrides, abilities, loot, XP reward. */
export const UnitComponent = z.object({
  stats: z.record(Id, z.number()).default({}),
  abilities: z.array(Id).max(6).default([]),
  loot: Id.optional(),
  xp: z.number().min(0).optional(),
  level: z.number().int().min(1).max(999).default(1),
});
