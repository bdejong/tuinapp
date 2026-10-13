export const BACKUP_FORMAT = 'tuinapp-backup-v1';
export const CURRENT_SCHEMA_VERSION = 2;

export const TABLES = {
  plants: ['id','name','plant_type','sun_requirements','sow_periods','plant_periods','notes','created_at','updated_at','needs_reorder','revision'],
  activities: ['id','name','description','active_periods','created_at','updated_at','revision'],
  plant_photos: ['id','plant_id','sort_order','image_data','created_at'],
  imports: ['fingerprint','kind','imported_at','row_count'],
} as const;

export type TableName = keyof typeof TABLES;
export type SqlValue = null | string | number | Uint8Array;
export type Dataset = { [K in TableName]: Record<string, SqlValue>[] } & {
  sqlite_sequence: { name: string; seq: number }[];
  generation: number;
};

function bytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  // Some D1 bindings marshal BLOBs through the Worker RPC boundary as arrays.
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value);
  throw new Error('Database returned an invalid photo blob');
}

export async function readDataset(db: D1Database): Promise<Dataset> {
  const tables = Object.keys(TABLES) as TableName[];
  const statements = [
    ...tables.map((table) => db.prepare(`SELECT ${TABLES[table].map((c) => `"${c}"`).join(',')} FROM "${table}" ORDER BY 1`)),
    db.prepare("SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos') ORDER BY name"),
    db.prepare('SELECT generation FROM app_state WHERE id=1'),
  ];
  const results = await db.batch(statements) as unknown as { results: Record<string, unknown>[] }[];
  const dataset: Record<string, unknown> = { sqlite_sequence: results[tables.length].results, generation: Number(results[tables.length + 1].results[0]?.generation ?? 0) };
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    dataset[table] = results[i].results.map((row) => {
      const copy = { ...row } as Record<string, unknown>;
      if (table === 'plant_photos') copy.image_data = bytes(copy.image_data);
      return copy;
    });
  }
  return dataset as Dataset;
}

function quote(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Backup contains an unsupported numeric value');
    return String(value);
  }
  if (typeof value !== 'string') return `X'${[...value].map((x) => x.toString(16).padStart(2, '0')).join('')}'`;
  return `'${value.replaceAll("'", "''")}'`;
}

export function makeDump(dataset: Dataset): string {
  const out: string[] = [];
  for (const table of Object.keys(TABLES) as TableName[]) {
    const columns: readonly string[] = TABLES[table];
    for (const row of dataset[table]) {
      out.push(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((column) => quote(row[column])).join(',')});`);
    }
  }
  for (const name of ['plants', 'activities', 'plant_photos']) out.push(`DELETE FROM sqlite_sequence WHERE name=${quote(name)};`);
  for (const row of dataset.sqlite_sequence) {
    out.push(`INSERT INTO sqlite_sequence (name,seq) VALUES (${quote(row.name)},${quote(row.seq)});`);
  }
  const body = `${out.join('\n')}\n`;
  const checksum = checksum32(`-- schema_version=${CURRENT_SCHEMA_VERSION}\n-- generation=${dataset.generation}\n${body}`);
  return `-- ${BACKUP_FORMAT}\n-- schema_version=${CURRENT_SCHEMA_VERSION}\n-- generation=${dataset.generation}\n-- checksum=${checksum}\n${body}-- END ${BACKUP_FORMAT} statements=${out.length} checksum=${checksum}\n`;
}

function checksum32(text: string): string {
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value.toString(16).padStart(8, '0');
}

export interface ParsedDump { schemaVersion: number; generation: number; dataset: Dataset }

function splitValues(text: string): string[] {
  const values: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      if (quoted && text[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      values.push(text.slice(start, i).trim()); start = i + 1;
    }
  }
  if (quoted) throw new Error('Backup SQL has an unterminated text value');
  values.push(text.slice(start).trim());
  return values;
}

function decodeLiteral(literal: string): SqlValue {
  if (literal === 'NULL') return null;
  if (/^-?(0|[1-9]\d*)$/.test(literal)) {
    const n = Number(literal);
    if (!Number.isSafeInteger(n)) throw new Error('Backup SQL integer is out of range');
    return n;
  }
  const text = /^'((?:[^']|'')*)'$/.exec(literal);
  if (text) return text[1].replaceAll("''", "'");
  const blob = /^X'([0-9a-fA-F]*)'$/.exec(literal);
  if (blob) {
    if (blob[1].length % 2) throw new Error('Backup SQL blob has odd-length hex');
    return Uint8Array.from(blob[1].match(/../g)?.map((x) => Number.parseInt(x, 16)) ?? []);
  }
  throw new Error('Backup SQL contains a value outside the supported literal format');
}

function parseInsert(statement: string): { table: string; columns: string[]; values: SqlValue[] } {
  const match = /^INSERT INTO (plants|activities|plant_photos|imports|sqlite_sequence) \(([^()]*)\) VALUES \(([\s\S]*)\);$/.exec(statement);
  if (!match) throw new Error('Backup contains unsupported SQL; only generated INSERT statements are accepted');
  const columns = match[2].split(',').map((x) => x.trim());
  return { table: match[1], columns, values: splitValues(match[3]).map(decodeLiteral) };
}

function splitDumpStatements(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") {
      if (quoted && text[i + 1] === "'") i++;
      else quoted = !quoted;
    } else if (text[i] === ';' && !quoted) {
      const statement = text.slice(start, i + 1).trim();
      if (statement) out.push(statement);
      start = i + 1;
    }
  }
  if (quoted) throw new Error('Backup SQL has an unterminated text value');
  if (text.slice(start).trim()) throw new Error('Backup SQL contains an incomplete statement');
  return out;
}

function validRows(dataset: Dataset): void {
  if (!Number.isSafeInteger(dataset.generation) || dataset.generation < 0) throw new Error('Backup has an invalid generation value');
  const nullableText = (value: SqlValue): boolean => value === null || typeof value === 'string';
  const requiredText = (value: SqlValue): value is string => typeof value === 'string';
  const idSets = new Map<string, Set<number>>();
  for (const table of ['plants','activities','plant_photos'] as const) {
    const ids = new Set<number>();
    for (const row of dataset[table]) {
      const id = row.id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new Error(`Backup has invalid or duplicate ${table} IDs`);
      ids.add(id);
    }
    idSets.set(table, ids);
  }
  for (const row of dataset.plants) {
    if (typeof row.name !== 'string' || !row.name.trim() || [...row.name].length > 500) throw new Error('Backup has an invalid plant name');
    if (!nullableText(row.plant_type) || !nullableText(row.notes) || !nullableText(row.created_at) || !nullableText(row.updated_at)) throw new Error('Backup has an invalid plant text field');
    if (row.plant_type !== null && !['vegetable_fruit','flower','herb'].includes(String(row.plant_type))) throw new Error('Backup has an invalid plant type');
    for (const key of ['sun_requirements','sow_periods','plant_periods','needs_reorder','revision']) if (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key] as number)) throw new Error(`Backup has invalid plant ${key}`);
    if ((row.sun_requirements as number) < 0 || (row.sun_requirements as number) > 7 || (row.sow_periods as number) < 0 || (row.sow_periods as number) > 16777215 || (row.plant_periods as number) < 0 || (row.plant_periods as number) > 16777215 || ![0,1].includes(row.needs_reorder as number) || (row.revision as number) < 1) throw new Error('Backup has out-of-range plant fields');
  }
  for (const row of dataset.activities) {
    if (typeof row.name !== 'string' || !row.name.trim() || [...row.name].length > 500) throw new Error('Backup has an invalid activity name');
    if (!nullableText(row.description) || !nullableText(row.created_at) || !nullableText(row.updated_at)) throw new Error('Backup has an invalid activity text field');
    if (typeof row.active_periods !== 'number' || !Number.isSafeInteger(row.active_periods) || row.active_periods < 0 || row.active_periods > 16777215 || typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Backup has invalid activity fields');
  }
  for (const row of dataset.plant_photos) {
    if (typeof row.plant_id !== 'number' || !idSets.get('plants')!.has(row.plant_id)) throw new Error('Backup photo references a missing plant');
    if (typeof row.sort_order !== 'number' || !Number.isSafeInteger(row.sort_order) || !nullableText(row.created_at) || (row.image_data !== null && !(row.image_data instanceof Uint8Array))) throw new Error('Backup has an invalid photo');
  }
  const fingerprints = new Set<string>();
  for (const row of dataset.imports) {
    if (!requiredText(row.fingerprint) || fingerprints.has(row.fingerprint) || !requiredText(row.kind) || !requiredText(row.imported_at) || typeof row.row_count !== 'number' || !Number.isSafeInteger(row.row_count) || row.row_count < 0) throw new Error('Backup has invalid import history');
    fingerprints.add(row.fingerprint);
  }
  for (const row of dataset.sqlite_sequence) {
    if (!['plants','activities','plant_photos'].includes(row.name) || !Number.isSafeInteger(row.seq) || row.seq < 0) throw new Error('Backup has invalid SQLite sequence state');
    const ids = idSets.get(row.name)!;
    if (row.seq < Math.max(0, ...ids)) throw new Error('Backup sequence is below an existing row ID');
  }
  if (new Set(dataset.sqlite_sequence.map((row) => row.name)).size !== dataset.sqlite_sequence.length) throw new Error('Backup has duplicate SQLite sequence entries');
}

export function parseDump(text: string): ParsedDump {
  if (new TextEncoder().encode(text).byteLength > 50 * 1024 * 1024) throw new Error('Backup file exceeds the 50 MiB limit');
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== `-- ${BACKUP_FORMAT}`) throw new Error('Unrecognized backup file format');
  const schemaVersion = /^-- schema_version=(\d+)$/.exec(lines[1] ?? '');
  const generation = /^-- generation=(\d+)$/.exec(lines[2] ?? '');
  const headerChecksum = /^-- checksum=([0-9a-f]{8})$/.exec(lines[3] ?? '');
  const footer = /^-- END tuinapp-backup-v1 statements=(\d+) checksum=([0-9a-f]{8})$/.exec(lines.at(-2) ?? '');
  if (!schemaVersion || !generation || !headerChecksum || !footer || lines.at(-1) !== '') throw new Error('Backup file is incomplete or has invalid integrity framing');
  const version = Number(schemaVersion[1]);
  if (version > CURRENT_SCHEMA_VERSION) throw new Error('Backup schema is newer than this application');
  if (version !== CURRENT_SCHEMA_VERSION) throw new Error('Backup schema version is not supported');
  const generationNumber = Number(generation[1]);
  if (!Number.isSafeInteger(generationNumber)) throw new Error('Backup generation is out of range');
  const dataset: Dataset = { plants: [], activities: [], plant_photos: [], imports: [], sqlite_sequence: [], generation: generationNumber };
  const expected = TABLES as unknown as Record<string, readonly string[]>;
  const headerEnd = source.indexOf('\n', source.indexOf('\n', source.indexOf('\n', source.indexOf('\n') + 1) + 1) + 1) + 1;
  const body = source.slice(headerEnd, source.lastIndexOf('-- END '));
  const statements = splitDumpStatements(body);
  const actualChecksum = checksum32(`${lines[1]}\n${lines[2]}\n${body}`);
  if (actualChecksum !== headerChecksum[1] || actualChecksum !== footer[2] || statements.length !== Number(footer[1])) throw new Error('Backup checksum or statement count does not match');
  for (const statement of statements) {
    if (/^DELETE FROM sqlite_sequence WHERE name='(?:plants|activities|plant_photos)';$/.test(statement)) continue;
    const parsed = parseInsert(statement);
    const columns = parsed.table === 'sqlite_sequence' ? ['name','seq'] : expected[parsed.table];
    if (!columns || columns.length !== parsed.columns.length || columns.some((c, i) => c !== parsed.columns[i]) || parsed.values.length !== columns.length) throw new Error('Backup SQL columns do not match this release');
    const row = Object.fromEntries(columns.map((column, i) => [column, parsed.values[i]])) as Record<string, SqlValue>;
    if (parsed.table === 'sqlite_sequence') dataset.sqlite_sequence.push(row as {name:string;seq:number});
    else dataset[parsed.table as TableName].push(row);
  }
  validRows(dataset);
  return { schemaVersion: version, generation: dataset.generation, dataset };
}
