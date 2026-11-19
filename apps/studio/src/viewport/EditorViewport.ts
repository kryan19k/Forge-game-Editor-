import type { CaptureView, EntityId, SceneDoc, Transform } from '@forge/contracts';
import {
  LocalSource,
  PlaySession,
  type GameSource,
  SceneSync,
  applyEnvironment,
  createRenderer,
  type ForgeRenderer,
  type PlayHooks,
  type RenderBackend,
} from '@forge/game-runtime';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { capturePng } from './capture';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const RAD = 180 / Math.PI;
const round = (n: number, p = 1000) => Math.round(n * p) / p;

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface Beacon {
  key: string;
  color: string;
  label: string;
  entityIds: EntityId[];
  agent: boolean;
}

export interface ViewportStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  backend: RenderBackend;
}

export interface ViewportCallbacks {
  onPick(id: EntityId | null, additive: boolean): void;
  onTransformCommit(id: EntityId, transform: Transform): void;
  onStats(stats: ViewportStats): void;
}

/**
 * Imperative three.js editor. React owns the chrome; this owns the canvas, camera,
 * gizmo, picking and the per-frame beacon overlay (no React re-render per frame).
 */
export class EditorViewport {
  private r!: ForgeRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  private readonly sync = new SceneSync({ editorHelpers: true });
  private readonly helpers = new THREE.Group();
  private orbit!: OrbitControls;
  private gizmo!: TransformControls;
  private gizmoHelper!: THREE.Object3D;
  private doc: SceneDoc | null = null;
  private selection: EntityId[] = [];
  private beacons: Beacon[] = [];
  private readonly beaconEls = new Map<string, HTMLDivElement>();
  private readonly ray = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private resizeObs?: ResizeObserver;
  private disposed = false;
  private frames = 0;
  private lastStat = performance.now();
  private snap = false;
  private play: PlaySession | null = null;

  constructor(
    private readonly host: HTMLDivElement,
    private readonly overlay: HTMLDivElement,
    private readonly cb: ViewportCallbacks,
  ) {}

  async init(): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    this.host.prepend(canvas);
    this.r = await createRenderer(canvas);
    if (this.disposed) {
      this.r.renderer.dispose();
      canvas.remove();
      return;
    }
    const { renderer } = this.r;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera.position.set(24, 17, 30);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 1.5, -2);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.maxPolarAngle = Math.PI * 0.495;

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.85);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      if (!e.value) this.commitGizmo();
    });

    this.scene.add(this.sync.root, this.helpers, this.gizmoHelper);
    this.buildGrid();

    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => this.handlePick(e));
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host);
    this.resize();
    if (this.doc) this.setScene(this.doc);
    renderer.setAnimationLoop(() => this.tick());
  }

  /* ── public API ─────────────────────────────────────────────────────── */

  setScene(doc: SceneDoc): void {
    this.doc = doc;
    if (!this.r) return;
    // Don't yank the object out from under an active gizmo drag.
    if (this.gizmo.dragging) return;
    this.sync.sync(doc);
    // While playing, the renderer belongs to the PlaySession (its own environment).
    if (this.play) return;
    applyEnvironment(this.scene, this.r.renderer, doc.environment);
    this.attachGizmo();
  }

  setSelection(ids: EntityId[]): void {
    this.selection = ids;
    if (this.r) this.attachGizmo();
  }

  setBeacons(beacons: Beacon[]): void {
    this.beacons = beacons;
    for (const [key, el] of this.beaconEls) {
      if (!beacons.some((b) => b.key === key)) {
        el.remove();
        this.beaconEls.delete(key);
      }
    }
  }

  setGizmo(mode: GizmoMode, space: 'world' | 'local', snap: boolean): void {
    this.snap = snap;
    if (!this.gizmo) return;
    this.gizmo.setMode(mode);
    this.gizmo.setSpace(space);
    this.gizmo.setTranslationSnap(snap ? 0.5 : null);
    this.gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(snap ? 0.25 : null);
  }

  /** Smoothly frame entities (or the whole scene). */
  frame(ids: EntityId[] = this.selection): void {
    const box = this.boundsOf(ids.length ? ids : null);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    const dist = Math.max(sphere.radius, 0.5) / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.15;
    this.tween(sphere.center, sphere.center.clone().add(dir.multiplyScalar(dist)));
  }

  /** Point on the ground in front of the camera — where new entities are placed. */
  placementPoint(): [number, number, number] {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hit = new THREE.Vector3();
    const ok = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
    if (!ok || hit.distanceTo(this.camera.position) > 60) hit.copy(this.orbit.target).setY(0);
    return [round(hit.x, 2), 0, round(hit.z, 2)];
  }

  /** Agent eyes: render a still from a chosen view and return a PNG data URL. */
  capture(view: CaptureView, includeHelpers: boolean, width: number, height: number): string {
    const { renderer } = this.r;
    const cam = this.camera.clone();
    cam.aspect = width / height;
    if (view !== 'current') {
      const box = this.boundsOf(view === 'focus' && this.selection.length ? this.selection : null);
      if (!box.isEmpty()) {
        const s = box.getBoundingSphere(new THREE.Sphere());
        const dist = (s.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.05;
        const dir = view === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(1, 0.75, 1.1).normalize();
        cam.position.copy(s.center).addScaledVector(dir, dist);
        cam.lookAt(s.center);
      }
    }
    cam.updateProjectionMatrix();

    const hidden: THREE.Object3D[] = [];
    if (!includeHelpers) {
      for (const o of [this.helpers, this.gizmoHelper]) if (o.visible) (o.visible = false), hidden.push(o);
      this.sync.root.traverse((o) => {
        if (o.userData.helper && o.visible) (o.visible = false), hidden.push(o);
      });
    }
    try {
      return capturePng(renderer, this.scene, cam, width, height);
    } finally {
      for (const o of hidden) o.visible = true;
      renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.play?.dispose();
    this.play = null;
    this.resizeObs?.disconnect();
    if (!this.r) return;
    this.r.renderer.setAnimationLoop(null);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.sync.dispose();
    this.r.renderer.dispose();
    this.r.renderer.domElement.remove();
    for (const el of this.beaconEls.values()) el.remove();
  }

  /* ── play-in-editor ─────────────────────────────────────────────────── */

  get playing(): boolean {
    return this.play !== null;
  }

  /**
   * Hand the canvas to a PlaySession. With no source given, the current scene is
   * snapshotted into a local simulation; multiplayer passes a network source.
   */
  async enterPlay(hooks: PlayHooks, source?: GameSource): Promise<void> {
    if (!this.r || !this.doc || this.play) return;
    const src = source ?? (await LocalSource.create(this.doc));
    if (this.disposed) return src.dispose();
    this.r.renderer.setAnimationLoop(null);
    this.gizmo.detach();
    this.orbit.enabled = false;
    this.play = new PlaySession(this.r.renderer as unknown as ConstructorParameters<typeof PlaySession>[0], src, hooks, this.overlay);
    this.play.start();
  }

  exitPlay(): void {
    if (!this.play) return;
    this.play.dispose();
    this.play = null;
    this.orbit.enabled = true;
    if (this.doc) applyEnvironment(this.scene, this.r.renderer, this.doc.environment);
    this.attachGizmo();
    this.resize();
    this.r.renderer.setAnimationLoop(() => this.tick());
  }

  /* ── internals ──────────────────────────────────────────────────────── */

  private buildGrid(): void {
    const minor = new THREE.GridHelper(120, 120, 0x1f1d1a, 0x1a1816);
    const major = new THREE.GridHelper(120, 12, 0x34302a, 0x2b2824);
    (minor.material as THREE.Material).depthWrite = false;
    (major.material as THREE.Material).depthWrite = false;
    minor.position.y = major.position.y = 0.002;
    const axis = (color: number, a: THREE.Vector3, b: THREE.Vector3) =>
      new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    const x = axis(0xe5654b, new THREE.Vector3(-60, 0.004, 0), new THREE.Vector3(60, 0.004, 0));
    const z = axis(0x5f9bea, new THREE.Vector3(0, 0.004, -60), new THREE.Vector3(0, 0.004, 60));
    this.helpers.add(minor, major, x, z);
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h || !this.r) return;
    this.r.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private attachGizmo(): void {
    if (this.play) return void this.gizmo.detach();
    const id = this.selection.length === 1 ? this.selection[0]! : null;
    const obj = id ? this.sync.object(id) : undefined;
    const locked = id ? this.doc?.entities[id]?.locked : false;
    if (obj && !locked) {
      if (this.gizmo.object !== obj) this.gizmo.attach(obj);
    } else this.gizmo.detach();
  }

  private commitGizmo(): void {
    const obj = this.gizmo.object;
    const id = this.sync.entityIdOf(obj ?? null);
    if (!obj || !id) return;
    this.cb.onTransformCommit(id, {
      position: [round(obj.position.x), round(obj.position.y), round(obj.position.z)],
      rotation: [round(obj.rotation.x * RAD, 100), round(obj.rotation.y * RAD, 100), round(obj.rotation.z * RAD, 100)],
      scale: [round(obj.scale.x), round(obj.scale.y), round(obj.scale.z)],
    });
  }

  private handlePick(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (this.play) return;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || this.gizmo.dragging || this.gizmo.axis) return;
    const rect = this.r.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.sync.pickables(), true);
    const id = hits.length ? this.sync.entityIdOf(hits[0]!.object) : null;
    this.cb.onPick(id, e.shiftKey || e.ctrlKey || e.metaKey);
  }

  private boundsOf(ids: EntityId[] | null): THREE.Box3 {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    if (ids) for (const id of ids) box.union(this.sync.bounds(id, tmp));
    else if (this.doc) {
      // Whole-scene framing ignores terrain so content, not the ground slab, fills the view.
      for (const e of Object.values(this.doc.entities))
        if (e.components.mesh && e.visible && !e.tags.includes('terrain')) box.union(this.sync.bounds(e.id, tmp));
      if (box.isEmpty()) for (const e of Object.values(this.doc.entities)) if (e.components.mesh && e.visible) box.union(this.sync.bounds(e.id, tmp));
    }
    return box;
  }

  private tweenState: { t0: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3 } | null = null;
  private tween(target: THREE.Vector3, position: THREE.Vector3): void {
    this.tweenState = { t0: performance.now(), fromT: this.orbit.target.clone(), toT: target, fromP: this.camera.position.clone(), toP: position };
  }

  private tick(): void {
    if (this.tweenState) {
      const k = Math.min((performance.now() - this.tweenState.t0) / 420, 1);
      const e = 1 - Math.pow(1 - k, 3);
      this.orbit.target.lerpVectors(this.tweenState.fromT, this.tweenState.toT, e);
      this.camera.position.lerpVectors(this.tweenState.fromP, this.tweenState.toP, e);
      if (k >= 1) this.tweenState = null;
    }
    this.orbit.update();
    this.r.renderer.render(this.scene, this.camera);
    this.drawBeacons();

    this.frames++;
    const now = performance.now();
    if (now - this.lastStat > 500) {
      const info = this.r.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
      this.cb.onStats({
        fps: Math.round((this.frames * 1000) / (now - this.lastStat)),
        drawCalls: info.drawCalls ?? info.calls ?? 0,
        triangles: info.triangles ?? 0,
        backend: this.r.backend,
      });
      this.frames = 0;
      this.lastStat = now;
    }
  }

  private readonly corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  private drawBeacons(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    for (const b of this.beacons) {
      let el = this.beaconEls.get(b.key);
      if (!el) {
        el = document.createElement('div');
        el.className = `beacon${b.agent ? ' agent' : ''}`;
        el.innerHTML = '<i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="tag"></span>';
        this.overlay.appendChild(el);
        this.beaconEls.set(b.key, el);
      }
      el.style.setProperty('--c', b.color);
      const tag = el.querySelector('.tag') as HTMLSpanElement;
      if (tag.textContent !== b.label) tag.textContent = b.label;
      tag.style.display = b.label ? '' : 'none';

      const box = this.boundsOf(b.entityIds);
      if (box.isEmpty()) {
        // Lights/empties without geometry: bracket a small region around their origin.
        const c = new THREE.Vector3();
        let n = 0;
        for (const id of b.entityIds) {
          const o = this.sync.object(id);
          if (o) c.add(o.getWorldPosition(new THREE.Vector3())), n++;
        }
        if (!n) {
          el.style.opacity = '0';
          continue;
        }
        box.setFromCenterAndSize(c.divideScalar(n), new THREE.Vector3(0.6, 0.6, 0.6));
      }
      const { min, max } = box;
      let i = 0;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) this.corners[i++]!.set(x, y, z);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, behind = 0;
      for (const v of this.corners) {
        v.project(this.camera);
        if (v.z > 1) behind++;
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        x0 = Math.min(x0, sx), y0 = Math.min(y0, sy), x1 = Math.max(x1, sx), y1 = Math.max(y1, sy);
      }
      if (behind === 8) {
        el.style.opacity = '0';
        continue;
      }
      const pad = 6;
      x0 = Math.max(x0 - pad, 8), y0 = Math.max(y0 - pad, 34);
      x1 = Math.min(x1 + pad, w - 8), y1 = Math.min(y1 + pad, h - 8);
      el.style.opacity = x1 > x0 && y1 > y0 ? '1' : '0';
      el.style.transform = `translate(${x0}px, ${y0}px)`;
      el.style.width = `${Math.max(x1 - x0, 12)}px`;
      el.style.height = `${Math.max(y1 - y0, 12)}px`;
    }
  }
}
