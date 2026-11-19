import { z } from 'zod';
import { EntityId, Vec3 } from './primitives';

/* ── Simulation events: the observable facts of a play session ─────────── */

export const SimEventType = z.enum([
  'spawn',
  'pickup',
  'interact',
  'interact_blocked',
  'door_open',
  'door_close',
  'objective_progress',
  'objective_complete',
  'all_objectives_complete',
  'trigger_enter',
  'trigger_exit',
  'fell_out_of_world',
  'dialogue',
  'hit',
  'blocked',
  'defeated',
  'npc_respawn',
  'player_down',
  'respawn',
  'checkpoint',
  'lap',
  'race_finished',
  'round_start',
  'round_end',
  'match_won',
  'match_lost',
  'player_joined',
  'player_left',
  'ability_cast',
  'heal',
  'status_applied',
  'level_up',
  'loot',
  'node_unlocked',
  'item_used',
  'equipped',
  'command_failed',
]);
export type SimEventType = z.infer<typeof SimEventType>;

export interface SimEvent {
  t: number;
  type: SimEventType;
  /** Actor (player/bot) that caused or received the event. */
  actorId?: string;
  entityId?: EntityId;
  detail?: string;
}

export interface SimFocus {
  entityId: EntityId;
  name: string;
  verb: string;
  prompt: string;
  /** Why the interaction would fail right now, e.g. "Requires keycard_alpha". */
  blocked?: string;
}

export type ActorKind = 'player' | 'bot' | 'npc';
export type ActorAnim = 'idle' | 'move' | 'attack' | 'block' | 'hit' | 'down';

/** Everything a renderer (local or networked) needs to draw one actor. */
export interface ActorView {
  id: string;
  kind: ActorKind;
  name: string;
  controller: 'character' | 'vehicle' | 'fighter';
  /** NPCs render their own entity; players/bots get an avatar or a car. */
  entityId?: EntityId;
  position: [number, number, number];
  yaw: number;
  speed: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  anim: ActorAnim;
  team: string;
  hostile: boolean;
}

export interface SimState {
  time: number;
  tick: number;
  /** The viewing player. */
  player: {
    id: string;
    position: [number, number, number];
    yaw: number;
    grounded: boolean;
    speed: number;
    health: number;
    maxHealth: number;
    alive: boolean;
    respawnIn: number;
  };
  inventory: string[];
  focus: SimFocus | null;
  objectives: Array<{ id: string; entityId?: EntityId; label: string; done: boolean; active: boolean; progress: number; count: number }>;
  doors: Array<{ entityId: EntityId; open: boolean }>;
  events: SimEvent[];
  actors: ActorView[];
  /** Last thing an NPC said to this player. */
  dialogue: { entityId: EntityId; speaker: string; line: string; index: number; total: number; at: number } | null;
  race: { phase: 'countdown' | 'racing' | 'finished'; countdown: number; lap: number; laps: number; checkpoint: number; checkpoints: number; place: number; racers: number; time: number; bestLap: number | null } | null;
  fight: { phase: 'intro' | 'fight' | 'ko' | 'over'; round: number; rounds: number; wins: Record<string, number>; timer: number; opponentId: string | null } | null;
  match: { result: 'won' | 'lost'; message: string } | null;
  /** Gameplay-framework view of the viewing player (null when the project doesn't use it). */
  kit: KitView | null;
}

export interface KitView {
  level: number;
  xp: number;
  xpNext: number;
  points: number;
  resources: Array<{ id: string; name: string; current: number; max: number; color?: string }>;
  stats: Array<{ id: string; name: string; value: number }>;
  bar: Array<{ slot: number; id: string; name: string; cooldown: number; cooldownMax: number; blocked: string | null; color: string } | null>;
  casting: { id: string; name: string; progress: number } | null;
  statuses: Array<{ id: string; name: string; remaining: number; stacks: number; harmful: boolean }>;
  trees: Array<{ id: string; name: string; currency: string; nodes: Array<{ id: string; name: string; description: string; rank: number; ranks: number; cost: number; requires: string[]; pos: [number, number]; why: string | null }> }>;
  items: Array<{ id: string; name: string; count: number; kind: string; rarity: string; equipped: boolean }>;
  equipment: Record<string, string>;
}

/* ── Playtest scripts: deterministic, headless, agent-authored ─────────── */

export const PlaytestCheck = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('has_item'), item: z.string().min(1), count: z.number().int().min(1).default(1) }),
  z.object({ kind: z.literal('lacks_item'), item: z.string().min(1) }),
  z.object({ kind: z.literal('event'), event: SimEventType, entityId: EntityId.optional() }),
  z.object({ kind: z.literal('no_event'), event: SimEventType }),
  z.object({ kind: z.literal('near'), entityId: EntityId, within: z.number().positive() }),
  z.object({ kind: z.literal('objective_done'), id: z.string().optional() }),
  z.object({ kind: z.literal('door_open'), entityId: EntityId }),
  z.object({ kind: z.literal('grounded') }),
  z.object({ kind: z.literal('health_above'), value: z.number() }),
  z.object({ kind: z.literal('defeated'), target: z.string().min(1), count: z.number().int().min(1).default(1) }),
  z.object({ kind: z.literal('lap'), count: z.number().int().min(1) }),
  z.object({ kind: z.literal('race_finished') }),
  z.object({ kind: z.literal('match'), result: z.enum(['won', 'lost']) }),
  z.object({ kind: z.literal('dialogue_seen'), entityId: EntityId }),
  z.object({ kind: z.literal('level'), atLeast: z.number().int().min(1) }),
  z.object({ kind: z.literal('stat'), stat: z.string(), atLeast: z.number().optional(), atMost: z.number().optional() }),
  z.object({ kind: z.literal('has_ability'), ability: z.string() }),
  z.object({ kind: z.literal('status'), status: z.string(), present: z.boolean().default(true) }),
]);
export type PlaytestCheck = z.output<typeof PlaytestCheck>;

const Direction = z.union([z.enum(['forward', 'back', 'left', 'right']), z.tuple([z.number(), z.number()])]);

export const PlaytestStep = z.discriminatedUnion('do', [
  z.object({ do: z.literal('move'), direction: Direction, seconds: z.number().positive().max(60), sprint: z.boolean().default(false) }),
  z.object({ do: z.literal('turn'), degrees: z.number() }),
  z.object({ do: z.literal('face'), entityId: EntityId }),
  z.object({
    do: z.literal('walk_to'),
    entityId: EntityId,
    /** Stop when this close (meters, XZ plane) to the entity's center. */
    stopDistance: z.number().positive().default(1.6),
    timeout: z.number().positive().max(120).default(20),
    sprint: z.boolean().default(false),
  }),
  z.object({ do: z.literal('jump') }),
  z.object({ do: z.literal('interact') }),
  /** Cast the ability on bar slot 1–6 (or by id). */
  z.object({ do: z.literal('cast'), slot: z.number().int().min(1).max(6).optional(), ability: z.string().optional() }),
  /** Player commands: unlock a tree node, equip/unequip/use an item. */
  z.object({
    do: z.literal('command'),
    command: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('unlock'), tree: z.string(), node: z.string() }),
      z.object({ kind: z.literal('equip'), item: z.string() }),
      z.object({ kind: z.literal('unequip'), slot: z.string() }),
      z.object({ kind: z.literal('use'), item: z.string() }),
    ]),
    expectFail: z.boolean().default(false),
  }),
  z.object({ do: z.literal('attack'), heavy: z.boolean().default(false), times: z.number().int().min(1).max(50).default(1) }),
  /** Vehicle: throttle/steer in [-1, 1]. */
  z.object({ do: z.literal('drive'), seconds: z.number().positive().max(120), throttle: z.number().min(-1).max(1).default(1), steer: z.number().min(-1).max(1).default(0) }),
  /** Hand the player to the built-in AI (racing line / fighting bot / hunt hostiles) until `until` holds or time runs out. */
  z.object({ do: z.literal('autopilot'), seconds: z.number().positive().max(600).default(60), until: PlaytestCheck.optional() }),
  z.object({ do: z.literal('wait'), seconds: z.number().positive().max(60) }),
  z.object({ do: z.literal('wait_until'), check: PlaytestCheck, timeout: z.number().positive().max(600).default(30) }),
  z.object({ do: z.literal('teleport'), position: Vec3, yaw: z.number().optional() }),
  z.object({ do: z.literal('expect'), check: PlaytestCheck }),
]);
export type PlaytestStep = z.output<typeof PlaytestStep>;

export const PlaytestScript = z.object({
  name: z.string().min(1).max(120).default('playtest'),
  steps: z.array(PlaytestStep).min(1).max(300),
  /** Hard cap on simulated time. */
  maxSimSeconds: z.number().positive().max(1200).default(240),
});
export type PlaytestScript = z.output<typeof PlaytestScript>;
export type PlaytestScriptInput = z.input<typeof PlaytestScript>;

export interface PlaytestStepResult {
  index: number;
  step: string;
  ok: boolean;
  note?: string;
  at: number;
}

export interface PlaytestReport {
  name: string;
  passed: boolean;
  revision: number;
  simSeconds: number;
  wallMs: number;
  steps: PlaytestStepResult[];
  events: SimEvent[];
  final: Pick<SimState, 'player' | 'inventory' | 'objectives' | 'doors' | 'race' | 'fight' | 'match' | 'kit'>;
}
