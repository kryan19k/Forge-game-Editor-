import type { ActorView, SimState } from '@forge/contracts';
import * as THREE from 'three';
import { SceneSync, applyEnvironment } from '../scene-sync';
import { PLAYER, type PlayerInput } from '../sim/simulation';
import type { GameSource } from './source';

export interface PlayHooks {
  /** ~10 Hz HUD snapshot. */
  onState(state: SimState): void;
  onPointerLock(locked: boolean): void;
}

interface Renderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setAnimationLoop(cb: ((t: number) => void) | null): void;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  domElement: HTMLCanvasElement;
}

type Key = 'f' | 'b' | 'l' | 'r' | 'sprint' | 'jump' | 'interact' | 'attack' | 'heavy' | 'block';
const KEYMAP: Record<string, Key> = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyE: 'interact', KeyF: 'interact',
  KeyJ: 'attack', KeyK: 'heavy', KeyL: 'block',
};
const EDGE: ReadonlySet<Key> = new Set(['jump', 'interact', 'attack', 'heavy']);

const PALETTE = ['#4fd1c5', '#e3608f', '#f2b33d', '#9bd15a', '#8ea8ff', '#d68cff'];

interface ActorRig {
  root: THREE.Group;
  body: THREE.Object3D;
  blade?: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  yaw: number;
  hitFlash: number;
  plate?: HTMLDivElement;
}

/**
 * Browser play mode for any GameSource (local sim or network). Owns its own scene
 * graph — the authoring scene is never touched.
 */
export class PlaySession {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 2000);
  private readonly sync = new SceneSync();
  private readonly rigs = new Map<string, ActorRig>();
  private readonly held = new Set<Key>();
  private readonly edges = new Set<Key>();
  private yaw: number;
  private pitch = -0.18;
  private last = performance.now();
  private lastHud = 0;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private camInit = false;
  private readonly tmpM = new THREE.Matrix4();
  private disposed = false;
  private readonly controller: 'character' | 'vehicle' | 'fighter';
  private readonly cameraMode: 'third_person' | 'chase' | 'side';
  private colorIdx = 0;
  private abilityEdge = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly source: GameSource,
    private readonly hooks: PlayHooks,
    private readonly overlay?: HTMLElement,
  ) {
    const doc = source.doc;
    this.controller = doc.game.controller;
    this.cameraMode = doc.game.camera;
    this.sync.sync(doc);
    this.scene.add(this.sync.root);
    applyEnvironment(this.scene, renderer, doc.environment);
    const me = source.frame().actors.find((a) => a.id === source.me);
    this.yaw = me?.yaw ?? 0;
  }

  start(): void {
    const c = this.renderer.domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    c.addEventListener('mousedown', this.onMouseDown);
    c.addEventListener('contextmenu', this.onContext);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.renderer.setAnimationLoop(() => this.frame());
    if (this.cameraMode === 'third_person') this.lock();
    else this.hooks.onPointerLock(true); // chase/side cameras don't need mouse capture
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.sync.dispose();
    for (const r of this.rigs.values()) this.disposeRig(r);
    this.source.dispose();
  }

  /* ── loop ──────────────────────────────────────────────────────────── */

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.source.update(dt, this.input());
    const f = this.source.frame();
    this.syncWorld(f.moving, f.removed, f.actors, now);
    this.syncActors(f.actors, dt, now);
    const me = f.actors.find((a) => a.id === this.source.me);
    this.updateCamera(me, f.actors, dt);
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.drawPlates(f.actors);
    if (now - this.lastHud > 100) {
      this.lastHud = now;
      const hud = this.source.hud();
      if (hud) this.hooks.onState(hud);
    }
  }

  private input(): PlayerInput {
    const h = this.held;
    const x = (h.has('r') ? 1 : 0) - (h.has('l') ? 1 : 0);
    const y = (h.has('f') ? 1 : 0) - (h.has('b') ? 1 : 0);
    const fighter = this.controller === 'fighter';
    const out: PlayerInput = {
      move: [x, fighter ? 0 : y],
      sprint: h.has('sprint'),
      jump: this.edges.has('jump') || (fighter && this.edges.has('f')),
      interact: this.edges.has('interact'),
      attack: this.edges.has('attack'),
      heavy: this.edges.has('heavy'),
      block: h.has('block'),
      ability: this.abilityEdge,
      yaw: this.yaw,
    };
    this.edges.clear();
    this.abilityEdge = 0;
    return out;
  }

  private syncWorld(moving: Map<string, { p: number[]; q: number[] }>, removed: ReadonlySet<string>, actors: ActorView[], now: number): void {
    for (const [id, m] of moving) {
      const obj = this.sync.object(id);
      if (!obj) continue;
      const world = this.tmpM.compose(
        new THREE.Vector3(m.p[0], m.p[1], m.p[2]),
        new THREE.Quaternion(m.q[0], m.q[1], m.q[2], m.q[3]),
        obj.getWorldScale(new THREE.Vector3()),
      );
      const parentInv = obj.parent ? new THREE.Matrix4().copy(obj.parent.matrixWorld).invert() : new THREE.Matrix4();
      parentInv.multiply(world).decompose(obj.position, obj.quaternion, obj.scale);
    }
    for (const id of removed) {
      const o = this.sync.object(id);
      if (o) o.visible = false;
    }
    for (const a of actors) {
      if (a.kind !== 'npc' || !a.entityId) continue;
      const o = this.sync.object(a.entityId);
      if (!o) continue;
      o.visible = a.alive && !removed.has(a.entityId);
      // Procedural life: hostile lunge on attack, squash when hit.
      const s = a.anim === 'hit' ? 0.85 : 1;
      o.scale.set(1 / s, s, 1 / s);
      if (a.anim === 'attack') o.position.addScaledVector(new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), 0.25);
    }
    for (const e of Object.values(this.source.doc.entities)) {
      if (e.components.interactable?.verb !== 'pickup' || removed.has(e.id)) continue;
      const o = this.sync.object(e.id);
      if (!o) continue;
      o.rotation.y = e.transform.rotation[1] * (Math.PI / 180) + now * 0.0015;
      o.position.y = e.transform.position[1] + Math.sin(now * 0.003) * 0.06;
    }
  }

  /* ── actors (players, bots, cars) ──────────────────────────────────── */

  private syncActors(actors: ActorView[], dt: number, now: number): void {
    const seen = new Set<string>();
    for (const a of actors) {
      if (a.kind === 'npc') continue;
      seen.add(a.id);
      let rig = this.rigs.get(a.id);
      if (!rig) {
        const color = a.id === this.source.me ? '#ece6da' : PALETTE[this.colorIdx++ % PALETTE.length]!;
        rig = a.controller === 'vehicle' ? this.buildCar(color, a.id === this.source.me) : this.buildAvatar(color, a.id === this.source.me);
        this.scene.add(rig.root);
        this.rigs.set(a.id, rig);
      }
      const target = new THREE.Vector3(...a.position);
      rig.root.position.lerp(target, a.id === this.source.me ? 1 : Math.min(1, dt * 20));
      let d = a.yaw - rig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      rig.yaw += d * (a.controller === 'character' ? 0.25 : 0.5);
      if (a.controller === 'character' && a.id === this.source.me && a.speed > 0.2) {
        // Face the movement direction, not the camera.
        const h = this.held;
        const mx = (h.has('r') ? 1 : 0) - (h.has('l') ? 1 : 0);
        const mz = (h.has('f') ? 1 : 0) - (h.has('b') ? 1 : 0);
        if (mx || mz) {
          let dd = this.yaw + Math.atan2(-mx, mz) - rig.yaw;
          dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          rig.yaw += dd * 0.3;
        }
      }
      rig.root.rotation.y = a.controller === 'character' && a.anim === 'attack' ? a.yaw : rig.yaw;
      this.animate(rig, a, now);
    }
    for (const [id, rig] of this.rigs)
      if (!seen.has(id)) {
        this.disposeRig(rig);
        this.rigs.delete(id);
      }
  }

  private animate(rig: ActorRig, a: ActorView, now: number): void {
    if (a.controller === 'vehicle') {
      rig.body.rotation.z = Math.sin(now * 0.02) * 0.004 * Math.min(a.speed, 30);
      return;
    }
    rig.root.visible = true;
    const t = now * 0.012;
    rig.body.rotation.set(0, 0, 0);
    rig.body.position.y = 0;
    if (a.anim === 'down') rig.body.rotation.x = -Math.PI / 2.2;
    else if (a.anim === 'move') rig.body.position.y = Math.abs(Math.sin(t)) * 0.06;
    else if (a.anim === 'hit') rig.body.rotation.x = 0.35;
    else rig.body.position.y = Math.sin(now * 0.003) * 0.015;
    if (rig.blade) {
      rig.blade.rotation.set(0, 0, 0);
      if (a.anim === 'attack') rig.blade.rotation.x = -1.7 + Math.sin(now * 0.04) * 0.4;
      else if (a.anim === 'block') rig.blade.rotation.z = Math.PI / 2;
      else rig.blade.rotation.x = -0.25;
    }
    if (a.anim === 'hit') rig.hitFlash = 1;
    rig.hitFlash *= 0.85;
    for (const m of rig.mats) m.emissiveIntensity = (m.userData.base as number) + rig.hitFlash * 3;
  }

  private buildAvatar(color: string, me: boolean): ActorRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const suit = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, emissive: '#ff2a2a', emissiveIntensity: 0 });
    const dark = new THREE.MeshStandardMaterial({ color: '#6b6d71', roughness: 0.45, metalness: 0.6 });
    const visor = new THREE.MeshStandardMaterial({ color: me ? '#ff6a2b' : color, emissive: me ? '#ff6a2b' : color, emissiveIntensity: 3, roughness: 0.2 });
    suit.userData.base = 0;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER.radius, PLAYER.halfHeight * 2, 6, 16), suit);
    torso.position.y = PLAYER.halfHeight + PLAYER.radius;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.16), dark);
    pack.position.set(0, 1.18, 0.36);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.16), visor);
    band.position.set(0, 1.52, -0.26);
    const arm = new THREE.Group();
    arm.position.set(0.42, 1.15, -0.05);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0).translate(0, 0, -0.5), new THREE.MeshStandardMaterial({ color: '#d7dde3', metalness: 0.9, roughness: 0.25 }));
    arm.add(blade);
    for (const m of [torso, pack, band, blade]) m.castShadow = true;
    body.add(torso, pack, band, arm);
    return { root, body, blade: arm, mats: [suit], yaw: 0, hitFlash: 0 };
  }

  private buildCar(color: string, me: boolean): ActorRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const paint = new THREE.MeshStandardMaterial({ color: me ? '#ff6a2b' : color, roughness: 0.35, metalness: 0.55, emissive: '#000000', emissiveIntensity: 0 });
    paint.userData.base = 0;
    const glass = new THREE.MeshStandardMaterial({ color: '#1b2026', roughness: 0.1, metalness: 0.8 });
    const tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
    const lamp = new THREE.MeshStandardMaterial({ color: '#ffe9c2', emissive: '#ffe9c2', emissiveIntensity: 3 });
    const tail = new THREE.MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 3 });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.5, 3.9), paint);
    chassis.position.y = 0.45;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.8), glass);
    cabin.position.set(0, 0.9, 0.25);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.4), paint);
    spoiler.position.set(0, 0.95, 1.8);
    body.add(chassis, cabin, spoiler);
    for (const [x, z] of [[-0.95, -1.3], [0.95, -1.3], [-0.95, 1.3], [0.95, 1.3]] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 16).rotateZ(Math.PI / 2), tire);
      w.position.set(x, 0.36, z);
      body.add(w);
    }
    for (const x of [-0.6, 0.6]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), lamp);
      h.position.set(x, 0.55, -1.96);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.05), tail);
      t.position.set(x, 0.6, 1.96);
      body.add(h, t);
    }
    body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    return { root, body, mats: [paint], yaw: 0, hitFlash: 0 };
  }

  private disposeRig(r: ActorRig): void {
    r.root.removeFromParent();
    r.plate?.remove();
    r.root.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.geometry.dispose(), (o.material as THREE.Material).dispose());
    });
  }

  /** Nameplates for other humans/bots, health bars for damaged hostiles. */
  private drawPlates(actors: ActorView[]): void {
    if (!this.overlay) return;
    const w = this.overlay.clientWidth;
    const h = this.overlay.clientHeight;
    const live = new Set<string>();
    for (const a of actors) {
      const showBar = a.kind === 'npc' ? a.hostile && a.alive && a.health < a.maxHealth : a.id !== this.source.me && a.controller !== 'fighter';
      if (!showBar) continue;
      live.add(a.id);
      let el = this.plateEls.get(a.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `nameplate ${a.kind}`;
        el.innerHTML = '<span class="n"></span><span class="bar"><i></i></span>';
        this.overlay.appendChild(el);
        this.plateEls.set(a.id, el);
      }
      const p = new THREE.Vector3(a.position[0], a.position[1] + (a.controller === 'vehicle' ? 2.2 : 2.25), a.position[2]).project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      el.style.opacity = visible ? '1' : '0';
      el.style.transform = `translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      (el.firstChild as HTMLElement).textContent = a.name;
      ((el.lastChild as HTMLElement).firstChild as HTMLElement).style.width = `${a.maxHealth > 0 ? (a.health / a.maxHealth) * 100 : 100}%`;
    }
    for (const [id, el] of this.plateEls)
      if (!live.has(id)) {
        el.remove();
        this.plateEls.delete(id);
      }
  }
  private readonly plateEls = new Map<string, HTMLDivElement>();

  /* ── cameras ───────────────────────────────────────────────────────── */

  private updateCamera(me: ActorView | undefined, actors: ActorView[], dt: number): void {
    if (!me) return;
    const pos = new THREE.Vector3(...me.position);
    let want: THREE.Vector3;
    let look: THREE.Vector3;
    let k = 1 - Math.pow(0.0001, dt);

    if (this.cameraMode === 'chase') {
      const rig = this.rigs.get(me.id);
      const yaw = rig?.yaw ?? me.yaw;
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const speedK = Math.min(me.speed / 34, 1);
      want = pos.clone().addScaledVector(back, 7.5 + speedK * 2.5).add(new THREE.Vector3(0, 2.8 + speedK * 0.6, 0));
      look = pos.clone().addScaledVector(back, -8).add(new THREE.Vector3(0, 0.8, 0));
      this.camera.fov = 62 + speedK * 12;
      this.camera.updateProjectionMatrix();
    } else if (this.cameraMode === 'side') {
      const fighters = actors.filter((a) => a.kind !== 'npc');
      const xs = fighters.map((a) => a.position[0]);
      const mid = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, pos.y, pos.z);
      const sep = Math.max(...xs) - Math.min(...xs);
      want = mid.clone().add(new THREE.Vector3(0, 2.0, 6.4 + sep * 0.5));
      look = mid.clone().add(new THREE.Vector3(0, 1.25, 0));
      k = 1 - Math.pow(0.002, dt);
    } else {
      const pivot = pos.clone().add(new THREE.Vector3(0, PLAYER.eye, 0));
      const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const shoulder = pivot.clone().addScaledVector(right, 0.55);
      const dist = 4.3;
      const hit = this.source.castRay(shoulder, back, dist + 0.3);
      const d = hit === null ? dist : Math.max(0.6, hit - 0.25);
      want = shoulder.clone().addScaledVector(back, d);
      look = shoulder.clone().addScaledVector(back, -6);
      k = hit !== null && hit < dist ? 1 : 1 - Math.pow(0.000001, dt);
    }
    if (!this.camInit) {
      this.camPos.copy(want);
      this.camLook.copy(look);
      this.camInit = true;
    }
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, Math.min(1, k * 1.5));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (this.camera.aspect !== w / h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ── input ─────────────────────────────────────────────────────────── */

  private lock(): void {
    const c = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock(): Promise<void> | void };
    try {
      const p = c.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* needs a user gesture; clicking the canvas retries */
    }
  }

  private readonly onMouseDown = (e: MouseEvent) => {
    if (this.cameraMode === 'third_person' && document.pointerLockElement !== this.renderer.domElement) return this.lock();
    if (e.button === 0) this.edges.add('attack');
    if (e.button === 2) this.edges.add('heavy');
  };
  private readonly onContext = (e: Event) => e.preventDefault();
  private readonly onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.yaw -= e.movementX * 0.0024;
    this.pitch = Math.max(-1.1, Math.min(0.75, this.pitch - e.movementY * 0.0022));
  };
  private readonly onLockChange = () => {
    if (this.cameraMode === 'third_person') this.hooks.onPointerLock(document.pointerLockElement === this.renderer.domElement);
  };
  private readonly onKeyDown = (e: KeyboardEvent) => {
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit && !e.repeat) {
      this.abilityEdge = Number(digit[1]);
      e.preventDefault();
      return;
    }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    if (EDGE.has(k) || k === 'f') this.edges.add(k);
    if (!EDGE.has(k)) this.held.add(k);
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    const k = KEYMAP[e.code];
    if (k) this.held.delete(k);
  };
  private readonly onBlur = () => this.held.clear();
}
