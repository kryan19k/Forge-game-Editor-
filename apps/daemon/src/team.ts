import {
  TEAM_THREAD, TeamAgentId, TeamEvent, newId,
  type Author, type Directive, type EntityId, type TeamNote, type TeamPlan, type TeamPlanReview, type TeamSnapshot, type TeamThinking,
} from '@forge/contracts';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

type NewEvent<T extends TeamEvent = TeamEvent> = T extends TeamEvent ? Omit<T, 'at' | 'sequence'> : never;

/** One append-only ledger per project. Only the Director can publish guidance and plan reviews. */
export class TeamRoom {
  private readonly events: TeamEvent[] = [];
  private readonly plans = new Map<string, TeamPlan>();
  private readonly paused = new Set<string>();
  readonly directives = new Map<string, Directive>();
  thinking: TeamThinking | null = null;

  constructor(private readonly path: string, private readonly publish: (event: TeamEvent) => void) {
    if (!existsSync(path)) return;
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = TeamEvent.parse(JSON.parse(line));
        if (event.sequence > this.cursor) this.remember(event);
      } catch {
        // A torn line must not prevent the remaining thread from opening.
      }
    }
    if (contents && !contents.endsWith('\n')) appendFileSync(path, '\n');
  }

  private get cursor(): number {
    return this.events.at(-1)?.sequence ?? 0;
  }

  snapshot(): TeamSnapshot {
    const counts = new Map<string, number>();
    const events: TeamEvent[] = [];
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]!;
      const count = counts.get(event.thread) ?? 0;
      if (count >= 120) continue;
      counts.set(event.thread, count + 1);
      events.push(event);
    }
    return { events: events.reverse(), paused: [...this.paused], thinking: this.thinking };
  }

  inbox(agentId: string, since = 0) {
    const matches = this.events.filter((event) => event.sequence > since && (event.thread === TEAM_THREAD || event.thread === agentId));
    const events = matches.slice(0, 100);
    const hasMore = events.length < matches.length;
    return { events, hasMore, cursor: hasMore ? events.at(-1)!.sequence : this.cursor, paused: this.isPaused(agentId) };
  }

  isPaused(agentId: string): boolean {
    return this.paused.has(agentId);
  }

  note(author: Author, thread: string, kind: TeamNote['kind'], text: string, focusEntityIds: EntityId[] = [], extra: Pick<TeamNote, 'source' | 'directive'> = {}): TeamNote {
    const mentions = [...new Set([...text.matchAll(/(?<![\w@])@([a-zA-Z0-9][\w.-]*)/g)].map((match) => match[1]!.replace(/\.+$/, '')))]
      .filter((id) => TeamAgentId.safeParse(id).success);
    return this.append({ author, thread, kind, text, focusEntityIds, mentions, ...extra });
  }

  propose(author: Author, thread: string, steps: string[]): TeamPlan {
    return this.append({
      kind: 'plan', author, thread, planId: newId('plan'), proposedBy: author,
      steps: steps.map((text, index) => ({ id: String(index + 1), text, decision: 'pending' })),
    });
  }

  review(author: Author, review: TeamPlanReview): TeamPlan {
    const current = this.plans.get(review.planId);
    if (!current) throw new Error('That plan is unavailable.');
    if (current.sequence !== review.baseSequence) throw new Error('The plan changed. Review the latest version.');
    const ids = new Set(review.steps.map((step) => step.id));
    if (ids.size !== current.steps.length || review.steps.length !== current.steps.length || current.steps.some((step) => !ids.has(step.id))) {
      throw new Error('A review must include each original step exactly once.');
    }
    return this.append({ kind: 'plan_review', author, thread: current.thread, planId: current.planId, proposedBy: current.proposedBy, steps: review.steps });
  }

  setPaused(author: Author, agentId: string, paused: boolean): void {
    if (this.isPaused(agentId) === paused) return;
    this.append({ kind: 'guidance', author, thread: agentId, agentId, paused });
  }

  private append<T extends NewEvent>(input: T): Extract<TeamEvent, { kind: T['kind'] }> {
    const event = TeamEvent.parse({ ...input, sequence: this.cursor + 1, at: Date.now() });
    appendFileSync(this.path, JSON.stringify(event) + '\n');
    this.remember(event);
    this.publish(event);
    return event as Extract<TeamEvent, { kind: T['kind'] }>;
  }

  private remember(event: TeamEvent): void {
    this.events.push(event);
    if ('planId' in event) this.plans.set(event.planId, event);
    if ('directive' in event && event.directive) this.directives.set(event.directive.id, event.directive);
    if (event.kind === 'guidance') {
      if (event.paused) this.paused.add(event.agentId);
      else this.paused.delete(event.agentId);
    }
  }
}
