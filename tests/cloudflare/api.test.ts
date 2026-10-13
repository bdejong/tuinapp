import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createPasswordHash } from '../../cloudflare/auth';
import type { Env } from '../../cloudflare/types';
import { handleApi } from '../../cloudflare/api';

const origin = 'https://tuin.test';
let mf: Miniflare;
let env: Env;
let passwordHash: string;

function migrationStatements(sql: string): string[] {
  return sql.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map((part) => part.trim().replace(/;$/u, '')).filter(Boolean);
}

beforeAll(async () => {
  passwordHash = await createPasswordHash('test-owner-password');
  const worker = await build({ entryPoints: ['cloudflare/pages.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
  const workerCode = worker.outputFiles[0].text;
  mf = new Miniflare({
    workers: [{
      config: {
        name: 'api-tests',
        compatibilityDate: '2026-10-01',
        manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: workerCode } } },
        env: {
          DB: { type: 'd1', name: 'tuinapp-api-tests' }, BACKUPS: { type: 'r2', name: 'tuinapp-api-tests' },
          TUINAPP_PASSWORD_HASH: { type: 'text', value: passwordHash },
          TUINAPP_SESSION_SECRET: { type: 'text', value: 'test-session-secret-must-be-at-least-32-bytes-long' },
          TUINAPP_PUBLIC_ORIGIN: { type: 'text', value: origin },
        },
      },
    }],
  });
  env = {
    DB: await mf.getD1Database('DB', 'api-tests'),
    BACKUPS: await mf.getR2Bucket('BACKUPS', 'api-tests'),
    TUINAPP_PASSWORD_HASH: passwordHash,
    TUINAPP_SESSION_SECRET: 'test-session-secret-must-be-at-least-32-bytes-long',
    TUINAPP_PUBLIC_ORIGIN: origin,
  };
  for (const migration of ['0001_initial.sql', '0002_data_generation.sql']) {
    for (const sql of migrationStatements(await readFile(resolve('cloudflare/migrations', migration), 'utf8'))) await env.DB.prepare(sql).run();
  }
});

afterAll(async () => { await mf?.dispose(); });

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions'), env.DB.prepare('DELETE FROM auth_attempts'),
    env.DB.prepare('DELETE FROM plants'), env.DB.prepare('DELETE FROM activities'),
  ]);
});

async function call(path: string, method = 'GET', options: { body?: unknown; cookie?: string; csrf?: string; originHeader?: string; protect?: boolean } = {}): Promise<Response> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.protect !== false) headers.set('x-tuinapp-request', '1');
  if (options.originHeader !== undefined) headers.set('origin', options.originHeader);
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.csrf) headers.set('x-csrf-token', options.csrf);
  const body = options.body === undefined || method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(options.body);
  return mf.dispatchFetch(`https://tuin.test${path}`, { method, headers, body });
}

async function signIn(): Promise<{ cookie: string; csrf: string }> {
  const parametersResponse = await call('/api/login-parameters');
  expect(parametersResponse.status).toBe(200);
  const parameters = await parametersResponse.json() as { salt: string; iterations: number };
  const salt = Uint8Array.from(atob(parameters.salt.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - parameters.salt.length % 4) % 4)), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-owner-password'), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: parameters.iterations }, key, 256));
  let binary = ''; for (const byte of derived) binary += String.fromCharCode(byte);
  const proof = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  const response = await call('/api/login', 'POST', { body: { proof }, originHeader: origin });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';', 1)[0];
  const body = await response.json() as { csrf_token: string };
  return { cookie, csrf: body.csrf_token };
}

function withAuth(auth: { cookie: string; csrf: string }, body?: unknown) {
  return { cookie: auth.cookie, csrf: auth.csrf, ...(body === undefined ? {} : { body }) };
}

const plant = () => ({ name: 'Desktop tomato', sun_requirements: 3, sow_periods: 1, plant_periods: 8388608, needs_reorder: true, notes: 'First note' });

describe('Cloudflare API', () => {
  it('protects private routes with login, CSRF, origin checks, and revocable sessions', async () => {
    expect((await call('/api/plants')).status).toBe(401);
    const parameters = await (await call('/api/login-parameters')).json() as { salt: string; iterations: number };
    const salt = Uint8Array.from(atob(parameters.salt.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - parameters.salt.length % 4) % 4)), (char) => char.charCodeAt(0));
    const wrongKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('wrong'), 'PBKDF2', false, ['deriveBits']);
    const wrongBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: parameters.iterations }, wrongKey, 256));
    let wrongBinary = ''; for (const byte of wrongBits) wrongBinary += String.fromCharCode(byte);
    const wrongProof = btoa(wrongBinary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    expect((await call('/api/login', 'POST', { body: { proof: wrongProof }, originHeader: origin })).status).toBe(401);
    expect((await call('/api/login', 'POST', { body: { proof: 'x' }, originHeader: origin, protect: false })).status).toBe(400);
    const auth = await signIn();
    expect((await call('/api/session', 'GET', withAuth(auth))).status).toBe(200);
    expect((await call('/api/plants', 'POST', { ...withAuth(auth, plant()), csrf: 'wrong' })).status).toBe(401);
    expect((await call('/api/plants', 'POST', { ...withAuth(auth, plant()), originHeader: 'https://attacker.test' })).status).toBe(403);
    expect((await call('/api/session', 'DELETE', withAuth(auth))).status).toBe(204);
    expect((await call('/api/plants', 'GET', withAuth(auth))).status).toBe(401);
  });

  it('guards backup routes and refuses requests when the app schema is from another version', async () => {
    expect((await call('/api/backups/status')).status).toBe(401);
    const auth = await signIn();
    expect((await call('/api/backups/status', 'GET', withAuth(auth))).status).toBe(200);
    const missingConfirm = await call('/api/backups/restore', 'POST', withAuth(auth, 'not-a-dump'));
    expect(missingConfirm.status).toBe(400);
    expect((await missingConfirm.json() as {error:string}).error).toMatch(/confirmation/i);

    await env.DB.prepare('UPDATE app_state SET schema_version=999 WHERE id=1').run();
    expect((await call('/health')).status).toBe(503);
    expect((await call('/api/plants', 'GET', withAuth(auth))).status).toBe(503);
    await env.DB.prepare('UPDATE app_state SET schema_version=2 WHERE id=1').run();
  });

  it('rejects a write if restore invalidates its session after HTTP authorization but before SQL commits', async () => {
    const auth = await signIn();
    const racedDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          // Emulate restore committing in the interval after authorize() and
          // sessionInfo() but immediately before the API's atomic write batch.
          await target.prepare('DELETE FROM auth_sessions').run();
          return target.batch(statements);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const headers = new Headers({ 'content-type':'application/json','x-tuinapp-request':'1','x-csrf-token':auth.csrf,origin,cookie:auth.cookie });
    const request = new Request('https://tuin.test/api/plants',{method:'POST',headers,body:JSON.stringify(plant())});
    const response = await handleApi(request,{...env,DB:racedDb});
    expect(response.status).toBe(409);
    expect(await env.DB.prepare('SELECT count(*) AS count FROM plants').first<{count:number}>()).toMatchObject({count:0});
  });

  it('preserves plant/activity CRUD, revision conflicts, validation, and calendar masks', async () => {
    const auth = await signIn();
    const createdResponse = await call('/api/plants', 'POST', withAuth(auth, plant()));
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json() as { id: number; revision: number };
    expect(created.revision).toBe(1);
    const path = `/api/plants/${created.id}`;
    const current = (await (await call('/api/plants', 'GET', withAuth(auth))).json() as Record<string, unknown>[])[0];
    const update = { ...current, notes: 'Edited from screen A' };
    const updatedResponse = await call(path, 'PUT', withAuth(auth, update));
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json() as { revision: number }).revision).toBe(2);
    expect((await call(path, 'PUT', withAuth(auth, update))).status).toBe(409);
    expect((await call(`${path}/reorder`, 'PUT', withAuth(auth, { needs_reorder: false, revision: 1 }))).status).toBe(409);
    expect((await call(`${path}/reorder`, 'PUT', withAuth(auth, { needs_reorder: false, revision: 2 }))).status).toBe(200);
    expect((await call('/api/months/0', 'GET', withAuth(auth))).status).toBe(400);
    expect((await call('/api/months/13', 'GET', withAuth(auth))).status).toBe(400);
    const january = await (await call('/api/months/1', 'GET', withAuth(auth))).json() as { sow_early: unknown[] };
    expect(january.sow_early).toHaveLength(1);
    const december = await (await call('/api/months/12', 'GET', withAuth(auth))).json() as { plant_late: unknown[] };
    expect(december.plant_late).toHaveLength(1);
    expect((await call('/api/plants', 'POST', withAuth(auth, { ...plant(), name: '  ' }))).status).toBe(400);
    expect((await call(path, 'DELETE', withAuth(auth, { revision: 2 }))).status).toBe(409);
    expect((await call(path, 'DELETE', withAuth(auth, { revision: 3 }))).status).toBe(204);
    expect((await call(path, 'DELETE', withAuth(auth, { revision: 3 }))).status).toBe(404);

    const activityResponse = await call('/api/activities', 'POST', withAuth(auth, { name: 'Prune', active_periods: 3 }));
    expect(activityResponse.status).toBe(200);
    const activity = await activityResponse.json() as Record<string, unknown>;
    const activityPath = `/api/activities/${activity.id}`;
    expect((await call(activityPath, 'PUT', withAuth(auth, { ...activity, description: 'After frost' }))).status).toBe(200);
    expect((await call(activityPath, 'PUT', withAuth(auth, activity))).status).toBe(409);
    expect((await call(activityPath, 'DELETE', withAuth(auth, { revision: 2 }))).status).toBe(204);
  });

  it('keeps removed photo and spreadsheet endpoints unavailable and attaches security headers', async () => {
    const auth = await signIn();
    const created = await (await call('/api/plants', 'POST', withAuth(auth, plant()))).json() as { id: number };
    await env.DB.prepare('INSERT INTO plant_photos(plant_id,sort_order,image_data) VALUES(?,?,?)').bind(created.id, 1, new Uint8Array([1, 2, 3])).run();
    for (const [method, path] of [
      ['GET', `/api/plants/${created.id}/photos`], ['POST', `/api/plants/${created.id}/photos`],
      ['GET', '/api/photos/1/image'], ['DELETE', '/api/photos/1'],
      ['POST', '/api/imports/preview'], ['POST', '/api/imports/tsv'],
    ]) expect((await call(path, method, withAuth(auth, { content: 'sample' }))).status).toBe(404);
    const photos = await env.DB.prepare('SELECT count(*) AS count FROM plant_photos').first<{ count: number }>();
    expect(photos?.count).toBe(1);
    const read = await call('/api/plants', 'GET', withAuth(auth));
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(read.headers.get('x-frame-options')).toBe('DENY');
  });

  it('returns month data for browser-side PDF rendering without spending Worker CPU on PDF layout', async () => {
    const auth = await signIn();
    await call('/api/plants', 'POST', withAuth(auth, plant()));
    const response = await call('/api/months/1/pdf-data', 'GET', withAuth(auth));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    const pdfData = await response.json() as { sow_early: unknown[] };
    expect(pdfData.sow_early).toHaveLength(1);
    expect((await call('/api/months/1/pdf', 'GET', withAuth(auth))).status).toBe(404);
  });

  it('allows ten incorrect proofs in a minute and blocks the eleventh attempt', async () => {
    const wrongProof = 'A'.repeat(43); // Canonical base64url for 32 zero bytes.
    for (let attempt = 1; attempt <= 10; attempt++) {
      const response = await call('/api/login', 'POST', { body: { proof: wrongProof }, originHeader: origin });
      expect(response.status, `wrong proof ${attempt}`).toBe(401);
    }
    const blocked = await call('/api/login', 'POST', { body: { proof: wrongProof }, originHeader: origin });
    expect(blocked.status).toBe(429);
    expect(await env.DB.prepare('SELECT attempts FROM auth_attempts').first<{attempts:number}>()).toMatchObject({ attempts: 11 });
  });
});
