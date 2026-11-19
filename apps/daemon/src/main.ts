import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectHub } from './hub';
import { Producer } from './producer';
import { createServer } from './server';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(process.env.FORGE_WORKSPACE ?? join(here, '../../../workspace'));
const port = Number(process.env.FORGE_PORT ?? 4317);
const host = '127.0.0.1';

const hub = new ProjectHub(workspace, process.env.FORGE_TEMPLATE ?? 'outpost-zero');
const producer = new Producer(join(workspace, 'secrets.json'));
const app = await createServer(hub, { port, host }, producer);
setInterval(() => hub.sweep(), 10_000).unref();

await app.listen({ port, host });
console.log(`\n  ▮ FORGE daemon  http://${host}:${port}   workspace ${workspace}   active ${hub.list().active}\n`);

const shutdown = async () => {
  await hub.flush();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
