import type { AbilityDef, EffectSpec, GameDatabase, ItemDef, Modifier, StatDef, StatusDef, TreeDef } from '@forge/contracts';

/**
 * Gameplay framework runtime: per-actor stat blocks, resources, abilities,
 * statuses, progression, trees, equipment. Pure data + arithmetic — the
 * simulation supplies targeting and damage delivery through GameplayHost.
 *
 * Well-known stats the runtime reads (all optional; any other stat is custom and
 * usable in ability scaling):
 *   health (resource, drives HP) · mana/stamina/… (any resource) · armor (dmg × 100/(100+armor))
 *   power (+% outgoing damage) · move_speed (% of base, 100 = normal) · crit_chance (0–100, ×1.5)
 *   cooldown_reduction (0–60 %)
 */

export type Command =
  | { kind: 'unlock'; tree: string; node: string }
  | { kind: 'equip'; item: string }
  | { kind: 'unequip'; slot: string }
  | { kind: 'use'; item: string }
  | { kind: 'slot'; index: number; ability: string | null };

export interface Kit {
  base: Map<string, number>;
  mods: Array<{ source: string; mod: Modifier }>;
  current: Map<string, number>;
  abilities: string[]; // known
  bar: Array<string | null>; // slots 1..6
  cooldowns: Map<string, number>;
  cooldownMax: Map<string, number>;
  statuses: Array<{ def: StatusDef; remaining: number; stacks: number; nextTick: number; source: string }>;
  level: number;
  xp: number;
  points: number;
  ranks: Map<string, number>; // `${tree}/${node}` → rank
  equipment: Map<string, string>; // slot → item id
  casting: { ability: AbilityDef; t: number } | null;
}

export class Gameplay {
  readonly stats: Map<string, StatDef>;
  readonly abilities: Map<string, AbilityDef>;
  readonly statuses: Map<string, StatusDef>;
  readonly trees: Map<string, TreeDef>;
  readonly items: Map<string, ItemDef>;
  /** True when the project uses the framework at all (HUD shows kit UI only then). */
  readonly active: boolean;

  constructor(readonly db: GameDatabase) {
    this.stats = new Map(db.stats.map((s) => [s.id, s]));
    this.abilities = new Map(db.abilities.map((a) => [a.id, a]));
    this.statuses = new Map(db.statuses.map((s) => [s.id, s]));
    this.trees = new Map(db.trees.map((t) => [t.id, t]));
    this.items = new Map(db.items.map((i) => [i.id, i]));
    this.active = db.stats.length > 0 || db.abilities.length > 0 || db.progression.enabled || db.trees.length > 0;
  }

  createKit(overrides: Record<string, number> = {}, abilities: string[] = [], level = 1): Kit {
    const kit: Kit = {
      base: new Map(),
      mods: [],
      current: new Map(),
      abilities: [],
      bar: [null, null, null, null, null, null],
      cooldowns: new Map(),
      cooldownMax: new Map(),
      statuses: [],
      level: 1,
      xp: 0,
      points: 0,
      ranks: new Map(),
      equipment: new Map(),
      casting: null,
    };
    for (const s of this.stats.values()) kit.base.set(s.id, overrides[s.id] ?? s.base);
    for (const [k, v] of Object.entries(overrides)) if (!kit.base.has(k)) kit.base.set(k, v);
    for (const a of abilities) this.learn(kit, a);
    for (let l = 1; l < level; l++) this.applyLevel(kit);
    this.refill(kit);
    return kit;
  }

  /* ── stats ─────────────────────────────────────────────────────────── */

  get(kit: Kit, stat: string): number {
    const def = this.stats.get(stat);
    let add = 0;
    let mul = 0;
    let override: number | undefined;
    for (const { mod } of kit.mods) {
      if (mod.stat !== stat) continue;
      if (mod.op === 'add') add += mod.value;
      else if (mod.op === 'mul') mul += mod.value;
      else override = mod.value;
    }
    for (const s of kit.statuses) for (const m of s.def.modifiers) if (m.stat === stat) {
      if (m.op === 'add') add += m.value * s.stacks;
      else if (m.op === 'mul') mul += m.value * s.stacks;
      else override = m.value;
    }
    let v = override ?? ((kit.base.get(stat) ?? def?.base ?? 0) + add) * (1 + mul);
    if (def) v = Math.max(def.min, def.max === undefined ? v : Math.min(def.max, v));
    return v;
  }

  has(stat: string): boolean {
    return this.stats.has(stat);
  }

  resources(): StatDef[] {
    return [...this.stats.values()].filter((s) => s.resource);
  }

  refill(kit: Kit): void {
    for (const r of this.resources()) kit.current.set(r.id, this.get(kit, r.id));
  }

  /* ── per-tick ──────────────────────────────────────────────────────── */

  /** Regen, cooldowns, status durations. Returns status tick effects to deliver. */
  tick(kit: Kit, dt: number): Array<{ effect: EffectSpec; status: StatusDef; source: string }> {
    for (const r of this.resources()) {
      if (r.id === 'health') continue; // HP regen is applied by the host on the actor
      const max = this.get(kit, r.id);
      const cur = kit.current.get(r.id) ?? max;
      kit.current.set(r.id, Math.min(max, Math.max(0, cur + r.regen * dt)));
    }
    for (const [id, cd] of kit.cooldowns) kit.cooldowns.set(id, Math.max(0, cd - dt));
    const out: Array<{ effect: EffectSpec; status: StatusDef; source: string }> = [];
    for (const s of kit.statuses) {
      s.remaining -= dt;
      if (s.def.tick.length) {
        s.nextTick -= dt;
        if (s.nextTick <= 0) {
          s.nextTick += s.def.tickEvery;
          for (let i = 0; i < s.stacks; i++) for (const effect of s.def.tick) out.push({ effect, status: s.def, source: s.source });
        }
      }
    }
    kit.statuses = kit.statuses.filter((s) => s.remaining > 0);
    return out;
  }

  stunned(kit: Kit): boolean {
    return kit.statuses.some((s) => s.def.stun);
  }

  rooted(kit: Kit): boolean {
    return kit.statuses.some((s) => s.def.stun || s.def.root);
  }

  applyStatus(kit: Kit, statusId: string, source: string): StatusDef | null {
    const def = this.statuses.get(statusId);
    if (!def) return null;
    const existing = kit.statuses.find((s) => s.def.id === def.id);
    if (existing) {
      existing.remaining = def.duration;
      existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
    } else kit.statuses.push({ def, remaining: def.duration, stacks: 1, nextTick: def.tickEvery, source });
    return def;
  }

  /* ── abilities ─────────────────────────────────────────────────────── */

  learn(kit: Kit, abilityId: string): boolean {
    if (!this.abilities.has(abilityId) || kit.abilities.includes(abilityId)) return false;
    kit.abilities.push(abilityId);
    const free = kit.bar.indexOf(null);
    if (free >= 0) kit.bar[free] = abilityId;
    return true;
  }

  /** Why an ability can't be cast right now, or null if it can. */
  blocked(kit: Kit, abilityId: string): string | null {
    const a = this.abilities.get(abilityId);
    if (!a) return 'unknown ability';
    if (!kit.abilities.includes(abilityId)) return 'not learned';
    if (kit.casting) return 'already casting';
    if (this.stunned(kit)) return 'stunned';
    if ((kit.cooldowns.get(abilityId) ?? 0) > 0) return 'on cooldown';
    for (const c of a.cost) if ((kit.current.get(c.stat) ?? 0) < c.amount) return `not enough ${this.stats.get(c.stat)?.name ?? c.stat}`;
    return null;
  }

  beginCast(kit: Kit, abilityId: string): AbilityDef | null {
    if (this.blocked(kit, abilityId)) return null;
    const a = this.abilities.get(abilityId)!;
    for (const c of a.cost) kit.current.set(c.stat, (kit.current.get(c.stat) ?? 0) - c.amount);
    const cdr = Math.min(60, Math.max(0, this.get(kit, 'cooldown_reduction')));
    const cd = a.cooldown * (1 - cdr / 100);
    kit.cooldowns.set(a.id, cd);
    kit.cooldownMax.set(a.id, cd);
    kit.casting = { ability: a, t: 0 };
    return a;
  }

  /* ── outgoing / incoming damage ────────────────────────────────────── */

  scaled(kit: Kit | null, base: number, scaling?: { stat: string; factor: number }): number {
    if (!kit) return base;
    return base + (scaling ? this.get(kit, scaling.stat) * scaling.factor : 0);
  }

  outgoing(kit: Kit | null, amount: number, roll: number): { amount: number; crit: boolean } {
    if (!kit) return { amount, crit: false };
    const power = this.has('power') ? this.get(kit, 'power') : 0;
    const crit = this.has('crit_chance') && roll * 100 < this.get(kit, 'crit_chance');
    return { amount: amount * (1 + power / 100) * (crit ? 1.5 : 1), crit };
  }

  incoming(kit: Kit | null, amount: number): number {
    if (!kit || !this.has('armor')) return amount;
    const armor = Math.max(0, this.get(kit, 'armor'));
    return amount * (100 / (100 + armor));
  }

  moveScale(kit: Kit | null): number {
    if (!kit || !this.has('move_speed')) return 1;
    return Math.max(0.1, this.get(kit, 'move_speed') / 100);
  }

  /* ── progression ───────────────────────────────────────────────────── */

  xpToNext(level: number): number {
    const p = this.db.progression;
    return Math.round(p.xpBase * Math.pow(p.xpGrowth, level - 1));
  }

  private applyLevel(kit: Kit): void {
    kit.level++;
    kit.points += this.db.progression.pointsPerLevel;
    for (const s of this.stats.values()) if (s.perLevel) kit.mods.push({ source: `level:${kit.level}`, mod: { stat: s.id, op: 'add', value: s.perLevel } });
  }

  /** Returns how many levels were gained. */
  gainXp(kit: Kit, xp: number): number {
    const p = this.db.progression;
    if (!p.enabled || kit.level >= p.maxLevel) return 0;
    kit.xp += xp;
    let gained = 0;
    while (kit.level < p.maxLevel && kit.xp >= this.xpToNext(kit.level)) {
      kit.xp -= this.xpToNext(kit.level);
      this.applyLevel(kit);
      gained++;
    }
    if (gained) this.refill(kit);
    return gained;
  }

  /* ── trees ─────────────────────────────────────────────────────────── */

  nodeState(kit: Kit, tree: TreeDef, nodeId: string, inventoryCount: (item: string) => number): { rank: number; why: string | null } {
    const node = tree.nodes.find((n) => n.id === nodeId);
    if (!node) return { rank: 0, why: 'unknown node' };
    const rank = kit.ranks.get(`${tree.id}/${node.id}`) ?? 0;
    if (rank >= node.ranks) return { rank, why: 'maxed' };
    if (kit.level < node.requiresLevel) return { rank, why: `requires level ${node.requiresLevel}` };
    for (const r of node.requires) if (!kit.ranks.get(`${tree.id}/${r}`)) return { rank, why: `requires ${tree.nodes.find((n) => n.id === r)?.name ?? r}` };
    const have = tree.currency === 'item' ? inventoryCount(tree.currencyItem ?? '') : kit.points;
    if (have < node.cost) return { rank, why: tree.currency === 'item' ? `needs ${node.cost} ${tree.currencyItem}` : `needs ${node.cost} point${node.cost === 1 ? '' : 's'}` };
    return { rank, why: null };
  }

  unlock(kit: Kit, treeId: string, nodeId: string, inventoryCount: (item: string) => number, spendItem: (item: string, n: number) => void): string | null {
    const tree = this.trees.get(treeId);
    if (!tree) return 'unknown tree';
    const { why } = this.nodeState(kit, tree, nodeId, inventoryCount);
    if (why) return why;
    const node = tree.nodes.find((n) => n.id === nodeId)!;
    if (tree.currency === 'item') spendItem(tree.currencyItem ?? '', node.cost);
    else kit.points -= node.cost;
    const key = `${tree.id}/${node.id}`;
    kit.ranks.set(key, (kit.ranks.get(key) ?? 0) + 1);
    for (const mod of node.grants.modifiers) kit.mods.push({ source: `tree:${key}`, mod });
    for (const a of node.grants.abilities) this.learn(kit, a);
    // Keep current resources sensible when max values grew.
    for (const r of this.resources()) if (r.id !== 'health') kit.current.set(r.id, Math.min(this.get(kit, r.id), (kit.current.get(r.id) ?? 0) + 0));
    return null;
  }

  /* ── equipment ─────────────────────────────────────────────────────── */

  equip(kit: Kit, itemId: string): string | null {
    const item = this.items.get(itemId);
    if (!item) return 'unknown item';
    if (item.kind !== 'equipment' || !item.slot) return `${item.name} can't be equipped`;
    this.unequip(kit, item.slot);
    kit.equipment.set(item.slot, item.id);
    for (const mod of item.modifiers) kit.mods.push({ source: `equip:${item.slot}`, mod });
    if (item.grantsAbility) this.learn(kit, item.grantsAbility);
    return null;
  }

  unequip(kit: Kit, slot: string): void {
    const prev = kit.equipment.get(slot);
    if (!prev) return;
    kit.equipment.delete(slot);
    kit.mods = kit.mods.filter((m) => m.source !== `equip:${slot}`);
    const granted = this.items.get(prev)?.grantsAbility;
    if (granted && ![...kit.equipment.values()].some((i) => this.items.get(i)?.grantsAbility === granted)) {
      kit.abilities = kit.abilities.filter((a) => a !== granted);
      kit.bar = kit.bar.map((b) => (b === granted ? null : b));
    }
  }
}

/** Roll a loot table deterministically with the sim's RNG. */
export function rollLoot(db: GameDatabase, tableId: string, random: () => number): Array<[string, number]> {
  const table = db.loot.find((t) => t.id === tableId);
  if (!table) return [];
  const total = table.entries.reduce((s, e) => s + e.weight, 0);
  const out = new Map<string, number>();
  for (let r = 0; r < table.rolls && total > 0; r++) {
    let pick = random() * total;
    for (const e of table.entries) {
      pick -= e.weight;
      if (pick > 0) continue;
      if (e.item) out.set(e.item, (out.get(e.item) ?? 0) + e.min + Math.floor(random() * (e.max - e.min + 1)));
      break;
    }
  }
  return [...out];
}

/** Advisory lint: dangling references across the database (does not block edits). */
export function lintDatabase(db: GameDatabase): string[] {
  const ids = {
    stats: new Set(db.stats.map((s) => s.id)),
    abilities: new Set(db.abilities.map((a) => a.id)),
    statuses: new Set(db.statuses.map((s) => s.id)),
    items: new Set(db.items.map((i) => i.id)),
    trees: new Set(db.trees.map((t) => t.id)),
    loot: new Set(db.loot.map((l) => l.id)),
  };
  const out: string[] = [];
  const effects = (where: string, list: EffectSpec[]) => {
    for (const e of list) {
      if (e.kind === 'apply_status' && !ids.statuses.has(e.status)) out.push(`${where}: unknown status "${e.status}"`);
      if (e.kind === 'restore' && !ids.stats.has(e.stat)) out.push(`${where}: unknown stat "${e.stat}"`);
      if (e.kind === 'grant_item' && !ids.items.has(e.item)) out.push(`${where}: unknown item "${e.item}"`);
      if ((e.kind === 'damage' || e.kind === 'heal') && e.scaling && !ids.stats.has(e.scaling.stat)) out.push(`${where}: unknown scaling stat "${e.scaling.stat}"`);
    }
  };
  for (const a of db.abilities) {
    effects(`ability ${a.id}`, a.effects);
    for (const c of a.cost) if (!ids.stats.has(c.stat)) out.push(`ability ${a.id}: cost uses unknown stat "${c.stat}"`);
  }
  for (const s of db.statuses) effects(`status ${s.id}`, s.tick);
  for (const i of db.items) {
    effects(`item ${i.id}`, i.use);
    if (i.grantsAbility && !ids.abilities.has(i.grantsAbility)) out.push(`item ${i.id}: unknown ability "${i.grantsAbility}"`);
  }
  for (const t of db.trees) {
    const nodes = new Set(t.nodes.map((n) => n.id));
    for (const n of t.nodes) {
      for (const r of n.requires) if (!nodes.has(r)) out.push(`tree ${t.id}/${n.id}: requires unknown node "${r}"`);
      for (const a of n.grants.abilities) if (!ids.abilities.has(a)) out.push(`tree ${t.id}/${n.id}: grants unknown ability "${a}"`);
      for (const m of n.grants.modifiers) if (!ids.stats.has(m.stat)) out.push(`tree ${t.id}/${n.id}: modifies unknown stat "${m.stat}"`);
    }
    if (t.currency === 'item' && (!t.currencyItem || !ids.items.has(t.currencyItem))) out.push(`tree ${t.id}: currency item missing`);
    // Soft-lock check: every node must be reachable from a root.
    const reach = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of t.nodes) if (!reach.has(n.id) && n.requires.every((r) => reach.has(r))) (reach.add(n.id), (grew = true));
    }
    for (const n of t.nodes) if (!reach.has(n.id)) out.push(`tree ${t.id}/${n.id}: unreachable (circular or missing prerequisites)`);
  }
  for (const l of db.loot) for (const e of l.entries) if (e.item && !ids.items.has(e.item)) out.push(`loot ${l.id}: unknown item "${e.item}"`);
  for (const a of db.loadout.abilities) if (!ids.abilities.has(a)) out.push(`loadout: unknown ability "${a}"`);
  for (const [i] of db.loadout.items) if (!ids.items.has(i)) out.push(`loadout: unknown item "${i}"`);
  for (const t of db.loadout.trees) if (!ids.trees.has(t)) out.push(`loadout: unknown tree "${t}"`);
  return out;
}
