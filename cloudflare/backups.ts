import type { Env } from './types';
import { CURRENT_SCHEMA_VERSION, JSON_SNAPSHOT_QUERY, MAX_JSON_PAYLOAD_BYTES, makeJsonBackup } from './backup-snapshot';

interface StateRow {
  schema_version: number; generation: number; restore_epoch: number; backup_generation: number; backup_last_success: number | null;
  backup_last_error: string | null; backup_failed_at: number | null; backup_last_checked_at: number | null;
  backup_checked_unchanged: number; restore_verified_at: number | null; backup_lease_until: number | null;
}
interface Manifest {
  file: string; created_at: string; reason: string; generation: number; sha256: string; bytes: number;
  plants: number; activities: number; uploaded_at: string;
}
const checkInterval = 86400;
const retention = 90;
const jsonMime = 'application/json; charset=utf-8';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function epoch(): number { return Math.floor(Date.now() / 1000); }
function iso(seconds: number | null): string | null { return seconds == null ? null : new Date(seconds * 1000).toISOString(); }
const encoder = new TextEncoder();
async function hash(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function objectBytes(object: R2ObjectBody): Promise<Uint8Array> {
  return typeof object.arrayBuffer === 'function'
    ? new Uint8Array(await object.arrayBuffer())
    : encoder.encode(await object.text());
}

async function currentState(env: Env): Promise<StateRow> {
  const row = await env.DB.prepare('SELECT schema_version,generation,restore_epoch,backup_generation,backup_last_success,backup_last_error,backup_failed_at,backup_last_checked_at,backup_checked_unchanged,restore_verified_at,backup_lease_until FROM app_state WHERE id=1').first<StateRow>();
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
  return /^tuinapp-[0-9]{8}T[0-9]{6}Z-[0-9]+-[a-f0-9]{8}-[a-f0-9]{8}\.(?:sql|json)$/.test(file);
}

interface Snapshot {
  schema_version: number; generation: number; plants: number; activities: number; payload_bytes: number; valid: number; payload: string | null;
}
async function readSnapshot(env: Env): Promise<Snapshot> {
  const snapshot = await env.DB.prepare(JSON_SNAPSHOT_QUERY).first<Snapshot>();
  if (!snapshot) throw new Error('Database snapshot query returned no initialized garden');
  if (snapshot.schema_version > CURRENT_SCHEMA_VERSION) throw new Error('Database schema is newer than this application');
  if (snapshot.schema_version !== CURRENT_SCHEMA_VERSION) throw new Error('Database schema is not ready; apply the D1 migrations first');
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0 ||
      !Number.isSafeInteger(snapshot.plants) || snapshot.plants < 0 ||
      !Number.isSafeInteger(snapshot.activities) || snapshot.activities < 0 ||
      !Number.isSafeInteger(snapshot.payload_bytes) || snapshot.payload_bytes < 0) {
    throw new Error('Database snapshot metadata is invalid');
  }
  if (snapshot.valid !== 1) throw new Error('Database contains data that cannot be represented by a valid backup');
  if (snapshot.payload_bytes > MAX_JSON_PAYLOAD_BYTES || snapshot.payload === null) {
    throw new Error('Garden is too large for one D1 JSON snapshot row; backup was not written');
  }
  return snapshot;
}

async function saveSnapshot(env: Env, reason: string, snapshot: Snapshot): Promise<Manifest> {
  const payloadBytes = encoder.encode(snapshot.payload!);
  if (payloadBytes.byteLength !== snapshot.payload_bytes || payloadBytes.byteLength > MAX_JSON_PAYLOAD_BYTES) {
    throw new Error('D1 JSON snapshot size did not match its declared size');
  }
  const payloadSha = await hash(payloadBytes);
  const dumpBytes = encoder.encode(makeJsonBackup(snapshot.payload!, payloadSha));
  const sha256 = await hash(dumpBytes);
  const now = new Date();
  const createdAt = now.toISOString();
  const file = 'tuinapp-' + now.toISOString().replace(/[-:]|\.\d{3}/g, '').replace('Z', 'Z') + '-' + snapshot.generation + '-' + sha256.slice(0, 8) + '-' + crypto.randomUUID().slice(0, 8) + '.json';
  const key = `backups/${file}`;
  const uploaded = await env.BACKUPS.put(key, dumpBytes, { httpMetadata: { contentType: jsonMime }, customMetadata: { sha256, generation: String(snapshot.generation), schemaVersion: String(CURRENT_SCHEMA_VERSION) } });
  if (!uploaded) throw new Error('R2 did not confirm the backup upload');
  const stored = await env.BACKUPS.get(key);
  if (!stored) throw new Error('Uploaded R2 backup could not be read back');
  const storedBytes = await objectBytes(stored);
  if (storedBytes.byteLength !== dumpBytes.byteLength || await hash(storedBytes) !== sha256) throw new Error('Uploaded R2 backup failed read-back verification');
  const manifest: Manifest = {
    file, created_at: createdAt, reason, generation: snapshot.generation, sha256, bytes: dumpBytes.byteLength,
    plants: snapshot.plants, activities: snapshot.activities, uploaded_at: createdAt,
  };
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO backup_manifests(file,created_at,reason,generation,sha256,bytes,plants,activities,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(manifest.file, manifest.created_at, manifest.reason, manifest.generation, manifest.sha256, manifest.bytes, manifest.plants, manifest.activities, manifest.uploaded_at),
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
  const bodyBytes = await objectBytes(object);
  return bodyBytes.byteLength === manifest.bytes && await hash(bodyBytes) === manifest.sha256;
}

export async function scheduledBackup(env: Env): Promise<void> {
  const now = epoch();
  try {
    const state = await env.DB.prepare(
      'UPDATE app_state SET backup_lease_until=? WHERE id=1 AND schema_version=? AND (backup_lease_until IS NULL OR backup_lease_until<?) ' +
      'RETURNING schema_version,generation,restore_epoch,backup_generation,backup_last_success,backup_last_error,backup_failed_at,backup_last_checked_at,backup_checked_unchanged,restore_verified_at'
    ).bind(now + 300, CURRENT_SCHEMA_VERSION, now).first<StateRow>();
    if (!state) {
      // The lease acquisition is the common fast path. This read only distinguishes
      // an active lease from a schema that cannot be backed up.
      const current = await currentState(env);
      if (current.backup_lease_until !== null && current.backup_lease_until >= now) return;
      throw new Error('Backup lease could not be acquired');
    }
    if (state.generation === state.backup_generation) {
      // A committed D1 manifest alone is not a usable backup. Repair missing or
      // damaged R2 state even when the garden has not changed since that snapshot.
      if (await latestScheduledObjectIsValid(env)) {
        await env.DB.prepare('UPDATE app_state SET backup_last_error=NULL,backup_failed_at=NULL,backup_last_checked_at=?,backup_checked_unchanged=1,backup_lease_until=NULL WHERE id=1').bind(now).run();
        return;
      }
    }
    const snapshot = await readSnapshot(env);
    await saveSnapshot(env, 'scheduled', snapshot);
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
  const bodyBytes = await objectBytes(object);
  if (bodyBytes.byteLength !== manifest.bytes || await hash(bodyBytes) !== manifest.sha256) return json({ error: 'Backup failed its integrity check' }, 500);
  return new Response(bodyBytes, { headers: { 'content-type': file.endsWith('.json') ? jsonMime : 'application/sql; charset=utf-8', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export async function handleBackups(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/$/, '') || '/';
  try {
    if (request.method === 'GET' && path === '/backups/status') return await backupStatus(env);
    if (request.method === 'GET' && path.startsWith('/backups/') && path.endsWith('/download')) {
      return await download(env, decodeURIComponent(path.slice('/backups/'.length, -'/download'.length)));
    }
    return json({ error: 'Backup route not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Backup request failed' }, 500);
  }
}
