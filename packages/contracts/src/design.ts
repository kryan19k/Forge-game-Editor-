import { z } from 'zod';
import { Genre } from './scene';

/**
 * Genre starters + the design interview. A starter is NOT a finished game: it is a
 * question set and a scaffold builder. The Director answers the wizard, an AI
 * Producer (embedded or any MCP agent) asks follow-ups and writes the design doc,
 * then agents build the game from the brief.
 */

export const DesignOption = z.object({ id: z.string(), label: z.string(), hint: z.string().optional() });

export const DesignQuestion = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  prompt: z.string(),
  help: z.string().optional(),
  kind: z.enum(['single', 'multi', 'text']),
  options: z.array(DesignOption).default([]),
  default: z.union([z.string(), z.array(z.string())]).optional(),
});
export type DesignQuestion = z.output<typeof DesignQuestion>;

export const DesignAnswer = z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)]);
export type DesignAnswer = z.infer<typeof DesignAnswer>;

export interface StarterInfo {
  id: string;
  code: string;
  genre: Genre;
  name: string;
  tagline: string;
  accent: string;
  skill: string;
  questions: DesignQuestion[];
}

export interface FollowUp {
  id: string;
  prompt: string;
  /** Suggested answers; empty = free text. */
  options: string[];
  answer?: string;
  askedBy: string;
  at: number;
}

export interface DesignBrief {
  starter: string;
  genre: Genre;
  title: string;
  answers: Record<string, DesignAnswer>;
  followUps: FollowUp[];
  /** Game design document (markdown), written by the Producer or an agent. */
  gdd: string;
  /** Ordered build tasks for the crew. */
  plan: string[];
  status: 'interview' | 'designing' | 'ready' | 'building';
  producer: { kind: 'embedded' | 'agent' | 'none'; note?: string };
  updatedAt: number;
}
