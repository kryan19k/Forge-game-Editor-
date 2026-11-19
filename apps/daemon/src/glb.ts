import type { AssetMetrics, Vec3 } from '@forge/contracts';
import { NodeIO, Primitive } from '@gltf-transform/core';
import { createHash } from 'node:crypto';

export const GLB_BYTE_LIMIT = 24 * 1024 * 1024;
export const GLB_TRIANGLE_LIMIT = 50_000;
const VERTEX_LIMIT = 150_000;

/** Read a self-contained static GLB and measure the geometry the default scene instances actually draw. */
export async function inspectGlb(bytes: Uint8Array): Promise<AssetMetrics> {
  const invalid = (message: string): never => { throw new Error(message); };
  if (bytes.byteLength < 20 || bytes.byteLength > GLB_BYTE_LIMIT) invalid('GLB must be between 20 bytes and 24 MiB.');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength) {
    invalid('Invalid GLB 2.0 header.');
  }
  const io = new NodeIO();
  const json = await io.binaryToJSON(bytes).catch(() => invalid('Could not read the GLB container.'));
  if (json.json.asset.version !== '2.0') invalid('Expected a glTF 2.0 asset.');
  if (json.json.buffers?.some((buffer) => buffer.uri) || json.json.images?.some((image) => image.uri || image.bufferView === undefined)) {
    invalid('The GLB must embed its buffers and images.');
  }
  if (json.json.extensionsRequired?.length || json.json.skins?.length || json.json.animations?.length) {
    invalid('The GLB must be a static model with standard geometry.');
  }
  if ((json.json.nodes?.length ?? 0) > 512 ||
    (json.json.accessors?.length ?? 0) > 1024 ||
    json.json.accessors?.some((accessor) => accessor.count > VERTEX_LIMIT || accessor.count < 1) ||
    (json.json.images?.length ?? 0) > 8) invalid('The model exceeds the scene or texture budget.');

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const nodes = json.json.nodes ?? [];
  const visit = (index: number) => {
    if (!nodes[index] || visiting.has(index)) invalid('Invalid GLB node hierarchy.');
    if (visited.has(index)) return;
    visiting.add(index);
    for (const child of nodes[index]!.children ?? []) visit(child);
    visiting.delete(index);
    visited.add(index);
  };
  for (const index of nodes.keys()) visit(index);

  const doc = await io.readJSON(json).catch(() => invalid('Could not parse the GLB geometry.'));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return invalid('The GLB has no scene.');
  for (const texture of root.listTextures()) {
    const size = texture.getSize();
    if (!size || size.some((axis) => axis < 1 || axis > 4096)) invalid('Textures must be readable and at most 4096 pixels per side.');
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let vertices = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    const vertex: [number, number, number] = [0, 0, 0];
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (primitive.getMode() !== Primitive.Mode.TRIANGLES || !position || position.getType() !== 'VEC3' || primitive.listTargets().length) {
        return invalid('Only static triangle primitives are supported.');
      }
      const count = position.getCount();
      const indices = primitive.getIndices();
      const elements = indices?.getCount() ?? count;
      if (elements % 3 || indices?.getArray()?.some((index) => index < 0 || index >= count)) invalid('Invalid GLB triangle indices.');
      triangles += elements / 3;
      vertices += count;
      if (triangles > GLB_TRIANGLE_LIMIT || vertices > VERTEX_LIMIT) invalid('The model exceeds 50,000 triangles or 150,000 vertices.');
      for (let i = 0; i < count; i++) {
        const [x, y, z] = position.getElement(i, vertex);
        for (const axis of [0, 1, 2] as const) {
          const value = m[axis] * x! + m[axis + 4]! * y! + m[axis + 8]! * z! + m[axis + 12]!;
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
        }
      }
    }
  });
  const size = max.map((value, axis) => value - min[axis]!);
  const longest = Math.max(...size);
  if (!triangles || !Number.isFinite(longest) || longest <= 1e-8) invalid('The GLB has no measurable geometry.');
  const dimensions = size.map((dimension) => dimension / longest) as Vec3;
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), triangles, dimensions };
}
