import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Dataset, SqlValue } from './dump';

function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function columns(db: DatabaseSync, table: string): Set<string> {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
}
function rows(db: DatabaseSync, query: string): Record<string, unknown>[] { return db.prepare(query).all() as Record<string, unknown>[]; }
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }

/** Read a Rust-era SQLite database in readonly mode and normalize known layouts for D1. */
export function convertLegacySqlite(path: string): { dataset: Dataset; sourceSha256: string } {
  const before = digest(new Uint8Array(readFileSync(path)));
  for (const suffix of ['-wal', '-journal']) {
    try { assert(readFileSync(`${path}${suffix}`).byteLength === 0, 'Source has a live journal; use a closed standalone snapshot'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    assert(rows(db, 'PRAGMA integrity_check').length === 1 && Object.values(rows(db, 'PRAGMA integrity_check')[0])[0] === 'ok', 'Source failed SQLite integrity checks');
    assert(rows(db, 'PRAGMA foreign_key_check').length === 0, 'Source contains orphaned records');
    const tableNames = rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((row) => String(row.name));
    assert(tableNames.every((name) => ['plants','activities','plant_photos','schema_version'].includes(name)), 'Unexpected tables or partial migration');
    const plantColumns = columns(db, 'plants');
    const activityColumns = columns(db, 'activities');
    const photoColumns = columns(db, 'plant_photos');
    const requiredPlant = ['id','name','sow_periods','plant_periods','notes','created_at','updated_at'];
    const requiredActivity = ['id','name','description','active_periods','created_at','updated_at'];
    const requiredPhoto = ['id','plant_id','sort_order','image_data','created_at'];
    assert(requiredPlant.every((name) => plantColumns.has(name)), 'Unrecognized plant schema');
    assert(requiredActivity.every((name) => activityColumns.has(name)) && activityColumns.size === 6, 'Unrecognized activity schema');
    assert(requiredPhoto.every((name) => photoColumns.has(name)) && photoColumns.size === 5, 'Unrecognized photo schema');
    const allowedPlant = new Set([...requiredPlant,'plant_type','sun_requirement','sun_requirements','needs_reorder']);
    assert([...plantColumns].every((name) => allowedPlant.has(name)), 'Unknown plant columns would be lost');
    const hasVersion = tableNames.includes('schema_version');
    let version: number | null = null;
    if (hasVersion) {
      const versions = rows(db, 'SELECT version FROM schema_version');
      assert(versions.length === 1 && Number.isSafeInteger(versions[0].version), 'Ambiguous legacy version history');
      version = Number(versions[0].version);
    }
    const textSun = plantColumns.has('sun_requirement');
    const bitSun = plantColumns.has('sun_requirements');
    const typed = plantColumns.has('plant_type');
    const reorder = plantColumns.has('needs_reorder');
    assert((version === null && textSun && !bitSun && !reorder) || (version === 1 && typed && textSun && !bitSun && !reorder) || (version === 2 && typed && !textSun && bitSun && !reorder) || (version === 3 && typed && !textSun && bitSun && reorder), 'Unknown or contradictory legacy schema/version');
    if (textSun) assert(rows(db, "SELECT 1 FROM plants WHERE sun_requirement IS NOT NULL AND sun_requirement NOT IN ('full_sun','partial_shade','full_shade') LIMIT 1").length === 0, 'Unknown sun requirement');
    if (bitSun) assert(rows(db, 'SELECT 1 FROM plants WHERE sun_requirements IS NULL OR sun_requirements NOT BETWEEN 0 AND 7 LIMIT 1').length === 0, 'Invalid sun requirement bits');
    if (reorder) assert(rows(db, 'SELECT 1 FROM plants WHERE needs_reorder IS NULL OR needs_reorder NOT IN (0,1) LIMIT 1').length === 0, 'Invalid reorder flag');
    const category = typed ? 'plant_type' : 'NULL AS plant_type';
    const sun = textSun ? "CASE sun_requirement WHEN 'full_sun' THEN 1 WHEN 'partial_shade' THEN 2 WHEN 'full_shade' THEN 4 ELSE 0 END AS sun_requirements" : 'sun_requirements';
    const reorderExpr = reorder ? 'needs_reorder' : '0 AS needs_reorder';
    const plants = rows(db, `SELECT id,name,${category},${sun},sow_periods,plant_periods,notes,${reorderExpr},created_at,updated_at,1 AS revision FROM plants ORDER BY id`) as Record<string, SqlValue>[];
    const activities = rows(db, 'SELECT id,name,description,active_periods,created_at,updated_at,1 AS revision FROM activities ORDER BY id') as Record<string, SqlValue>[];
    const plant_photos = rows(db, 'SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id').map((row) => ({ ...row, image_data: row.image_data == null ? null : new Uint8Array(row.image_data as ArrayBuffer) })) as Record<string, SqlValue>[];
    const sqlite_sequence = rows(db, "SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name") as {name:string;seq:number}[];
    const dataset: Dataset = { plants, activities, plant_photos, imports: [], sqlite_sequence, generation: 0 };
    assert(digest(new Uint8Array(readFileSync(path))) === before, 'Source checksum changed during readonly conversion');
    return { dataset, sourceSha256: before };
  } finally { db.close(); }
}
