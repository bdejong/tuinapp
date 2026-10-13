import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION, makeDump, parseDump, type Dataset, type SqlValue } from '../cloudflare/dump.ts';

const goldenPath = '/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/db.golden.sqlite';
const expectedGoldenSha = 'ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6';
const schemaFiles = readdirSync(resolve('cloudflare/migrations')).filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/iu.test(name)).sort().map((name) => `cloudflare/migrations/${name}`);

function sha(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function columns(db: DatabaseSync, table: string): string[] { return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)); }
function tableRows(db: DatabaseSync, query: string): Record<string, unknown>[] { return db.prepare(query).all() as Record<string, unknown>[]; }
function scalar(db: DatabaseSync, query: string): unknown { return db.prepare(query).get()?.version; }
function comparable(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? [...value] : value]))));
}

function readGolden(path: string): { dataset: Dataset; sourceSha256: string } {
  const before = sha(readFileSync(path));
  if (before !== expectedGoldenSha) throw new Error(`Golden file checksum differs from its preservation record (${before})`);
  const source = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    const integrity = tableRows(source, 'PRAGMA integrity_check').map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok' || tableRows(source, 'PRAGMA foreign_key_check').length) throw new Error('Golden database failed SQLite integrity checks');
    if (Number(scalar(source, 'SELECT version FROM schema_version')) !== 3) throw new Error('Only the documented version 3 golden schema is accepted');
    const expected = {
      plants: ['id','name','plant_type','sun_requirements','sow_periods','plant_periods','notes','created_at','updated_at','needs_reorder'],
      activities: ['id','name','description','active_periods','created_at','updated_at'],
      plant_photos: ['id','plant_id','sort_order','image_data','created_at'],
    };
    for (const [table, names] of Object.entries(expected)) {
      if (JSON.stringify(columns(source, table)) !== JSON.stringify(names)) throw new Error(`Golden database has an unrecognized ${table} schema`);
    }
    const plants = tableRows(source, 'SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,1 AS revision FROM plants ORDER BY id') as Record<string, SqlValue>[];
    const activities = tableRows(source, 'SELECT id,name,description,active_periods,created_at,updated_at,1 AS revision FROM activities ORDER BY id') as Record<string, SqlValue>[];
    const photos = tableRows(source, 'SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id').map((row) => ({ ...row, image_data: row.image_data == null ? null : new Uint8Array(row.image_data as ArrayBuffer) })) as Record<string, SqlValue>[];
    const imports: Record<string, SqlValue>[] = [];
    const sequences = tableRows(source, "SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name") as {name:string;seq:number}[];
    if (plants.length !== 177 || activities.length !== 9 || photos.length !== 0) throw new Error(`Unexpected reference garden counts: ${plants.length} plants, ${activities.length} activities, ${photos.length} photos`);
    const dataset: Dataset = { plants, activities, plant_photos: photos, imports, sqlite_sequence: sequences, generation: 0 };
    const after = sha(readFileSync(path));
    if (after !== before || after !== expectedGoldenSha) throw new Error('Golden source checksum changed during read-only conversion');
    return { dataset, sourceSha256: before };
  } finally { source.close(); }
}

function convert(path: string, outputDir: string): void {
  const sourcePath = resolve(path);
  const output = resolve(outputDir);
  const { dataset, sourceSha256 } = readGolden(sourcePath);
  if (existsSync(output)) throw new Error('Converted golden destination already exists; refusing to overwrite it');
  mkdirSync(resolve(output, '..'), { recursive: true });
  mkdirSync(output);
  const dump = makeDump(dataset);
  const parsed = parseDump(dump);
  if (JSON.stringify(parsed.dataset, (_key, value) => value instanceof Uint8Array ? [...value] : value) !== JSON.stringify(dataset, (_key, value) => value instanceof Uint8Array ? [...value] : value)) throw new Error('Generated SQL backup failed its own round-trip validation');
  const sqlPath = `${output}/tuinapp-golden.sql`;
  const dbPath = `${output}/tuinapp-golden.sqlite`;
  const manifestPath = `${output}/manifest.json`;
  try {
    writeFileSync(sqlPath, dump, { flag: 'wx', mode: 0o600 });
    const target = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
    try {
      for (const file of schemaFiles) target.exec(readFileSync(resolve(file), 'utf8'));
    target.exec(dump);
      const integrity = tableRows(target, 'PRAGMA integrity_check').map((row) => Object.values(row)[0]);
      if (integrity.length !== 1 || integrity[0] !== 'ok' || tableRows(target, 'PRAGMA foreign_key_check').length) throw new Error('Converted D1 reference database failed integrity checks');
      const actual = {
        plants: tableRows(target, 'SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision FROM plants ORDER BY id'),
        activities: tableRows(target, 'SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities ORDER BY id'),
        plant_photos: tableRows(target, 'SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id'),
        imports: tableRows(target, 'SELECT fingerprint,kind,imported_at,row_count FROM imports ORDER BY fingerprint'),
        sqlite_sequence: tableRows(target, "SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name"),
      };
      for (const table of Object.keys(actual) as (keyof typeof actual)[]) {
        const expectedRows = [...dataset[table]] as Record<string, unknown>[];
        if (comparable(actual[table]) !== comparable(expectedRows)) throw new Error(`Converted database changed source values in ${table}`);
      }
    } finally { target.close(); }
    const manifest = {
      format: 'tuinapp-backup-v1', schema_version: CURRENT_SCHEMA_VERSION, source: sourcePath, source_sha256: sourceSha256,
      converted_sql_sha256: sha(dump), converted_sqlite_sha256: sha(readFileSync(dbPath)),
      plants: dataset.plants.length, activities: dataset.activities.length, photos: dataset.plant_photos.length,
      imported_at: new Date().toISOString(),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const finalSha = sha(readFileSync(sourcePath));
    if (finalSha !== expectedGoldenSha) throw new Error('Golden checksum changed after conversion; stop and inspect immediately');
    process.stdout.write(`${JSON.stringify({ ...manifest, output: outputDir }, null, 2)}\n`);
  } catch (error) {
    rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function verifyGolden(outputDir: string): void {
  const output = resolve(outputDir);
  const manifest = JSON.parse(readFileSync(`${output}/manifest.json`, 'utf8')) as { source: string; source_sha256: string; converted_sql_sha256: string; converted_sqlite_sha256: string; plants: number; activities: number; photos: number };
  const { dataset, sourceSha256 } = readGolden(manifest.source);
  const dump = readFileSync(`${output}/tuinapp-golden.sql`, 'utf8');
  const databaseBytes = readFileSync(`${output}/tuinapp-golden.sqlite`);
  if (sourceSha256 !== manifest.source_sha256 || sha(dump) !== manifest.converted_sql_sha256 || sha(databaseBytes) !== manifest.converted_sqlite_sha256) throw new Error('Converted golden hashes do not match the preservation manifest');
  const parsed = parseDump(dump);
  if (JSON.stringify(parsed.dataset, (_key, value) => value instanceof Uint8Array ? [...value] : value) !== JSON.stringify(dataset, (_key, value) => value instanceof Uint8Array ? [...value] : value)) throw new Error('Converted SQL dump differs from the readonly golden database');
  const target = new DatabaseSync(`${output}/tuinapp-golden.sqlite`, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    const integrity = tableRows(target, 'PRAGMA integrity_check').map((row) => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok' || tableRows(target, 'PRAGMA foreign_key_check').length) throw new Error('Converted SQLite reference failed integrity checks');
    const actual = {
      plants: tableRows(target, 'SELECT id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision FROM plants ORDER BY id'),
      activities: tableRows(target, 'SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities ORDER BY id'),
      plant_photos: tableRows(target, 'SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id'),
      imports: tableRows(target, 'SELECT fingerprint,kind,imported_at,row_count FROM imports ORDER BY fingerprint'),
      sqlite_sequence: tableRows(target, "SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name"),
    };
    for (const table of Object.keys(actual) as (keyof typeof actual)[]) {
      if (comparable(actual[table]) !== comparable([...dataset[table]] as Record<string, unknown>[])) throw new Error(`Converted SQLite reference differs from golden values in ${table}`);
    }
    if (dataset.plants.length !== manifest.plants || dataset.activities.length !== manifest.activities || dataset.plant_photos.length !== manifest.photos) throw new Error('Converted golden counts differ from the manifest');
  } finally { target.close(); }
  process.stdout.write(`${JSON.stringify({ verified: true, source_sha256: sourceSha256, plants: dataset.plants.length, activities: dataset.activities.length, photos: dataset.plant_photos.length, output }, null, 2)}\n`);
}

const [command, sourceArg, outputArg] = process.argv.slice(2);
if (command === 'convert-golden') convert(sourceArg ?? goldenPath, outputArg ?? 'data/cloudflare-golden');
else if (command === 'verify-golden') verifyGolden(sourceArg ?? 'data/cloudflare-golden');
else if (command === 'verify-migrations') {
  const manifest = JSON.parse(readFileSync(resolve('cloudflare/migration-checksums.json'), 'utf8')) as Record<string, string>;
  for (const file of schemaFiles) {
    const name = file.split('/').at(-1)!;
    const actual = sha(readFileSync(resolve(file)));
    if (manifest[name] !== actual) throw new Error(`Released Cloudflare migration checksum changed: ${name}`);
  }
  if (Object.keys(manifest).length !== schemaFiles.length) throw new Error('Cloudflare migration checksum manifest has unknown entries');
  process.stdout.write('Cloudflare migration checksums verified.\n');
} else {
  process.stderr.write('Usage: node scripts/cloudflare-data.ts <convert-golden [source.sqlite] [output-dir] | verify-golden [output-dir] | verify-migrations>\n');
  process.exitCode = 2;
}
