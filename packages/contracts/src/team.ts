import { z } from 'zod';
import { Author } from './mutations';
import { EntityId } from './primitives';

export const TeamAgentId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/).refine((id) => id.toLowerCase() !== 'director');
export const TEAM_THREAD = '#team';
export const TeamThread = z.union([z.literal(TEAM_THREAD), TeamAgentId]);
export const TeamText = z.string().trim().min(1).max(2000);
export const TeamNoteKind = z.enum(['message', 'thought', 'progress', 'question', 'result']);
export const TeamTarget = z.enum(['team', 'dm']).default('team');
export const TeamPostKind = z.enum(['message', 'question', 'result']).default('message');
export const PublishedKind = z.enum(['thought', 'plan', 'progress']);
export const TeamFocus = z.array(EntityId).max(100);
export const PlanSteps = z.array(z.string().trim().min(1).max(400)).min(1).max(40);
const StepDecision = z.enum(['pending', 'approved', 'rejected']);
export const PlanStep = z.object({ id: z.string(), text: PlanSteps.element, decision: StepDecision });
export type PlanStep = z.infer<typeof PlanStep>;
export const TeamPlanReview = z.object({
  planId: z.string().min(1).max(64),
  baseSequence: z.number().int().positive(),
  steps: z.array(PlanStep).min(1).max(40),
});
export type TeamPlanReview = z.infer<typeof TeamPlanReview>;

export const DirectiveStatus = z.enum(['open', 'claimed', 'done', 'rejected']);
export type DirectiveStatus = z.infer<typeof DirectiveStatus>;
export const Directive = z.object({
  id: z.string(),
  text: TeamText,
  status: DirectiveStatus,
  createdAt: z.number(),
  createdBy: z.string(),
  focusEntityIds: TeamFocus,
  claimedBy: z.string().optional(),
  response: z.string().max(2000).optional(),
});
export type Directive = z.infer<typeof Directive>;

const event = { sequence: z.number().int().positive(), at: z.number(), author: Author, thread: TeamThread };
const plan = { planId: z.string(), proposedBy: Author, steps: z.array(PlanStep).min(1).max(40) };
export const TeamEvent = z.discriminatedUnion('kind', [
  z.object({
    ...event, kind: TeamNoteKind, text: TeamText, focusEntityIds: TeamFocus, mentions: z.array(TeamAgentId),
    source: z.enum(['published', 'provider_summary']).optional(), directive: Directive.optional(),
  }),
  z.object({ ...event, kind: z.literal('plan'), ...plan }),
  z.object({ ...event, kind: z.literal('plan_review'), ...plan }),
  z.object({ ...event, kind: z.literal('guidance'), agentId: TeamAgentId, paused: z.boolean() }),
]);
export type TeamEvent = z.infer<typeof TeamEvent>;
export type TeamNote = Extract<TeamEvent, { text: string }>;
export type TeamPlan = Extract<TeamEvent, { planId: string }>;
export const TeamInboxCursor = z.number().int().nonnegative();

export interface TeamThinking {
  author: Author;
  text: string;
}

export interface TeamSnapshot {
  events: TeamEvent[];
  paused: string[];
  thinking: TeamThinking | null;
}
