import { z } from 'zod';
import { Author, Transaction } from './mutations';
import { EntityId } from './primitives';
import type { DesignBrief } from './design';
import type { SceneDoc } from './scene';

/* ── Crew: agents and humans connected to a project ───────────────────── */

export const AgentStatus = z.enum(['idle', 'working', 'waiting', 'blocked']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export interface CrewMember {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  color: string;
  status: AgentStatus;
  message: string;
  focusEntityIds: EntityId[];
  lastSeen: number;
}

/* ── History ──────────────────────────────────────────────────────────── */

export interface HistoryEntry {
  txId: string;
  revision: number;
  author: Author;
  label: string;
  mutationCount: number;
  touched: EntityId[];
  createdAt: number;
  revertOf?: string;
  revertedBy?: string;
}

/* ── Directives: human intent queued for the crew ─────────────────────── */

export const DirectiveStatus = z.enum(['open', 'claimed', 'done', 'rejected']);
export type DirectiveStatus = z.infer<typeof DirectiveStatus>;

export interface Directive {
  id: string;
  text: string;
  status: DirectiveStatus;
  createdAt: number;
  createdBy: string;
  focusEntityIds: EntityId[];
  claimedBy?: string;
  response?: string;
}

/* ── Comms log ────────────────────────────────────────────────────────── */

export interface CommsEntry {
  id: string;
  at: number;
  source: { kind: 'human' | 'agent' | 'system'; id: string; name: string };
  level: 'info' | 'action' | 'warn' | 'error';
  text: string;
}

export interface ProjectInfo {
  projectId: string;
  name: string;
  template: string;
}

/* ── Wire messages ────────────────────────────────────────────────────── */

export type ServerMessage =
  | {
      type: 'snapshot';
      project: ProjectInfo;
      scene: SceneDoc;
      history: HistoryEntry[];
      crew: CrewMember[];
      directives: Directive[];
      comms: CommsEntry[];
      you: CrewMember;
      brief: DesignBrief | null;
    }
  | { type: 'tx.applied'; tx: Transaction; entry: HistoryEntry }
  | { type: 'tx.rejected'; txId: string; code: string; message: string }
  | { type: 'history.updated'; entry: HistoryEntry }
  | { type: 'crew'; crew: CrewMember[] }
  | { type: 'directives'; directives: Directive[] }
  | { type: 'comms'; entry: CommsEntry }
  | { type: 'brief'; brief: DesignBrief | null }
  | {
      type: 'capture.request';
      requestId: string;
      view: CaptureView;
      helpers: boolean;
      width: number;
      height: number;
      by: { name: string; color: string };
    };

export const CaptureView = z.enum(['current', 'overview', 'top', 'focus']);
export type CaptureView = z.infer<typeof CaptureView>;

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tx.submit'), tx: Transaction }),
  z.object({ type: z.literal('history.undo') }),
  z.object({ type: z.literal('history.redo') }),
  z.object({ type: z.literal('history.revert'), txId: z.string() }),
  z.object({ type: z.literal('selection'), entityIds: z.array(EntityId).max(500) }),
  z.object({
    type: z.literal('directive.create'),
    text: z.string().trim().min(1).max(2000),
    focusEntityIds: z.array(EntityId).max(100).default([]),
  }),
  z.object({
    type: z.literal('capture.response'),
    requestId: z.string(),
    dataUrl: z.string().optional(),
    error: z.string().optional(),
  }),
]);
export type ClientMessage = z.input<typeof ClientMessage>;
