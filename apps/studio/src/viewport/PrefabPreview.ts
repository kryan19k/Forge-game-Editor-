import { Entity, type Prefab } from '@forge/contracts';
import { createRenderer, SceneSync } from '@forge/game-runtime';
import { AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Scene, Sphere, Vector3 } from 'three';
import { capturePng } from './capture';

export async function createPrefabPreview() {
  const { renderer } = await createRenderer(document.createElement('canvas'));
  const sync = new SceneSync();
  const scene = new Scene();
  scene.background = new Color('#201e1b');
  const key = new DirectionalLight('#ffe8ce', 2.8);
  key.position.set(4, 6, 3);
  scene.add(sync.root, key, new AmbientLight('#d0e4ff', 1.2));
  const camera = new PerspectiveCamera(37, 1.6, 0.01, 2000);
  const direction = new Vector3(1.15, 0.7, 1.3).normalize();

  return {
    render(prefab: Prefab): string | null {
      const entities = Object.fromEntries(prefab.entities.map((entity) => [entity.id, Entity.parse(entity)]));
      sync.sync({ entities });
      const bounds = new Box3();
      sync.root.updateMatrixWorld(true);
      sync.root.traverseVisible((object) => {
        if ('isMesh' in object) bounds.expandByObject(object, true);
      });
      if (bounds.isEmpty()) return null;
      const { center, radius } = bounds.getBoundingSphere(new Sphere());
      const distance = Math.max(radius, 0.01) * 1.12 / Math.sin(camera.fov * Math.PI / 360);
      camera.near = Math.max(0.001, distance / 100);
      camera.far = distance + Math.max(radius * 2, 10);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      return capturePng(renderer, scene, camera, 256, 160);
    },
    dispose() {
      sync.dispose();
      renderer.dispose();
    },
  };
}
