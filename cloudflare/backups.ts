import type { Env } from './types';
import { CURRENT_SCHEMA_VERSION, makeDump, parseDump, readDataset, type Dataset } from './dump';

interface StateRow {
  schema_version: number; generation: number; restore_epoch: number; backup_generation: number; backup_last_success: number | null;
  backup_last_error: string | null; backup_failed_at: number | null; backup_last_checked_at: number | null;
  backup_checked_unchanged: number; restore_verified_at: number | null;
}
export interface BackupRequestContext { tokenHash?: string }
const maxRestoreBytes = 5 * 1024 * 1024;
const maxBoundBytes = 1_500_000;
interface Manifest {
  file: string; created_at: string; reason: string; generation: number; sha256: string; bytes: number;
  plants: number; activities: number; photos: number; uploaded_at: string;
}
const checkInterval = 86400;
const retention = 90;
const sqlMime = 'application/sql; charset=utf-8';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function epoch(): number { return Math.floor(Date.now() / 1000); }
function iso(seconds: number | null): string | null { return seconds == null ? null : new Date(seconds * 1000).toISOString(); }
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function currentState(env: Env): Promise<StateRow> {
  const row = await env.DB.prepare('SELECT schema_version,generation,restore_epoch,backup_generation,backup_last_success,backup_last_error,backup_failed_at,backup_last_checked_at,backup_checked_unchanged,restore_verified_at FROM app_state WHERE id=1').first<StateRow>();
  if (!row) throw new Error('Cloud database is not initialized; apply the D1 migrations first');
  if (row.schema_version > CURRENT_SCHEMA_VERSION) throw new Error('Database schema is newer than this application');
  if (row.schema_version !== CURRENT_SCHEMA_VERSION) throw new Error('Database schema is not ready; apply the D1 migrations first');
  return row;
}

async function recordFailure(env: Env, error: unknown): Promise<void> {
  const now = epoch();
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare('UPDATE app_state SET backup_last_error=?,backup_failed_at=?,backup_last_checked_at=?,backup_checked_unchanged=0,backup_lease_until=NULL WHERE id=1').bind(message.slice(0, 1000), now, now).run();
}

function validFile(file: string): boolean {
  return /^tuinapp-[0-9]{8}T[0-9]{6}Z-[0-9]+-[a-f0-9]{8}-[a-f0-9]{8}\.sql$/.test(file);
}

async function saveSnapshot(env: Env, reason: string, dataset?: Awaited<ReturnType<typeof readDataset>>): Promise<Manifest> {
  await currentState(env);
  const snapshot = dataset ?? await readDataset(env.DB);
  const dump = makeDump(snapshot);
  parseDump(dump);
  const sha256 = await hash(dump);
  const now = new Date();
  const createdAt = now.toISOString();
  const file = `tuinapp-${now.toISOString().replace(/[-:]|\.\d{3}/g, '').replace('Z', 'Z')}-${snapshot.generation}-${sha256.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}.sql`;
  const key = `backups/${file}`;
  const uploaded = await env.BACKUPS.put(key, dump, { httpMetadata: { contentType: sqlMime }, customMetadata: { sha256, generation: String(snapshot.generation), schemaVersion: String(CURRENT_SCHEMA_VERSION) } });
  if (!uploaded) throw new Error('R2 did not confirm the backup upload');
  const stored = await env.BACKUPS.get(key);
  if (!stored) throw new Error('Uploaded R2 backup could not be read back');
  const storedBody = await stored.text();
  if (new TextEncoder().encode(storedBody).byteLength !== new TextEncoder().encode(dump).byteLength || await hash(storedBody) !== sha256) throw new Error('Uploaded R2 backup failed read-back verification');
  const manifest: Manifest = {
    file, created_at: createdAt, reason, generation: snapshot.generation, sha256, bytes: new TextEncoder().encode(dump).byteLength,
    plants: snapshot.plants.length, activities: snapshot.activities.length, photos: snapshot.plant_photos.length, uploaded_at: createdAt,
  };
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,photos,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(manifest.file, manifest.created_at, manifest.reason, manifest.generation, manifest.sha256, manifest.bytes, manifest.plants, manifest.activities, manifest.photos, manifest.uploaded_at),
    env.DB.prepare('UPDATE app_state SET backup_generation=?,backup_last_success=?,backup_last_error=NULL,backup_failed_at=NULL,backup_last_checked_at=?,backup_checked_unchanged=0,backup_lease_until=NULL WHERE id=1').bind(snapshot.generation, epoch(), epoch()),
  ]);
  // Retain recent scheduled points plus every named recovery point. Pruning is after a verified upload.
  const { results } = await env.DB.prepare("SELECT file FROM backup_manifests WHERE reason='scheduled' ORDER BY created_at DESC,file DESC").all<{file:string}>();
  const stale = results.slice(retention).filter((item) => validFile(item.file));
  if (stale.length) {
    await env.BACKUPS.delete(stale.map((item) => `backups/${item.file}`));
    await env.DB.prepare("DELETE FROM backup_manifests WHERE reason='scheduled' AND file IN (SELECT value FROM json_each(?))").bind(JSON.stringify(stale.map((item) => item.file))).run();
  }
  return manifest;
}

async function latestScheduledObjectIsValid(env: Env): Promise<boolean> {
  const manifest = await env.DB.prepare("SELECT file,sha256,bytes FROM backup_manifests WHERE reason='scheduled' ORDER BY created_at DESC,file DESC LIMIT 1").first<Pick<Manifest,'file'|'sha256'|'bytes'>>();
  if (!manifest || !validFile(manifest.file)) return false;
  const object = await env.BACKUPS.get(`backups/${manifest.file}`);
  if (!object) return false;
  const body = await object.text();
  return new TextEncoder().encode(body).byteLength === manifest.bytes && await hash(body) === manifest.sha256;
}

export async function scheduledBackup(env: Env): Promise<void> {
  const now = epoch();
  try {
    await currentState(env);
    const acquired = await env.DB.prepare('UPDATE app_state SET backup_lease_until=? WHERE id=1 AND (backup_lease_until IS NULL OR backup_lease_until<?)').bind(now + 300, now).run();
    if ((acquired.meta.changes ?? 0) !== 1) return;
    const state = await currentState(env);
    const dataset = await readDataset(env.DB);
    if (dataset.generation === state.backup_generation) {
      // A committed D1 manifest alone is not a usable backup. Repair missing or
      // damaged R2 state even when the garden has not changed since that snapshot.
      if (!await latestScheduledObjectIsValid(env)) {
        await saveSnapshot(env, 'scheduled', dataset);
        return;
      }
      await env.DB.prepare('UPDATE app_state SET backup_last_error=NULL,backup_failed_at=NULL,backup_last_checked_at=?,backup_checked_unchanged=1,backup_lease_until=NULL WHERE id=1').bind(now).run();
      return;
    }
    await saveSnapshot(env, 'scheduled', dataset);
  } catch (error) {
    try { await recordFailure(env, error); } catch { /* Keep the original backup error visible to the scheduler. */ }
    throw error;
  }
}

async function backupStatus(env: Env): Promise<Response> {
  const state = await currentState(env);
  const { results } = await env.DB.prepare('SELECT file,created_at,reason,plants,activities,bytes,uploaded_at FROM backup_manifests ORDER BY created_at DESC,file DESC').all<Pick<Manifest,'file'|'created_at'|'reason'|'plants'|'activities'|'bytes'|'uploaded_at'>>();
  const backups = results.map((row) => ({ ...row, uploaded_at: row.uploaded_at ?? null }));
  const latest = backups[0] ?? null;
  return json({ latest, backups, last_error: state.backup_last_error, failed_at: iso(state.backup_failed_at), last_checked_at: iso(state.backup_last_checked_at), checked_unchanged: Boolean(state.backup_checked_unchanged), check_interval_seconds: checkInterval, last_restore_verified_at: iso(state.restore_verified_at), offsite: null, storage: 'r2' });
}

async function download(env: Env, file: string): Promise<Response> {
  if (!validFile(file)) return json({ error: 'Backup not found' }, 404);
  const manifest = await env.DB.prepare('SELECT file,sha256,bytes FROM backup_manifests WHERE file=?').bind(file).first<Pick<Manifest,'file'|'sha256'|'bytes'>>();
  if (!manifest) return json({ error: 'Backup not found' }, 404);
  const object = await env.BACKUPS.get(`backups/${file}`);
  if (!object) return json({ error: 'Backup object is missing from R2' }, 404);
  const body = await object.text();
  if (new TextEncoder().encode(body).byteLength !== manifest.bytes || await hash(body) !== manifest.sha256) return json({ error: 'Backup failed its integrity check' }, 500);
  return new Response(body, { headers: { 'content-type': sqlMime, 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function jsonFor(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows.map((row) => ({ ...row, ...(row.image_data instanceof Uint8Array ? { image_data: [...row.image_data].map((v) => v.toString(16).padStart(2, '0')).join('') } : {}) })));
}

type RestoreChunks = Record<'plants'|'activities'|'plant_photos'|'imports', string[]>;

function chunkRows(rows: Record<string, unknown>[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentBytes = 2;
  for (const row of rows) {
    const encodedRow = jsonFor([row]).slice(1, -1);
    const rowBytes = new TextEncoder().encode(encodedRow).byteLength;
    if (rowBytes + 2 > maxBoundBytes) throw new Error('A single restore row exceeds the D1 request limit');
    const addedBytes = rowBytes + (current.length ? 1 : 0);
    if (currentBytes + addedBytes > maxBoundBytes) {
      if (!current.length) throw new Error('A single restore row exceeds the D1 request limit');
      chunks.push(`[${current.join(',')}]`);
      current = [encodedRow];
      currentBytes = rowBytes + 2;
    } else {
      current.push(encodedRow);
      currentBytes += addedBytes;
    }
  }
  if (current.length) chunks.push(`[${current.join(',')}]`);
  return chunks;
}

function makeRestoreChunks(dataset: Dataset): RestoreChunks {
  return {
    plants: chunkRows(dataset.plants), activities: chunkRows(dataset.activities),
    plant_photos: chunkRows(dataset.plant_photos), imports: chunkRows(dataset.imports),
  };
}

async function applyRestore(env: Env, parsed: ReturnType<typeof parseDump>, chunks: RestoreChunks, expectedGeneration: number, expectedRestoreEpoch: number, tokenHash: string): Promise<void> {
  await currentState(env);
  const d = parsed.dataset;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('INSERT INTO transaction_assertions(ok) SELECT CASE WHEN generation=? THEN 1 ELSE 0 END FROM app_state WHERE id=1').bind(expectedGeneration),
    env.DB.prepare('INSERT INTO transaction_assertions(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=? AND a.restore_epoch=?) THEN 1 ELSE 0 END').bind(tokenHash, epoch(), expectedRestoreEpoch, expectedRestoreEpoch),
    env.DB.prepare('UPDATE app_state SET generation=generation+1 WHERE id=1'),
    env.DB.prepare('UPDATE app_state SET restore_epoch=restore_epoch+1 WHERE id=1'),
    env.DB.prepare('DELETE FROM auth_sessions'),
    env.DB.prepare('DELETE FROM plant_photos'), env.DB.prepare('DELETE FROM plants'), env.DB.prepare('DELETE FROM activities'), env.DB.prepare('DELETE FROM imports'),
    env.DB.prepare("DELETE FROM sqlite_sequence WHERE name IN ('plants','activities','plant_photos')"),
    ...chunks.plants.map((json) => env.DB.prepare("INSERT INTO plants (id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,created_at,updated_at,needs_reorder,revision) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.plant_type'),json_extract(value,'$.sun_requirements'),json_extract(value,'$.sow_periods'),json_extract(value,'$.plant_periods'),json_extract(value,'$.notes'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.needs_reorder'),json_extract(value,'$.revision') FROM json_each(?)").bind(json)),
    ...chunks.activities.map((json) => env.DB.prepare("INSERT INTO activities (id,name,description,active_periods,created_at,updated_at,revision) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.description'),json_extract(value,'$.active_periods'),json_extract(value,'$.created_at'),json_extract(value,'$.updated_at'),json_extract(value,'$.revision') FROM json_each(?)").bind(json)),
    ...chunks.plant_photos.map((json) => env.DB.prepare("INSERT INTO plant_photos (id,plant_id,sort_order,image_data,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.plant_id'),json_extract(value,'$.sort_order'),CASE WHEN json_extract(value,'$.image_data') IS NULL THEN NULL ELSE unhex(json_extract(value,'$.image_data')) END,json_extract(value,'$.created_at') FROM json_each(?)").bind(json)),
    ...chunks.imports.map((json) => env.DB.prepare("INSERT INTO imports (fingerprint,kind,imported_at,row_count) SELECT json_extract(value,'$.fingerprint'),json_extract(value,'$.kind'),json_extract(value,'$.imported_at'),json_extract(value,'$.row_count') FROM json_each(?)").bind(json)),
    ...(d.sqlite_sequence.length ? [
      env.DB.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT json_extract(value,'$.name'),json_extract(value,'$.seq') FROM json_each(?) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=json_extract(value,'$.name'))").bind(JSON.stringify(d.sqlite_sequence)),
      env.DB.prepare("UPDATE sqlite_sequence SET seq=(SELECT json_extract(value,'$.seq') FROM json_each(?) WHERE json_extract(value,'$.name')=sqlite_sequence.name) WHERE name IN (SELECT json_extract(value,'$.name') FROM json_each(?))").bind(JSON.stringify(d.sqlite_sequence), JSON.stringify(d.sqlite_sequence)),
    ] : []),
    env.DB.prepare('INSERT INTO transaction_assertions(ok) SELECT CASE WHEN (SELECT count(*) FROM plants)=? AND (SELECT count(*) FROM activities)=? AND (SELECT count(*) FROM plant_photos)=? AND NOT EXISTS (SELECT 1 FROM plant_photos p LEFT JOIN plants x ON p.plant_id=x.id WHERE x.id IS NULL) THEN 1 ELSE 0 END').bind(d.plants.length, d.activities.length, d.plant_photos.length),
    env.DB.prepare('DELETE FROM transaction_assertions'),
    env.DB.prepare('UPDATE app_state SET backup_checked_unchanged=0,restore_verified_at=?,backup_last_error=NULL,backup_failed_at=NULL WHERE id=1').bind(epoch()),
  ];
  if (statements.length > 25) throw new Error('Restore exceeds the reserved D1 atomic batch statement budget');
  await env.DB.batch(statements);
}

async function restoreUpload(request: Request, env: Env, context: BackupRequestContext): Promise<Response> {
  if (!context.tokenHash) return json({ error: 'Authenticated restore session is required' }, 401);
  if (request.headers.get('x-tuinapp-restore-confirm') !== 'replace') return json({ error: 'Explicit restore confirmation is required' }, 400);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/sql')) return json({ error: 'Upload a generated .sql backup' }, 415);
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxRestoreBytes) return json({ error: 'Backup file exceeds the 5 MiB limit' }, 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxRestoreBytes) return json({ error: 'Backup file exceeds the 5 MiB limit' }, 413);
  // Parse once before creating recovery material so malformed input cannot cause side effects.
  let parsed: ReturnType<typeof parseDump>;
  let chunks: RestoreChunks;
  try {
    parsed = parseDump(text);
    chunks = makeRestoreChunks(parsed.dataset);
    // Keep half of the 50-statement per-invocation budget available to auth,
    // recovery snapshot, and response bookkeeping around this atomic batch.
    if (15 + Object.values(chunks).reduce((total, entries) => total + entries.length, 0) > 25) return json({ error: 'Backup exceeds the D1 atomic restore limit' }, 413);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid backup file' }, 400); }
  const guard = await currentState(env);
  const session = await env.DB.prepare('SELECT restore_epoch FROM auth_sessions WHERE token_hash=? AND expires_at>?').bind(context.tokenHash, epoch()).first<{restore_epoch:number}>();
  if (!session || session.restore_epoch !== guard.restore_epoch) return json({ error: 'Authenticated restore session is stale; sign in again' }, 401);
  let recovery: Manifest;
  try {
    recovery = await saveSnapshot(env, 'before-restore');
  } catch (error) {
    await recordFailure(env, error).catch(() => undefined);
    return json({ error: 'Could not create a verified R2 recovery snapshot; restore was not applied' }, 503);
  }
  try {
    // Fail safely if garden writes happened while the recovery snapshot was uploading.
    const fresh = await currentState(env);
    if (fresh.generation !== guard.generation) return json({ error: 'Garden changed while preparing restore; retry after a fresh recovery snapshot' }, 409);
    await applyRestore(env, parsed, chunks, guard.generation, guard.restore_epoch, context.tokenHash);
    const state = await currentState(env);
    return json({ ok: true, recovery_file: recovery.file, generation: state.generation });
  } catch (error) {
    await recordFailure(env, error).catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : 'Restore failed', recovery_file: recovery.file }, 400);
  }
}

export async function handleBackups(request: Request, env: Env, context: BackupRequestContext = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  try {
    if (request.method === 'GET' && path === '/backups/status') return await backupStatus(env);
    if (request.method === 'GET' && path.startsWith('/backups/') && path.endsWith('/download')) {
      return await download(env, decodeURIComponent(path.slice('/backups/'.length, -'/download'.length)));
    }
    if (request.method === 'POST' && path === '/backups/restore') return await restoreUpload(request, env, context);
    return json({ error: 'Backup route not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Backup request failed' }, 500);
  }
}
