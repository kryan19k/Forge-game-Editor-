import type { SimState } from '@forge/contracts';
import { LocalSource, NetSource, type Command, type GameSource } from '@forge/game-runtime';
import { create } from 'zustand';
import { viewportApi } from '../viewport/api';
import { toast, useStudio } from './store';

export interface PlayState {
  status: 'off' | 'loading' | 'running';
  mode: 'solo' | 'online';
  hud: SimState | null;
  locked: boolean;
  startedAt: number;
  /** Authoring revision the session was snapshotted from. */
  revision: number;
  room: { id: string; url: string } | null;
}

export const usePlay = create<PlayState>(() => ({ status: 'off', mode: 'solo', hud: null, locked: false, startedAt: 0, revision: 0, room: null }));

/** The live game source (local sim or network) — the HUD sends player commands through it. */
let source: GameSource | null = null;
export function setPlaySource(s: GameSource | null): void {
  source = s;
}
export function sendCommand(cmd: Command): void {
  source?.command(cmd);
}

const hooks = {
  onState: (hud: SimState) => usePlay.setState({ hud }),
  onPointerLock: (locked: boolean) => usePlay.setState({ locked }),
};

export async function startPlay(): Promise<void> {
  const vp = viewportApi.current;
  const scene = useStudio.getState().scene;
  if (!vp || !scene || usePlay.getState().status !== 'off') return;
  usePlay.setState({ status: 'loading', mode: 'solo', hud: null, locked: false, startedAt: Date.now(), revision: scene.revision, room: null });
  try {
    const local = await LocalSource.create(scene, 'You');
    source = local;
    await vp.enterPlay(hooks, local);
    usePlay.setState({ status: 'running' });
  } catch (err) {
    usePlay.setState({ status: 'off' });
    toast('error', 'PLAY', `could not start: ${String(err)}`);
  }
}

/** Host the current scene as an authoritative multiplayer session and join it as the Director. */
export async function hostOnline(): Promise<void> {
  const vp = viewportApi.current;
  const scene = useStudio.getState().scene;
  if (!vp || !scene || usePlay.getState().status !== 'off') return;
  usePlay.setState({ status: 'loading', mode: 'online', hud: null, locked: false, startedAt: Date.now(), revision: scene.revision, room: null });
  try {
    const res = (await (await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as {
      room: { roomId: string };
    };
    const id = res.room.roomId;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const net = await NetSource.connect(`${proto}://${location.host}/net/${id}`, 'Director', (reason) => {
      if (usePlay.getState().mode === 'online' && usePlay.getState().status !== 'off') {
        toast('info', 'SESSION', `ended: ${reason}`);
        stopPlay();
      }
    });
    usePlay.setState({ room: { id, url: `${location.origin}/play.html?room=${id}` } });
    source = net;
    await vp.enterPlay(hooks, net);
    usePlay.setState({ status: 'running' });
  } catch (err) {
    usePlay.setState({ status: 'off', room: null });
    toast('error', 'HOST', `could not host: ${(err as Error).message}`);
  }
}

export function stopPlay(): void {
  if (usePlay.getState().status === 'off') return;
  viewportApi.current?.exitPlay();
  source = null;
  usePlay.setState({ status: 'off', hud: null, locked: false, room: null });
}

export function togglePlay(): void {
  if (usePlay.getState().status === 'off') void startPlay();
  else stopPlay();
}

export { hooks as playHooks };
