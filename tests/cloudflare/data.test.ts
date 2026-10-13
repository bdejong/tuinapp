import { describe, expect, it } from 'vitest';
import { TextEncoder } from 'node:util';
import { makeDump, parseDump, readDataset, type Dataset } from '../../cloudflare/dump';

function sample(): Dataset {
  return {
    plants: [{ id: 17, name: "Épinard d'été", plant_type: 'vegetable_fruit', sun_requirements: 7, sow_periods: 8388611, plant_periods: 12, notes: "Line one\nLine 'two'", created_at: '2020-01-01 10:00:00', updated_at: '2021-01-01 11:00:00', needs_reorder: 1, revision: 9 }],
    activities: [{ id: 4, name: 'Prune', description: 'After frost', active_periods: 8388609, created_at: '2020-02-01', updated_at: '2021-03-01', revision: 3 }],
    plant_photos: [{ id: 3, plant_id: 17, sort_order: 2, image_data: new Uint8Array([0, 255, 22, 99, 2]), created_at: '2021-04-01' }],
    imports: [{ fingerprint: 'sha256:abc', kind: 'legacy', imported_at: '2022-01-01', row_count: 18 }],
    sqlite_sequence: [{ name: 'plants', seq: 99 }, { name: 'activities', seq: 7 }, { name: 'plant_photos', seq: 3 }],
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

describe('Cloudflare logical data backup format', () => {
  it('round trips IDs, timestamps, revisions, flags, imports, BLOB bytes, and AUTOINCREMENT sequence state', () => {
    const source = sample();
    const dump = makeDump(source);
    const parsed = parseDump(dump);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.generation).toBe(42);
    expect(parsed.dataset).toEqual(source);
  });

  it('rejects arbitrary SQL, malformed headers, newer schemas, and invalid foreign keys', () => {
    const dump = makeDump(sample());
    expect(() => parseDump(retag(dump.replace('INSERT INTO plants', 'DROP TABLE plants;\nINSERT INTO plants'), 1))).toThrow('unsupported SQL');
    expect(() => parseDump(dump.replace('-- schema_version=2', '-- schema_version=999'))).toThrow('newer than this application');
    expect(() => parseDump(retag(dump.replace("INSERT INTO plant_photos (id,plant_id,sort_order,image_data,created_at) VALUES (3,17", "INSERT INTO plant_photos (id,plant_id,sort_order,image_data,created_at) VALUES (3,999")))).toThrow('missing plant');
    expect(() => parseDump(retag(dump.replace('-- END tuinapp-backup-v1', 'CREATE TABLE users(id);\n-- END tuinapp-backup-v1'), 1))).toThrow('unsupported SQL');
  });

  it('rejects duplicate identifiers, malformed binary values, and out-of-range masks', () => {
    const dump = makeDump(sample());
    const duplicate = "INSERT INTO plants (id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision) VALUES (17,'duplicate',NULL,0,0,0,NULL,NULL,NULL,0,1);\n";
    expect(() => parseDump(retag(dump.replace('-- END tuinapp-backup-v1', `${duplicate}-- END tuinapp-backup-v1`), 1))).toThrow('duplicate plants IDs');
    expect(() => parseDump(retag(dump.replace("X'00ff166302'", "X'123'")))).toThrow('odd-length hex');
    expect(() => parseDump(retag(dump.replace(',7,8388611,12,', ',8,8388611,12,')))).toThrow('out-of-range');
  });

  it('requires complete checksummed framing and counts Unicode names by code point', () => {
    const dump = makeDump(sample());
    expect(() => parseDump(dump.slice(0, dump.lastIndexOf('-- END')))).toThrow('incomplete or has invalid integrity framing');
    expect(() => parseDump(dump.replace("Épinard d''été", "Épinard d''ete"))).toThrow('checksum or statement count');
    const unicode = sample();
    unicode.plants[0].name = '🌱'.repeat(500);
    expect(parseDump(makeDump(unicode)).dataset.plants[0].name).toHaveLength(1000);
    unicode.plants[0].name = '🌱'.repeat(501);
    expect(() => parseDump(makeDump(unicode))).toThrow('invalid plant name');
  });

  it('normalizes Worker RPC byte-array BLOBs when reading an R2 snapshot', async () => {
    const batchResults = [
      { results: [] }, { results: [] }, { results: [{ id: 3, plant_id: 17, sort_order: 2, image_data: [0, 255, 22], created_at: null }] }, { results: [] },
      { results: [] }, { results: [{ generation: 9 }] },
    ];
    const db = { prepare: () => ({}), batch: async () => batchResults } as unknown as D1Database;
    const result = await readDataset(db);
    expect(result.generation).toBe(9);
    expect(result.plant_photos[0].image_data).toEqual(new Uint8Array([0, 255, 22]));
  });
});
