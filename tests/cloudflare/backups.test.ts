import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { handleBackups, scheduledBackup } from '../../cloudflare/backups';
import { makeDump, type Dataset } from '../../cloudflare/dump';
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
  for (const migration of ['0001_initial.sql', '0002_data_generation.sql']) {
    const source = await readFile(resolve('cloudflare/migrations', migration), 'utf8');
    const statements = source.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean);
    for (const sql of statements) await next.DB.prepare(sql).run();
  }
  await next.DB.prepare('INSERT INTO auth_sessions(token_hash,csrf_token,expires_at,restore_epoch) VALUES(?,?,?,0)').bind('test-session','test-csrf',Math.floor(Date.now()/1000)+3600).run();
  return next;
}

async function call(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return handleBackups(new Request(`https://tuin.test/api${path}`, { method, headers, body }), env, { tokenHash: 'test-session' });
}

function dataset(): Dataset {
  return {
    plants: [{ id: 17, name: "Épinard d'été", plant_type: 'vegetable_fruit', sun_requirements: 7, sow_periods: 8388611, plant_periods: 12, notes: "Line one\nLine 'two'", created_at: '2020-01-01 10:00:00', updated_at: '2021-01-01 11:00:00', needs_reorder: 1, revision: 9 }],
    activities: [{ id: 4, name: 'Prune', description: 'After frost', active_periods: 8388609, created_at: '2020-02-01', updated_at: '2021-03-01', revision: 3 }],
    plant_photos: [{ id: 3, plant_id: 17, sort_order: 2, image_data: new Uint8Array([0, 255, 22, 99, 2]), created_at: '2021-04-01' }],
    imports: [{ fingerprint: 'sha256:abc', kind: 'legacy', imported_at: '2022-01-01', row_count: 18 }],
    sqlite_sequence: [{ name: 'plants', seq: 99 }, { name: 'activities', seq: 7 }, { name: 'plant_photos', seq: 3 }],
    generation: 42,
  };
}

async function responseJson<T>(response: Response): Promise<T> { return await response.json() as T; }

describe('Cloudflare backups and restore', () => {
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
    expect(await latest.text()).toContain('-- tuinapp-backup-v1');
  });

  it('requires explicit confirmation and a successful R2 recovery snapshot before atomic restore', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Current')").run();
    const dump = makeDump(dataset());
    const denied = await call('POST', '/backups/restore', dump, { 'content-type': 'application/sql' });
    expect(denied.status).toBe(400);
    const bucket = env.BACKUPS;
    env.BACKUPS = new Proxy(bucket, { get(target, property) { if (property === 'put') return async () => { throw new Error('R2 offline'); }; const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
    const failed = await call('POST', '/backups/restore', dump, { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(failed.status).toBe(503);
    const stillCurrent = await env.DB.prepare('SELECT name FROM plants').first<{name:string}>();
    expect(stillCurrent?.name).toBe('Current');
    env.BACKUPS = bucket;
    const restored = await call('POST', '/backups/restore', dump, { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(restored.status).toBe(200);
    const payload = await responseJson<{ ok: boolean; recovery_file: string }>(restored);
    expect(payload.ok).toBe(true);
    expect(payload.recovery_file).toMatch(/\.sql$/);
    const plant = await env.DB.prepare('SELECT id,name,notes,needs_reorder,revision FROM plants').first<Record<string, unknown>>();
    expect(plant).toMatchObject({ id: 17, name: "Épinard d'été", notes: "Line one\nLine 'two'", needs_reorder: 1, revision: 9 });
    const photo = await env.DB.prepare('SELECT image_data FROM plant_photos WHERE id=3').first<{image_data: Uint8Array}>();
    expect([...photo!.image_data]).toEqual([0, 255, 22, 99, 2]);
    expect((await env.DB.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').bind('plants').first<{seq:number}>())?.seq).toBe(99);
    const history = await responseJson<{ backups: { reason: string }[] }>(await call('GET', '/backups/status'));
    expect(history.backups.some((entry) => entry.reason === 'before-restore')).toBe(true);
  });

  it('rejects corrupt dumps before creating recovery points and detects concurrent writes during snapshot creation', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Current')").run();
    const malformed = await call('POST', '/backups/restore', 'DROP TABLE plants;', { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(malformed.status).toBe(400);
    expect((await responseJson<{backups: unknown[]}>(await call('GET', '/backups/status'))).backups).toHaveLength(0);
    const bucket = env.BACKUPS;
    env.BACKUPS = new Proxy(bucket, { get(target, property) { if (property === 'put') return async (key: string, body: string, options?: R2PutOptions) => { await env.DB.prepare("INSERT INTO plants(name) VALUES('Concurrent')").run(); return target.put(key, body, options); }; const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
    const rejected = await call('POST', '/backups/restore', makeDump(dataset()), { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(rejected.status).toBe(409);
    expect((await env.DB.prepare('SELECT count(*) AS count FROM plants').first<{count:number}>())?.count).toBe(2);
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

  it('rejects invalid rows before recovery or garden changes', async () => {
    await env.DB.prepare("INSERT INTO plants(id,name) VALUES(1,'Keep me')").run();
    const base = makeDump(dataset());
    const invalid = [
      `${base}INSERT INTO plants (id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision) VALUES (17,'Duplicate',NULL,0,0,0,NULL,NULL,NULL,0,1);\n`,
      base.replace('VALUES (3,17,2,X\'00ff166302\'', 'VALUES (3,999,2,X\'00ff166302\''),
      base.replace("'vegetable_fruit'", "'unexpected_type'"),
      base.replace('8388611', '16777216'),
    ];
    for (const dump of invalid) {
      const response = await call('POST', '/backups/restore', dump, { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
      expect(response.status).toBe(400);
      expect((await env.DB.prepare('SELECT id,name FROM plants').all()).results).toEqual([{ id: 1, name: 'Keep me' }]);
      expect((await responseJson<{ backups: unknown[] }>(await call('GET', '/backups/status'))).backups).toHaveLength(0);
    }
  });

  it('rolls back the entire D1 batch when a late restore statement fails', async () => {
    await env.DB.prepare("INSERT INTO plants(id,name,revision) VALUES(5,'Keep me',4)").run();
    const database = env.DB;
    env.DB = new Proxy(database, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 10) {
            return target.batch([...statements, target.prepare('INSERT INTO missing_restore_table(value) VALUES(1)')]);
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await call('POST', '/backups/restore', makeDump(dataset()), { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(response.status).toBe(400);
    env.DB = database;
    expect((await env.DB.prepare('SELECT id,name,revision FROM plants').all()).results).toEqual([{ id: 5, name: 'Keep me', revision: 4 }]);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM backup_manifests WHERE reason=?').bind('before-restore').first<{n:number}>())?.n).toBe(1);
  });

  it('rejects a write that races after the recovery snapshot and immediately before the D1 batch', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Keep me')").run();
    const database = env.DB;
    env.DB = new Proxy(database, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 10) {
            await target.prepare("INSERT INTO plants(name) VALUES('Concurrent')").run();
          }
          return target.batch(statements);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await call('POST', '/backups/restore', makeDump(dataset()), { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(response.status).toBe(400);
    env.DB = database;
    expect((await env.DB.prepare('SELECT name FROM plants ORDER BY id').all()).results).toEqual([{ name: 'Keep me' }, { name: 'Concurrent' }]);
  });

  it('checks the restore session again inside the atomic batch', async () => {
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Keep me')").run();
    const database = env.DB;
    env.DB = new Proxy(database, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          if (statements.length > 10) await target.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind('test-session').run();
          return target.batch(statements);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await call('POST', '/backups/restore', makeDump(dataset()), { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(response.status).toBe(400);
    env.DB = database;
    expect((await env.DB.prepare('SELECT name FROM plants').all()).results).toEqual([{ name: 'Keep me' }]);
    expect((await env.DB.prepare('SELECT restore_epoch FROM app_state WHERE id=1').first<{restore_epoch:number}>())?.restore_epoch).toBe(0);
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

  it('restores multi-megabyte gardens using bounded D1 JSON batches', async () => {
    const large = dataset();
    large.plants = Array.from({ length: 32 }, (_, index) => ({
      id: index + 1, name: `Plant ${index + 1}`, plant_type: null, sun_requirements: 3,
      sow_periods: 0x555555, plant_periods: 0xaaaaaa, notes: 'garden note '.repeat(7_500),
      created_at: '2020-01-01', updated_at: '2026-10-12', needs_reorder: index % 2, revision: index + 1,
    }));
    large.plant_photos = [];
    large.sqlite_sequence = [{ name: 'plants', seq: 99 }, { name: 'activities', seq: 7 }, { name: 'plant_photos', seq: 3 }];
    const dump = makeDump(large);
    expect(new TextEncoder().encode(dump).byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(new TextEncoder().encode(dump).byteLength).toBeLessThan(5 * 1024 * 1024);
    const response = await call('POST', '/backups/restore', dump, { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(response.status).toBe(200);
    expect((await env.DB.prepare('SELECT count(*) AS n FROM plants').first<{n:number}>())?.n).toBe(32);
    expect((await env.DB.prepare('SELECT length(notes) AS n FROM plants WHERE id=32').first<{n:number}>())?.n).toBe(90_000);
  });

  it('rejects a single row over the D1 bound limit before taking the mandatory recovery point', async () => {
    const large = dataset();
    large.plants[0].notes = 'x'.repeat(1_600_000);
    const response = await call('POST', '/backups/restore', makeDump(large), { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('single restore row exceeds');
    expect((await responseJson<{backups:unknown[]}>(await call('GET', '/backups/status'))).backups).toHaveLength(0);
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
      await env.DB.prepare('INSERT INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,photos,uploaded_at) VALUES(?,?,?,0,?,0,0,0,0,?)')
        .bind(file, new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(), 'scheduled', 'a'.repeat(64), new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()).run();
    }
    const protectedFiles = ['tuinapp-20200101T000000Z-0-aaaaaaaa-00000001.sql', 'tuinapp-20200102T000000Z-0-bbbbbbbb-00000002.sql'];
    for (const file of protectedFiles) {
      await env.BACKUPS.put(`backups/${file}`, 'protected recovery point');
      await env.DB.prepare('INSERT INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,photos,uploaded_at) VALUES(?,?,?,0,?,0,0,0,0,?)')
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
