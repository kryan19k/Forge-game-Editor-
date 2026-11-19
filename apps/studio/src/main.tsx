import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startPlay, stopPlay, usePlay } from './state/play';
import { connect, useStudio } from './state/store';
import { viewportApi } from './viewport/api';

connect();
createRoot(document.getElementById('root')!).render(<App />);

// Dev-only automation hook for browser QA (Playwright). Never shipped in production builds.
if (import.meta.env.DEV) {
  Object.assign(window, { forge: { studio: useStudio, play: usePlay, startPlay, stopPlay, viewport: viewportApi } });
}
