import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { convertLegacySqlite } from '../../cloudflare/legacy-conversion';

function createLegacy(path: string, version: number | null, typed: boolean): void {
  const db = new DatabaseSync(path);
  const category = typed ? 'plant_type TEXT,' : '';
  const sun = version !== null && version >= 2 ? 'sun_requirements INTEGER DEFAULT 0,' : 'sun_requirement TEXT,';
  const reorder = version === 3 ? ',needs_reorder INTEGER DEFAULT 0' : '';
  db.exec(`CREATE TABLE plants(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,${category}${sun}sow_periods INTEGER DEFAULT 0,plant_periods INTEGER DEFAULT 0,notes TEXT,created_at TEXT,updated_at TEXT${reorder});
    CREATE TABLE activities(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,active_periods INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE plant_photos(id INTEGER PRIMARY KEY AUTOINCREMENT,plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,sort_order INTEGER,image_data BLOB,created_at TEXT);
    ${version === null ? '' : 'CREATE TABLE schema_version(version INTEGER);'}
    ${version === null ? '' : `INSERT INTO schema_version VALUES(${version});`}`);
  db.prepare('INSERT INTO plants(id,name,sow_periods,plant_periods,notes,created_at,updated_at) VALUES(7,?,?,?,?,?,?)').run('Épinard été', 8388611, 12, 'A note\nwith two lines', '2020-01-01 10:00:00', '2021-01-01 11:00:00');
  db.prepare("INSERT INTO plants(id,name,sow_periods,plant_periods) VALUES(8,'Épinard été',0,0)").run();
  if (version !== null && version >= 2) db.prepare('UPDATE plants SET sun_requirements=7 WHERE id=7').run();
  else db.prepare("UPDATE plants SET sun_requirement='partial_shade' WHERE id=7").run();
  if (version === 3) db.prepare('UPDATE plants SET needs_reorder=1 WHERE id=7').run();
  db.prepare("INSERT INTO activities VALUES(4,'Prune','Gently',8388609,'2020-02-01','2021-03-01')").run();
  db.prepare("INSERT INTO plant_photos VALUES(3,7,2,?,'2021-04-01')").run(new Uint8Array([0,255,22,99,2]));
  db.prepare("UPDATE sqlite_sequence SET seq=99 WHERE name='plants'").run();
  db.close();
}

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('readonly historical SQLite conversion', () => {
  it.each([
    { version: null, typed: false, sun: 2, reorder: 0 },
    { version: null, typed: true, sun: 2, reorder: 0 },
    { version: 1, typed: true, sun: 2, reorder: 0 },
    { version: 2, typed: true, sun: 7, reorder: 0 },
    { version: 3, typed: true, sun: 7, reorder: 1 },
  ])('preserves version $version legacy rows, binary photos, and sequence state', ({ version, typed, sun, reorder }) => {
    const directory = mkdtempSync(join(tmpdir(), 'tuinapp-legacy-'));
    const source = join(directory, 'legacy.sqlite');
    try {
      createLegacy(source, version, typed);
      const before = sha(source);
      const { dataset, sourceSha256 } = convertLegacySqlite(source);
      expect(sourceSha256).toBe(before);
      expect(dataset.plants).toHaveLength(2);
      expect(dataset.plants[0]).toMatchObject({ id: 7, name: 'Épinard été', plant_type: null, sun_requirements: sun, sow_periods: 8388611, plant_periods: 12, notes: 'A note\nwith two lines', needs_reorder: reorder, revision: 1, created_at: '2020-01-01 10:00:00', updated_at: '2021-01-01 11:00:00' });
      expect(dataset.plants[1].name).toBe(dataset.plants[0].name);
      expect(dataset.activities[0]).toMatchObject({ id: 4, name: 'Prune', active_periods: 8388609, revision: 1 });
      expect(dataset.plant_photos[0]).toMatchObject({ id: 3, plant_id: 7, sort_order: 2, created_at: '2021-04-01' });
      expect([...(dataset.plant_photos[0].image_data as Uint8Array)]).toEqual([0,255,22,99,2]);
      expect(dataset.sqlite_sequence.find((row) => row.name === 'plants')?.seq).toBe(99);
      expect(sha(source)).toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([
    ['future version', (db: DatabaseSync) => db.prepare('UPDATE schema_version SET version=99').run()],
    ['ambiguous version history', (db: DatabaseSync) => db.prepare('INSERT INTO schema_version VALUES(3)').run()],
    ['unexpected table', (db: DatabaseSync) => db.exec('CREATE TABLE surprise(id INTEGER)')],
    ['unknown plant column', (db: DatabaseSync) => db.exec('ALTER TABLE plants ADD COLUMN surprise TEXT')],
    ['missing typed category column in a versioned source', (db: DatabaseSync) => db.exec('ALTER TABLE plants DROP COLUMN plant_type')],
    ['partial version 3 migration', (db: DatabaseSync) => db.exec('ALTER TABLE plants DROP COLUMN needs_reorder')],
    ['contradictory migration version', (db: DatabaseSync) => db.prepare('UPDATE schema_version SET version=2').run()],
    ['invalid sun flags', (db: DatabaseSync) => db.prepare('UPDATE plants SET sun_requirements=8 WHERE id=7').run()],
    ['invalid reorder flag', (db: DatabaseSync) => db.prepare('UPDATE plants SET needs_reorder=3 WHERE id=7').run()],
  ])('refuses %s without changing the source', (_label, invalid) => {
    const directory = mkdtempSync(join(tmpdir(), 'tuinapp-invalid-'));
    const source = join(directory, 'legacy.sqlite');
    try {
      createLegacy(source, 3, true);
      const db = new DatabaseSync(source);
      invalid(db);
      db.close();
      const before = sha(source);
      expect(() => convertLegacySqlite(source)).toThrow();
      expect(sha(source)).toBe(before);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
