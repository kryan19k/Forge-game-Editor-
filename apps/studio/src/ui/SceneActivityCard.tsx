import type { SceneActivity, SceneChange } from '@forge/contracts';

const coordinates = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function changeText(change: SceneChange) {
  const name = <strong>{change.entity.name}</strong>;
  switch (change.kind) {
    case 'created':
      return <>added {name} at {change.position.map((n) => coordinates.format(n)).join(', ')}{change.parent && <> in {change.parent.name}</>}</>;
    case 'deleted':
      return <>deleted {name}</>;
    case 'renamed':
      return <>renamed {change.previousName} to {name}</>;
    case 'reparented':
      return <>moved {name} under {change.parent?.name ?? 'Scene root'}</>;
    case 'component_added':
      return <>added {change.component} to {name}</>;
    case 'component_removed':
      return <>removed {change.component} from {name}</>;
  }
}

export function SceneActivityCard({ entry, color }: { entry: SceneActivity; color: string }) {
  const [first, ...rest] = entry.changes;
  return (
    <div className="scene-activity" style={{ '--c': color } as React.CSSProperties}>
      <div className="micro scene-activity-head">
        <span>Scene activity</span><span>Rev {entry.revision}</span>
      </div>
      <div>{entry.author.name} {changeText(first!)}</div>
      {rest.length > 0 && (
        <details>
          <summary>{rest.length} more {rest.length === 1 ? 'change' : 'changes'}</summary>
          <ul>
            {rest.map((change, index) => <li key={index}>{changeText(change)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
