import { NetClientMessage, newId, type NetServerMessage, type NetXf, type RoomInfo, type SceneDoc } from '@forge/contracts';
import { GameSimulation, IDLE_INPUT, SIM_DT } from '@forge/game-runtime/sim';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';

const SNAP_HZ = 30;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface Client {
  ws: WebSocket;
  playerId: string;
  name: string;
  lastSeq: number;
}

/**
 * One authoritative multiplayer session: a GameSimulation stepping at 60 Hz,
 * fed by client inputs, broadcasting per-player snapshots at 30 Hz.
 * The scene is snapshotted at creation — editing the project doesn't disturb a live match.
 */
export class Room extends EventEmitter<{ closed: [] }> {
  readonly id: string;
  private readonly clients = new Map<WebSocket, Client>();
  private loop: NodeJS.Timeout | undefined;
  private acc = 0;
  private last = performance.now();
  private lastSnap = 0;
  private seq = 0;
  private emptySince = Date.now();
  readonly createdAt = Date.now();

  private constructor(
    private readonly sim: GameSimulation,
    private readonly doc: SceneDoc,
    readonly projectId: string,
    readonly name: string,
  ) {
    super();
    this.id = newId('room').slice(5, 11).toUpperCase();
  }

  static async create(doc: SceneDoc, projectId: string, name: string): Promise<Room> {
    const sim = await GameSimulation.create(doc);
    const room = new Room(sim, structuredClone(doc), projectId, name);
    room.start();
    return room;
  }

  info(): RoomInfo {
    return {
      roomId: this.id,
      projectId: this.projectId,
      name: this.name,
      genre: this.doc.game.genre,
      players: [...this.clients.values()].map((c) => ({ id: c.playerId, name: c.name })),
      maxPlayers: this.doc.game.maxPlayers,
      revision: this.doc.revision,
      createdAt: this.createdAt,
    };
  }

  /** Attach a socket. The client must send `join` before it gets a player. */
  attach(ws: WebSocket): void {
    ws.on('message', (raw) => {
      let msg: ReturnType<typeof NetClientMessage.parse>;
      try {
        msg = NetClientMessage.parse(JSON.parse(String(raw)));
      } catch {
        return; // ignore malformed packets
      }
      const c = this.clients.get(ws);
      if (msg.t === 'join') {
        if (c) return;
        if (this.clients.size >= this.doc.game.maxPlayers) return this.send(ws, { t: 'full', reason: `room is full (${this.doc.game.maxPlayers} players)` });
        const playerId = `p${++this.seq}`;
        this.sim.addPlayer(playerId, msg.name);
        this.clients.set(ws, { ws, playerId, name: msg.name, lastSeq: 0 });
        this.send(ws, { t: 'welcome', you: playerId, room: this.info(), doc: this.doc, tickRate: 60, snapRate: SNAP_HZ });
        return;
      }
      if (msg.t === 'command' && c) {
        this.sim.command(c.playerId, msg.cmd);
        return;
      }
      if (msg.t === 'ping') return this.send(ws, { t: 'pong', at: msg.at, serverTime: this.sim.time });
      if (msg.t === 'input' && c && msg.seq > c.lastSeq) {
        c.lastSeq = msg.seq;
        this.sim.setInput(c.playerId, msg.input);
      }
    });
    ws.on('close', () => {
      const c = this.clients.get(ws);
      this.clients.delete(ws);
      if (c) this.sim.removePlayer(c.playerId);
      if (!this.clients.size) this.emptySince = Date.now();
    });
  }

  private start(): void {
    // Windows timers are ~15 ms coarse; an accumulator keeps the sim at exactly 60 Hz on average.
    this.loop = setInterval(() => this.pump(), 5);
  }

  private pump(): void {
    const now = performance.now();
    this.acc += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 10) {
      this.sim.step();
      this.acc -= SIM_DT;
      steps++;
    }
    if (now - this.lastSnap >= 1000 / SNAP_HZ && this.clients.size) {
      this.lastSnap = now;
      this.broadcast();
    }
    if (!this.clients.size && Date.now() - this.emptySince > 120_000) this.close('empty for 2 minutes');
  }

  private broadcast(): void {
    const actors = this.sim.actorViews();
    const moving: NetXf[] = [];
    this.sim.forEachMoving((id, p, q) => moving.push([id, r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)]));
    const removed = [...this.sim.removed];
    for (const c of this.clients.values()) {
      this.send(c.ws, { t: 'snap', tick: this.sim.tick, time: this.sim.time, ack: c.lastSeq, actors, moving, removed, hud: this.sim.state(c.playerId) });
    }
  }

  private send(ws: WebSocket, msg: NetServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  close(reason: string): void {
    clearInterval(this.loop);
    for (const c of this.clients.values()) {
      this.send(c.ws, { t: 'closed', reason });
      c.ws.close();
    }
    this.clients.clear();
    this.sim.dispose();
    this.emit('closed');
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  async create(doc: SceneDoc, projectId: string, name: string): Promise<Room> {
    const room = await Room.create(doc, projectId, name);
    this.rooms.set(room.id, room);
    room.on('closed', () => this.rooms.delete(room.id));
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id.toUpperCase());
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()].map((r) => r.info());
  }

  closeAll(): void {
    for (const r of this.rooms.values()) r.close('server shutting down');
  }
}

export { IDLE_INPUT };
