import type { Entity, EntityId, Environment, SceneDoc, Shape } from '@forge/contracts';
import * as THREE from 'three';

const DEG = Math.PI / 180;

export interface SceneSyncOptions {
  /** Draw editor-only proxies (light icons, spawn markers, triggers, empties). Never in exported games. */
  editorHelpers?: boolean;
  shadowMapSize?: number;
}

interface Node {
  group: THREE.Group;
  mesh?: THREE.Mesh;
  light?: THREE.Light;
  helper?: THREE.Object3D;
  sig: { mesh?: string; light?: string; helper?: string };
}

/**
 * Reconciles a SceneDoc into a three.js object graph. Idempotent and diff-based:
 * call `sync(doc)` after every transaction. Transforms are always re-applied;
 * meshes/lights are rebuilt only when their component JSON changes.
 */
export class SceneSync {
  readonly root = new THREE.Group();
  private readonly nodes = new Map<EntityId, Node>();
  private readonly geometries = new Map<Shape, THREE.BufferGeometry>();
  private readonly helperMaterials = new Map<string, THREE.Material>();

  constructor(private readonly opts: SceneSyncOptions = {}) {
    this.root.name = 'forge:root';
  }

  sync(doc: SceneDoc): void {
    const seen = new Set<EntityId>();
    for (const e of Object.values(doc.entities)) {
      seen.add(e.id);
      this.upsert(e);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.group.removeFromParent();
      this.disposeParts(node);
      this.nodes.delete(id);
    }
    for (const e of Object.values(doc.entities)) {
      const node = this.nodes.get(e.id)!;
      const parent = (e.parentId && this.nodes.get(e.parentId)?.group) || this.root;
      if (node.group.parent !== parent) parent.add(node.group);
    }
  }

  object(id: EntityId): THREE.Object3D | undefined {
    return this.nodes.get(id)?.group;
  }

  /** World-space bounds of an entity (meshes + helpers). */
  bounds(id: EntityId, target = new THREE.Box3()): THREE.Box3 {
    target.makeEmpty();
    const g = this.nodes.get(id)?.group;
    if (g) target.setFromObject(g, true);
    return target;
  }

  entityIdOf(obj: THREE.Object3D | null): EntityId | null {
    for (let o = obj; o; o = o.parent) if (typeof o.userData.entityId === 'string') return o.userData.entityId;
    return null;
  }

  /** Objects that are eligible for picking (meshes and helper proxies). */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const n of this.nodes.values()) {
      if (!n.group.visible) continue;
      if (n.mesh) out.push(n.mesh);
      if (n.helper) out.push(n.helper);
    }
    return out;
  }

  dispose(): void {
    for (const n of this.nodes.values()) this.disposeParts(n);
    this.nodes.clear();
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.helperMaterials.values()) m.dispose();
    this.root.clear();
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private upsert(e: Entity): void {
    let node = this.nodes.get(e.id);
    if (!node) {
      const group = new THREE.Group();
      group.userData.entityId = e.id;
      node = { group, sig: {} };
      this.nodes.set(e.id, node);
    }
    const { group } = node;
    group.name = e.name;
    group.visible = e.visible;
    const t = e.transform;
    group.position.set(...t.position);
    group.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'XYZ');
    group.scale.set(...t.scale);

    const meshSig = e.components.mesh ? JSON.stringify(e.components.mesh) : undefined;
    if (meshSig !== node.sig.mesh) {
      this.replace(node, 'mesh', e.components.mesh ? this.buildMesh(e.components.mesh) : undefined);
      node.sig.mesh = meshSig;
    }

    const lightSig = e.components.light ? JSON.stringify(e.components.light) : undefined;
    if (lightSig !== node.sig.light) {
      this.replace(node, 'light', e.components.light ? this.buildLight(e.components.light) : undefined);
      node.sig.light = lightSig;
    }

    if (this.opts.editorHelpers) {
      const helperSig = JSON.stringify([
        !!e.components.mesh,
        e.components.light?.kind,
        e.components.light?.color,
        e.components.spawnPoint,
        e.components.collider?.isTrigger ? e.components.collider : null,
      ]);
      if (helperSig !== node.sig.helper) {
        this.replace(node, 'helper', this.buildHelper(e));
        node.sig.helper = helperSig;
      }
    }
  }

  private replace(node: Node, key: 'mesh' | 'light' | 'helper', next: THREE.Object3D | undefined): void {
    const prev = node[key];
    if (prev) {
      prev.removeFromParent();
      if (key !== 'helper') disposeObject(prev);
    }
    if (next) node.group.add(next);
    (node as unknown as Record<string, unknown>)[key] = next;
  }

  private disposeParts(node: Node): void {
    if (node.mesh) disposeObject(node.mesh);
    if (node.light) disposeObject(node.light);
  }

  private geometry(shape: Shape): THREE.BufferGeometry {
    let g = this.geometries.get(shape);
    if (g) return g;
    switch (shape) {
      case 'box':
        g = new THREE.BoxGeometry(1, 1, 1);
        break;
      case 'sphere':
        g = new THREE.SphereGeometry(0.5, 48, 24);
        break;
      case 'cylinder':
        g = new THREE.CylinderGeometry(0.5, 0.5, 1, 40);
        break;
      case 'cone':
        g = new THREE.ConeGeometry(0.5, 1, 40);
        break;
      case 'capsule':
        g = new THREE.CapsuleGeometry(0.5, 1, 8, 24).scale(1, 0.5, 1);
        break;
      case 'torus':
        g = new THREE.TorusGeometry(0.375, 0.125, 24, 64);
        break;
      case 'plane':
        g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        break;
    }
    this.geometries.set(shape, g);
    return g;
  }

  private buildMesh(c: NonNullable<Entity['components']['mesh']>): THREE.Mesh {
    const m = c.material;
    const material = new THREE.MeshStandardMaterial({
      color: m.color,
      roughness: m.roughness,
      metalness: m.metalness,
      emissive: m.emissive,
      emissiveIntensity: m.emissiveIntensity,
      transparent: m.opacity < 1,
      opacity: m.opacity,
      side: c.shape === 'plane' ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(this.geometry(c.shape), material);
    mesh.userData.sharedGeometry = true;
    mesh.scale.set(...c.size);
    mesh.castShadow = c.castShadow;
    mesh.receiveShadow = c.receiveShadow;
    return mesh;
  }

  private buildLight(c: NonNullable<Entity['components']['light']>): THREE.Light {
    const size = this.opts.shadowMapSize ?? 2048;
    switch (c.kind) {
      case 'directional': {
        const l = new THREE.DirectionalLight(c.color, c.intensity);
        l.add(l.target);
        l.target.position.set(0, 0, -1);
        l.castShadow = c.castShadow;
        const cam = l.shadow.camera;
        cam.left = cam.bottom = -34;
        cam.right = cam.top = 34;
        cam.near = 0.5;
        cam.far = 140;
        l.shadow.mapSize.set(size, size);
        l.shadow.bias = -0.0004;
        l.shadow.normalBias = 0.03;
        return l;
      }
      case 'point': {
        const l = new THREE.PointLight(c.color, c.intensity, c.range, 2);
        l.castShadow = c.castShadow;
        return l;
      }
      case 'spot': {
        const l = new THREE.SpotLight(c.color, c.intensity, c.range, c.angle * DEG, 0.4, 2);
        l.add(l.target);
        l.target.position.set(0, 0, -1);
        l.castShadow = c.castShadow;
        l.shadow.mapSize.set(size / 2, size / 2);
        l.shadow.bias = -0.0004;
        return l;
      }
      case 'hemisphere':
        return new THREE.HemisphereLight(c.color, c.groundColor, c.intensity);
    }
  }

  private helperMaterial(color: string): THREE.Material {
    let m = this.helperMaterials.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85, depthWrite: false });
      this.helperMaterials.set(color, m);
    }
    return m;
  }

  private buildHelper(e: Entity): THREE.Object3D | undefined {
    const c = e.components;
    const group = new THREE.Group();
    group.userData.helper = true;
    if (c.light && !c.mesh) {
      const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), this.helperMaterial(c.light.color));
      if (c.light.kind === 'directional' || c.light.kind === 'spot') {
        const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.4, 4).translate(0, -0.7, 0).rotateX(Math.PI / 2), this.helperMaterial(c.light.color));
        icon.add(ray);
      }
      group.add(icon);
    }
    if (c.spawnPoint) {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12).translate(0, 0.9, 0), this.helperMaterial('#9bd15a'));
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 8).rotateX(-Math.PI / 2).translate(0, 1.4, -0.55), this.helperMaterial('#9bd15a'));
      group.add(body, nose);
    }
    if (c.collider?.isTrigger) {
      const s = c.collider.size ?? c.mesh?.size ?? [1, 1, 1];
      const geo = c.collider.shape === 'sphere' ? new THREE.SphereGeometry(0.5, 12, 8) : new THREE.BoxGeometry(1, 1, 1);
      const trig = new THREE.Mesh(geo, this.helperMaterial('#f2b33d'));
      trig.scale.set(...s);
      group.add(trig);
    }
    if (!c.mesh && !c.light && !c.spawnPoint && !c.collider?.isTrigger) {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), this.helperMaterial('#6d675e')));
    }
    if (group.children.length === 0) return undefined;
    group.traverse((o) => {
      o.userData.helper = true;
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = false;
    });
    return group;
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (!o.userData.sharedGeometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
    if (o instanceof THREE.Light) o.dispose();
  });
}

export function applyEnvironment(scene: THREE.Scene, renderer: { toneMapping: THREE.ToneMapping; toneMappingExposure: number }, env: Environment): void {
  scene.background = new THREE.Color(env.background);
  scene.fog = env.fogDensity > 0 ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null;
  renderer.toneMapping = {
    agx: THREE.AgXToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping,
    none: THREE.NoToneMapping,
  }[env.toneMapping];
  renderer.toneMappingExposure = env.exposure;
}
