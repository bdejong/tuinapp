export const CURRENT_SCHEMA_VERSION = 3;
export const JSON_BACKUP_FORMAT = 'tuinapp-backup-v2';
export const MAX_JSON_PAYLOAD_BYTES = 1_750_000;

export const TABLES = {
  plants: ['id','name','plant_type','sun_requirements','sow_periods','plant_periods','notes','created_at','updated_at','needs_reorder','revision'],
  activities: ['id','name','description','active_periods','created_at','updated_at','revision'],
  imports: ['fingerprint','kind','imported_at','row_count'],
} as const;
type TableName = keyof typeof TABLES;

const validSnapshotSql = (() => {
  const integer = (column: string, condition: string): string => `typeof(${column})='integer' AND ${condition}`;
  const safeInt = (column: string, condition = '1=1'): string => integer(column, `${column} BETWEEN -9007199254740991 AND 9007199254740991 AND (${condition})`);
  const text = (column: string, nullable = false): string => nullable
    ? `(${column} IS NULL OR typeof(${column})='text')`
    : `typeof(${column})='text'`;
  const jsWhitespace = "CAST(X'090A0B0C0D20C2A0E19A80E28080E28081E28082E28083E28084E28085E28086E28087E28088E28089E2808AE280A8E280A9E280AFE2819FE38080EFBBBF' AS TEXT)";
  const plant = [
    safeInt('id', 'id > 0'), `typeof(name)='text' AND length(trim(name,${jsWhitespace})) > 0 AND length(name) <= 500`,
    text('plant_type', true), `(plant_type IS NULL OR plant_type IN ('vegetable_fruit','flower','herb'))`,
    safeInt('sun_requirements', 'sun_requirements BETWEEN 0 AND 7'),
    safeInt('sow_periods', 'sow_periods BETWEEN 0 AND 16777215'), safeInt('plant_periods', 'plant_periods BETWEEN 0 AND 16777215'),
    text('notes', true), text('created_at', true), text('updated_at', true),
    safeInt('needs_reorder', 'needs_reorder IN (0,1)'), safeInt('revision', 'revision >= 1'),
  ].join(' AND ');
  const activity = [
    safeInt('id', 'id > 0'), `typeof(name)='text' AND length(trim(name,${jsWhitespace})) > 0 AND length(name) <= 500`,
    text('description', true), safeInt('active_periods', 'active_periods BETWEEN 0 AND 16777215'),
    text('created_at', true), text('updated_at', true), safeInt('revision', 'revision >= 1'),
  ].join(' AND ');
  const imported = [text('fingerprint'), text('kind'), text('imported_at'), safeInt('row_count', 'row_count >= 0')].join(' AND ');
  const sequence = [
    `name IN ('plants','activities')`, safeInt('seq', 'seq >= 0'),
    `seq >= CASE name WHEN 'plants' THEN COALESCE((SELECT max(id) FROM plants),0) ELSE COALESCE((SELECT max(id) FROM activities),0) END`,
  ].join(' AND ');
  return `(
    typeof(generation)='integer' AND generation BETWEEN 0 AND 9007199254740991
    AND NOT EXISTS (SELECT 1 FROM plants WHERE COALESCE(NOT (${plant}),1))
    AND NOT EXISTS (SELECT 1 FROM activities WHERE COALESCE(NOT (${activity}),1))
    AND NOT EXISTS (SELECT 1 FROM imports WHERE COALESCE(NOT (${imported}),1))
    AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name IN ('plants','activities') AND COALESCE(NOT (${sequence}),1))
    AND (SELECT count(*) FROM sqlite_sequence WHERE name IN ('plants','activities')) =
        (SELECT count(DISTINCT name) FROM sqlite_sequence WHERE name IN ('plants','activities'))
  )`;
})();

/** SQLite assembles one bounded, deterministic snapshot row. */
export const JSON_SNAPSHOT_QUERY = (() => {
  const jsonRows = (table: TableName): string => {
    const cols = TABLES[table];
    const object = cols.map((column) => "'" + column + "'," + column).join(',');
    return "json(COALESCE((SELECT json_group_array(json_object(" + object + ")) FROM (SELECT " + cols.join(',') + " FROM " + table + " ORDER BY " + (table === 'imports' ? 'fingerprint' : 'id') + ")), '[]'))";
  };
  return [
    'WITH snapshot AS (',
    'SELECT schema_version,generation,',
    "json_object('schema_version',schema_version,'generation',generation,",
    "'plants'," + jsonRows('plants') + ",",
    "'activities'," + jsonRows('activities') + ",",
    "'imports'," + jsonRows('imports') + ",",
    "'sqlite_sequence',json(COALESCE((SELECT json_group_array(json_object('name',name,'seq',seq)) FROM (SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities') ORDER BY name)), '[]'))",
    ') AS payload',
    'FROM app_state WHERE id=1',
    ')',
    'SELECT schema_version,generation,',
    '(SELECT count(*) FROM plants) AS plants,',
    '(SELECT count(*) FROM activities) AS activities,',
    'length(CAST(payload AS BLOB)) AS payload_bytes,',
    'CASE WHEN ' + validSnapshotSql + ' THEN 1 ELSE 0 END AS valid,',
    'CASE WHEN length(CAST(payload AS BLOB)) <= ' + MAX_JSON_PAYLOAD_BYTES + ' THEN payload ELSE NULL END AS payload',
    'FROM snapshot',
  ].join(' ');
})();

export function makeJsonBackup(payload: string, payloadSha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(payloadSha256)) throw new Error('Backup payload hash is invalid');
  return '{"format":"' + JSON_BACKUP_FORMAT + '","sha256":"' + payloadSha256 + '","data":' + payload + '}\n';
}
