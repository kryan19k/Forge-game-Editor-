import RAPIER from '@dimforge/rapier3d-compat';
import type {
  ActorAnim,
  ActorKind,
  ActorView,
  Entity,
  EntityId,
  GameSettings,
  Objective,
  SceneDoc,
  SimEvent,
  SimEventType,
  SimFocus,
  SimState,
} from '@forge/contracts';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { Gameplay, rollLoot, type Command, type Kit } from './gameplay';
import type { AbilityDef, EffectSpec, KitView } from '@forge/contracts';

/**
 * GameSimulation — the playable game, minus pixels.
 *
 * Multi-actor (players, bots, NPCs), fixed 60 Hz, deterministic for identical
 * inputs and seed. Runs in the browser (play mode), in Node (agent playtests, CI)
 * and as the authoritative multiplayer server. Never mutates the authoring scene.
 */

export const SIM_DT = 1 / 60;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export const PLAYER = { radius: 0.35, halfHeight: 0.55, reach: 2.6, eye: 1.55 } as const;
const CENTER_TO_FEET = PLAYER.halfHeight + PLAYER.radius;
const CAR = { hx: 0.95, hy: 0.45, hz: 2.0 } as const;

export type Controller = 'character' | 'vehicle' | 'fighter';

export interface PlayerInput {
  /** x = strafe/steer right, y = forward/throttle. */
  move: [number, number];
  sprint: boolean;
  /** Edge-triggered: true for the tick the button went down. */
  jump: boolean;
  interact: boolean;
  attack: boolean;
  heavy: boolean;
  /** Held. */
  block: boolean;
  /** Ability bar slot pressed (edge), 1–6; 0 = none. */
  ability: number;
  /** Camera yaw in radians (character aim). 0 faces -Z. */
  yaw: number;
}

export const IDLE_INPUT: PlayerInput = { move: [0, 0], sprint: false, jump: false, interact: false, attack: false, heavy: false, block: false, ability: 0, yaw: 0 };

interface AttackSpec {
  damage: number;
  range: number;
  windup: number;
  cooldown: number;
  knock: number;
  stun: number;
}

interface Actor {
  id: string;
  kind: ActorKind;
  name: string;
  controller: Controller;
  entityId?: EntityId;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  feetOffset: number;
  radius: number;
  vy: number;
  grounded: boolean;
  yaw: number;
  speed: number;
  vel: number;
  knock: Vector3;
  health: number;
  maxHealth: number;
  regen: number;
  alive: boolean;
  respawnAt: number;
  team: string;
  hostile: boolean;
  attack: { spec: AttackSpec; t: number; hit: boolean } | null;
  cooldown: number;
  hitstun: number;
  blocking: boolean;
  input: PlayerInput;
  autopilot: boolean;
  inventory: Map<string, number>;
  talk: Map<EntityId, number>;
  dialogue: SimState['dialogue'];
  focus: SimFocus | null;
  spawnIndex: number;
  spawn: { at: Vector3; yaw: number };
  lockZ: number;
  // npc brain
  home: Vector3;
  wander: Vector3 | null;
  idleUntil: number;
  targetId: string | null;
  removeAt: number;
  // racing
  race: { next: number; lap: number; crossed: number; finished: boolean; finishTime: number; lapStart: number; bestLap: number | null };
  stuckFor: number;
  reverseUntil: number;
  // fighting bot
  decideAt: number;
  plan: 'approach' | 'block' | 'retreat' | 'idle';
  result: 'won' | 'lost' | null;
  deaths: number;
  /** Gameplay-framework state (stats, abilities, statuses, progression); null if unused. */
  kit: Kit | null;
}

interface WorldXf {
  matrix: Matrix4;
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
}

interface Box {
  center: Vector3;
  half: Vector3;
}

interface DoorState {
  entityId: EntityId;
  body: RAPIER.RigidBody;
  closed: Vector3;
  openOffset: Vector3;
  t: number;
  target: 0 | 1;
}

interface ObjectiveState {
  def: Objective;
  progress: number;
  done: boolean;
}

let ready: Promise<void> | null = null;
/** Load Rapier's WASM once per process. */
export function initPhysics(): Promise<void> {
  return (ready ??= RAPIER.init());
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (n: number) => Math.round(n * 1000) / 1000;
const fwdOf = (yaw: number) => new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
/** Yaw that faces from `from` toward `to` on the XZ plane (0 = -Z). */
export function yawToward(from: Vector3, to: Vector3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export class GameSimulation {
  readonly world: RAPIER.World;
  readonly doc: SceneDoc;
  readonly game: GameSettings;
  time = 0;
  tick = 0;
  readonly events: SimEvent[] = [];
  readonly removed = new Set<EntityId>();
  readonly actors = new Map<string, Actor>();
  readonly gp: Gameplay;

  private readonly random: () => number;
  private readonly xf = new Map<EntityId, WorldXf>();
  private readonly moving = new Map<EntityId, RAPIER.RigidBody>();
  private readonly colliders = new Map<EntityId, RAPIER.Collider>();
  private readonly doors = new Map<EntityId, DoorState>();
  private readonly triggers = new Map<EntityId, Box>();
  private readonly inside = new Map<string, Set<EntityId>>();
  private readonly checkpoints: Array<{ entityId: EntityId; box: Box }> = [];
  private readonly spawns: Array<{ at: Vector3; yaw: number; team: string }> = [];
  private readonly objectives: ObjectiveState[] = [];
  private readonly defeats = new Map<string, number>();
  private readonly dialogueSeen = new Set<EntityId>();
  private race: { phase: 'countdown' | 'racing' | 'finished'; startAt: number } | null = null;
  private fight: { phase: 'intro' | 'fight' | 'ko' | 'over'; round: number; timer: number; wins: Map<string, number> } | null = null;
  private matchDone = false;
  private nextPlayerSlot = 0;

  /**
   * @param opts.collisionOnly static world only — no NPCs, bots or moving bodies.
   *   Network clients use this purely for camera collision; the server owns the game.
   */
  static async create(doc: SceneDoc, opts: { collisionOnly?: boolean } = {}): Promise<GameSimulation> {
    await initPhysics();
    return new GameSimulation(doc, opts.collisionOnly ?? false);
  }

  private constructor(doc: SceneDoc, collisionOnly = false) {
    this.doc = structuredClone(doc);
    this.game = this.doc.game;
    this.random = rng(this.game.seed);
    this.gp = new Gameplay(this.doc.database);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_DT;

    for (const e of Object.values(this.doc.entities)) this.worldXf(e.id);
    for (const e of Object.values(this.doc.entities)) {
      if (!this.active(e)) continue;
      if (collisionOnly) {
        if (!e.components.npc && (e.components.rigidBody?.kind ?? 'static') === 'static') this.buildPhysics(e);
        continue;
      }
      if (e.components.npc) this.spawnNpc(e);
      else this.buildPhysics(e);
      if (e.components.checkpoint) this.checkpoints.push({ entityId: e.id, box: this.boxOf(e) });
      if (e.components.spawnPoint) {
        const x = this.worldXf(e.id);
        this.spawns.push({ at: x.position.clone(), yaw: new Euler().setFromQuaternion(x.quaternion, 'YXZ').y, team: e.components.spawnPoint.team });
      }
    }
    this.checkpoints.sort((a, b) => this.doc.entities[a.entityId]!.components.checkpoint!.order - this.doc.entities[b.entityId]!.components.checkpoint!.order);
    if (!this.spawns.length) this.spawns.push({ at: new Vector3(0, 0.5, 0), yaw: 0, team: 'any' });

    const defs: Objective[] = this.game.objectives.length
      ? this.game.objectives
      : Object.values(this.doc.entities)
          .filter((e) => e.tags.includes('objective') && e.components.interactable && this.active(e))
          .map((e) => ({ id: e.id, label: e.components.interactable!.prompt, kind: 'interact' as const, target: e.id, count: 1 }));
    for (const def of defs) this.objectives.push({ def, progress: 0, done: false });

    if (this.game.win === 'race' || this.checkpoints.length) this.race = { phase: 'countdown', startAt: 3 };
    if (this.game.win === 'ko' || this.game.controller === 'fighter') this.fight = { phase: 'intro', round: 1, timer: 1.6, wins: new Map() };

    for (let i = 0; i < (collisionOnly ? 0 : this.game.bots); i++) {
      const slot = this.spawns.length - 1 - (i % this.spawns.length);
      this.addActor(`bot${i + 1}`, this.botName(i), 'bot', slot);
    }
  }

  /* ── players ───────────────────────────────────────────────────────── */

  addPlayer(id: string, name = id): string {
    if (this.actors.has(id)) return id;
    let slot = this.nextPlayerSlot++ % this.spawns.length;
    // Bots are seat-fillers: when the arena/grid is full, a joining human takes a bot's seat.
    const humans = [...this.actors.values()].filter((a) => a.kind === 'player').length;
    const bots = [...this.actors.values()].filter((a) => a.kind === 'bot');
    if (bots.length && humans + bots.length >= this.spawns.length) {
      const bot = bots.find((b) => b.spawnIndex === slot) ?? bots[bots.length - 1]!;
      slot = bot.spawnIndex;
      this.world.removeCharacterController(bot.kcc);
      this.world.removeRigidBody(bot.body);
      this.actors.delete(bot.id);
    }
    this.addActor(id, name, 'player', slot);
    this.emit('player_joined', id, undefined, name);
    return id;
  }

  removePlayer(id: string): void {
    const a = this.actors.get(id);
    if (!a || a.kind === 'npc') return;
    this.world.removeCharacterController(a.kcc);
    this.world.removeRigidBody(a.body);
    this.actors.delete(id);
    this.emit('player_left', id);
  }

  setInput(id: string, input: PlayerInput): void {
    const a = this.actors.get(id);
    if (!a || a.kind === 'npc') return;
    // Edges accumulate until consumed by a step so taps between ticks are never lost.
    a.input = {
      ...input,
      jump: a.input.jump || input.jump,
      interact: a.input.interact || input.interact,
      attack: a.input.attack || input.attack,
      heavy: a.input.heavy || input.heavy,
      ability: a.input.ability || input.ability || 0,
    };
  }

  setAutopilot(id: string, on: boolean): void {
    const a = this.actors.get(id);
    if (a) a.autopilot = on;
  }

  private botName(i: number): string {
    const names = this.game.controller === 'vehicle' ? ['Vex', 'Rook', 'Juno', 'Kade', 'Nyx', 'Orrin'] : ['Sparring Bot', 'Brawler', 'Duelist'];
    return names[i % names.length]!;
  }

  private addActor(id: string, name: string, kind: 'player' | 'bot', slot: number): Actor {
    const spawn = this.spawns[slot]!;
    const controller = this.game.controller;
    const car = controller === 'vehicle';
    const feetOffset = car ? CAR.hy : CENTER_TO_FEET;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(spawn.at.x, spawn.at.y + feetOffset + 0.02, spawn.at.z)
        .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spawn.yaw)),
    );
    const collider = this.world.createCollider(
      car ? RAPIER.ColliderDesc.cuboid(CAR.hx, CAR.hy, CAR.hz) : RAPIER.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius),
      body,
    );
    const a = this.makeActor({
      id,
      name,
      kind,
      controller,
      body,
      collider,
      kcc: this.makeKcc(car),
      feetOffset,
      radius: car ? CAR.hx : PLAYER.radius,
      health: this.game.player.health,
      team: controller === 'fighter' || this.game.pvp ? id : 'players',
      hostile: false,
      spawn: { at: spawn.at.clone(), yaw: spawn.yaw },
      spawnIndex: slot,
    });
    a.lockZ = spawn.at.z;
    a.autopilot = kind === 'bot';
    if (this.gp.active) {
      const lo = this.doc.database.loadout;
      a.kit = this.gp.createKit({}, lo.abilities);
      for (const [item, n] of lo.items) a.inventory.set(item, (a.inventory.get(item) ?? 0) + n);
      this.syncHealth(a, true);
    }
    this.actors.set(id, a);
    return a;
  }

  private makeKcc(car: boolean): RAPIER.KinematicCharacterController {
    const kcc = this.world.createCharacterController(0.02);
    if (!car) kcc.enableAutostep(0.4, 0.2, false);
    kcc.enableSnapToGround(car ? 0.5 : 0.3);
    kcc.setMaxSlopeClimbAngle((car ? 35 : 50) * DEG);
    kcc.setMinSlopeSlideAngle(35 * DEG);
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(car ? 900 : 80);
    return kcc;
  }

  private makeActor(p: Pick<Actor, 'id' | 'name' | 'kind' | 'controller' | 'body' | 'collider' | 'kcc' | 'feetOffset' | 'radius' | 'health' | 'team' | 'hostile' | 'spawn' | 'spawnIndex'> & { entityId?: EntityId; regen?: number }): Actor {
    return {
      ...p,
      ...(p.entityId ? { entityId: p.entityId } : {}),
      vy: 0,
      grounded: false,
      yaw: p.spawn.yaw,
      speed: 0,
      vel: 0,
      knock: new Vector3(),
      maxHealth: p.health,
      regen: p.regen ?? 0,
      alive: true,
      respawnAt: 0,
      attack: null,
      cooldown: 0,
      hitstun: 0,
      blocking: false,
      input: { ...IDLE_INPUT, yaw: p.spawn.yaw },
      autopilot: false,
      inventory: new Map(),
      talk: new Map(),
      dialogue: null,
      focus: null,
      lockZ: p.spawn.at.z,
      home: p.spawn.at.clone(),
      wander: null,
      idleUntil: 0,
      targetId: null,
      removeAt: 0,
      race: { next: 0, lap: 0, crossed: 0, finished: false, finishTime: 0, lapStart: 0, bestLap: null },
      stuckFor: 0,
      reverseUntil: 0,
      decideAt: 0,
      plan: 'idle',
      result: null,
      deaths: 0,
      kit: null,
    };
  }

  private spawnNpc(e: Entity): void {
    const x = this.worldXf(e.id);
    const size = e.components.mesh?.size ?? [0.7, 1.8, 0.7];
    const r = clamp((Math.max(size[0], size[2]) / 2) * Math.max(x.scale.x, x.scale.z), 0.15, 3);
    const halfH = Math.max(((size[1] / 2) * x.scale.y) - r, 0.05);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x.position.x, x.position.y, x.position.z));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfH, r), body);
    const npc = e.components.npc!;
    const hp = e.components.health?.max ?? 0;
    const a = this.makeActor({
      id: `npc:${e.id}`,
      name: e.name,
      kind: 'npc',
      controller: 'character',
      body,
      collider,
      kcc: this.makeKcc(false),
      feetOffset: halfH + r,
      radius: r,
      health: hp > 0 ? hp : 1e9,
      team: npc.hostile ? 'hostile' : 'neutral',
      hostile: npc.hostile,
      spawn: { at: x.position.clone().setY(x.position.y - (halfH + r)), yaw: new Euler().setFromQuaternion(x.quaternion, 'YXZ').y },
      spawnIndex: -1,
      entityId: e.id,
      regen: e.components.health?.regen ?? 0,
    });
    if (hp <= 0) a.maxHealth = 0; // invulnerable
    const unit = e.components.unit;
    if (unit || (this.gp.active && hp > 0)) {
      a.kit = this.gp.createKit(unit?.stats ?? {}, unit?.abilities ?? [], unit?.level ?? 1);
      if (this.gp.has('health') || unit?.stats.health !== undefined) this.syncHealth(a, true);
    }
    this.actors.set(a.id, a);
  }

  /* ── stepping ──────────────────────────────────────────────────────── */

  step(): void {
    this.tick++;
    this.time = this.tick * SIM_DT;
    this.stepPhases();
    for (const a of this.actors.values()) {
      if (a.autopilot) a.input = this.autopilotInput(a);
      this.stepActor(a);
    }
    this.stepDoors();
    this.world.step();
    for (const a of this.actors.values()) this.afterActor(a);
    this.updateObjectives();
    for (const a of this.actors.values()) a.input = { ...a.input, jump: false, interact: false, attack: false, heavy: false, ability: 0 };
  }

  /** Advance N seconds synchronously (headless runs are far faster than real time). */
  advance(seconds: number, each?: () => void): void {
    const ticks = Math.max(1, Math.round(seconds / SIM_DT));
    for (let i = 0; i < ticks; i++) {
      each?.();
      this.step();
    }
  }

  private frozen(a: Actor): boolean {
    if (this.race && this.race.phase === 'countdown') return true;
    if (this.fight && this.fight.phase !== 'fight') return a.kind !== 'npc';
    if (a.race.finished && a.controller === 'vehicle') return false;
    return false;
  }

  private stepActor(a: Actor): void {
    a.cooldown = Math.max(0, a.cooldown - SIM_DT);
    a.hitstun = Math.max(0, a.hitstun - SIM_DT);
    if (a.regen && a.alive && a.maxHealth > 0) a.health = Math.min(a.maxHealth, a.health + a.regen * SIM_DT);
    if (!a.alive) {
      a.speed = 0;
      return;
    }
    if (a.kit) this.stepKit(a, a.kit);
    if (!a.alive) return;
    const stunned = !!a.kit && this.gp.stunned(a.kit);
    const inp = this.frozen(a) || a.hitstun > 0 || stunned ? { ...IDLE_INPUT, yaw: a.input.yaw, block: a.input.block } : a.input;
    if (a.kit && inp.ability) {
      const id = a.kit.bar[inp.ability - 1];
      if (id) this.cast(a, id);
    }
    if (a.kind === 'npc') this.npcBrain(a);
    else if (a.controller === 'vehicle') return this.moveVehicle(a, inp);

    if (a.controller === 'fighter') this.moveFighter(a, inp);
    else if (a.kind !== 'npc') this.moveCharacter(a, inp, inp.sprint ? this.game.player.sprintSpeed : this.game.player.walkSpeed);

    if (a.kind !== 'npc') {
      a.blocking = inp.block && a.controller === 'fighter' && !a.attack;
      // Attack buttons cast bound abilities when the game defines them (rifle, firebolt…), else melee.
      const primary = this.game.player.primaryAbility;
      const secondary = this.game.player.secondaryAbility;
      if (inp.heavy && secondary && a.kit?.abilities.includes(secondary)) this.cast(a, secondary);
      else if (inp.attack && primary && a.kit?.abilities.includes(primary)) this.cast(a, primary);
      else if (inp.attack || inp.heavy) this.startAttack(a, inp.heavy ? 'heavy' : 'light');
    }
    this.stepAttack(a);
  }

  private readonly isActorCollider = (c: RAPIER.Collider): boolean => {
    for (const x of this.actors.values()) if (x.collider.handle === c.handle) return true;
    return false;
  };

  private applyMove(a: Actor, desired: { x: number; y: number; z: number }): RAPIER.Vector {
    // Cars don't block each other in the KCC (overlapping kinematic boxes deadlock);
    // they bump via soft separation in moveVehicle instead.
    if (a.controller === 'vehicle') a.kcc.computeColliderMovement(a.collider, desired, undefined, undefined, (c) => !this.isActorCollider(c));
    else a.kcc.computeColliderMovement(a.collider, desired);
    const mv = a.kcc.computedMovement();
    a.grounded = a.kcc.computedGrounded();
    if (a.vy > 0 && mv.y < desired.y * 0.5) a.vy = 0;
    const t = a.body.translation();
    a.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    a.speed = Math.hypot(mv.x, mv.z) / SIM_DT;
    return mv;
  }

  private gravity(a: Actor, jump: boolean, jumpSpeed: number): void {
    if (a.grounded && jump) a.vy = jumpSpeed;
    else if (a.grounded && a.vy <= 0) a.vy = -2;
    else a.vy -= 22 * SIM_DT;
  }

  private moveCharacter(a: Actor, inp: PlayerInput, speed: number): void {
    a.yaw = inp.yaw;
    const fwd = fwdOf(inp.yaw);
    const right = new Vector3(Math.cos(inp.yaw), 0, -Math.sin(inp.yaw));
    const wish = fwd.multiplyScalar(inp.move[1]).add(right.multiplyScalar(inp.move[0]));
    if (wish.lengthSq() > 1) wish.normalize();
    if (a.attack) wish.multiplyScalar(0.35);
    const rooted = !!a.kit && this.gp.rooted(a.kit);
    wish.multiplyScalar(rooted ? 0 : speed * this.gp.moveScale(a.kit) * (a.kit?.casting ? 0.4 : 1)).add(a.knock);
    a.knock.multiplyScalar(0.86);
    this.gravity(a, inp.jump, this.game.player.jump);
    this.applyMove(a, { x: wish.x * SIM_DT, y: a.vy * SIM_DT, z: wish.z * SIM_DT });
  }

  private moveFighter(a: Actor, inp: PlayerInput): void {
    const opp = this.opponentOf(a);
    const pos = this.feet(a);
    if (opp) a.yaw = this.feet(opp).x >= pos.x ? -Math.PI / 2 : Math.PI / 2;
    const dx = a.blocking || a.attack ? 0 : inp.move[0] * 4.6;
    this.gravity(a, inp.jump, 8.5);
    const vx = dx + a.knock.x;
    a.knock.multiplyScalar(0.85);
    this.applyMove(a, { x: vx * SIM_DT, y: a.vy * SIM_DT, z: (a.lockZ - pos.z) * 0.5 });
  }

  private moveVehicle(a: Actor, inp: PlayerInput): void {
    const v = this.game.vehicle;
    const throttle = this.frozen(a) ? 0 : inp.move[1];
    const steer = this.frozen(a) ? 0 : inp.move[0];
    if (throttle > 0) a.vel += (a.vel < 0 ? v.braking : v.acceleration) * throttle * SIM_DT;
    else if (throttle < 0) a.vel += (a.vel > 0.5 ? -v.braking : -v.acceleration * 0.5) * -throttle * SIM_DT;
    else a.vel *= 1 - 0.55 * SIM_DT;
    a.vel = clamp(a.vel, -9, v.maxSpeed);
    const grip = clamp(Math.abs(a.vel) / 9, 0, 1) * Math.sign(a.vel);
    a.yaw = wrap(a.yaw - steer * v.turnRate * grip * SIM_DT * (1 - clamp(Math.abs(a.vel) / (v.maxSpeed * 2.4), 0, 0.4)));
    this.gravity(a, false, 0);
    const f = fwdOf(a.yaw).multiplyScalar(a.vel * SIM_DT);
    // Soft car-to-car contact: push apart, scrub a little speed.
    const me = this.feet(a);
    for (const b of this.actors.values()) {
      if (b === a || b.controller !== 'vehicle' || !b.alive) continue;
      const away = me.clone().sub(this.feet(b)).setY(0);
      const d = away.length();
      if (d > 0.01 && d < 2.8) {
        f.addScaledVector(away.normalize(), (2.8 - d) * 0.12);
        if (fwdOf(a.yaw).dot(away) < -0.3) a.vel *= 0.985;
      }
    }
    a.body.setNextKinematicRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw));
    const mv = this.applyMove(a, { x: f.x, y: a.vy * SIM_DT, z: f.z });
    const actual = Math.hypot(mv.x, mv.z) / SIM_DT;
    if (Math.abs(a.vel) > 4 && actual < Math.abs(a.vel) * 0.55) a.vel *= 0.6; // scraped a wall
    a.speed = actual;
  }

  private stepDoors(): void {
    for (const d of this.doors.values()) {
      if (d.t === d.target) continue;
      d.t = d.target > d.t ? Math.min(1, d.t + SIM_DT / 0.9) : Math.max(0, d.t - SIM_DT / 0.9);
      const k = d.t * d.t * (3 - 2 * d.t);
      d.body.setNextKinematicTranslation(d.closed.clone().addScaledVector(d.openOffset, k));
    }
  }

  private afterActor(a: Actor): void {
    if (!a.alive) {
      if (a.kind === 'npc' && a.removeAt && this.time >= a.removeAt) {
        a.removeAt = 0;
        if (a.entityId) this.removed.add(a.entityId);
        a.body.setEnabled(false);
      }
      if (a.respawnAt && this.time >= a.respawnAt) this.revive(a);
      return;
    }
    const feet = this.feet(a);
    if (feet.y < -25) {
      if (a.kind === 'npc') return this.down(a, null);
      this.emit('fell_out_of_world', a.id, undefined, `at ${feet.x.toFixed(1)},${feet.y.toFixed(1)},${feet.z.toFixed(1)}`);
      this.place(a, a.spawn.at, a.spawn.yaw);
    }
    if (a.kind === 'npc') return;
    this.updateTriggers(a);
    if (this.race) this.updateRace(a);
    if (a.kind === 'player') {
      a.focus = this.computeFocus(a);
      if (a.input.interact) this.interact(a);
    }
  }

  private stepPhases(): void {
    if (this.race?.phase === 'countdown' && this.time >= this.race.startAt) {
      this.race.phase = 'racing';
      for (const a of this.actors.values()) a.race.lapStart = this.time;
    }
    const f = this.fight;
    if (!f || f.phase === 'over') return;
    f.timer -= SIM_DT;
    if (f.phase === 'intro' && f.timer <= 0) {
      f.phase = 'fight';
      this.emit('round_start', undefined, undefined, `Round ${f.round}`);
    } else if (f.phase === 'fight') {
      const fighters = [...this.actors.values()].filter((a) => a.kind !== 'npc');
      const alive = fighters.filter((a) => a.alive);
      if (fighters.length >= 2 && alive.length <= 1) {
        const winner = alive[0];
        if (winner) f.wins.set(winner.id, (f.wins.get(winner.id) ?? 0) + 1);
        this.emit('round_end', winner?.id, undefined, winner ? `${winner.name} wins round ${f.round}` : 'Double KO');
        const need = Math.ceil(this.game.rounds / 2);
        if (winner && (f.wins.get(winner.id) ?? 0) >= need) {
          f.phase = 'over';
          for (const a of fighters) this.finishMatch(a, a.id === winner.id ? 'won' : 'lost');
        } else {
          f.phase = 'ko';
          f.timer = 2.2;
        }
      }
    } else if (f.phase === 'ko' && f.timer <= 0) {
      f.round++;
      f.phase = 'intro';
      f.timer = 1.4;
      for (const a of this.actors.values()) if (a.kind !== 'npc') this.revive(a);
    }
  }

  /* ── combat ────────────────────────────────────────────────────────── */

  private specFor(a: Actor, kind: 'light' | 'heavy'): AttackSpec {
    if (a.kind === 'npc') {
      const c = a.entityId ? this.doc.entities[a.entityId]?.components.combat : undefined;
      return { damage: c?.damage ?? 8, range: c?.range ?? 1.6, windup: 0.35, cooldown: c?.cooldown ?? 1.2, knock: 3, stun: 0.2 };
    }
    if (a.controller === 'fighter')
      return kind === 'heavy'
        ? { damage: 16, range: 1.95, windup: 0.3, cooldown: 0.85, knock: 7, stun: 0.45 }
        : { damage: 7, range: 1.6, windup: 0.1, cooldown: 0.36, knock: 3, stun: 0.24 };
    const p = this.game.player;
    return kind === 'heavy'
      ? { damage: p.damage * 1.8, range: p.attackRange * 1.1, windup: 0.3, cooldown: p.attackCooldown * 2, knock: 6, stun: 0.35 }
      : { damage: p.damage, range: p.attackRange, windup: 0.12, cooldown: p.attackCooldown, knock: 3.5, stun: 0.2 };
  }

  private startAttack(a: Actor, kind: 'light' | 'heavy'): void {
    if (!a.alive || a.attack || a.cooldown > 0 || a.hitstun > 0 || a.controller === 'vehicle') return;
    const spec = this.specFor(a, kind);
    a.attack = { spec, t: 0, hit: false };
    a.cooldown = spec.cooldown;
  }

  private stepAttack(a: Actor): void {
    const atk = a.attack;
    if (!atk) return;
    atk.t += SIM_DT;
    if (!atk.hit && atk.t >= atk.spec.windup) {
      atk.hit = true;
      const at = this.feet(a);
      const facing = fwdOf(a.yaw);
      for (const b of this.actors.values()) {
        if (!this.canHit(a, b)) continue;
        const to = this.feet(b).sub(at).setY(0);
        const dist = to.length() - b.radius;
        if (dist > atk.spec.range) continue;
        if (to.lengthSq() > 0.01 && to.normalize().dot(facing) < 0.34) continue;
        this.damage(b, atk.spec, a, to);
      }
    }
    if (atk.t >= atk.spec.windup + 0.16) a.attack = null;
  }

  private canHit(a: Actor, b: Actor): boolean {
    if (a === b || !b.alive || b.maxHealth <= 0) return false;
    if (a.kind === 'npc') return a.hostile && b.kind !== 'npc';
    if (b.kind === 'npc') return b.hostile;
    return a.controller === 'fighter' || this.game.pvp;
  }

  private damage(b: Actor, spec: AttackSpec, from: Actor, dir: Vector3): void {
    const facingAttacker = fwdOf(b.yaw).dot(dir.clone().negate()) > 0.2;
    const blocked = b.blocking && facingAttacker;
    const out = this.gp.outgoing(from.kit, spec.damage, this.random());
    const amount = Math.round(this.gp.incoming(b.kit, blocked ? out.amount * 0.2 : out.amount));
    b.health = Math.max(0, b.health - amount);
    b.knock.copy(dir).setY(0).normalize().multiplyScalar(blocked ? spec.knock * 0.35 : spec.knock);
    if (!blocked) {
      b.hitstun = spec.stun;
      b.attack = null;
    }
    if (b.kind === 'npc' && !b.targetId) b.targetId = from.id;
    this.emit(blocked ? 'blocked' : 'hit', from.id, b.entityId, `${b.name} −${amount}${blocked ? ' (blocked)' : ''}`);
    if (b.health <= 0) this.down(b, from);
  }

  private down(a: Actor, by: Actor | null): void {
    a.alive = false;
    a.attack = null;
    a.deaths++;
    if (a.kind === 'npc') {
      this.emit('defeated', by?.id, a.entityId, a.name);
      if (by && by.kind !== 'npc') this.reward(by, a);
      const e = a.entityId ? this.doc.entities[a.entityId] : undefined;
      for (const key of [a.entityId ?? '', ...(e?.tags ?? []).map((t) => `#${t}`)]) if (key) this.defeats.set(key, (this.defeats.get(key) ?? 0) + 1);
      this.bumpDefeatObjectives(e);
      const respawn = e?.components.npc?.respawnSeconds ?? 0;
      if (respawn > 0) a.respawnAt = this.time + respawn;
      else a.removeAt = this.time + 1.2;
      a.collider.setEnabled(false);
      return;
    }
    this.emit('player_down', a.id, undefined, by ? `by ${by.name}` : undefined);
    if (!this.fight && this.game.respawnSeconds >= 0) a.respawnAt = this.time + this.game.respawnSeconds;
    a.collider.setEnabled(false);
  }

  private revive(a: Actor): void {
    a.alive = true;
    a.respawnAt = 0;
    a.health = a.maxHealth > 0 ? a.maxHealth : 1e9;
    if (a.kit) (a.kit.statuses = []), (a.kit.casting = null), this.gp.refill(a.kit);
    a.hitstun = 0;
    a.attack = null;
    a.knock.set(0, 0, 0);
    a.targetId = null;
    a.collider.setEnabled(true);
    a.body.setEnabled(true);
    if (a.entityId) this.removed.delete(a.entityId);
    this.place(a, a.kind === 'npc' ? a.home : a.spawn.at, a.spawn.yaw);
    this.emit(a.kind === 'npc' ? 'npc_respawn' : 'respawn', a.id, a.entityId);
  }

  /* ── AI ────────────────────────────────────────────────────────────── */

  private npcBrain(a: Actor): void {
    const e = this.doc.entities[a.entityId!]!;
    const npc = e.components.npc!;
    const at = this.feet(a);
    let goal: Vector3 | null = null;
    let speed = npc.speed;

    if (a.hostile) {
      let target = a.targetId ? this.actors.get(a.targetId) : undefined;
      if (!target || !target.alive || target.kind === 'npc') {
        target = undefined;
        let best = npc.aggroRadius;
        for (const b of this.actors.values()) {
          if (b.kind === 'npc' || !b.alive) continue;
          const d = this.feet(b).distanceTo(at);
          if (d < best) (best = d), (target = b);
        }
      }
      if (target && at.distanceTo(a.home) > Math.max(npc.aggroRadius * 2.5, 12)) target = undefined; // leash
      a.targetId = target?.id ?? null;
      if (target) {
        const tp = this.feet(target);
        const d = Math.hypot(tp.x - at.x, tp.z - at.z) - target.radius;
        a.yaw = yawToward(at, tp);
        const range = this.specFor(a, 'light').range;
        const usable = a.kit?.abilities.find((id) => {
          const ab = this.gp.abilities.get(id)!;
          return !this.gp.blocked(a.kit!, id) && (ab.target === 'self' || d <= Math.max(ab.range, ab.radius));
        });
        if (usable && !a.attack) this.cast(a, usable);
        else if (d > range * 0.85) (goal = tp), (speed = npc.speed * 1.3);
        else this.startAttack(a, 'light');
      }
    }
    if (!goal && !a.targetId) {
      if (npc.behavior === 'wander' && npc.wanderRadius > 0) {
        if (!a.wander && this.time >= a.idleUntil) {
          const ang = this.random() * TAU;
          const r = Math.sqrt(this.random()) * npc.wanderRadius;
          a.wander = a.home.clone().add(new Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
        }
        if (a.wander) {
          if (Math.hypot(a.wander.x - at.x, a.wander.z - at.z) < 0.6) {
            a.wander = null;
            a.idleUntil = this.time + 1.5 + this.random() * 3;
          } else goal = a.wander;
        }
      } else if (at.distanceTo(a.home) > 1.2) goal = a.home;
    }
    let wish = new Vector3();
    if (goal) {
      a.yaw = yawToward(at, goal);
      wish = fwdOf(a.yaw).multiplyScalar(speed);
    }
    if (a.attack) wish.multiplyScalar(0.2);
    wish.add(a.knock);
    a.knock.multiplyScalar(0.85);
    this.gravity(a, false, 0);
    const before = a.speed;
    this.applyMove(a, { x: wish.x * SIM_DT, y: a.vy * SIM_DT, z: wish.z * SIM_DT });
    if (goal && a.wander && a.speed < 0.05 && before < 0.05) a.wander = null; // blocked: pick another spot
  }

  /** The built-in pilot: racing line, sparring bot, or hostile hunter — used by bots and `autopilot`. */
  autopilotInput(a: Actor): PlayerInput {
    const base: PlayerInput = { ...IDLE_INPUT, yaw: a.yaw };
    if (!a.alive) return base;
    const at = this.feet(a);

    if (a.controller === 'vehicle' && this.checkpoints.length) {
      const cp = this.checkpoints[a.race.next % this.checkpoints.length]!;
      const nxt = this.checkpoints[(a.race.next + 1) % this.checkpoints.length]!;
      const target = cp.box.center.clone().lerp(nxt.box.center, 0.2);
      const diff = wrap(yawToward(at, target) - a.yaw);
      if (a.speed < 1.2 && this.race?.phase === 'racing') a.stuckFor += SIM_DT;
      else a.stuckFor = 0;
      if (a.stuckFor > 1.2) (a.reverseUntil = this.time + 1.0), (a.stuckFor = 0);
      if (this.time < a.reverseUntil) return { ...base, move: [clamp(diff * 2, -1, 1), -1] };
      const sharp = Math.abs(diff) > 0.8 && a.vel > 13;
      return { ...base, move: [clamp(-diff * 2.2, -1, 1), sharp ? -0.4 : 1] };
    }

    if (a.controller === 'fighter') {
      const opp = this.opponentOf(a);
      if (!opp || !opp.alive) return base;
      const op = this.feet(opp);
      const dx = op.x - at.x;
      const dist = Math.abs(dx);
      if (this.time >= a.decideAt) {
        a.decideAt = this.time + 0.18;
        const threatened = !!opp.attack && opp.attack.t < opp.attack.spec.windup && dist < 2.4;
        const r = this.random();
        a.plan = threatened && r < 0.45 ? 'block' : a.health < a.maxHealth * 0.3 && r < 0.12 ? 'retreat' : dist > 1.35 ? 'approach' : 'idle';
      }
      const dir = Math.sign(dx);
      if (a.plan === 'block') return { ...base, block: true };
      if (a.plan === 'retreat') return { ...base, move: [-dir, 0] };
      if (a.plan === 'approach') return { ...base, move: [dir, 0] };
      if (a.cooldown <= 0 && !a.attack) return this.random() < 0.28 ? { ...base, heavy: true } : { ...base, attack: true };
      return base;
    }

    // Character: hunt the nearest hostile.
    let target: Actor | undefined;
    let best = Infinity;
    for (const b of this.actors.values()) {
      if (b.kind !== 'npc' || !b.hostile || !b.alive) continue;
      const d = this.feet(b).distanceTo(at);
      if (d < best) (best = d), (target = b);
    }
    if (!target) return base;
    const tp = this.feet(target);
    const yaw = yawToward(at, tp);
    const reach = this.game.player.attackRange + target.radius - 0.2;
    if (Math.hypot(tp.x - at.x, tp.z - at.z) > reach) return { ...base, yaw, move: [0, 1], sprint: best > 6 };
    return { ...base, yaw, attack: a.cooldown <= 0 };
  }

  private opponentOf(a: Actor): Actor | undefined {
    let best: Actor | undefined;
    let bd = Infinity;
    const at = this.feet(a);
    for (const b of this.actors.values()) {
      if (b === a || b.kind === 'npc') continue;
      const d = this.feet(b).distanceTo(at);
      if (d < bd) (bd = d), (best = b);
    }
    return best;
  }

  /* ── racing ────────────────────────────────────────────────────────── */

  private updateRace(a: Actor): void {
    const n = this.checkpoints.length;
    if (!n || a.race.finished || this.race?.phase === 'countdown') return;
    const cp = this.checkpoints[a.race.next % n]!;
    const p = this.feet(a).add(new Vector3(0, a.feetOffset, 0));
    if (!inBox(p, cp.box, 0.5)) return;
    const wasStart = a.race.next === 0;
    a.race.crossed++;
    a.race.next = (a.race.next + 1) % n;
    if (wasStart && a.race.crossed > 1) {
      a.race.lap++;
      const lapTime = this.time - a.race.lapStart;
      a.race.bestLap = a.race.bestLap === null ? lapTime : Math.min(a.race.bestLap, lapTime);
      a.race.lapStart = this.time;
      this.emit('lap', a.id, cp.entityId, `${a.name} lap ${a.race.lap}/${this.game.laps} · ${lapTime.toFixed(2)}s`);
      if (a.race.lap >= this.game.laps) {
        a.race.finished = true;
        a.race.finishTime = this.time;
        const place = this.placeOf(a);
        this.emit('race_finished', a.id, undefined, `${a.name} P${place} · ${(this.time - this.race!.startAt).toFixed(2)}s`);
        if (this.game.win === 'race' && a.kind === 'player') this.finishMatch(a, place === 1 ? 'won' : 'lost');
        if ([...this.actors.values()].filter((x) => x.kind === 'player').every((x) => x.race.finished)) this.race!.phase = 'finished';
      }
    } else this.emit('checkpoint', a.id, cp.entityId, `${a.race.crossed}`);
  }

  private progressOf(a: Actor): number {
    if (a.race.finished) return 1e9 - a.race.finishTime * 1000;
    const cp = this.checkpoints[a.race.next % Math.max(1, this.checkpoints.length)];
    const d = cp ? this.feet(a).distanceTo(cp.box.center) : 0;
    return a.race.crossed * 10000 - d;
  }

  private placeOf(a: Actor): number {
    const mine = this.progressOf(a);
    let place = 1;
    for (const b of this.actors.values()) if (b !== a && b.kind !== 'npc' && this.progressOf(b) > mine) place++;
    return place;
  }

  /* ── interaction, dialogue, triggers, objectives ───────────────────── */

  private interact(a: Actor): void {
    const f = a.focus;
    if (!f) return;
    const e = this.doc.entities[f.entityId]!;
    const ia = e.components.interactable!;
    if (f.blocked) return this.emit('interact_blocked', a.id, e.id, f.blocked);
    switch (ia.verb) {
      case 'pickup': {
        const item = ia.grantsItem ?? e.id;
        a.inventory.set(item, (a.inventory.get(item) ?? 0) + 1);
        this.removeEntity(e.id);
        this.emit('pickup', a.id, e.id, item);
        break;
      }
      case 'open': {
        const door = this.doors.get(e.id);
        const opening = door ? door.target === 0 : true;
        if (door) door.target = opening ? 1 : 0;
        this.emit(opening ? 'door_open' : 'door_close', a.id, e.id);
        break;
      }
      default: {
        const lines = e.components.npc?.dialogue ?? [];
        if (lines.length) {
          const i = a.talk.get(e.id) ?? 0;
          a.talk.set(e.id, i + 1);
          const line = lines[Math.min(i, lines.length - 1)]!;
          a.dialogue = { entityId: e.id, speaker: e.name, line, index: Math.min(i, lines.length - 1), total: lines.length, at: this.time };
          this.dialogueSeen.add(e.id);
          this.emit('dialogue', a.id, e.id, line);
        } else this.emit('interact', a.id, e.id, `${ia.verb}: ${ia.prompt}`);
      }
    }
    const obj = this.activeObjective();
    if (obj && obj.def.kind === 'interact' && obj.def.target === e.id) {
      this.completeObjective(obj);
      // Quest-aware closure: when the whole chain is done, the NPC delivers their final line.
      const lines = e.components.npc?.dialogue ?? [];
      if (this.objectives.every((o) => o.done) && lines.length > 1 && a.dialogue?.entityId === e.id) {
        a.dialogue = { ...a.dialogue, line: lines[lines.length - 1]!, index: lines.length - 1 };
      }
    }
  }

  private computeFocus(a: Actor): SimFocus | null {
    if (!a.alive || a.controller !== 'character') return null;
    const eye = this.feet(a).add(new Vector3(0, PLAYER.eye - 0.25, 0));
    const fwd = fwdOf(a.yaw);
    let best: { e: Entity; score: number } | null = null;
    for (const e of Object.values(this.doc.entities)) {
      const ia = e.components.interactable;
      if (!ia || !this.active(e)) continue;
      const npcActor = e.components.npc ? this.actors.get(`npc:${e.id}`) : undefined;
      if (npcActor && (!npcActor.alive || npcActor.hostile)) continue;
      const box = npcActor ? { center: this.feet(npcActor).add(new Vector3(0, npcActor.feetOffset, 0)), half: new Vector3(npcActor.radius, npcActor.feetOffset, npcActor.radius) } : this.boxOf(e);
      const closest = eye.clone().clamp(box.center.clone().sub(box.half), box.center.clone().add(box.half));
      const dist = closest.distanceTo(eye);
      if (dist > PLAYER.reach) continue;
      const to = box.center.clone().sub(eye).setY(0);
      const facing = to.lengthSq() < 1e-6 ? 1 : to.normalize().dot(fwd);
      if (dist > 0.9 && facing < 0.3) continue;
      const score = dist - facing * 0.8;
      if (!best || score < best.score) best = { e, score };
    }
    if (!best) return null;
    const e = best.e;
    const ia = e.components.interactable!;
    const door = this.doors.get(e.id);
    const open = !!door && door.target === 1;
    const need = ia.requiresItem && !a.inventory.has(ia.requiresItem) ? `Requires ${ia.requiresItem}` : undefined;
    return { entityId: e.id, name: e.name, verb: ia.verb, prompt: open ? ia.prompt.replace(/^Open/i, 'Close') : ia.prompt, ...(need && !open ? { blocked: need } : {}) };
  }

  private updateTriggers(a: Actor): void {
    const p = this.feet(a).add(new Vector3(0, 0.9, 0));
    const set = this.inside.get(a.id) ?? new Set<EntityId>();
    this.inside.set(a.id, set);
    for (const [id, box] of this.triggers) {
      const now = inBox(p, box, 0.9);
      if (now && !set.has(id)) {
        set.add(id);
        this.emit('trigger_enter', a.id, id);
        const obj = this.activeObjective();
        if (obj && obj.def.kind === 'reach' && obj.def.target === id && a.kind === 'player') this.completeObjective(obj);
      }
      if (!now && set.has(id)) (set.delete(id), this.emit('trigger_exit', a.id, id));
    }
  }

  private activeObjective(): ObjectiveState | undefined {
    return this.objectives.find((o) => !o.done);
  }

  private bumpDefeatObjectives(_e: Entity | undefined): void {
    // Defeat objectives read the running tally in updateObjectives, so kills made
    // before the step became active still count (players fight whatever attacks them).
  }

  private updateObjectives(): void {
    const obj = this.activeObjective();
    if (!obj || (obj.def.kind !== 'collect' && obj.def.kind !== 'defeat')) return;
    let have = 0;
    if (obj.def.kind === 'defeat') have = this.defeats.get(obj.def.target) ?? 0;
    else for (const a of this.actors.values()) if (a.kind === 'player') have += a.inventory.get(obj.def.target) ?? 0;
    if (have !== obj.progress) {
      obj.progress = Math.min(have, obj.def.count);
      this.emit('objective_progress', undefined, undefined, `${obj.def.label} ${obj.progress}/${obj.def.count}`);
    }
    if (have >= obj.def.count) this.completeObjective(obj);
  }

  private completeObjective(o: ObjectiveState): void {
    if (o.done) return;
    o.done = true;
    o.progress = o.def.count;
    this.emit('objective_complete', undefined, o.def.kind === 'interact' || o.def.kind === 'reach' ? o.def.target : undefined, o.def.label);
    if (this.objectives.every((x) => x.done)) {
      this.emit('all_objectives_complete');
      if (this.game.win === 'objectives') for (const a of this.actors.values()) if (a.kind === 'player') this.finishMatch(a, 'won');
    }
  }

  private finishMatch(a: Actor, result: 'won' | 'lost'): void {
    if (a.result) return;
    a.result = result;
    if (a.kind === 'player') this.emit(result === 'won' ? 'match_won' : 'match_lost', a.id);
    this.matchDone = true;
  }

  /* ── gameplay framework ────────────────────────────────────────────── */

  /** HP is the actor's canonical health; when the database defines a 'health' stat, it sets the max. */
  private syncHealth(a: Actor, fill = false): void {
    if (!a.kit || !(this.gp.has('health') || a.kit.base.has('health'))) return;
    const max = Math.max(1, this.gp.get(a.kit, 'health'));
    const ratio = a.maxHealth > 0 ? a.health / a.maxHealth : 1;
    a.maxHealth = max;
    a.health = fill ? max : Math.min(max, Math.max(1, ratio * max));
  }

  private stepKit(a: Actor, kit: Kit): void {
    for (const t of this.gp.tick(kit, SIM_DT)) {
      const src = this.actors.get(t.source) ?? null;
      this.applyEffect(a, t.effect, src, null);
      if (!a.alive) return;
    }
    const hpDef = this.gp.stats.get('health');
    if (hpDef?.regen && a.maxHealth > 0) a.health = Math.min(a.maxHealth, a.health + hpDef.regen * SIM_DT);
    if (kit.casting) {
      kit.casting.t += SIM_DT;
      if (kit.casting.t >= kit.casting.ability.windup) {
        const ability = kit.casting.ability;
        kit.casting = null;
        this.resolveAbility(a, ability);
      }
    }
  }

  /** Begin casting an ability (cost + cooldown are paid at cast start; effects land after windup). */
  cast(a: Actor, abilityId: string): string | null {
    if (!a.kit || !a.alive) return 'no kit';
    const why = this.gp.blocked(a.kit, abilityId);
    if (why) return why;
    const ab = this.gp.beginCast(a.kit, abilityId)!;
    this.emit('ability_cast', a.id, a.entityId, ab.name);
    if (ab.windup <= 0) {
      a.kit.casting = null;
      this.resolveAbility(a, ab);
    }
    return null;
  }

  private harmful(ab: AbilityDef): boolean {
    return ab.effects.some((e) => e.kind === 'damage' || e.kind === 'knockback' || (e.kind === 'apply_status' && (this.gp.statuses.get(e.status)?.harmful ?? true)));
  }

  private resolveAbility(a: Actor, ab: AbilityDef): void {
    if (!a.alive) return;
    const at = this.feet(a);
    const facing = fwdOf(a.yaw);
    const harmful = this.harmful(ab);
    const ally = (b: Actor) =>
      b === a ||
      (b.alive && b.kind !== 'npc' && a.kind !== 'npc' && b.team === a.team) ||
      (b.alive && a.kind === 'npc' && b.kind === 'npc' && b.hostile === a.hostile);
    const eligible = (b: Actor) => (harmful ? this.canHit(a, b) : ally(b));
    let targets: Actor[] = [];
    if (ab.target === 'self') targets = [a];
    else if (ab.target === 'aoe') {
      for (const b of this.actors.values()) if (eligible(b) && this.feet(b).distanceTo(at) <= ab.radius + b.radius) targets.push(b);
    } else if (ab.target === 'melee') {
      const cos = Math.cos((ab.arc * Math.PI) / 180);
      for (const b of this.actors.values()) {
        if (b === a || !eligible(b)) continue;
        const to = this.feet(b).sub(at).setY(0);
        if (to.length() - b.radius > ab.range) continue;
        if (to.lengthSq() > 0.01 && to.normalize().dot(facing) < cos) continue;
        targets.push(b);
      }
    } else if (ab.target === 'ray') {
      let best: { b: Actor; d: number } | null = null;
      for (const b of this.actors.values()) {
        if (b === a || !eligible(b)) continue;
        const to = this.feet(b).sub(at).setY(0);
        const along = to.dot(facing);
        if (along <= 0 || along > ab.range) continue;
        const lateral = to.clone().addScaledVector(facing, -along).length();
        if (lateral > b.radius + 0.6) continue;
        if (!best || along < best.d) best = { b, d: along };
      }
      if (best) targets = [best.b];
    }
    for (const b of targets) {
      const dir = this.feet(b).sub(at).setY(0);
      for (const e of ab.effects) {
        this.applyEffect(b, e, a, dir);
        if (!b.alive) break;
      }
    }
  }

  /** Deliver one effect from `src` (null for environmental/status ticks with no living source). */
  private applyEffect(t: Actor, e: EffectSpec, src: Actor | null, dir: Vector3 | null): void {
    switch (e.kind) {
      case 'damage': {
        if (!t.alive || t.maxHealth <= 0) return;
        const base = this.gp.scaled(src?.kit ?? null, e.amount, e.scaling);
        const out = this.gp.outgoing(src?.kit ?? null, base, this.random());
        const blocked = t.blocking && !!dir && fwdOf(t.yaw).dot(dir.clone().normalize().negate()) > 0.2;
        const amount = Math.max(0, Math.round(this.gp.incoming(t.kit, blocked ? out.amount * 0.2 : out.amount)));
        t.health = Math.max(0, t.health - amount);
        if (t.kind === 'npc' && src && !t.targetId) t.targetId = src.id;
        this.emit(blocked ? 'blocked' : 'hit', src?.id, t.entityId, `${t.name} −${amount}${out.crit ? ' CRIT' : ''}`);
        if (t.health <= 0) this.down(t, src);
        return;
      }
      case 'heal': {
        if (!t.alive || t.maxHealth <= 0) return;
        const amount = Math.round(this.gp.scaled(src?.kit ?? null, e.amount, e.scaling));
        t.health = Math.min(t.maxHealth, t.health + amount);
        this.emit('heal', src?.id, t.entityId, `${t.name} +${amount}`);
        return;
      }
      case 'restore':
        if (t.kit) t.kit.current.set(e.stat, Math.min(this.gp.get(t.kit, e.stat), (t.kit.current.get(e.stat) ?? 0) + e.amount));
        return;
      case 'apply_status': {
        if (!t.kit) t.kit = this.gp.createKit();
        const def = this.gp.applyStatus(t.kit, e.status, src?.id ?? '');
        if (def) this.emit('status_applied', src?.id, t.entityId, `${t.name}: ${def.name}`);
        this.syncHealth(t);
        return;
      }
      case 'knockback':
        if (dir && dir.lengthSq() > 0.0001) t.knock.copy(dir).setY(0).normalize().multiplyScalar(e.force);
        return;
      case 'grant_item':
        t.inventory.set(e.item, (t.inventory.get(e.item) ?? 0) + e.count);
        return;
    }
  }

  private reward(by: Actor, victim: Actor): void {
    const e = victim.entityId ? this.doc.entities[victim.entityId] : undefined;
    const unit = e?.components.unit;
    if (by.kit && this.doc.database.progression.enabled) {
      const xp = unit?.xp ?? this.doc.database.progression.defaultKillXp * (unit?.level ?? 1);
      const levels = this.gp.gainXp(by.kit, xp);
      if (levels) {
        this.syncHealth(by, true);
        this.emit('level_up', by.id, undefined, `${by.name} reached level ${by.kit.level}`);
      }
    }
    if (unit?.loot) {
      for (const [item, n] of rollLoot(this.doc.database, unit.loot, this.random)) {
        by.inventory.set(item, (by.inventory.get(item) ?? 0) + n);
        this.emit('loot', by.id, victim.entityId, `${n > 1 ? `${n}× ` : ''}${this.gp.items.get(item)?.name ?? item}`);
      }
    }
  }

  /** Player commands: tree unlocks, equipment, consumables, bar slots. Returns an error string or null. */
  command(id: string, cmd: Command): string | null {
    const a = this.actors.get(id);
    if (!a || a.kind === 'npc') return 'no such player';
    if (!a.kit) a.kit = this.gp.createKit();
    const kit = a.kit;
    const count = (item: string) => a.inventory.get(item) ?? 0;
    const spend = (item: string, n: number) => {
      const left = count(item) - n;
      if (left > 0) a.inventory.set(item, left);
      else a.inventory.delete(item);
    };
    let err: string | null = null;
    switch (cmd.kind) {
      case 'unlock': {
        const allowed = this.doc.database.loadout.trees;
        if (allowed.length && !allowed.includes(cmd.tree)) err = 'tree not available to this player';
        else err = this.gp.unlock(kit, cmd.tree, cmd.node, count, spend);
        if (!err) this.emit('node_unlocked', a.id, undefined, this.gp.trees.get(cmd.tree)?.nodes.find((n) => n.id === cmd.node)?.name ?? cmd.node);
        break;
      }
      case 'equip':
        if (!count(cmd.item)) err = 'not in inventory';
        else err = this.gp.equip(kit, cmd.item);
        if (!err) this.emit('equipped', a.id, undefined, this.gp.items.get(cmd.item)?.name ?? cmd.item);
        break;
      case 'unequip':
        this.gp.unequip(kit, cmd.slot);
        break;
      case 'use': {
        const item = this.gp.items.get(cmd.item);
        if (!item) err = 'unknown item';
        else if (!count(cmd.item)) err = 'not in inventory';
        else if (item.kind !== 'consumable' || !item.use.length) err = `${item.name} is not usable`;
        else {
          spend(item.id, 1);
          for (const e of item.use) this.applyEffect(a, e, a, null);
          this.emit('item_used', a.id, undefined, item.name);
        }
        break;
      }
      case 'slot':
        if (cmd.ability && !kit.abilities.includes(cmd.ability)) err = 'ability not learned';
        else kit.bar[cmd.index] = cmd.ability;
        break;
    }
    if (err) this.emit('command_failed', a.id, undefined, `${cmd.kind}: ${err}`);
    this.syncHealth(a);
    return err;
  }

  private kitView(a: Actor): KitView {
    const kit = a.kit!;
    const gp = this.gp;
    const count = (item: string) => a.inventory.get(item) ?? 0;
    const allowed = this.doc.database.loadout.trees;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return {
      level: kit.level,
      xp: Math.round(kit.xp),
      xpNext: gp.xpToNext(kit.level),
      points: kit.points,
      resources: gp.resources().map((r) =>
        r.id === 'health'
          ? { id: r.id, name: r.name, current: Math.round(a.health), max: Math.round(a.maxHealth), ...(r.color ? { color: r.color } : {}) }
          : { id: r.id, name: r.name, current: Math.round(kit.current.get(r.id) ?? 0), max: Math.round(gp.get(kit, r.id)), ...(r.color ? { color: r.color } : {}) },
      ),
      stats: [...gp.stats.values()].filter((s) => !s.resource).map((s) => ({ id: s.id, name: s.name, value: r1(gp.get(kit, s.id)) })),
      bar: kit.bar.map((id, i) => {
        if (!id) return null;
        const ab = gp.abilities.get(id);
        if (!ab) return null;
        return { slot: i + 1, id, name: ab.name, cooldown: r1(kit.cooldowns.get(id) ?? 0), cooldownMax: r1(kit.cooldownMax.get(id) ?? ab.cooldown), blocked: gp.blocked(kit, id), color: ab.color };
      }),
      casting: kit.casting ? { id: kit.casting.ability.id, name: kit.casting.ability.name, progress: Math.min(1, kit.casting.t / Math.max(0.01, kit.casting.ability.windup)) } : null,
      statuses: kit.statuses.map((s) => ({ id: s.def.id, name: s.def.name, remaining: r1(s.remaining), stacks: s.stacks, harmful: s.def.harmful })),
      trees: [...gp.trees.values()]
        .filter((t) => !allowed.length || allowed.includes(t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          currency: t.currency === 'item' ? (t.currencyItem ?? 'item') : 'skill points',
          nodes: t.nodes.map((n) => {
            const st = gp.nodeState(kit, t, n.id, count);
            return { id: n.id, name: n.name, description: n.description, rank: st.rank, ranks: n.ranks, cost: n.cost, requires: n.requires, pos: n.pos, why: st.why };
          }),
        })),
      items: [...a.inventory].map(([id, n]) => {
        const def = gp.items.get(id);
        return { id, name: def?.name ?? id, count: n, kind: def?.kind ?? 'material', rarity: def?.rarity ?? 'common', equipped: [...kit.equipment.values()].includes(id) };
      }),
      equipment: Object.fromEntries(kit.equipment),
    };
  }

  /* ── queries ───────────────────────────────────────────────────────── */

  feet(a: Actor): Vector3 {
    const t = a.body.translation();
    return new Vector3(t.x, t.y - a.feetOffset, t.z);
  }

  actor(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  firstPlayer(): Actor | undefined {
    for (const a of this.actors.values()) if (a.kind === 'player') return a;
    return undefined;
  }

  /** World-space center of an entity (NPCs: their live position). */
  centerOf(id: EntityId): Vector3 | null {
    const npc = this.actors.get(`npc:${id}`);
    if (npc) return this.feet(npc).add(new Vector3(0, npc.feetOffset, 0));
    const e = this.doc.entities[id];
    return e ? this.boxOf(e).center.clone() : null;
  }

  isDoorOpen(id: EntityId): boolean {
    return this.doors.get(id)?.target === 1;
  }

  defeatedCount(target: string): number {
    return this.defeats.get(target) ?? 0;
  }

  sawDialogue(id: EntityId): boolean {
    return this.dialogueSeen.has(id);
  }

  objectiveStates(): ReadonlyArray<ObjectiveState> {
    return this.objectives;
  }

  get matchOver(): boolean {
    return this.matchDone;
  }

  /** Current world transform of simulated entities: doors, dynamic props, and NPCs. */
  forEachMoving(cb: (id: EntityId, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number; w: number }) => void): void {
    for (const [id, body] of this.moving) cb(id, body.translation(), body.rotation());
    for (const a of this.actors.values()) {
      if (a.kind !== 'npc' || !a.entityId) continue;
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a.yaw);
      cb(a.entityId, a.body.translation(), q);
    }
  }

  /** Ray cast against the world, ignoring one actor (the camera's owner). */
  castRay(origin: Vector3, dir: Vector3, maxDist: number, ignoreActor?: string): number | null {
    const ignore = ignoreActor ? this.actors.get(ignoreActor)?.collider : undefined;
    const hit = this.world.castRay(new RAPIER.Ray(origin, dir), maxDist, true, undefined, undefined, ignore);
    return hit ? hit.timeOfImpact : null;
  }

  teleport(id: string, feet: Vector3, yaw?: number): void {
    const a = this.actors.get(id);
    if (a) this.place(a, feet, yaw ?? a.yaw);
  }

  private place(a: Actor, feet: Vector3, yaw: number): void {
    const p = { x: feet.x, y: feet.y + a.feetOffset + 0.02, z: feet.z };
    a.body.setTranslation(p, true);
    a.body.setNextKinematicTranslation(p);
    a.vy = 0;
    a.vel = 0;
    a.yaw = yaw;
    a.input = { ...a.input, yaw };
  }

  actorViews(): ActorView[] {
    const out: ActorView[] = [];
    for (const a of this.actors.values()) {
      const f = this.feet(a);
      const anim: ActorAnim = !a.alive ? 'down' : a.hitstun > 0 ? 'hit' : a.attack ? 'attack' : a.blocking ? 'block' : a.speed > 0.3 ? 'move' : 'idle';
      out.push({
        id: a.id,
        kind: a.kind,
        name: a.name,
        controller: a.controller,
        ...(a.entityId ? { entityId: a.entityId } : {}),
        position: [round(f.x), round(f.y), round(f.z)],
        yaw: round(a.yaw),
        speed: round(a.speed),
        health: Math.round(a.health),
        maxHealth: a.maxHealth,
        alive: a.alive,
        anim,
        team: a.team,
        hostile: a.hostile,
      });
    }
    return out;
  }

  state(viewerId?: string): SimState {
    const a = (viewerId ? this.actors.get(viewerId) : undefined) ?? this.firstPlayer();
    const f = a ? this.feet(a) : new Vector3();
    const active = this.activeObjective();
    const fight = this.fight;
    return {
      time: round(this.time),
      tick: this.tick,
      player: {
        id: a?.id ?? '',
        position: [round(f.x), round(f.y), round(f.z)],
        yaw: round(a?.yaw ?? 0),
        grounded: a?.grounded ?? false,
        speed: round(a?.speed ?? 0),
        health: Math.round(a?.health ?? 0),
        maxHealth: a?.maxHealth ?? 0,
        alive: a?.alive ?? false,
        respawnIn: a && !a.alive && a.respawnAt ? round(Math.max(0, a.respawnAt - this.time)) : 0,
      },
      inventory: a ? [...a.inventory].flatMap(([item, n]) => Array.from({ length: n }, () => item)) : [],
      focus: a?.focus ?? null,
      objectives: this.objectives.map((o) => ({
        id: o.def.id,
        ...(o.def.kind === 'interact' || o.def.kind === 'reach' ? { entityId: o.def.target } : {}),
        label: o.def.label,
        done: o.done,
        active: o === active,
        progress: o.progress,
        count: o.def.count,
      })),
      doors: [...this.doors.values()].map((d) => ({ entityId: d.entityId, open: d.target === 1 })),
      events: this.events.slice(-14),
      actors: this.actorViews(),
      dialogue: a?.dialogue && this.time - a.dialogue.at < 6 ? a.dialogue : null,
      race:
        this.race && a
          ? {
              phase: this.race.phase,
              countdown: round(Math.max(0, this.race.startAt - this.time)),
              lap: Math.min(a.race.lap + 1, this.game.laps),
              laps: this.game.laps,
              checkpoint: a.race.next,
              checkpoints: this.checkpoints.length,
              place: this.placeOf(a),
              racers: [...this.actors.values()].filter((x) => x.kind !== 'npc').length,
              time: round(a.race.finished ? a.race.finishTime - this.race.startAt : Math.max(0, this.time - this.race.startAt)),
              bestLap: a.race.bestLap === null ? null : round(a.race.bestLap),
            }
          : null,
      fight:
        fight && a
          ? {
              phase: fight.phase,
              round: fight.round,
              rounds: this.game.rounds,
              wins: Object.fromEntries(fight.wins),
              timer: round(Math.max(0, fight.timer)),
              opponentId: this.opponentOf(a)?.id ?? null,
            }
          : null,
      match: a?.result ? { result: a.result, message: a.result === 'won' ? this.winMessage() : 'Defeat' } : null,
      kit: a?.kit ? this.kitView(a) : null,
    };
  }

  private winMessage(): string {
    return this.game.win === 'race' ? 'First place' : this.game.win === 'ko' ? 'Victory' : 'Objectives complete';
  }

  dispose(): void {
    this.world.free();
  }

  /* ── construction ──────────────────────────────────────────────────── */

  private active(e: Entity): boolean {
    if (this.removed.has(e.id)) return false;
    for (let c: Entity | undefined = e; c; c = c.parentId ? this.doc.entities[c.parentId] : undefined) if (!c.visible) return false;
    return true;
  }

  private worldXf(id: EntityId): WorldXf {
    const cached = this.xf.get(id);
    if (cached) return cached;
    const e = this.doc.entities[id]!;
    const t = e.transform;
    const local = new Matrix4().compose(
      new Vector3(...t.position),
      new Quaternion().setFromEuler(new Euler(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'XYZ')),
      new Vector3(...t.scale),
    );
    const matrix = e.parentId ? this.worldXf(e.parentId).matrix.clone().multiply(local) : local;
    const out: WorldXf = { matrix, position: new Vector3(), quaternion: new Quaternion(), scale: new Vector3() };
    matrix.decompose(out.position, out.quaternion, out.scale);
    this.xf.set(id, out);
    return out;
  }

  private boxOf(e: Entity): Box {
    const x = this.worldXf(e.id);
    const size = e.components.collider?.size ?? e.components.mesh?.size ?? [0.5, 0.5, 0.5];
    const half = new Vector3(...size).multiply(x.scale).multiplyScalar(0.5);
    if (e.components.mesh?.shape === 'plane' && !e.components.collider?.size) half.y = 0.02;
    const m = new Matrix4().makeRotationFromQuaternion(x.quaternion).elements;
    const abs = (i: number) => Math.abs(m[i]!);
    const aabb = new Vector3(
      abs(0) * half.x + abs(4) * half.y + abs(8) * half.z,
      abs(1) * half.x + abs(5) * half.y + abs(9) * half.z,
      abs(2) * half.x + abs(6) * half.y + abs(10) * half.z,
    );
    return { center: x.position.clone(), half: aabb };
  }

  private buildPhysics(e: Entity): void {
    const c = e.components.collider;
    if (!c) return;
    const x = this.worldXf(e.id);
    if (c.isTrigger) {
      if (!e.components.interactable && !e.components.checkpoint) this.triggers.set(e.id, this.boxOf(e));
      return;
    }
    const size = c.size ?? e.components.mesh?.size ?? [1, 1, 1];
    const h = new Vector3(...size).multiply(x.scale).multiplyScalar(0.5);
    const shape = c.shape === 'auto' ? autoShape(e) : c.shape;
    let desc: RAPIER.ColliderDesc;
    switch (shape) {
      case 'sphere':
        desc = RAPIER.ColliderDesc.ball(Math.max(h.x, h.y, h.z));
        break;
      case 'capsule': {
        const r = Math.max(h.x, h.z);
        desc = RAPIER.ColliderDesc.capsule(Math.max(h.y - r, 0.01), r);
        break;
      }
      case 'cylinder':
        desc = RAPIER.ColliderDesc.cylinder(h.y, Math.max(h.x, h.z));
        break;
      case 'cone':
        desc = RAPIER.ColliderDesc.cone(h.y, Math.max(h.x, h.z));
        break;
      default:
        desc = RAPIER.ColliderDesc.cuboid(Math.max(h.x, 0.01), Math.max(e.components.mesh?.shape === 'plane' ? 0.02 : h.y, 0.01), Math.max(h.z, 0.01));
    }
    desc.setFriction(0.7);
    const kind = e.components.rigidBody?.kind ?? 'static';
    const q = { x: x.quaternion.x, y: x.quaternion.y, z: x.quaternion.z, w: x.quaternion.w };
    if (kind === 'static') {
      desc.setTranslation(x.position.x, x.position.y, x.position.z).setRotation(q);
      this.colliders.set(e.id, this.world.createCollider(desc));
      return;
    }
    const bodyDesc = (kind === 'dynamic' ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.kinematicPositionBased())
      .setTranslation(x.position.x, x.position.y, x.position.z)
      .setRotation(q);
    if (kind === 'dynamic') bodyDesc.setGravityScale(e.components.rigidBody!.gravityScale).setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);
    if (kind === 'dynamic') desc.setMass(e.components.rigidBody!.mass);
    this.colliders.set(e.id, this.world.createCollider(desc, body));
    this.moving.set(e.id, body);
    if (kind === 'kinematic' && e.components.interactable?.verb === 'open') {
      const width = (c.size ?? e.components.mesh?.size ?? [1, 1, 1])[0] * x.scale.x * 0.98;
      this.doors.set(e.id, { entityId: e.id, body, closed: x.position.clone(), openOffset: new Vector3(width, 0, 0).applyQuaternion(x.quaternion), t: 0, target: 0 });
    }
  }

  private removeEntity(id: EntityId): void {
    this.removed.add(id);
    const col = this.colliders.get(id);
    if (col) this.world.removeCollider(col, true);
    this.colliders.delete(id);
  }

  private emit(type: SimEventType, actorId?: string, entityId?: EntityId, detail?: string): void {
    this.events.push({ t: round(this.time), type, ...(actorId ? { actorId } : {}), ...(entityId ? { entityId } : {}), ...(detail ? { detail } : {}) });
    if (this.events.length > 2000) this.events.splice(0, 500);
  }
}

function inBox(p: Vector3, box: Box, padY: number): boolean {
  return Math.abs(p.x - box.center.x) <= box.half.x && Math.abs(p.y - box.center.y) <= box.half.y + padY && Math.abs(p.z - box.center.z) <= box.half.z;
}

function autoShape(e: Entity): 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' {
  switch (e.components.mesh?.shape) {
    case 'sphere':
      return 'sphere';
    case 'capsule':
      return 'capsule';
    case 'cylinder':
      return 'cylinder';
    case 'cone':
      return 'cone';
    default:
      return 'box';
  }
}
