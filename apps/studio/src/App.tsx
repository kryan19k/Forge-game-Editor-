import { useEffect } from 'react';
import { installHotkeys } from './commands';
import { DesignPanel } from './ui/DesignPanel';
import { Gallery } from './ui/Gallery';
import { CrewChannel } from './ui/CrewChannel';
import { Inspector } from './ui/Inspector';
import { Outliner } from './ui/Outliner';
import { Palette } from './ui/Palette';
import { Tape } from './ui/Tape';
import { TopBar } from './ui/TopBar';
import { Viewport } from './ui/Viewport';

export function App() {
  useEffect(() => installHotkeys(), []);
  return (
    <div className="studio">
      <TopBar />
      <Outliner />
      <Viewport />
      <Tape />
      <div className="area-right">
        <Inspector />
        <CrewChannel />
      </div>
      <Palette />
      <Gallery />
      <DesignPanel />
    </div>
  );
}
