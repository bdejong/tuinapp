import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { handleBackups, scheduledBackup } from '../../cloudflare/backups';
import { parseDump } from '../../cloudflare/dump';
import type { Env } from '../../cloudflare/types';

let mf: Miniflare;
let env: Env;

async function freshEnv(): Promise<Env> {
  const worker = `backup-${crypto.randomUUID()}`;
  mf = new Miniflare({
    workers: [{
      config: {
        name: worker,
        compatibilityDate: '2026-10-01',
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default { fetch() { return new Response("ok") } }' } } },
        env: { DB: { type: 'd1', name: worker }, BACKUPS: { type: 'r2', name: worker } },
      },
    }],
  });
  const next: Env = { DB: await mf.getD1Database('DB', worker), BACKUPS: await mf.getR2Bucket('BACKUPS', worker), TUINAPP_PASSWORD_HASH: '', TUINAPP_SESSION_SECRET: 'test' };
  for (const migration of ['0001_initial.sql', '0002_data_generation.sql', '0003_remove_plant_photos.sql']) {
    const source = await readFile(resolve('cloudflare/migrations', migration), 'utf8');
    const statements = source.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean);
    for (const sql of statements) await next.DB.prepare(sql).run();
  }
  return next;
}

async function call(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return handleBackups(new Request(`https://tuin.test/api${path}`, { method, headers, body }), env);
}


async function responseJson<T>(response: Response): Promise<T> { return await response.json() as T; }

describe('Cloudflare backups', () => {
  beforeEach(async () => { env = await freshEnv(); });
  afterEach(async () => { await mf?.dispose(); });

  it('backs up only changed data, including updates and deletes, and reports R2 as storage', async () => {
    await env.DB.prepare("INSERT INTO plants(id,name,needs_reorder) VALUES(1,'One',1)").run();
    await scheduledBackup(env);
    const first = await responseJson<{ storage: string; backups: { file: string; reason: string }[]; checked_unchanged: boolean }>(await call('GET', '/backups/status'));
    expect(first.storage).toBe('r2');
    expect(first.backups).toHaveLength(1);
    expect(first.backups[0].reason).toBe('scheduled');
    await scheduledBackup(env);
    const unchanged = await responseJson<{ backups: unknown[]; checked_unchanged: boolean }>(await call('GET', '/backups/status'));
    expect(unchanged.backups).toHaveLength(1);
    expect(unchanged.checked_unchanged).toBe(true);
    await env.DB.prepare("UPDATE plants SET needs_reorder=0,revision=revision+1 WHERE id=1").run();
    await scheduledBackup(env);
    await env.DB.prepare('DELETE FROM plants WHERE id=1').run();
    await scheduledBackup(env);
    const changed = await responseJson<{ backups: { file: string }[] }>(await call('GET', '/backups/status'));
    expect(changed.backups).toHaveLength(3);
    const latest = await call('GET', `/backups/${changed.backups[0].file}/download`);
    expect(latest.status).toBe(200);
    expect(latest.headers.get('content-type')).toContain('application/sql');
    expect(parseDump(await latest.text()).dataset.plants).toEqual([]);
  });

  it('records a failed scheduled upload and retries successfully on the next cron run', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Retry me')").run();
    const bucket = env.BACKUPS;
    let fail = true;
    env.BACKUPS = new Proxy(bucket, { get(target, property) { if (property === 'put') return async (key: string, body: string, options?: R2PutOptions) => { if (fail) { fail = false; throw new Error('Transient R2 error'); } return target.put(key, body, options); }; const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
    await expect(scheduledBackup(env)).rejects.toThrow('Transient R2 error');
    const failed = await responseJson<{last_error:string; backups:unknown[]}>(await call('GET', '/backups/status'));
    expect(failed.last_error).toContain('Transient R2 error');
    expect(failed.backups).toHaveLength(0);
    await scheduledBackup(env);
    const success = await responseJson<{last_error:null; backups:unknown[]}>(await call('GET', '/backups/status'));
    expect(success.last_error).toBeNull();
    expect(success.backups).toHaveLength(1);
  });

  it('refuses a corrupt R2 readback and retries without advancing backup state', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Readback retry')").run();
    const bucket = env.BACKUPS;
    let corruptReadback = true;
    env.BACKUPS = new Proxy(bucket, { get(target, property) {
      if (property === 'get') return async (key: string) => {
        const object = await target.get(key);
        if (corruptReadback && object) return { text: async () => 'corrupt readback' };
        return object;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(scheduledBackup(env)).rejects.toThrow('read-back verification');
    expect((await responseJson<{ backups: unknown[]; last_error: string }>(await call('GET', '/backups/status'))).backups).toHaveLength(0);
    expect((await env.DB.prepare('SELECT backup_generation FROM app_state WHERE id=1').first<{backup_generation:number}>())?.backup_generation).toBe(-1);
    corruptReadback = false;
    await scheduledBackup(env);
    expect((await responseJson<{ backups: unknown[]; last_error: null }>(await call('GET', '/backups/status'))).backups).toHaveLength(1);
  });

  it('repairs a missing or corrupt latest R2 object without waiting for a garden edit', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Steady')").run();
    await scheduledBackup(env);
    const first = await responseJson<{ backups: { file: string }[] }>(await call('GET', '/backups/status'));
    const file = first.backups[0].file;
    await env.BACKUPS.put(`backups/${file}`, 'not a backup');
    await scheduledBackup(env);
    let latest = await responseJson<{ backups: { file: string }[] }>(await call('GET', '/backups/status'));
    expect(latest.backups[0].file).not.toBe(file);
    expect((await (await call('GET', `/backups/${latest.backups[0].file}/download`)).text())).toContain('-- tuinapp-backup-v1');
    await env.BACKUPS.delete(`backups/${latest.backups[0].file}`);
    await scheduledBackup(env);
    latest = await responseJson<{ backups: { file: string }[] }>(await call('GET', '/backups/status'));
    const repaired = await call('GET', `/backups/${latest.backups[0].file}/download`);
    expect(repaired.status).toBe(200);
    expect(await repaired.text()).toContain("INSERT INTO plants (id,name");
  });

  it('does not expose a website restore endpoint', async () => {
    const response = await call('POST', '/backups/restore', 'not SQL');
    expect(response.status).toBe(404);
  });

  it('reports missing and corrupt remote history objects instead of downloading them', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Backup me')").run();
    await scheduledBackup(env);
    const status = await responseJson<{ backups: { file: string }[] }>(await call('GET', '/backups/status'));
    const file = status.backups[0].file;
    await env.BACKUPS.delete(`backups/${file}`);
    expect((await call('GET', `/backups/${file}/download`)).status).toBe(404);
    await env.BACKUPS.put(`backups/${file}`, 'bad');
    expect((await call('GET', `/backups/${file}/download`)).status).toBe(500);
  });

  it('uses the upload lease so overlapping cron runs produce only one R2 backup', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('One lease')").run();
    const bucket = env.BACKUPS;
    let uploadCount = 0;
    let started!: () => void;
    const uploadStarted = new Promise<void>((resolve) => { started = resolve; });
    let release!: () => void;
    const uploadGate = new Promise<void>((resolve) => { release = resolve; });
    env.BACKUPS = new Proxy(bucket, { get(target, property) {
      if (property === 'put') return async (key: string, body: string, options?: R2PutOptions) => {
        uploadCount++;
        started();
        await uploadGate;
        return target.put(key, body, options);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const firstRun = scheduledBackup(env);
    await uploadStarted;
    await scheduledBackup(env);
    expect(uploadCount).toBe(1);
    release();
    await firstRun;
    expect((await responseJson<{backups:unknown[]}>(await call('GET', '/backups/status'))).backups).toHaveLength(1);
  });

  it('retains the newest 90 scheduled backups and keeps every protected restore point', async () => {
    const scheduledFiles: string[] = [];
    for (let index = 0; index < 91; index++) {
      const stamp = new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString().replace(/[-:]|\.\d{3}/g, '');
      const file = `tuinapp-${stamp}-0-${index.toString(16).padStart(8, '0')}-00000000.sql`;
      scheduledFiles.push(file);
      await env.BACKUPS.put(`backups/${file}`, 'seeded scheduled backup');
      await env.DB.prepare('INSERT INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,uploaded_at) VALUES(?,?,?,0,?,0,0,0,?)')
        .bind(file, new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(), 'scheduled', 'a'.repeat(64), new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()).run();
    }
    const protectedFiles = ['tuinapp-20200101T000000Z-0-aaaaaaaa-00000001.sql', 'tuinapp-20200102T000000Z-0-bbbbbbbb-00000002.sql'];
    for (const file of protectedFiles) {
      await env.BACKUPS.put(`backups/${file}`, 'protected recovery point');
      await env.DB.prepare('INSERT INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,uploaded_at) VALUES(?,?,?,0,?,0,0,0,?)')
        .bind(file, file.includes('20200101') ? '2020-01-01T00:00:00.000Z' : '2020-01-02T00:00:00.000Z', 'before-restore', 'b'.repeat(64), '2020-01-01T00:00:00.000Z').run();
    }
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Retention run')").run();
    await scheduledBackup(env);
    const status = await responseJson<{backups:{file:string;reason:string}[]}>(await call('GET', '/backups/status'));
    expect(status.backups.filter((backup) => backup.reason === 'scheduled')).toHaveLength(90);
    expect(status.backups.filter((backup) => backup.reason === 'before-restore').map((backup) => backup.file).sort()).toEqual([...protectedFiles].sort());
    expect(await env.BACKUPS.get(`backups/${scheduledFiles[0]}`)).toBeNull();
    for (const file of protectedFiles) expect(await env.BACKUPS.get(`backups/${file}`)).not.toBeNull();
  });
});
