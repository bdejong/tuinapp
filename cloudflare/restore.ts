import { CURRENT_SCHEMA_VERSION, TABLES, quoteSqlValue, validateDataset, type Dataset, type SqlValue, type TableName } from './dump';

export interface RestoreGuard { schemaVersion: number; generation: number; restoreEpoch: number }
const maxStatementBytes = 90_000; // Cloudflare D1's documented 100 KB SQL statement ceiling, with headroom.
const encoder = new TextEncoder();

function sqlBytes(sql: string): number { return encoder.encode(sql).byteLength; }

function quoteImportValue(value: SqlValue): string {
  if (typeof value === 'string' && value.includes('\0')) {
    const hex = [...encoder.encode(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `CAST(X'${hex}' AS TEXT)`;
  }
  return quoteSqlValue(value);
}

function chunksOfText(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let part = '';
  let bytes = 0;
  for (const char of value) {
    const size = encoder.encode(char).byteLength + (char === "'" ? 1 : 0);
    if (part && bytes + size > maxBytes) { chunks.push(part); part = ''; bytes = 0; }
    part += char;
    bytes += size;
  }
  if (part) chunks.push(part);
  return chunks;
}

function updateLongValue(table: TableName, column: string, value: string, row: Record<string, SqlValue>): string[] {
  const where = table === 'imports' ? `fingerprint=${quoteImportValue(row.fingerprint)}` : `id=${quoteImportValue(row.id)}`;
  const pieces = chunksOfText(value, 30_000);
  return pieces.map((part, index) => {
    const initial = index === 0 ? quoteImportValue(part) : `${column} || ${quoteImportValue(part)}`;
    return `UPDATE ${table} SET ${column}=${initial} WHERE ${where};`;
  });
}

function insertRows(table: TableName, rows: Record<string, SqlValue>[]): string[] {
  const columns = TABLES[table] as readonly string[];
  const statements: string[] = [];
  for (const row of rows) {
    const insertRow = { ...row };
    const values = columns.map((column) => row[column]);
    let sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map(quoteImportValue).join(',')});`;
    const oversized: { column: string; value: string }[] = [];
    if (sqlBytes(sql) > maxStatementBytes) {
      const candidates = table === 'plants' ? ['notes'] : table === 'activities' ? ['description'] : [];
      for (const column of candidates) {
        const value = row[column];
        if (typeof value === 'string') {
          if (sqlBytes(quoteImportValue(value)) < 10_000) continue;
          oversized.push({ column, value });
          insertRow[column] = null;
          sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((name) => quoteImportValue(insertRow[name])).join(',')});`;
          if (sqlBytes(sql) <= maxStatementBytes) break;
        }
      }
    }
    if (sqlBytes(sql) > maxStatementBytes) throw new Error(`A ${table} row exceeds Cloudflare D1's SQL statement limit`);
    statements.push(sql);
    for (const item of oversized) statements.push(...updateLongValue(table, item.column, item.value, row));
  }
  return statements;
}

function ledgerGuard(migrations: string[]): string {
  if (new Set(migrations).size !== migrations.length || migrations.some((name) => !/^\d{4}_[a-z0-9_-]+\.sql$/iu.test(name))) throw new Error('Invalid migration ledger guard');
  const names = migrations.map((name) => quoteSqlValue(name));
  if (!names.length) throw new Error('The released migration ledger is empty');
  const expected = quoteSqlValue(migrations.join('\n'));
  return `COALESCE((SELECT group_concat(name,char(10)) FROM (SELECT name FROM d1_migrations ORDER BY id)),'')=${expected}`;
}

/** Build a canonical, generated D1 import. The supplied SQL file is never executed. */
export function buildRestoreSql(dataset: Dataset, guard: RestoreGuard, migrations: string[], now = Math.floor(Date.now() / 1000)): string {
  validateDataset(dataset);
  if (guard.schemaVersion !== CURRENT_SCHEMA_VERSION || !Number.isSafeInteger(guard.generation) || guard.generation < 0 || !Number.isSafeInteger(guard.restoreEpoch) || guard.restoreEpoch < 0) throw new Error('Invalid restore guard state');
  const ledger = ledgerGuard(migrations);
  const sequenceRows = dataset.sqlite_sequence.map((row) => ({ name: quoteImportValue(row.name), seq: quoteImportValue(row.seq) }));
  const expectedSequenceSelect = sequenceRows.length ? sequenceRows.map((row) => `SELECT ${row.name} AS name,${row.seq} AS seq`).join(' UNION ALL ') : "SELECT 'plants' AS name,0 AS seq WHERE 0";
  const sequenceGuard = `(SELECT count(*) FROM sqlite_sequence WHERE name IN ('plants','activities'))=${sequenceRows.length} AND NOT EXISTS (SELECT 1 FROM (${expectedSequenceSelect}) expected LEFT JOIN sqlite_sequence actual ON actual.name=expected.name AND actual.seq=expected.seq WHERE actual.name IS NULL)`;
  const datasetGuard = `(SELECT count(*) FROM plants)=${dataset.plants.length} AND (SELECT count(*) FROM activities)=${dataset.activities.length} AND (SELECT count(*) FROM imports)=${dataset.imports.length} AND ${sequenceGuard}`;
  const statements = [
    'DELETE FROM transaction_assertions;',
    `INSERT INTO transaction_assertions(ok) SELECT CASE WHEN (SELECT count(*) FROM app_state)=1 AND (SELECT schema_version FROM app_state WHERE id=1)=${guard.schemaVersion} AND (SELECT generation FROM app_state WHERE id=1)=${guard.generation} AND (SELECT restore_epoch FROM app_state WHERE id=1)=${guard.restoreEpoch} AND ${ledger} THEN 1 ELSE 0 END;`,
    'DELETE FROM auth_sessions;',
    'DELETE FROM plants;', 'DELETE FROM activities;', 'DELETE FROM imports;',
    ...insertRows('plants', dataset.plants),
    ...insertRows('activities', dataset.activities),
    ...insertRows('imports', dataset.imports),
    "DELETE FROM sqlite_sequence WHERE name IN ('plants','activities');",
    ...dataset.sqlite_sequence.map((row) => `INSERT INTO sqlite_sequence(name,seq) VALUES(${quoteSqlValue(row.name)},${quoteSqlValue(row.seq)});`),
    `INSERT INTO transaction_assertions(ok) SELECT CASE WHEN ${datasetGuard} THEN 1 ELSE 0 END;`,
    `UPDATE app_state SET generation=${guard.generation + 1},restore_epoch=${guard.restoreEpoch + 1},backup_checked_unchanged=0,restore_verified_at=${now},backup_last_error=NULL,backup_failed_at=NULL WHERE id=1;`,
    'DELETE FROM transaction_assertions;',
  ];
  for (const statement of statements) if (sqlBytes(statement) > maxStatementBytes) throw new Error('Generated restore statement exceeds Cloudflare D1 SQL statement limit');
  return `${statements.join('\n')}\n`;
}
