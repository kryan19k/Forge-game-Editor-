import type { ActorView, EntityId, NetServerMessage, RoomInfo, SceneDoc, SimState } from '@forge/contracts';
import { Quaternion, type Vector3 } from 'three';
import type { Command } from '../sim/gameplay';
import { GameSimulation, type PlayerInput } from '../sim/simulation';
import type { GameSource, MovingXf, ViewFrame } from './source';

type Snap = Extract<NetServerMessage, { t: 'snap' }>;

const INTERP_DELAY_MS = 100;
const SEND_HZ = 30;

/**
 * Multiplayer client. Sends inputs; renders authoritative snapshots.
 * Remote actors and world objects are interpolated INTERP_DELAY_MS in the past for
 * smoothness; the local player renders from the newest snapshot for responsiveness.
 * (Client-side prediction is a later milestone — see ADR-002.)
 */
export class NetSource implements GameSource {
  private readonly snaps: Array<{ at: number; snap: Snap }> = [];
  private seq = 0;
  private lastSend = 0;
  private pending: Pick<PlayerInput, 'jump' | 'interact' | 'attack' | 'heavy' | 'ability'> = { jump: false, interact: false, attack: false, heavy: false, ability: 0 };
  private collision: GameSimulation | null = null;
  private closedReason: string | null = null;
  rtt = 0;

  private constructor(
    private readonly ws: WebSocket,
    readonly doc: SceneDoc,
    readonly me: string,
    readonly room: RoomInfo,
    private readonly onClosed?: (reason: string) => void,
  ) {
    ws.addEventListener('message', (ev) => this.onMessage(JSON.parse(String(ev.data)) as NetServerMessage));
    ws.addEventListener('close', () => this.closed(this.closedReason ?? 'connection lost'));
    void GameSimulation.create(doc, { collisionOnly: true }).then((s) => (this.collision = s));
    this.pinger = setInterval(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ t: 'ping', at: performance.now() })), 2000);
  }
  private readonly pinger: ReturnType<typeof setInterval>;

  static connect(url: string, name: string, onClosed?: (reason: string) => void): Promise<NetSource> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const fail = (why: string) => {
        ws.close();
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('session did not answer'), 8000);
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', name })));
      ws.addEventListener('error', () => fail('could not reach the session'));
      const first = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as NetServerMessage;
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          ws.removeEventListener('message', first);
          resolve(new NetSource(ws, msg.doc, msg.you, msg.room, onClosed));
        } else if (msg.t === 'full' || msg.t === 'closed') {
          clearTimeout(timer);
          fail(msg.reason);
        }
      };
      ws.addEventListener('message', first);
    });
  }

  private onMessage(msg: NetServerMessage): void {
    if (msg.t === 'snap') {
      this.snaps.push({ at: performance.now(), snap: msg });
      if (this.snaps.length > 30) this.snaps.shift();
    } else if (msg.t === 'pong') this.rtt = performance.now() - msg.at;
    else if (msg.t === 'closed') this.closedReason = msg.reason;
  }

  private closed(reason: string): void {
    this.onClosed?.(reason);
  }

  update(_dt: number, input: PlayerInput): void {
    this.pending.jump ||= input.jump;
    this.pending.interact ||= input.interact;
    this.pending.attack ||= input.attack;
    this.pending.heavy ||= input.heavy;
    this.pending.ability ||= input.ability;
    const now = performance.now();
    const edge = this.pending.jump || this.pending.interact || this.pending.attack || this.pending.heavy || !!this.pending.ability;
    if (!edge && now - this.lastSend < 1000 / SEND_HZ) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.lastSend = now;
    this.ws.send(JSON.stringify({ t: 'input', seq: ++this.seq, input: { ...input, ...this.pending } }));
    this.pending = { jump: false, interact: false, attack: false, heavy: false, ability: 0 };
  }

  frame(): ViewFrame {
    const latest = this.snaps.at(-1);
    if (!latest) return { actors: [], moving: new Map(), removed: new Set() };
    const renderAt = performance.now() - INTERP_DELAY_MS;
    let a = latest;
    let b = latest;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1]!.at <= renderAt) {
        a = this.snaps[i - 1]!;
        b = this.snaps[i]!;
        break;
      }
    }
    const span = b.at - a.at;
    const k = span > 0 ? Math.min(1, Math.max(0, (renderAt - a.at) / span)) : 1;

    const prevActors = new Map(a.snap.actors.map((x) => [x.id, x]));
    const actors: ActorView[] = latest.snap.actors.map((now) => {
      if (now.id === this.me) return now; // newest for the local player
      const to = b.snap.actors.find((x) => x.id === now.id) ?? now;
      const from = prevActors.get(now.id) ?? to;
      return { ...to, position: lerp3(from.position, to.position, k), yaw: lerpAngle(from.yaw, to.yaw, k) };
    });

    const moving = new Map<EntityId, MovingXf>();
    const prevMoving = new Map(a.snap.moving.map((m) => [m[0], m]));
    for (const m of b.snap.moving) {
      const p = prevMoving.get(m[0]) ?? m;
      const qa = new Quaternion(p[4], p[5], p[6], p[7]);
      const q = qa.slerp(new Quaternion(m[4], m[5], m[6], m[7]), k);
      moving.set(m[0], { p: lerp3([p[1], p[2], p[3]], [m[1], m[2], m[3]], k), q: [q.x, q.y, q.z, q.w] });
    }
    return { actors, moving, removed: new Set(latest.snap.removed) };
  }

  hud(): SimState | null {
    return this.snaps.at(-1)?.snap.hud ?? null;
  }

  command(cmd: Command): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'command', cmd }));
  }

  castRay(origin: Vector3, dir: Vector3, maxDist: number): number | null {
    return this.collision?.castRay(origin, dir, maxDist) ?? null;
  }

  dispose(): void {
    this.closedReason ??= 'left';
    clearInterval(this.pinger);
    this.ws.close();
    this.collision?.dispose();
  }
}

const lerp3 = (a: number[], b: number[], k: number): [number, number, number] => [
  a[0]! + (b[0]! - a[0]!) * k,
  a[1]! + (b[1]! - a[1]!) * k,
  a[2]! + (b[2]! - a[2]!) * k,
];
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
