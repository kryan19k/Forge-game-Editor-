import type { AssetLibrary, AssetRecord } from '@forge/contracts';
import { runPlaytest } from '@forge/game-runtime/sim';
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { inspectGlb } from '../src/glb';
import { ProjectHub } from '../src/hub';
import { ModelAssets } from '../src/model-assets';
import { Producer } from '../src/producer';
import { createServer } from '../src/server';
import { TripoProvider } from '../src/tripo';

async function boxGlb(repeated = false): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const corners = new Float32Array([-1, -.5, -.5, 1, -.5, -.5, 1, .5, -.5, -1, .5, -.5, -1, -.5, .5, 1, -.5, .5, 1, .5, .5, -1, .5, .5]);
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
  const indices = repeated ? new Uint16Array(30_000 * 3) : new Uint16Array(faces);
  if (repeated) for (let i = 0; i < indices.length; i++) indices[i] = faces[i % faces.length]!;
  const position = doc.createAccessor().setType('VEC3').setArray(corners).setBuffer(buffer);
  const facesAccessor = doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer);
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', position).setIndices(facesAccessor));
  const scene = doc.createScene().addChild(doc.createNode().setMesh(mesh).setTranslation([3, 4, 5]));
  if (repeated) scene.addChild(doc.createNode().setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

it('validates GLB geometry and counts triangles across instances', async () => {
  const bytes = await boxGlb();
  await expect(inspectGlb(bytes)).resolves.toMatchObject({ triangles: 12, dimensions: [1, .5, .5], bytes: bytes.byteLength });
  await expect(inspectGlb(bytes.subarray(0, -1))).rejects.toThrow(/header/);
  await expect(inspectGlb(await boxGlb(true))).rejects.toThrow(/50,000 triangles/);
});

it('imports a local GLB without a Tripo key and applies the existing review gate', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-import-model-'));
  const hub = new ProjectHub(workspace);
  const assets = new ModelAssets(workspace);
  const app = await createServer(hub, { port: 4317, host: '127.0.0.1' }, undefined, assets);
  const bytes = Buffer.from(await boxGlb());
  const headers = { host: '127.0.0.1:4317', 'content-type': 'application/octet-stream' };
  const importFile = (fileName: string, payload = bytes, projectId = hub.active.project.projectId) => app.inject({
    method: 'POST', url: '/api/assets/import?' + new URLSearchParams({ fileName, projectId }), headers, payload,
  });
  try {
    expect((await importFile('asset.fbx')).statusCode).toBe(400);
    expect((await importFile('../asset.glb')).statusCode).toBe(400);
    expect((await importFile('Bad.glb', Buffer.from('bad'))).statusCode).toBe(422);
    expect((await importFile('Crate.glb', bytes, 'old-project')).statusCode).toBe(409);
    const imported = await importFile('metal_crate.glb');
    expect(imported.statusCode).toBe(201);
    const asset = imported.json<AssetRecord>();
    expect(asset).toMatchObject({ name: 'metal crate', sourceFile: 'metal_crate.glb', provider: 'local', status: 'review', metrics: { triangles: 12 } });
    expect(asset.prompt).toBeUndefined();
    expect(assets.approved(hub.active.project.projectId, asset.id)).toBe(false);
    expect(assets.list(hub.active.project.projectId)).toMatchObject({ configured: false, assets: [asset] });
    assets.review(hub.active.project.projectId, asset.id, true);
    expect(assets.placement(hub.active.project.projectId, { asset: asset.id, position: [1, 0, 1], meters: 2 })).toMatchObject({
      mutation: { entity: { components: { mesh: { asset: asset.id }, collider: { size: [2, 1, 1] } } } },
    });
  } finally {
    await hub.flush();
    await app.close();
  }
});

it('generates via mocked Tripo, gates approval, keeps immutable versions and places a playable collider', async () => {
  const bytes = await boxGlb();
  const workspace = mkdtempSync(join(tmpdir(), 'forge-models-'));
  const hub = new ProjectHub(workspace);
  const secrets = join(workspace, 'secrets.json');
  new Producer(secrets).setKey('mock-claude-key');
  const assets = new ModelAssets(workspace, new TripoProvider(), 1);
  const app = await createServer(hub, { port: 4317, host: '127.0.0.1' }, undefined, assets);
  const headers = { host: '127.0.0.1:4317' };
  const agent = { ...headers, 'x-forge-agent-id': 'codex' };
  const get = (url: string) => app.inject({ url, headers });
  const post = (url: string, payload: object, who = headers) => app.inject({ method: 'POST', url, payload, headers: who });
  const mockKey = 'tripo-mock-test-key';
  const modelUrl = 'https://cdn.tripo3d.ai/output/test.glb';
  let submissions = 0;
  let polls = 0;
  let unavailableOnce = true;
  const provider = vi.fn(async (input: string | URL, init: RequestInit) => {
    const url = new URL(input);
    if (url.href === modelUrl) {
      expect(init.headers).toBeUndefined();
      return new Response(Buffer.from(bytes), { headers: { 'content-type': 'model/gltf-binary' } });
    }
    expect(url.origin).toBe('https://openapi.tripo3d.ai');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ' + mockKey);
    if (url.pathname === '/v3/generation/text-to-model') {
      expect(JSON.parse(String(init.body))).toMatchObject({ prompt: 'A stone crossing', model: 'v3.1-20260211', face_limit: 40_000 });
      return Response.json({ code: 0, data: { task_id: 'job_' + ++submissions } });
    }
    expect(url.pathname).toBe('/v3/tasks/job_' + submissions);
    if (unavailableOnce) {
      unavailableOnce = false;
      return new Response(null, { status: 503 });
    }
    if (++polls % 2 === 1) return Response.json({ code: 0, data: { status: 'running', progress: 42 } });
    return Response.json({ code: 0, data: { status: 'success', credits_consumed: 40, output: { model_url: modelUrl } } });
  });
  vi.stubGlobal('fetch', provider);
  const request = { name: 'Stone crossing', prompt: 'A stone crossing' };
  const record = async (id: string) => (await get('/api/assets')).json<AssetLibrary>().assets.find((asset) => asset.id === id);
  try {
    expect((await get('/api/assets')).json<AssetLibrary>().configured).toBe(false);
    expect((await post('/api/assets/generate', request)).statusCode).toBe(409);
    expect((await post('/api/assets/key', { key: mockKey }, agent)).statusCode).toBe(403);
    const key = await post('/api/assets/key', { key: mockKey });
    expect(key.json()).toEqual({ configured: true });
    expect(JSON.parse(readFileSync(secrets, 'utf8'))).toEqual({ anthropicApiKey: 'mock-claude-key', tripoApiKey: mockKey });
    new Producer(secrets).setKey(null);
    expect(JSON.parse(readFileSync(secrets, 'utf8'))).toEqual({ tripoApiKey: mockKey });
    expect((await post('/api/assets/generate', request, agent)).statusCode).toBe(403);
    const generation = await post('/api/assets/generate', request);
    expect(generation.statusCode).toBe(202);
    const first = generation.json<AssetRecord>();
    const file = '/api/assets/content/' + first.id;
    const placement = { asset: first.id, position: [12, 0, 7], meters: 2 };
    await expect.poll(() => record(first.id)).toMatchObject({ status: 'review', credits: 40, metrics: { triangles: 12 } });
    expect((await get(file)).statusCode).toBe(404);
    expect((await get(file + '?preview=1')).rawPayload).toEqual(Buffer.from(bytes));
    expect((await post('/api/assets/place', placement, agent)).statusCode).toBe(409);
    expect((await post('/api/tx', { label: 'Unapproved asset', mutations: [{ op: 'create_entity', entity: { id: 'ent_bad_model', name: 'Unapproved', components: { mesh: { asset: first.id } } } }] }, agent)).json()).toMatchObject({ ok: false });
    const review = '/api/assets/' + first.id + '/review';
    expect((await post(review, { approve: true }, agent)).statusCode).toBe(403);
    expect((await post(review, { approve: true })).json()).toMatchObject({ status: 'approved' });
    expect((await get(file)).rawPayload).toEqual(Buffer.from(bytes));
    const placed = (await post('/api/assets/place', placement, agent)).json<{ ok: boolean; rootId: string }>();
    expect(placed.ok).toBe(true);
    expect(hub.active.scene.entities[placed.rootId]).toMatchObject({
      transform: { position: [12, .5, 7] },
      components: { mesh: { asset: first.id, size: [2, 2, 2] }, collider: { size: [2, 1, 1], shape: 'box' } },
    });
    const report = await runPlaytest(hub.active.scene, { name: 'Land on generated model', steps: [
      { do: 'teleport', position: [12, 3, 7] },
      { do: 'wait', seconds: 1 },
      { do: 'expect', check: { kind: 'grounded' } },
    ] });
    expect(report.passed).toBe(true);
    expect(report.final.player.position[1]).toBeCloseTo(1, 1);

    const next = (await post('/api/assets/generate', { ...request, versionOf: first.id })).json<AssetRecord>();
    expect(next).toMatchObject({ family: first.family, version: 2 });
    expect(next.id).not.toBe(first.id);
    await expect.poll(() => record(next.id)).toMatchObject({ status: 'review' });
    expect((await post('/api/assets/' + next.id + '/review', { approve: false })).json()).toMatchObject({ status: 'rejected' });
    expect((await get('/api/assets/content/' + next.id + '?preview=1')).statusCode).toBe(404);
    expect((await get(file)).rawPayload).toEqual(Buffer.from(bytes));
    const reopened = new ModelAssets(workspace).list(hub.active.project.projectId);
    expect(reopened.assets.map((asset) => asset.status)).toEqual(['rejected', 'approved']);
    expect(JSON.stringify(reopened)).not.toContain(mockKey);
  } finally {
    vi.unstubAllGlobals();
    await hub.flush();
    await app.close();
  }
});
