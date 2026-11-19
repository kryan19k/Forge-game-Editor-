import { z } from 'zod';
import type { ActorView, SimState } from './playtest';
import type { SceneDoc } from './scene';

/**
 * Multiplayer wire protocol (WebSocket, JSON). Server-authoritative: clients send
 * only inputs; the room's GameSimulation decides everything and broadcasts snapshots.
 */

export const NetInput = z.object({
  move: z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]),
  sprint: z.boolean(),
  jump: z.boolean(),
  interact: z.boolean(),
  attack: z.boolean(),
  heavy: z.boolean(),
  block: z.boolean(),
  /** Ability bar slot pressed this tick (0 = none). */
  ability: z.number().int().min(0).max(6).default(0),
  yaw: z.number(),
});

export const NetClientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join'), name: z.string().trim().min(1).max(24) }),
  z.object({ t: z.literal('input'), seq: z.number().int(), input: NetInput }),
  z.object({ t: z.literal('ping'), at: z.number() }),
  z.object({
    t: z.literal('command'),
    cmd: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('unlock'), tree: z.string().max(48), node: z.string().max(48) }),
      z.object({ kind: z.literal('equip'), item: z.string().max(48) }),
      z.object({ kind: z.literal('unequip'), slot: z.string().max(16) }),
      z.object({ kind: z.literal('use'), item: z.string().max(48) }),
      z.object({ kind: z.literal('slot'), index: z.number().int().min(0).max(5), ability: z.string().max(48).nullable() }),
    ]),
  }),
]);
export type NetClientMessage = z.input<typeof NetClientMessage>;

/** [entityId, px, py, pz, qx, qy, qz, qw] — compact transform for doors, props, NPCs. */
export type NetXf = [string, number, number, number, number, number, number, number];

export interface RoomInfo {
  roomId: string;
  projectId: string;
  name: string;
  genre: string;
  players: Array<{ id: string; name: string }>;
  maxPlayers: number;
  revision: number;
  createdAt: number;
}

export type NetServerMessage =
  | { t: 'welcome'; you: string; room: RoomInfo; doc: SceneDoc; tickRate: number; snapRate: number }
  | { t: 'snap'; tick: number; time: number; ack: number; actors: ActorView[]; moving: NetXf[]; removed: string[]; hud: SimState }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'full'; reason: string }
  | { t: 'closed'; reason: string };
