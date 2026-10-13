import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Env } from '../../cloudflare/types';
import { handleBackups } from '../../cloudflare/backups';

let mf: Miniflare;
let env: Env;
const names = ['0001_initial.sql', '0002_data_generation.sql'];
function statements(sql: string): string[] {
  return sql.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean);
}
function sha(text: string): string { return createHash('sha256').update(text).digest('hex'); }

async function applyRecorded(name: string, sql: string): Promise<void> {
  const existing = await env.DB.prepare('SELECT name FROM d1_migrations WHERE name=?').bind(name).first<{name:string}>();
  if (existing) return;
  await env.DB.batch([
    ...statements(sql).map((statement) => env.DB.prepare(statement)),
    env.DB.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name),
  ]);
}

describe('Cloudflare D1 migrations', () => {
  beforeEach(async () => {
    const worker = `migration-${crypto.randomUUID()}`;
    mf = new Miniflare({ workers: [{ config: { name: worker, compatibilityDate: '2026-10-01', manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default {}' } } }, env: { DB: { type: 'd1', name: worker }, BACKUPS: { type: 'r2', name: worker } } } }] });
    env = { DB: await mf.getD1Database('DB', worker), BACKUPS: await mf.getR2Bucket('BACKUPS', worker), TUINAPP_PASSWORD_HASH: '', TUINAPP_SESSION_SECRET: 'test' };
    await env.DB.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  });
  afterEach(async () => { await mf?.dispose(); });

  it('upgrades existing data once, records the native ledger entry, and preserves generation tracking', async () => {
    const first = await readFile(resolve('cloudflare/migrations', names[0]), 'utf8');
    const second = await readFile(resolve('cloudflare/migrations', names[1]), 'utf8');
    await applyRecorded(names[0], first);
    await env.DB.prepare("INSERT INTO plants(id,name,needs_reorder,revision) VALUES(17,'Épinard',1,8)").run();
    const before = await env.DB.prepare('SELECT generation FROM app_state WHERE id=1').first<{generation:number}>();
    await applyRecorded(names[1], second);
    const after = await env.DB.prepare('SELECT schema_version,generation FROM app_state WHERE id=1').first<{schema_version:number;generation:number}>();
    expect(after?.schema_version).toBe(2);
    expect(after?.generation).toBe(before?.generation);
    expect(await env.DB.prepare('SELECT id,name,needs_reorder,revision FROM plants WHERE id=17').first()).toMatchObject({ id: 17, name: 'Épinard', needs_reorder: 1, revision: 8 });
    await env.DB.prepare("UPDATE plants SET needs_reorder=0 WHERE id=17").run();
    const changed = await env.DB.prepare('SELECT generation FROM app_state WHERE id=1').first<{generation:number}>();
    expect(changed!.generation).toBeGreaterThan(after!.generation);
    await applyRecorded(names[1], second);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM d1_migrations WHERE name=?').bind(names[1]).first<{n:number}>()).toMatchObject({ n: 1 });
  });

  it('rolls back a failed migration batch and can retry it cleanly', async () => {
    const first = await readFile(resolve('cloudflare/migrations', names[0]), 'utf8');
    const second = await readFile(resolve('cloudflare/migrations', names[1]), 'utf8');
    await applyRecorded(names[0], first);
    await env.DB.prepare("INSERT INTO plants(name) VALUES('Existing')").run();
    await expect(env.DB.batch([
      ...statements(second).map((statement) => env.DB.prepare(statement)),
      env.DB.prepare('INSERT INTO table_that_does_not_exist(value) VALUES(1)'),
      env.DB.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(names[1]),
    ])).rejects.toThrow();
    expect((await env.DB.prepare('SELECT schema_version FROM app_state WHERE id=1').first<{schema_version:number}>())?.schema_version).toBe(1);
    expect(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='plants_generation_insert'").first()).toBeNull();
    expect((await env.DB.prepare('SELECT count(*) AS n FROM d1_migrations').first<{n:number}>())?.n).toBe(1);
    await applyRecorded(names[1], second);
    expect((await env.DB.prepare('SELECT schema_version FROM app_state WHERE id=1').first<{schema_version:number}>())?.schema_version).toBe(2);
    expect((await env.DB.prepare("SELECT name FROM plants WHERE name='Existing'").first<{name:string}>())?.name).toBe('Existing');
  });

  it('checks immutable migration checksums and refuses unknown future schema versions', async () => {
    const manifest = JSON.parse(await readFile(resolve('cloudflare/migration-checksums.json'), 'utf8')) as Record<string,string>;
    for (const name of names) expect(manifest[name]).toBe(sha(await readFile(resolve('cloudflare/migrations', name), 'utf8')));
    await applyRecorded(names[0], await readFile(resolve('cloudflare/migrations', names[0]), 'utf8'));
    await applyRecorded(names[1], await readFile(resolve('cloudflare/migrations', names[1]), 'utf8'));
    await env.DB.prepare('UPDATE app_state SET schema_version=999 WHERE id=1').run();
    const response = await handleBackups(new Request('https://tuin.test/api/backups/status'), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Database schema is newer than this application' });
  });
});
