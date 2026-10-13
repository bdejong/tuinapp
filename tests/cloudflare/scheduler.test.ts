import { afterEach, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Env } from '../../cloudflare/types';

let mf: Miniflare | undefined;

async function setup(): Promise<Env> {
  const workerName = `scheduler-${crypto.randomUUID()}`;
  const buildResult = await build({
    stdin: {
      contents: `import cron from './cloudflare/scheduler'; export { BackupRunner } from './cloudflare/scheduler'; export default { async fetch(request, env) { if (new URL(request.url).pathname !== '/__scheduled') return new Response(null,{status:404}); await cron.scheduled({cron:'15 2 * * *'}, env); return new Response(null,{status:204}); } }`,
      resolveDir: process.cwd(), sourcefile: 'scheduler-test.ts', loader: 'ts',
    },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'], write: false,
  });
  mf = new Miniflare({ workers: [{ config: {
    name: workerName,
    compatibilityDate: '2026-10-01',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: buildResult.outputFiles[0].text } } },
    env: {
      DB: { type: 'd1', name: workerName }, BACKUPS: { type: 'r2', name: workerName },
      BACKUP_RUNNER: { type: 'durable-object', worker: workerName, exportName: 'BackupRunner' },
    },
    exports: { BackupRunner: { type: 'durable-object', storage: 'sqlite' } },
  } }] });
  const env: Env = {
    DB: await mf.getD1Database('DB', workerName), BACKUPS: await mf.getR2Bucket('BACKUPS', workerName),
    TUINAPP_PASSWORD_HASH: '', TUINAPP_SESSION_SECRET: 'unused',
  };
  for (const migration of ['0001_initial.sql', '0002_data_generation.sql', '0003_remove_plant_photos.sql']) {
    const sql = await readFile(resolve('cloudflare/migrations', migration), 'utf8');
    const statements = sql.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean);
    for (const statement of statements) await env.DB.prepare(statement).run();
  }
  return env;
}

afterEach(async () => { await mf?.dispose(); mf = undefined; });

it('runs the scheduled snapshot through its private SQLite Durable Object', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO plants(name) VALUES('DO snapshot')").run();
  const worker = await mf!.getWorker();
  const response = await worker.fetch(new Request('https://scheduler.test/__scheduled'));
  expect(response.status).toBe(204);
  const manifests = await env.DB.prepare('SELECT file FROM backup_manifests').all<{file:string}>();
  expect(manifests.results).toHaveLength(1);
  expect(manifests.results[0].file).toMatch(/\.json$/u);
  expect((await env.BACKUPS.list()).objects).toHaveLength(1);
});

it('propagates backup failures from the Durable Object to the scheduled invocation', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO plants(id,name) VALUES(0,'Invalid')").run();
  const worker = await mf!.getWorker();
  await expect(worker.fetch(new Request('https://scheduler.test/__scheduled'))).rejects.toThrow('Scheduled backup runner failed');
  expect((await env.DB.prepare('SELECT backup_last_error FROM app_state WHERE id=1').first<{backup_last_error:string}>())?.backup_last_error).toContain('cannot be represented');
  expect((await env.BACKUPS.list()).objects).toHaveLength(0);
});
