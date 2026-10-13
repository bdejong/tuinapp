import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRestoreSql } from '../../cloudflare/restore';
import type { Dataset } from '../../cloudflare/dump';
import { makeDump } from '../../cloudflare/dump';
import { restoreDownloadedBackup } from '../../scripts/cloudflare-restore';

const migrations = ['0001_initial.sql', '0002_data_generation.sql', '0003_remove_plant_photos.sql'];
const guard = { schemaVersion: 3, generation: 8, restoreEpoch: 3 };

function fixture(): Dataset {
  return {
    plants: [{ id: 13, name: 'Parsley', plant_type: 'herb', sun_requirements: 4, sow_periods: 0x123456, plant_periods: 0xabcdef, notes: "quoted ' text\nwith unicode 🌱", created_at: '2020-01-02', updated_at: '2026-10-12', needs_reorder: 1, revision: 27 }],
    activities: [{ id: 5, name: 'Water', description: 'Every day', active_periods: 0xff0001, created_at: '2021-02-03', updated_at: '2026-09-10', revision: 8 }],
    imports: [{ fingerprint: 'sha256:abc', kind: 'legacy', imported_at: '2023-06-07', row_count: 14 }],
    sqlite_sequence: [{ name: 'plants', seq: 51 }, { name: 'activities', seq: 8 }],
    generation: 1,
  };
}

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  for (const file of migrations) db.exec(readFileSync(`cloudflare/migrations/${file}`, 'utf8'));
  db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT)');
  for (const [index, name] of migrations.entries()) db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(index + 1, name);
  db.exec('INSERT INTO plants(id,name) VALUES(1,\'Old plant\'); INSERT INTO auth_sessions(token_hash,csrf_token,expires_at,restore_epoch) VALUES(\'old\',\'csrf\',9999999999,0);');
  db.exec('UPDATE app_state SET generation=8,restore_epoch=3 WHERE id=1');
  return db;
}

describe('CLI-generated guarded database restore SQL', () => {
  it('rebuilds canonical SQL, preserving IDs, timestamps, flags, revisions, imports and sequences', () => {
    const db = database();
    const sql = buildRestoreSql(fixture(), guard, migrations, 1_800_000_000);
    expect(sql).not.toContain('BEGIN');
    expect(sql).toContain('generation FROM app_state WHERE id=1)=8');
    expect(sql).toContain('restore_epoch FROM app_state WHERE id=1)=3');
    db.exec(sql);
    expect(db.prepare('SELECT id,name,plant_type,sow_periods,plant_periods,notes,needs_reorder,revision,created_at,updated_at FROM plants').get()).toMatchObject({
      id: 13, name: 'Parsley', plant_type: 'herb', sow_periods: 0x123456, plant_periods: 0xabcdef,
      notes: "quoted ' text\nwith unicode 🌱", needs_reorder: 1, revision: 27, created_at: '2020-01-02', updated_at: '2026-10-12',
    });
    expect(db.prepare('SELECT fingerprint,kind,imported_at,row_count FROM imports').get()).toEqual({ fingerprint: 'sha256:abc', kind: 'legacy', imported_at: '2023-06-07', row_count: 14 });
    expect(db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities') ORDER BY name").all()).toEqual([
      { name: 'activities', seq: 8 }, { name: 'plants', seq: 51 },
    ]);
    expect(db.prepare('SELECT generation,restore_epoch,restore_verified_at FROM app_state WHERE id=1').get()).toEqual({ generation: 9, restore_epoch: 4, restore_verified_at: 1_800_000_000 });
    expect(db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toEqual({ n: 0 });
    db.close();
  });

  it('splits large notes into bounded statements while retaining exact values', () => {
    const data = fixture();
    data.plants[0].notes = `${'a\'🌱'.repeat(30_000)}\0after`;
    const sql = buildRestoreSql(data, guard, migrations);
    const statements = sql.split(';\n').filter(Boolean);
    expect(Math.max(...statements.map((statement) => Buffer.byteLength(statement) + 1))).toBeLessThanOrEqual(90_000);
    const db = database();
    db.exec(sql);
    expect((db.prepare('SELECT notes FROM plants WHERE id=13').get() as { notes: string }).notes).toBe(data.plants[0].notes);
    db.close();
  });

  it('rolls back on stale generation and ledger tampering', () => {
    for (const ledger of [migrations, [migrations[0], '0009_tampered.sql']]) {
      const db = database();
      const sql = buildRestoreSql(fixture(), guard, migrations);
      if (ledger !== migrations) db.prepare('UPDATE d1_migrations SET name=? WHERE id=2').run(ledger[1]);
      else db.exec('UPDATE app_state SET generation=generation+1 WHERE id=1');
      db.exec('BEGIN IMMEDIATE');
      expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/u);
      db.exec('ROLLBACK');
      expect(db.prepare('SELECT name FROM plants WHERE id=1').get()).toEqual({ name: 'Old plant' });
      expect(db.prepare('SELECT count(*) AS n FROM auth_sessions').get()).toEqual({ n: 1 });
      db.close();
    }
  });

  it('preserves NUL characters in text using UTF-8 hex expressions', () => {
    const data = fixture();
    data.plants[0].notes = 'before\0after';
    const sql = buildRestoreSql(data, guard, migrations);
    expect(sql).toContain("CAST(X'6265666f7265006166746572' AS TEXT)");
    const db = database();
    db.exec(sql);
    expect((db.prepare('SELECT notes FROM plants WHERE id=13').get() as { notes: string }).notes).toBe('before\0after');
    db.close();
  });

  it('rejects invalid data and unsafe migration identifiers before generating SQL', () => {
    const invalid = fixture();
    invalid.plants[0].id = 0;
    expect(() => buildRestoreSql(invalid, guard, migrations)).toThrow(/invalid or duplicate plants IDs/u);
    expect(() => buildRestoreSql(fixture(), guard, ["0001_initial.sql'); DROP TABLE plants;--"])).toThrow(/migration ledger guard/u);
  });

  it('validates input locally, stores a verified native recovery export, then imports only generated SQL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuinapp-cli-test-'));
    try {
      const config = join(dir, 'wrangler.jsonc');
      const backup = join(dir, 'download.sql');
      writeFileSync(config, JSON.stringify({
        name: 'tuinapp',
        d1_databases: [{ binding: 'DB', database_name: 'tuinapp', database_id: '610e681f-4f5f-45f2-983b-aa11002d294d' }],
        r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'tuinapp-backups' }],
      }));
      writeFileSync(backup, makeDump(fixture()));
      const commands: string[][] = [];
      let importSql = '';
      let importReached = false;
      const native = Buffer.from('verified native database export');
      const run = (args: string[], sensitive = false): string => {
        commands.push(args);
        if (args.includes('export')) { writeFileSync(args[args.indexOf('--output') + 1], native); return ''; }
        if (args[0] === 'r2' && args[1] === 'object' && args[2] === 'put') return '';
        if (args[0] === 'r2' && args[1] === 'object' && args[2] === 'get') { writeFileSync(args[args.indexOf('--file') + 1], native); return ''; }
        if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--file')) {
          importReached = true;
          importSql = readFileSync(args[args.indexOf('--file') + 1], 'utf8');
          expect(sensitive).toBe(true);
          return '';
        }
        const sql = args[args.indexOf('--command') + 1];
        if (sql.startsWith('SELECT schema_version')) return JSON.stringify([{ success: true, results: [{ schema_version: 3, generation: importReached ? 9 : 8, restore_epoch: importReached ? 4 : 3, plants: 1, activities: 1, imports: 1 }] }]);
        if (sql.startsWith('SELECT name FROM d1_migrations')) return JSON.stringify([{ success: true, results: migrations.map((name) => ({ name })) }]);
        if (sql.startsWith('PRAGMA foreign_key_check')) return JSON.stringify([{ success: true, results: [] }]);
        if (sql.startsWith('SELECT name,seq FROM sqlite_sequence')) return JSON.stringify([{ success: true, results: [...fixture().sqlite_sequence].sort((a, b) => a.name.localeCompare(b.name)) }]);
        throw new Error(`Unexpected fake Wrangler call: ${args.join(' ')}`);
      };
      const result = await restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], run, async (databaseName) => { expect(databaseName).toBe('tuinapp'); });
      expect(result.generation).toBe(9);
      expect(result.recoveryKey).toMatch(/^releases\/manual-restore-/u);
      expect(importReached).toBe(true);
      expect(importSql).not.toBe(readFileSync(backup, 'utf8'));
      expect(importSql).toContain('INSERT INTO plants (id,name,plant_type');
      expect(importSql).toContain('DELETE FROM auth_sessions');
      expect(importSql).toContain('restore_epoch=4');
      const importIndex = commands.findIndex((args) => args[0] === 'd1' && args[1] === 'execute' && args.includes('--file'));
      const putIndex = commands.findIndex((args) => args[0] === 'r2' && args[2] === 'put');
      const getIndex = commands.findIndex((args) => args[0] === 'r2' && args[2] === 'get');
      expect(putIndex).toBeLessThan(getIndex);
      expect(getIndex).toBeLessThan(importIndex);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses malformed input before calling Cloudflare commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuinapp-cli-test-'));
    try {
      const config = join(dir, 'wrangler.jsonc');
      const backup = join(dir, 'bad.sql');
      writeFileSync(config, JSON.stringify({ name: 'tuinapp', d1_databases: [{ binding: 'DB', database_name: 'tuinapp', database_id: '610e681f-4f5f-45f2-983b-aa11002d294d' }], r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'tuinapp-backups' }] }));
      writeFileSync(backup, 'DROP TABLE plants;');
      let calls = 0;
      await expect(restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], () => { calls++; return ''; }, async () => {})).rejects.toThrow(/Unrecognized backup/u);
      expect(calls).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stops before remote calls when the interactive confirmation is declined', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuinapp-cli-test-'));
    try {
      const config = join(dir, 'wrangler.jsonc');
      const backup = join(dir, 'backup.sql');
      writeFileSync(config, JSON.stringify({ name: 'tuinapp', d1_databases: [{ binding: 'DB', database_name: 'tuinapp', database_id: '610e681f-4f5f-45f2-983b-aa11002d294d' }], r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'tuinapp-backups' }] }));
      writeFileSync(backup, makeDump(fixture()));
      let calls = 0;
      await expect(restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], () => { calls++; return ''; }, async () => { throw new Error('declined'); })).rejects.toThrow('declined');
      expect(calls).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('refuses stale migration ledgers and R2 readback corruption before import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuinapp-cli-test-'));
    try {
      const config = join(dir, 'wrangler.jsonc');
      const backup = join(dir, 'backup.sql');
      writeFileSync(config, JSON.stringify({ name: 'tuinapp', d1_databases: [{ binding: 'DB', database_name: 'tuinapp', database_id: '610e681f-4f5f-45f2-983b-aa11002d294d' }], r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'tuinapp-backups' }] }));
      writeFileSync(backup, makeDump(fixture()));
      let exports = 0;
      const staleLedger = (args: string[]) => {
        if (args.includes('--command') && args[args.indexOf('--command') + 1].startsWith('SELECT schema_version')) return JSON.stringify([{ success: true, results: [{ schema_version: 3, generation: 8, restore_epoch: 3 }] }]);
        if (args.includes('--command') && args[args.indexOf('--command') + 1].startsWith('SELECT name FROM d1_migrations')) return JSON.stringify([{ success: true, results: [...migrations].reverse().map((name) => ({ name })) }]);
        if (args.includes('export')) exports++;
        return '';
      };
      await expect(restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], (args) => staleLedger(args), async () => {})).rejects.toThrow(/exact match/u);
      expect(exports).toBe(0);

      const native = Buffer.from('native export');
      const calls: string[][] = [];
      const corruptR2 = (args: string[]) => {
        calls.push(args);
        if (args.includes('export')) { writeFileSync(args[args.indexOf('--output') + 1], native); return ''; }
        if (args[0] === 'r2' && args[2] === 'get') { writeFileSync(args[args.indexOf('--file') + 1], 'corrupt'); return ''; }
        if (args.includes('--command')) {
          const command = args[args.indexOf('--command') + 1];
          if (command.startsWith('SELECT schema_version')) return JSON.stringify([{ success: true, results: [{ schema_version: 3, generation: 8, restore_epoch: 3 }] }]);
          if (command.startsWith('SELECT name FROM d1_migrations')) return JSON.stringify([{ success: true, results: migrations.map((name) => ({ name })) }]);
        }
        return '';
      };
      await expect(restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], (args) => corruptR2(args), async () => {})).rejects.toThrow(/read-back verification/u);
      expect(calls.some((args) => args[0] === 'd1' && args[1] === 'execute' && args.includes('--file'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('suppresses sensitive native import errors and reports the verified recovery key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuinapp-cli-test-'));
    try {
      const config = join(dir, 'wrangler.jsonc');
      const backup = join(dir, 'backup.sql');
      writeFileSync(config, JSON.stringify({ name: 'tuinapp', d1_databases: [{ binding: 'DB', database_name: 'tuinapp', database_id: '610e681f-4f5f-45f2-983b-aa11002d294d' }], r2_buckets: [{ binding: 'BACKUPS', bucket_name: 'tuinapp-backups' }] }));
      writeFileSync(backup, makeDump(fixture()));
      const native = Buffer.from('native export');
      const run = (args: string[], sensitive = false): string => {
        if (args.includes('export')) { writeFileSync(args[args.indexOf('--output') + 1], native); return ''; }
        if (args[0] === 'r2' && args[2] === 'get') { writeFileSync(args[args.indexOf('--file') + 1], native); return ''; }
        if (args[0] === 'd1' && args[1] === 'execute' && args.includes('--file')) {
          expect(sensitive).toBe(true);
          throw new Error('secret SQL diagnostics that must never reach the operator');
        }
        if (args.includes('--command')) {
          const command = args[args.indexOf('--command') + 1];
          if (command.startsWith('SELECT schema_version')) return JSON.stringify([{ success: true, results: [{ schema_version: 3, generation: 8, restore_epoch: 3 }] }]);
          if (command.startsWith('SELECT name FROM d1_migrations')) return JSON.stringify([{ success: true, results: migrations.map((name) => ({ name })) }]);
        }
        return '';
      };
      let failure = '';
      try { await restoreDownloadedBackup([backup, '--config', config, '--confirm-restore'], run, async () => {}); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); }
      expect(failure).toContain('completion could not be confirmed');
      expect(failure).toMatch(/releases\/manual-restore-/u);
      expect(failure).not.toContain('secret SQL diagnostics');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
