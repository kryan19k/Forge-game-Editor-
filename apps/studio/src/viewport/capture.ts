import { Vector2, type Camera, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

export function capturePng(renderer: WebGPURenderer, scene: Scene, camera: Camera, width: number, height: number): string {
  const size = renderer.getSize(new Vector2());
  const ratio = renderer.getPixelRatio();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    renderer.setPixelRatio(ratio);
    renderer.setSize(size.x, size.y, false);
  }
}
