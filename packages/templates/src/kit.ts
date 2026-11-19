import { SceneDoc, type EntityInput } from '@forge/contracts';

type V3 = [number, number, number];
type Mat = { color: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; opacity?: number };

/** Tiny authoring kit so templates read like level scripts, not JSON. */
export class Kit {
  readonly ents: EntityInput[] = [];

  add(e: EntityInput): string {
    this.ents.push(e);
    return e.id;
  }

  group(id: string, name: string, position: V3 = [0, 0, 0], parentId: string | null = null): string {
    return this.add({ id, name, parentId, transform: { position } });
  }

  /** Solid static box (collider + static body). */
  solid(id: string, name: string, position: V3, size: V3, mat: Mat, o: { parentId?: string; rotation?: V3; tags?: string[]; shadow?: boolean } = {}): string {
    return this.add({
      id,
      name,
      parentId: o.parentId ?? null,
      transform: { position, rotation: o.rotation ?? [0, 0, 0] },
      components: { mesh: { shape: 'box', size, material: mat, castShadow: o.shadow ?? true }, collider: {}, rigidBody: { kind: 'static' } },
      tags: o.tags ?? ['structure'],
    });
  }

  /** Visual-only mesh (no collision). */
  prop(id: string, name: string, shape: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'cone' | 'torus' | 'plane', position: V3, size: V3, mat: Mat, o: { parentId?: string; rotation?: V3; tags?: string[]; solid?: boolean; shadow?: boolean } = {}): string {
    return this.add({
      id,
      name,
      parentId: o.parentId ?? null,
      transform: { position, rotation: o.rotation ?? [0, 0, 0] },
      components: {
        mesh: { shape, size, material: mat, castShadow: o.shadow ?? true },
        ...(o.solid ? { collider: {}, rigidBody: { kind: 'static' as const } } : {}),
      },
      tags: o.tags ?? [],
    });
  }

  light(id: string, name: string, kind: 'directional' | 'point' | 'spot' | 'hemisphere', position: V3, l: { color?: string; groundColor?: string; intensity: number; range?: number; angle?: number; castShadow?: boolean; rotation?: V3; parentId?: string }): string {
    return this.add({
      id,
      name,
      parentId: l.parentId ?? null,
      transform: { position, rotation: l.rotation ?? [0, 0, 0] },
      components: {
        light: {
          kind,
          color: l.color ?? '#ffffff',
          intensity: l.intensity,
          ...(l.groundColor ? { groundColor: l.groundColor } : {}),
          ...(l.range !== undefined ? { range: l.range } : {}),
          ...(l.angle !== undefined ? { angle: l.angle } : {}),
          castShadow: l.castShadow ?? false,
        },
      },
    });
  }

  spawn(id: string, position: V3, yaw = 0, team = 'any', parentId: string | null = null): string {
    return this.add({ id, name: `Spawn ${id.replace(/^ent_/, '')}`, parentId, transform: { position, rotation: [0, yaw, 0] }, components: { spawnPoint: { team } }, tags: ['spawn'] });
  }

  tree(id: string, position: V3, scale = 1, parentId: string | null = null): void {
    this.add({ id, name: 'Tree', parentId, transform: { position, scale: [scale, scale, scale] }, tags: ['foliage'] });
    this.prop(`${id}_trunk`, 'Trunk', 'cylinder', [0, 1.2, 0], [0.45, 2.4, 0.45], { color: '#5b4330', roughness: 0.95 }, { parentId: id, solid: true });
    this.prop(`${id}_canopy`, 'Canopy', 'cone', [0, 3.6, 0], [2.8, 3.8, 2.8], { color: '#2f4a2c', roughness: 0.9 }, { parentId: id });
  }

  build(meta: { sceneId?: string; name: string; environment: Record<string, unknown>; game: Record<string, unknown>; database?: Record<string, unknown> }): SceneDoc {
    return SceneDoc.parse({
      schemaVersion: 1,
      sceneId: meta.sceneId ?? 'main',
      name: meta.name,
      revision: 0,
      environment: meta.environment,
      game: meta.game,
      ...(meta.database ? { database: meta.database } : {}),
      entities: Object.fromEntries(this.ents.map((e) => [e.id, e])),
    });
  }
}
