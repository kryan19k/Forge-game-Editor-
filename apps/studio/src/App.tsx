import { useEffect, useState } from 'react';
import { installHotkeys } from './commands';
import { DesignPanel } from './ui/DesignPanel';
import { AssetsPanel } from './ui/AssetsPanel';
import { Gallery } from './ui/Gallery';
import { TeamRoom } from './ui/TeamRoom';
import { useStudio } from './state/store';
import { Inspector } from './ui/Inspector';
import { Outliner } from './ui/Outliner';
import { Palette } from './ui/Palette';
import { Tape } from './ui/Tape';
import { TopBar } from './ui/TopBar';
import { Viewport } from './ui/Viewport';

export function App() {
  useEffect(() => installHotkeys(), []);
  const projectId = useStudio((s) => s.project?.projectId);
  const assetsOpen = useStudio((s) => s.assetsOpen);
  const [wide, setWide] = useState(false);
  return (
    <div className={wide ? 'studio team-wide' : 'studio'}>
      <TopBar />
      <Outliner />
      <Viewport />
      <Tape />
      <div className="area-right">
        {assetsOpen ? <AssetsPanel key={projectId} /> : <Inspector />}
        <TeamRoom key={projectId} wide={wide} onToggleWidth={() => setWide(!wide)} />
      </div>
      <Palette />
      <Gallery />
      <DesignPanel />
    </div>
  );
}
