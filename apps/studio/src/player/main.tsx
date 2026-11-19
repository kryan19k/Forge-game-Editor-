import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/jetbrains-mono';
import '../styles.css';
import { NetSource, PlaySession, createRenderer } from '@forge/game-runtime';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { playHooks, setPlaySource, usePlay } from '../state/play';
import { useStudio } from '../state/store';
import { PlayHud } from '../ui/PlayHud';

/**
 * Standalone player client: no editor, just the game. Joins a hosted session via
 * ?room=CODE. This is the seed of the exported game build.
 */
function Player() {
  const params = new URLSearchParams(location.search);
  const [room, setRoom] = useState(params.get('room') ?? '');
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('forge.playerName') ?? '';
    } catch {
      return '';
    }
  });
  const [phase, setPhase] = useState<'lobby' | 'joining' | 'playing' | 'ended'>('lobby');
  const [note, setNote] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const session = useRef<PlaySession | null>(null);

  useEffect(() => () => session.current?.dispose(), []);
  // The HUD's Stop/Leave button flips play status off — tear the session down.
  useEffect(
    () =>
      usePlay.subscribe((s) => {
        if (s.status === 'off' && session.current) {
          session.current.dispose();
          session.current = null;
          setPhase('ended');
          setNote('You left the session.');
        }
      }),
    [],
  );

  const join = async () => {
    const code = room.trim().toUpperCase();
    const who = name.trim() || 'Player';
    if (!code) return;
    try {
      localStorage.setItem('forge.playerName', who);
    } catch {
      /* private mode */
    }
    setPhase('joining');
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const source = await NetSource.connect(`${proto}://${location.host}/net/${code}`, who, (reason) => {
        session.current?.dispose();
        session.current = null;
        usePlay.setState({ status: 'off' });
        setPhase('ended');
        setNote(`Session ended: ${reason}`);
      });
      useStudio.setState({ scene: source.doc });
      setPlaySource(source);
      usePlay.setState({ status: 'running', mode: 'online', startedAt: Date.now(), revision: source.doc.revision, room: { id: code, url: location.href }, locked: false });
      const canvas = document.createElement('canvas');
      host.current!.prepend(canvas);
      const { renderer } = await createRenderer(canvas);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      session.current = new PlaySession(renderer as unknown as ConstructorParameters<typeof PlaySession>[0], source, playHooks, overlay.current!);
      session.current.start();
      setPhase('playing');
    } catch (err) {
      setPhase('lobby');
      setNote((err as Error).message);
    }
  };

  return (
    <div className="player-shell">
      <div className={`viewport playing${phase === 'playing' ? '' : ' idle'}`} ref={host}>
        <div className="vp-overlay" ref={overlay}>
          {phase === 'playing' && <PlayHud />}
        </div>
      </div>
      {phase !== 'playing' && (
        <div className="lobby">
          <div className="lobby-card">
            <div className="wordmark-lg">
              <span className="furnace" /> FORGE
            </div>
            <div className="micro dim">{phase === 'ended' ? 'Session over' : 'Join a session'}</div>
            {note && <div className="lobby-note">{note}</div>}
            <label className="micro dim">Session code</label>
            <input className="text mono" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ABC123" />
            <label className="micro dim">Your name</label>
            <input className="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" onKeyDown={(e) => e.key === 'Enter' && join()} />
            <button className="btn primary" disabled={phase === 'joining' || !room.trim()} onClick={join}>
              {phase === 'joining' ? 'Joining…' : 'Join'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Player />);
if (import.meta.env.DEV) Object.assign(window, { forge: { play: usePlay, studio: useStudio } });
