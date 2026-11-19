import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export type RenderBackend = 'webgpu' | 'webgl2';

export interface ForgeRenderer {
  renderer: WebGPURenderer;
  backend: RenderBackend;
}

/**
 * WebGPU is progressive enhancement (ADR-001): WebGPURenderer runs on WebGPU when
 * available and falls back to its WebGL2 backend otherwise. One renderer API either way.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { forceWebGL?: boolean; antialias?: boolean } = {},
): Promise<ForgeRenderer> {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
  const renderer = new WebGPURenderer({
    canvas,
    antialias: opts.antialias ?? true,
    forceWebGL: opts.forceWebGL ?? !hasWebGPU,
  });
  await renderer.init();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const backend: RenderBackend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  return { renderer, backend };
}
