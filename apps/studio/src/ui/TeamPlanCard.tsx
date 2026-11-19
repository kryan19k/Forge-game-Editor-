import type { PlanStep, TeamPlan } from '@forge/contracts';
import { useState } from 'react';
import { send } from '../state/store';

export function TeamPlanCard({ plan, color, online }: { plan: TeamPlan; color: string; online: boolean }) {
  const [draft, setDraft] = useState<PlanStep[] | null>(null);
  const review = (steps: PlanStep[]) => {
    send({ type: 'team.review', review: { planId: plan.planId, baseSequence: plan.sequence, steps } });
    setDraft(null);
  };
  const update = (index: number, patch: Partial<PlanStep>) =>
    setDraft((steps) => steps?.map((step, i) => i === index ? { ...step, ...patch } : step) ?? null);
  const move = (index: number, delta: number) => {
    if (!draft) return;
    const steps = [...draft];
    [steps[index], steps[index + delta]] = [steps[index + delta]!, steps[index]!];
    setDraft(steps);
  };
  const steps = draft ?? plan.steps;

  return (
    <article className="team-card team-plan" style={{ '--c': color } as React.CSSProperties}>
      <header className="micro"><span>{plan.proposedBy.name}</span><span>{plan.kind === 'plan_review' ? 'Plan reviewed' : 'Plan for review'}</span></header>
      <ol>
        {steps.map((step, i) => (
          <li key={step.id}>
            {draft ? (
              <div className="team-step-edit">
                <textarea aria-label={'Step ' + (i + 1)} maxLength={400} value={step.text} onChange={(e) => update(i, { text: e.target.value })} />
                <div className="team-actions">
                  <select aria-label={'Decision for step ' + (i + 1)} value={step.decision} onChange={(e) => update(i, { decision: e.target.value as PlanStep['decision'] })}>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <button className="btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={'Move step ' + (i + 1) + ' up'}>↑</button>
                  <button className="btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={'Move step ' + (i + 1) + ' down'}>↓</button>
                </div>
              </div>
            ) : <div className="team-step"><span>{step.text}</span><span className={'micro team-step-status ' + step.decision}>{step.decision}</span></div>}
          </li>
        ))}
      </ol>
      <div className="team-actions">
        {draft ? <>
          <button className="btn primary" disabled={!online || draft.some((step) => !step.text.trim())} onClick={() => review(draft)}>Save review</button>
          <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
        </> : <>
          <button className="btn" disabled={!online || steps.every((step) => step.decision === 'approved')} onClick={() => review(steps.map((step) => ({ ...step, decision: 'approved' })))}>Approve all</button>
          <button className="btn" disabled={!online || steps.every((step) => step.decision === 'rejected')} onClick={() => review(steps.map((step) => ({ ...step, decision: 'rejected' })))}>Reject all</button>
          <button className="btn" disabled={!online} onClick={() => setDraft(steps)}>Review steps</button>
        </>}
      </div>
    </article>
  );
}
