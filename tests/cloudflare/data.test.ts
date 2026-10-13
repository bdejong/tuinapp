import { describe, expect, it } from 'vitest';
import { TextEncoder } from 'node:util';
import { JSON_BACKUP_FORMAT, makeDump, makeJsonBackup, parseBackup, parseDump, readDataset, type Dataset } from '../../cloudflare/dump';
import { buildRestoreSql } from '../../cloudflare/restore';

function sample(): Dataset {
  return {
    plants: [{ id: 17, name: "Épinard d'été", plant_type: 'vegetable_fruit', sun_requirements: 7, sow_periods: 8388611, plant_periods: 12, notes: "Line one\nLine 'two'", created_at: '2020-01-01 10:00:00', updated_at: '2021-01-01 11:00:00', needs_reorder: 1, revision: 9 }],
    activities: [{ id: 4, name: 'Prune', description: 'After frost', active_periods: 8388609, created_at: '2020-02-01', updated_at: '2021-03-01', revision: 3 }],
    imports: [{ fingerprint: 'sha256:abc', kind: 'legacy', imported_at: '2022-01-01', row_count: 18 }],
    sqlite_sequence: [{ name: 'plants', seq: 99 }, { name: 'activities', seq: 7 }],
    generation: 42,
  };
}

function retag(dump: string, addedStatements = 0): string {
  const lines = dump.split('\n');
  const footer = /^-- END tuinapp-backup-v1 statements=(\d+) checksum=/.exec(lines.at(-2)!);
  const body = `${lines.slice(4, -2).join('\n')}\n`;
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`${lines[1]}\n${lines[2]}\n${body}`)) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  const checksum = value.toString(16).padStart(8, '0');
  lines[3] = `-- checksum=${checksum}`;
  lines[lines.length - 2] = `-- END tuinapp-backup-v1 statements=${Number(footer?.[1]) + addedStatements} checksum=${checksum}`;
  return lines.join('\n');
}

function legacyV2Dump(): string {
  const body = [
    "INSERT INTO plants (id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision) VALUES (17,'Spinazie',NULL,3,4,5,'note','2020-01-01','2020-01-02',0,2);",
    "INSERT INTO activities (id,name,description,active_periods,created_at,updated_at,revision) VALUES (4,'Water','daily',7,'2020-01-01','2020-01-02',3);",
    "INSERT INTO plant_photos (id,plant_id,sort_order,image_data,created_at) VALUES (9,17,2,X'00ff1663','2021-04-01');",
    "INSERT INTO imports (fingerprint,kind,imported_at,row_count) VALUES ('sha256:abc','legacy','2022-01-01',18);",
    "DELETE FROM sqlite_sequence WHERE name='plants';",
    "DELETE FROM sqlite_sequence WHERE name='activities';",
    "DELETE FROM sqlite_sequence WHERE name='plant_photos';",
    "INSERT INTO sqlite_sequence (name,seq) VALUES ('plants',99);",
    "INSERT INTO sqlite_sequence (name,seq) VALUES ('activities',7);",
    "INSERT INTO sqlite_sequence (name,seq) VALUES ('plant_photos',9);",
  ].join('\n') + '\n';
  let value = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(`-- schema_version=2\n-- generation=42\n${body}`)) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  const checksum = value.toString(16).padStart(8, '0');
  return `-- tuinapp-backup-v1\n-- schema_version=2\n-- generation=42\n-- checksum=${checksum}\n${body}-- END tuinapp-backup-v1 statements=10 checksum=${checksum}\n`;
}

async function jsonDump(dataset: Dataset): Promise<string> {
  const payload = JSON.stringify({
    schema_version: 3, generation: dataset.generation, plants: dataset.plants,
    activities: dataset.activities, imports: dataset.imports, sqlite_sequence: dataset.sqlite_sequence,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return makeJsonBackup(payload, sha);
}

describe('Cloudflare logical data backup format', () => {
  it('round trips garden fields and preserves AUTOINCREMENT sequence values above current IDs', () => {
    const source = sample();
    const dump = makeDump(source);
    const parsed = parseDump(dump);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.generation).toBe(42);
    expect(parsed.dataset).toEqual(source);
  });

  it('validates the compact JSON snapshot envelope and converts it to a normal restore dataset', async () => {
    const source = sample();
    const dump = await jsonDump(source);
    expect(dump).toContain('"format":"' + JSON_BACKUP_FORMAT + '"');
    expect(await parseBackup(dump)).toMatchObject({ schemaVersion: 3, generation: 42, dataset: source });
    expect((await parseBackup(makeDump(source))).dataset).toEqual(source);
    await expect(parseBackup(dump.slice(0, -3))).rejects.toThrow('framing');
    await expect(parseBackup(dump.replace("Épinard", 'Bedorf'))).rejects.toThrow('checksum');
  });

  it('rejects validly hashed JSON with future schema, invalid generation, bad sequence, or extra fields', async () => {
    const payload = (data: unknown) => JSON.stringify(data);
    const wrap = async (data: unknown) => {
      const raw = payload(data);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const sha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return makeJsonBackup(raw, sha);
    };
    const source = sample();
    const valid = { schema_version: 3, generation: source.generation, plants: source.plants, activities: source.activities, imports: source.imports, sqlite_sequence: source.sqlite_sequence };
    await expect(parseBackup(await wrap({ ...valid, schema_version: 4 }))).rejects.toThrow('newer than this application');
    await expect(parseBackup(await wrap({ ...valid, generation: -1 }))).rejects.toThrow('invalid generation');
    await expect(parseBackup(await wrap({ ...valid, sqlite_sequence: [{ name: 'plants', seq: 1 }] }))).rejects.toThrow('below an existing row ID');
    await expect(parseBackup(await wrap({ ...valid, unrecognized: true }))).rejects.toThrow('unsupported schema or shape');
  });

  it('converts schema 2 garden backups by validating then dropping deprecated photo rows', () => {
    const old = legacyV2Dump();
    const parsed = parseDump(old);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.dataset).toMatchObject({ generation: 42, plants: [{ id: 17, name: 'Spinazie' }], activities: [{ id: 4, name: 'Water' }], imports: [{ fingerprint: 'sha256:abc' }] });
    expect(parsed.dataset.sqlite_sequence).toEqual([{ name: 'plants', seq: 99 }, { name: 'activities', seq: 7 }]);
    expect(makeDump(parsed.dataset)).not.toContain('plant_photos');
    const restoreSql = buildRestoreSql(parsed.dataset, { schemaVersion: 3, generation: 8, restoreEpoch: 2 }, ['0001_initial.sql', '0002_data_generation.sql', '0003_remove_plant_photos.sql']);
    expect(restoreSql).toContain("INSERT INTO plants (id,name,plant_type");
    expect(restoreSql).not.toContain('INSERT INTO plant_photos');
    const badReference = old.replace('VALUES (9,17,2,', 'VALUES (9,999,2,');
    expect(() => parseDump(retag(badReference))).toThrow('missing plant');
  });

  it('rejects arbitrary SQL, malformed headers, newer schemas, and unsupported statements', () => {
    const dump = makeDump(sample());
    expect(() => parseDump(retag(dump.replace('INSERT INTO plants', 'DROP TABLE plants;\nINSERT INTO plants'), 1))).toThrow('unsupported SQL');
    expect(() => parseDump(dump.replace('-- schema_version=3', '-- schema_version=999'))).toThrow('newer than this application');
    expect(() => parseDump(retag(dump.replace('-- END tuinapp-backup-v1', 'CREATE TABLE users(id);\n-- END tuinapp-backup-v1'), 1))).toThrow('unsupported SQL');
  });

  it('rejects duplicate identifiers, malformed binary values, and out-of-range masks', () => {
    const dump = makeDump(sample());
    const duplicate = "INSERT INTO plants (id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision) VALUES (17,'duplicate',NULL,0,0,0,NULL,NULL,NULL,0,1);\n";
    expect(() => parseDump(retag(dump.replace('-- END tuinapp-backup-v1', `${duplicate}-- END tuinapp-backup-v1`), 1))).toThrow('duplicate plants IDs');
    expect(() => parseDump(dump.slice(0, dump.lastIndexOf('-- END')))).toThrow('incomplete or has invalid integrity framing');
    expect(() => parseDump(dump.replace("Épinard d''été", "Épinard d''ete"))).toThrow('checksum or statement count');
    const unicode = sample();
    unicode.plants[0].name = '🌱'.repeat(500);
    expect(parseDump(makeDump(unicode)).dataset.plants[0].name).toHaveLength(1000);
    unicode.plants[0].name = '🌱'.repeat(501);
    expect(() => makeDump(unicode)).toThrow('invalid plant name');
  });

  it('normalizes Worker RPC results and reads sequence high-water marks', async () => {
    const batchResults = [
      { results: [{ id: 17, name: 'Spinach' }] }, { results: [{ id: 4, name: 'Prune' }] }, { results: [] },
      { results: [{ name: 'activities', seq: 7 }, { name: 'plants', seq: 99 }] }, { results: [{ generation: 9 }] },
    ];
    const db = { prepare: () => ({}), batch: async () => batchResults } as unknown as D1Database;
    const result = await readDataset(db);
    expect(result.generation).toBe(9);
    expect(result.sqlite_sequence).toEqual([{ name: 'activities', seq: 7 }, { name: 'plants', seq: 99 }]);
  });
});
