import { z } from 'zod';
import { GLB_BYTE_LIMIT } from './glb';

export const TRIPO_MODEL = 'v3.1-20260211';
const BASE = 'https://openapi.tripo3d.ai/v3';
const Created = z.object({ task_id: z.string().min(1).max(128) });
const Task = z.object({
  status: z.string(),
  progress: z.number().min(0).max(100).default(0),
  credits_consumed: z.number().nonnegative().optional(),
  output: z.object({ model_url: z.url().optional() }).optional(),
});
export type TripoTask = z.output<typeof Task>;

export interface ModelProvider {
  submit(key: string, prompt: string): Promise<string>;
  poll(key: string, taskId: string): Promise<TripoTask>;
  download(url: string): Promise<Uint8Array>;
}

export class TripoProvider implements ModelProvider {
  private async request(path: string, key: string, body?: object): Promise<unknown> {
    const response = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Tripo API returned HTTP ' + response.status + '.');
    const result = z.object({ code: z.number(), data: z.unknown() }).parse(await response.json());
    if (result.code !== 0) throw new Error('Tripo declined the request (code ' + result.code + ').');
    return result.data;
  }

  async submit(key: string, prompt: string): Promise<string> {
    const result = await this.request('/generation/text-to-model', key, { prompt, model: TRIPO_MODEL, texture: true, pbr: true, face_limit: 40_000 });
    return Created.parse(result).task_id;
  }

  async poll(key: string, taskId: string): Promise<TripoTask> {
    return Task.parse(await this.request('/tasks/' + encodeURIComponent(taskId), key));
  }

  async download(source: string): Promise<Uint8Array> {
    const url = new URL(source);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.tripo3d.ai') || url.port || url.username || url.password) {
      throw new Error('Tripo returned a model URL outside its HTTPS hosts.');
    }
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
    if (!response.ok || !response.body) throw new Error('Could not download the Tripo model.');
    const size = Number(response.headers.get('content-length') ?? 0);
    if (size > GLB_BYTE_LIMIT) {
      await response.body.cancel();
      throw new Error('The Tripo download exceeds 24 MiB.');
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > GLB_BYTE_LIMIT) throw new Error('The Tripo download exceeds 24 MiB.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return Buffer.concat(chunks, bytes);
  }
}
