import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DesignBrief, StarterInfo } from '@forge/contracts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The embedded Producer: turns a design interview into follow-up questions, a game
 * design doc and a build plan, using the Claude API. Optional — without credentials
 * the same brief is driven by any MCP agent (forge_brief / forge_ask).
 *
 * Credentials (first match): a key saved from the Studio (workspace/secrets.json,
 * never sent to clients), else the SDK's default chain (ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
 */

const MODEL = 'claude-opus-5-5';
const FALLBACK_MODEL = 'claude-opus-4-8';

const ProducerOutput = z.object({
  followUps: z
    .array(z.object({ prompt: z.string(), options: z.array(z.string()) }))
    .describe('3-5 questions that resolve the biggest open design decisions; empty in the final phase'),
  gdd: z.string().describe('Concise game design document in markdown'),
  plan: z.array(z.string()).describe('Ordered, concrete build tasks for FORGE agents'),
});
export type ProducerOutput = z.infer<typeof ProducerOutput>;

const SYSTEM = `You are the Producer inside FORGE, an AI-native game studio where agents build browser 3D games through typed scene transactions.
Your job: turn a creator's design-interview answers into a clear, buildable game design.

What FORGE's runtime supports today (design within it; list anything beyond it under "Future milestones"):
- Controllers: third-person character, arcade vehicle, 2.5D fighter. Cameras: third-person, chase, side.
- Gameplay framework: stats & layered modifiers, resources (health/mana/energy/ammo…), abilities (self, melee arc, ray, area) with costs/cooldowns/windups, status effects (DoT, buffs, stun/root), XP & levels, skill/talent trees, items, equipment, consumables, loot tables.
- NPCs: idle/wander/guard brains, hostile chase/attack, respawning, dialogue lines. Quests: ordered objective chains (interact, collect, defeat, reach).
- Rules: objectives, race (laps/checkpoints), KO rounds, persistent worlds. Authoritative multiplayer up to 64 players per session, bots fill seats.
- Not yet: crafting, building, branching dialogue choices, pathfinding/navmesh, save/load, audio, custom models (greybox primitives until the asset pipeline lands).

Write for builders: specific numbers, named content, a pacing plan. Be concise. Follow-up questions must be decisions only the creator can make, each with 2-4 short suggested answers.`;

export class Producer {
  private authFailed = false;

  constructor(private readonly secretsFile: string) {}

  private savedKey(): string | null {
    try {
      if (!existsSync(this.secretsFile)) return null;
      return (JSON.parse(readFileSync(this.secretsFile, 'utf8')) as { anthropicApiKey?: string }).anthropicApiKey ?? null;
    } catch {
      return null;
    }
  }

  status(): { available: boolean; source: 'saved' | 'environment' | 'unverified' | 'none'; model: string } {
    if (this.authFailed) return { available: false, source: 'none', model: MODEL };
    if (this.savedKey()) return { available: true, source: 'saved', model: MODEL };
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return { available: true, source: 'environment', model: MODEL };
    // The SDK may still find an `ant auth login` profile; we only know after a call.
    return { available: true, source: 'unverified', model: MODEL };
  }

  setKey(key: string | null): void {
    writeFileSync(this.secretsFile, JSON.stringify(key ? { anthropicApiKey: key } : {}, null, 2), { mode: 0o600 });
    this.authFailed = false;
  }

  private client(): Anthropic {
    const key = this.savedKey();
    return key ? new Anthropic({ apiKey: key }) : new Anthropic();
  }

  /**
   * phase "interview": draft GDD + plan and ask follow-ups.
   * phase "final": fold the answered follow-ups into the final GDD + plan (no new questions).
   */
  async design(brief: DesignBrief, starter: StarterInfo, phase: 'interview' | 'final'): Promise<ProducerOutput> {
    const questions = starter.questions.map((q) => ({ id: q.id, prompt: q.prompt, answer: brief.answers[q.id] ?? q.default ?? '(skipped)' }));
    const user = [
      `Genre starter: ${starter.name} (${starter.genre}). Working title: "${brief.title}".`,
      `Interview answers:\n${JSON.stringify(questions, null, 2)}`,
      brief.followUps.length ? `Follow-up answers:\n${JSON.stringify(brief.followUps.map((f) => ({ q: f.prompt, a: f.answer ?? '(unanswered)' })), null, 2)}` : '',
      `Current draft design notes:\n${brief.gdd}`,
      phase === 'interview'
        ? 'Draft the GDD and build plan, and ask 3-5 follow-up questions for the decisions that most change what gets built.'
        : 'Write the final GDD and build plan incorporating every answer. Return an empty followUps array.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const run = (model: string) =>
      this.client().messages.parse({
        model,
        max_tokens: 16000,
        output_config: { effort: 'high', format: zodOutputFormat(ProducerOutput) },
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      });

    try {
      let res = await run(MODEL);
      // Client-side refusal fallback (structured parsing path): retry once on the previous Opus.
      if (res.stop_reason === 'refusal') res = await run(FALLBACK_MODEL);
      if (res.stop_reason === 'refusal') throw new Error('the Producer declined this brief');
      if (!res.parsed_output) throw new Error(`no structured output (stop_reason ${res.stop_reason})`);
      const out = res.parsed_output;
      return { ...out, followUps: phase === 'final' ? [] : out.followUps.slice(0, 5) };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        this.authFailed = true;
        throw new Error('no valid Claude credentials — add an API key in the Studio (Design ▸ Producer) or run `ant auth login`');
      }
      if (err instanceof Anthropic.RateLimitError) throw new Error('Claude API rate limit — try again shortly');
      if (err instanceof Anthropic.APIConnectionError) throw new Error('could not reach the Claude API');
      if (err instanceof Anthropic.APIError) throw new Error(`Claude API error ${err.status}: ${err.message}`);
      // Non-HTTP SDK errors (e.g. no credentials could be resolved at all).
      if (err instanceof Anthropic.AnthropicError) {
        this.authFailed = true;
        throw new Error(`Claude client not configured (${err.message}) — add an API key in the Studio (Design ▸ Producer) or run \`ant auth login\``);
      }
      throw err;
    }
  }
}
