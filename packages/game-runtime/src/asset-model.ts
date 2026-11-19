import { Box3, Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function assetModelUrl(id: string, preview = false): string {
  return '/api/assets/content/' + encodeURIComponent(id) + (preview ? '?preview=1' : '');
}

export async function loadAssetModel(url: string): Promise<Group> {
  const { scene } = await new GLTFLoader().loadAsync(url);
  const model = new Group();
  const box = new Box3().setFromObject(scene, true);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  model.add(scene);
  model.scale.setScalar(1 / longest);
  model.position.copy(center).multiplyScalar(-1 / longest);
  return model;
}
