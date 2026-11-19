import type { ActorView, EntityId, SceneDoc, SimState } from '@forge/contracts';
import type { Vector3 } from 'three';
import type { Command } from '../sim/gameplay';
import { GameSimulation, IDLE_INPUT, SIM_DT, type PlayerInput } from '../sim/simulation';

export interface MovingXf {
  p: [number, number, number];
  q: [number, number, number, number];
}

/** Everything the renderer needs for one frame. */
export interface ViewFrame {
  actors: ActorView[];
  moving: Map<EntityId, MovingXf>;
  removed: ReadonlySet<EntityId>;
}

/**
 * Where a play session's game state comes from. LocalSource runs the simulation
 * in-page; NetSource (multiplayer) receives authoritative snapshots from a server.
 * The renderer and HUD don't know the difference.
 */
export interface GameSource {
  readonly doc: SceneDoc;
  readonly me: string;
  update(dtSeconds: number, input: PlayerInput): void;
  frame(): ViewFrame;
  hud(): SimState | null;
  /** Camera collision. */
  castRay(origin: Vector3, dir: Vector3, maxDist: number): number | null;
  /** Player commands (tree unlocks, equip, use). Local: applied now. Network: sent to the server. */
  command(cmd: Command): void;
  dispose(): void;
}

export class LocalSource implements GameSource {
  private acc = 0;
  readonly me = 'p1';

  private constructor(
    readonly sim: GameSimulation,
    readonly doc: SceneDoc,
  ) {}

  static async create(doc: SceneDoc, playerName = 'You'): Promise<LocalSource> {
    const sim = await GameSimulation.create(doc);
    const s = new LocalSource(sim, doc);
    sim.addPlayer(s.me, playerName);
    return s;
  }

  update(dt: number, input: PlayerInput): void {
    this.sim.setInput(this.me, input);
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 6) {
      this.sim.step();
      // Edges were consumed by the first step; hold the analog part.
      this.sim.setInput(this.me, { ...input, jump: false, interact: false, attack: false, heavy: false, ability: 0 });
      this.acc -= SIM_DT;
      steps++;
    }
  }

  frame(): ViewFrame {
    const moving = new Map<EntityId, MovingXf>();
    this.sim.forEachMoving((id, p, q) => moving.set(id, { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] }));
    return { actors: this.sim.actorViews(), moving, removed: this.sim.removed };
  }

  hud(): SimState {
    return this.sim.state(this.me);
  }

  castRay(origin: Vector3, dir: Vector3, maxDist: number): number | null {
    return this.sim.castRay(origin, dir, maxDist, this.me);
  }

  command(cmd: Command): void {
    this.sim.command(this.me, cmd);
  }

  dispose(): void {
    this.sim.dispose();
  }
}

export { IDLE_INPUT };
