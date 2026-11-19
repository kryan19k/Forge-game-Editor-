import { describe, expect, it } from 'vitest';
import { templates } from '../src';

describe('templates', () => {
  for (const t of Object.values(templates)) {
    it(`${t.id} produces a valid scene with a spawn point`, () => {
      const scene = t.createScene();
      const all = Object.values(scene.entities);
      expect(all.length).toBeGreaterThan(5);
      expect(all.some((e) => e.components.spawnPoint)).toBe(true);
      for (const e of all) if (e.parentId) expect(scene.entities[e.parentId]).toBeDefined();
    });
  }
});
