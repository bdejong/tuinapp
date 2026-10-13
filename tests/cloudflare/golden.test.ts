import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { handleBackups, scheduledBackup } from '../../cloudflare/backups';
import { makeDump, type Dataset, type SqlValue } from '../../cloudflare/dump';
import type { Env } from '../../cloudflare/types';

const goldenPath = process.env.TUINAPP_GOLDEN_DB;
const goldenSha = 'ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6';
let mf: Miniflare;
let env: Env;

function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  return value;
}

async function newEnv(): Promise<Env> {
  const worker = `golden-${crypto.randomUUID()}`;
  mf = new Miniflare({ workers: [{ config: {
    name: worker,
    compatibilityDate: '2026-10-01',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default {}' } } },
    env: { DB: { type: 'd1', name: worker }, BACKUPS: { type: 'r2', name: worker } },
  } }] });
  const result: Env = { DB: await mf.getD1Database('DB', worker), BACKUPS: await mf.getR2Bucket('BACKUPS', worker), TUINAPP_PASSWORD_HASH: '', TUINAPP_SESSION_SECRET: 'golden-test' };
  for (const migration of ['0001_initial.sql', '0002_data_generation.sql']) {
    const sql = await readFile(resolve('cloudflare/migrations', migration), 'utf8');
    for (const statement of sql.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean)) {
      await result.DB.prepare(statement).run();
    }
  }
  await result.DB.prepare('INSERT INTO auth_sessions(token_hash,csrf_token,expires_at,restore_epoch) VALUES(?,?,?,0)').bind('golden-session','golden-csrf',Math.floor(Date.now()/1000)+3600).run();
  return result;
}

function loadGolden(path: string): { dataset: Dataset; digest: string } {
  const sourceBytes = new Uint8Array(readFileSync(path));
  const digest = createHash('sha256').update(sourceBytes).digest('hex');
  if (digest !== goldenSha) throw new Error(`Golden source hash mismatch: ${digest}`);
  const source = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    expect(source.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    expect(source.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(source.prepare('SELECT version FROM schema_version').get()).toMatchObject({ version: 3 });
    const plants = source.prepare('SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,1 AS revision FROM plants ORDER BY id').all() as Record<string, SqlValue>[];
    const activities = source.prepare('SELECT id,name,description,active_periods,created_at,updated_at,1 AS revision FROM activities ORDER BY id').all() as Record<string, SqlValue>[];
    const photos = source.prepare('SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id').all().map((row) => ({ ...row, image_data: row.image_data == null ? null : new Uint8Array(row.image_data as ArrayBuffer) })) as Record<string, SqlValue>[];
    const sqlite_sequence = source.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name").all() as { name: string; seq: number }[];
    return { dataset: { plants, activities, plant_photos: photos, imports: [], sqlite_sequence, generation: 0 }, digest };
  } finally { source.close(); }
}

async function request(method: string, path: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  return handleBackups(new Request(`https://tuin.test/api${path}`, { method, body, headers }), env, { tokenHash: 'golden-session' });
}

describe.skipIf(!goldenPath)('preserved golden garden through D1 and R2', () => {
  beforeEach(async () => { env = await newEnv(); });
  afterEach(async () => { await mf?.dispose(); });

  it('round trips every legacy field, sequence, and all twelve calendar bits through a D1 restore and verified R2 backup', async () => {
    const beforeHash = createHash('sha256').update(new Uint8Array(readFileSync(goldenPath!))).digest('hex');
    const { dataset, digest } = loadGolden(goldenPath!);
    expect(digest).toBe(goldenSha);
    expect(dataset.plants).toHaveLength(177);
    expect(dataset.activities).toHaveLength(9);
    const dump = makeDump(dataset);
    const restored = await request('POST', '/backups/restore', dump, { 'content-type': 'application/sql', 'x-tuinapp-restore-confirm': 'replace' });
    expect(restored.status).toBe(200);
    const plants = await env.DB.prepare('SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision FROM plants ORDER BY id').all();
    const activities = await env.DB.prepare('SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities ORDER BY id').all();
    const photos = await env.DB.prepare('SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id').all();
    const imports = await env.DB.prepare('SELECT fingerprint,kind,imported_at,row_count FROM imports ORDER BY fingerprint').all();
    const sequences = await env.DB.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name").all();
    expect(normalize(plants.results)).toEqual(normalize(dataset.plants));
    expect(normalize(activities.results)).toEqual(normalize(dataset.activities));
    expect(normalize(photos.results)).toEqual(normalize(dataset.plant_photos));
    expect(imports.results).toEqual(dataset.imports);
    expect(sequences.results).toEqual(dataset.sqlite_sequence);
    for (let month = 0; month < 12; month++) {
      const early = 1 << (month * 2);
      const late = early << 1;
      const expected = {
        sow_early: dataset.plants.reduce((n, row) => n + ((Number(row.sow_periods) & early) !== 0 ? 1 : 0), 0),
        sow_late: dataset.plants.reduce((n, row) => n + ((Number(row.sow_periods) & late) !== 0 ? 1 : 0), 0),
        plant_early: dataset.plants.reduce((n, row) => n + ((Number(row.plant_periods) & early) !== 0 ? 1 : 0), 0),
        plant_late: dataset.plants.reduce((n, row) => n + ((Number(row.plant_periods) & late) !== 0 ? 1 : 0), 0),
        activity_early: dataset.activities.reduce((n, row) => n + ((Number(row.active_periods) & early) !== 0 ? 1 : 0), 0),
        activity_late: dataset.activities.reduce((n, row) => n + ((Number(row.active_periods) & late) !== 0 ? 1 : 0), 0),
      };
      const actual = await env.DB.prepare('SELECT (SELECT SUM((sow_periods & ?) != 0) FROM plants) AS sow_early,(SELECT SUM((sow_periods & ?) != 0) FROM plants) AS sow_late,(SELECT SUM((plant_periods & ?) != 0) FROM plants) AS plant_early,(SELECT SUM((plant_periods & ?) != 0) FROM plants) AS plant_late,(SELECT SUM((active_periods & ?) != 0) FROM activities) AS activity_early,(SELECT SUM((active_periods & ?) != 0) FROM activities) AS activity_late').bind(early,late,early,late,early,late).first<typeof expected>();
      expect(actual, `all half-month calendar flags for month ${month + 1}`).toEqual(expected);
    }
    await scheduledBackup(env);
    const status = await (await request('GET', '/backups/status')).json() as { backups: { file: string }[] };
    const downloaded = await request('GET', `/backups/${status.backups[0].file}/download`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toContain('application/sql');
    expect(downloaded.headers.get('content-disposition')).toContain('.sql');
    const currentGeneration = await env.DB.prepare('SELECT generation FROM app_state WHERE id=1').first<{generation:number}>();
    expect(await downloaded.text()).toBe(makeDump({ ...dataset, generation: currentGeneration!.generation }));
    expect(createHash('sha256').update(new Uint8Array(readFileSync(goldenPath!))).digest('hex')).toBe(beforeHash);
    expect(beforeHash).toBe(goldenSha);
  });
});
