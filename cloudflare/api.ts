import { authorize, login, loginParameters, logout, sessionInfo, issueSession, mutationSessionGuard } from './auth';
import { getActivities, getPlants, oneActivity, onePlant } from './db';
import { validActivity, validPlant, type Activity, type MonthData, type Plant } from './models';
import { handleBackups } from './backups';
import type { Env } from './types';
import { CURRENT_SCHEMA_VERSION } from './dump';

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const CACHE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(value: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}

function error(status: number, message: string): Response { return json({ error: message }, status); }

function withSecurity(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CACHE_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON body'); }
}

function numericId(text: string): number {
  if (!/^\d+$/u.test(text)) throw new HttpError(404, 'Endpoint not found');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) throw new HttpError(404, 'Endpoint not found');
  return value;
}

function conflict(changes: number): void {
  if (!changes) throw new HttpError(409, 'This record changed or was deleted on another screen. Reload it before saving.');
}

async function createPlant(body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!validPlant(body)) throw new HttpError(400, 'Enter a name and valid plant details');
  const p: Plant = body;
  const result = await env.DB.batch([
    mutationSessionGuard(env, tokenHash),
    env.DB.prepare(`INSERT INTO plants(name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`)
      .bind(p.name, p.plant_type ?? null, p.sun_requirements, p.sow_periods, p.plant_periods, p.notes ?? null, p.needs_reorder ? 1 : 0, tokenHash, Math.floor(Date.now()/1000)),
    env.DB.prepare('DELETE FROM transaction_assertions'),
  ]);
  const insert = result[1] as unknown as { meta?: { last_row_id?: number; changes?: number } };
  if (!(insert.meta?.changes)) throw new HttpError(409, 'Garden was restored in another screen. Reload before saving.');
  const inserted = await onePlant(env, Number(insert.meta?.last_row_id));
  if (!inserted) throw new Error('Inserted plant could not be read');
  return json(inserted);
}

async function updatePlant(id: number, body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!validPlant(body) || body.id !== id) throw new HttpError(400, 'Invalid plant details');
  const p = body as Plant;
  if (!Number.isInteger(p.revision) || (p.revision as number) < 1) throw new HttpError(400, 'Invalid plant details');
  if (!await onePlant(env, id)) throw new HttpError(404, 'Plant not found');
  const result = await env.DB.prepare(`UPDATE plants SET name=?,plant_type=?,sun_requirements=?,sow_periods=?,plant_periods=?,notes=?,needs_reorder=?,updated_at=CURRENT_TIMESTAMP,revision=revision+1
    WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(p.name, p.plant_type ?? null, p.sun_requirements, p.sow_periods, p.plant_periods, p.notes ?? null, p.needs_reorder ? 1 : 0, id, p.revision, tokenHash, Math.floor(Date.now()/1000)).run();
  conflict(result.meta.changes ?? 0);
  return json(await onePlant(env, id));
}

async function deletePlant(id: number, body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!await onePlant(env, id)) throw new HttpError(404, 'Plant not found');
  const revision = body && typeof body === 'object' ? (body as { revision?: unknown }).revision : undefined;
  if (!Number.isInteger(revision) || (revision as number) < 1) throw new HttpError(400, 'Invalid revision');
  const result = await env.DB.prepare(`DELETE FROM plants WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(id, revision, tokenHash, Math.floor(Date.now()/1000)).run();
  conflict(result.meta.changes ?? 0);
  return new Response(null, { status: 204 });
}

async function reorderPlant(id: number, body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!body || typeof body !== 'object' || typeof (body as { needs_reorder?: unknown }).needs_reorder !== 'boolean') throw new HttpError(400, 'Invalid reorder details');
  const { needs_reorder, revision } = body as { needs_reorder: boolean; revision: number };
  if (!Number.isInteger(revision) || revision < 1) throw new HttpError(400, 'Invalid reorder details');
  if (!await onePlant(env, id)) throw new HttpError(404, 'Plant not found');
  const result = await env.DB.prepare(`UPDATE plants SET needs_reorder=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(needs_reorder ? 1 : 0, id, revision, tokenHash, Math.floor(Date.now()/1000)).run();
  conflict(result.meta.changes ?? 0);
  return json(await onePlant(env, id));
}

async function createActivity(body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!validActivity(body)) throw new HttpError(400, 'Enter a name and valid activity details');
  const a = body as Activity;
  const result = await env.DB.prepare(`INSERT INTO activities(name,description,active_periods) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(a.name, a.description ?? null, a.active_periods, tokenHash, Math.floor(Date.now()/1000)).run();
  if (!(result.meta.changes ?? 0)) throw new HttpError(409, 'Garden was restored in another screen. Reload before saving.');
  const inserted = await oneActivity(env, Number(result.meta.last_row_id));
  if (!inserted) throw new Error('Inserted activity could not be read');
  return json(inserted);
}

async function updateActivity(id: number, body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!validActivity(body) || body.id !== id) throw new HttpError(400, 'Invalid activity details');
  const a = body as Activity;
  if (!Number.isInteger(a.revision) || (a.revision as number) < 1) throw new HttpError(400, 'Invalid activity details');
  if (!await oneActivity(env, id)) throw new HttpError(404, 'Activity not found');
  const result = await env.DB.prepare(`UPDATE activities SET name=?,description=?,active_periods=?,updated_at=CURRENT_TIMESTAMP,revision=revision+1
    WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(a.name, a.description ?? null, a.active_periods, id, a.revision, tokenHash, Math.floor(Date.now()/1000)).run();
  conflict(result.meta.changes ?? 0);
  return json(await oneActivity(env, id));
}

async function deleteActivity(id: number, body: unknown, env: Env, tokenHash: string): Promise<Response> {
  if (!await oneActivity(env, id)) throw new HttpError(404, 'Activity not found');
  const revision = body && typeof body === 'object' ? (body as { revision?: unknown }).revision : undefined;
  if (!Number.isInteger(revision) || (revision as number) < 1) throw new HttpError(400, 'Invalid revision');
  const result = await env.DB.prepare(`DELETE FROM activities WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1 WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch)`).bind(id, revision, tokenHash, Math.floor(Date.now()/1000)).run();
  conflict(result.meta.changes ?? 0);
  return new Response(null, { status: 204 });
}

async function monthData(month: number, env: Env): Promise<MonthData> {
  if (month < 1 || month > 12) throw new HttpError(400, 'Month must be between 1 and 12');
  const plants = await getPlants(env);
  const activities = await getActivities(env);
  const early = 1 << ((month - 1) * 2);
  const late = early << 1;
  return {
    sow_early: plants.filter((p) => (p.sow_periods & early) !== 0),
    sow_late: plants.filter((p) => (p.sow_periods & late) !== 0),
    plant_early: plants.filter((p) => (p.plant_periods & early) !== 0),
    plant_late: plants.filter((p) => (p.plant_periods & late) !== 0),
    activities: activities.filter((a) => (a.active_periods & (early | late)) !== 0),
  };
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const state = await env.DB.prepare('SELECT schema_version FROM app_state WHERE id=1').first<{ schema_version: number }>();
    if (!state || state.schema_version !== CURRENT_SCHEMA_VERSION) {
      return withSecurity(error(503, state && state.schema_version > CURRENT_SCHEMA_VERSION ? 'Database schema is newer than this application.' : 'Database schema is not ready. Apply the Cloudflare migrations first.'));
    }
    if (path === '/health' && request.method === 'GET') return withSecurity(json({ status: 'ok' }));
    if (!path.startsWith('/api/')) return withSecurity(error(404, 'Endpoint not found'));

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutating) {
      if (request.headers.get('x-tuinapp-request') !== '1') throw new HttpError(400, 'Missing request protection');
      const expectedOrigin = env.TUINAPP_PUBLIC_ORIGIN ?? url.origin;
      const origin = request.headers.get('origin');
      if (origin && origin !== expectedOrigin) throw new HttpError(403, 'Origin not allowed');
    }

    if (path === '/api/login-parameters' && request.method === 'GET') response = loginParameters(env);
    else if (path === '/api/login' && request.method === 'POST') response = await login(request, env);
    else {
      if (!await authorize(request, env)) throw new HttpError(401, 'Please sign in.');
      const session = await sessionInfo(request, env);
      if (!session) throw new HttpError(401, 'Please sign in.');
      if (path === '/api/session' && request.method === 'GET') {
        response = json({ csrf_token: session.csrf, restore_epoch: session.restoreEpoch });
      } else if (path === '/api/session' && request.method === 'DELETE') response = await logout(request, env);
      else if (path === '/api/plants' && request.method === 'GET') response = json(await getPlants(env));
      else if (path === '/api/plants' && request.method === 'POST') response = await createPlant(await readJson(request), env, session.tokenHash);
      else if (path === '/api/activities' && request.method === 'GET') response = json(await getActivities(env));
      else if (path === '/api/activities' && request.method === 'POST') response = await createActivity(await readJson(request), env, session.tokenHash);
      else if (path === '/api/backups' || path.startsWith('/api/backups/')) {
        response = await handleBackups(request, env, { tokenHash: session.tokenHash });
        if (path === '/api/backups/restore' && request.method === 'POST' && response.ok) {
          const issued = await issueSession(env);
          const body = await response.json() as Record<string, unknown>;
          response = json({ ...body, csrf_token: issued.csrf, restore_epoch: issued.restoreEpoch }, 200, { 'set-cookie': issued.cookie });
        }
      }
      else {
        let match = path.match(/^\/api\/plants\/(\d+)(?:\/(reorder))?$/u);
        if (match) {
          const id = numericId(match[1]);
          if (match[2] === 'reorder' && request.method === 'PUT') response = await reorderPlant(id, await readJson(request), env, session.tokenHash);
          else if (!match[2] && request.method === 'PUT') response = await updatePlant(id, await readJson(request), env, session.tokenHash);
          else if (!match[2] && request.method === 'DELETE') response = await deletePlant(id, await readJson(request), env, session.tokenHash);
          else throw new HttpError(404, 'Endpoint not found');
        } else {
          match = path.match(/^\/api\/activities\/(\d+)$/u);
          if (match) {
            const id = numericId(match[1]);
            if (request.method === 'PUT') response = await updateActivity(id, await readJson(request), env, session.tokenHash);
            else if (request.method === 'DELETE') response = await deleteActivity(id, await readJson(request), env, session.tokenHash);
            else throw new HttpError(404, 'Endpoint not found');
          } else {
            match = path.match(/^\/api\/months\/(\d+)(?:\/(pdf-data))?$/u);
            if (match && request.method === 'GET') {
              const month = Number(match[1]);
              const data = await monthData(month, env);
              response = json(data);
            } else throw new HttpError(404, 'Endpoint not found');
          }
        }
      }
    }
  } catch (cause) {
    if (cause instanceof HttpError) response = error(cause.status, cause.message);
    else if (cause instanceof Error && /CHECK constraint failed: ok=1/u.test(cause.message)) response = error(409, 'Garden was restored in another screen. Reload before saving.');
    else {
      console.error('Request failed:', cause);
      response = error(500, 'The operation failed. Your changes may not have been saved; reload to check before retrying.');
    }
  }
  return withSecurity(response);
}
