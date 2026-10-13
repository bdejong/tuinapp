import type { Env } from './types';

const PBKDF2_ITERATIONS = 600_000;
const SESSION_SECONDS = 12 * 60 * 60;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Hash a password for TUINAPP_PASSWORD_HASH. Run this in a trusted local environment. */
export async function createPasswordHash(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  if (!password || new TextEncoder().encode(password).byteLength > 1024) throw new Error('Password must be 1–1024 UTF-8 bytes');
  if (!Number.isInteger(iterations) || iterations !== PBKDF2_ITERATIONS) throw new Error('PBKDF2 iterations are fixed at 600000');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, iterations);
  const verifier = new Uint8Array(await crypto.subtle.digest('SHA-256', derived));
  return `tuinapp-login-v1$pbkdf2-sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(verifier)}`;
}

function parsePasswordHash(encoded: string): { iterations: number; salt: Uint8Array; verifier: Uint8Array } | null {
  const parts = encoded.split('$');
  if (parts.length !== 5 || parts[0] !== 'tuinapp-login-v1' || parts[1] !== 'pbkdf2-sha256') return null;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations !== PBKDF2_ITERATIONS) return null;
  let salt: Uint8Array;
  let verifier: Uint8Array;
  try { salt = fromBase64Url(parts[3]); verifier = fromBase64Url(parts[4]); } catch { return null; }
  if (salt.byteLength !== 16 || verifier.byteLength !== 32) return null;
  return { iterations, salt, verifier };
}

export function loginParameters(env: Env): Response {
  const parsed = parsePasswordHash(env.TUINAPP_PASSWORD_HASH);
  if (!parsed) return json({ error: 'Sign-in is not configured correctly.' }, 503);
  return json({ version: 1, algorithm: 'PBKDF2-SHA-256', salt: toBase64Url(parsed.salt), iterations: parsed.iterations }, 200);
}

async function verifyProof(proof: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  let supplied: Uint8Array;
  try { supplied = fromBase64Url(proof); } catch { return false; }
  if (supplied.byteLength !== 32 || toBase64Url(supplied) !== proof) return false;
  const actual = new Uint8Array(await crypto.subtle.digest('SHA-256', supplied));
  let mismatch = 0;
  for (let i = 0; i < parsed.verifier.length; i++) mismatch |= parsed.verifier[i] ^ actual[i];
  return mismatch === 0;
}

function randomToken(size: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function sessionKey(env: Env): Promise<CryptoKey> {
  const secret = env.TUINAPP_SESSION_SECRET;
  if (typeof secret !== 'string' || new TextEncoder().encode(secret).byteLength < 32) throw new Error('TUINAPP_SESSION_SECRET must contain at least 32 bytes');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function tokenHash(token: string, env: Env): Promise<string> {
  const key = await sessionKey(env);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))));
}

export function sessionCookie(request: Request): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('tuinapp_session=')) return trimmed.slice('tuinapp_session='.length) || null;
  }
  return null;
}

export async function login(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > 4096) return json({ error: 'Sign-in request is too large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'Invalid JSON body' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ error: 'Sign-in request is too large' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const proof = body && typeof body === 'object' ? (body as { proof?: unknown }).proof : undefined;
  if (typeof proof !== 'string' || proof.length !== 43 || !/^[A-Za-z0-9_-]{43}$/u.test(proof)) return json({ error: 'Invalid sign-in proof' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const bucket = await sha256(ip);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM auth_attempts WHERE window_started_at<=?').bind(now - 60).run();
  await env.DB.prepare(`INSERT INTO auth_attempts(bucket,window_started_at,attempts) VALUES(?,?,1)
    ON CONFLICT(bucket) DO UPDATE SET
      attempts=CASE WHEN auth_attempts.window_started_at <= ? THEN 1 ELSE auth_attempts.attempts+1 END,
      window_started_at=CASE WHEN auth_attempts.window_started_at <= ? THEN excluded.window_started_at ELSE auth_attempts.window_started_at END`)
    .bind(bucket, now, now - 60, now - 60).run();
  const rate = await env.DB.prepare('SELECT attempts,window_started_at FROM auth_attempts WHERE bucket=?').bind(bucket).first<{ attempts: number; window_started_at: number }>();
  if (rate && rate.window_started_at > now - 60 && rate.attempts > 10) return json({ error: 'Too many attempts. Try again in a minute.' }, 429);

  let valid = false;
  try { valid = await verifyProof(proof, env.TUINAPP_PASSWORD_HASH); } catch { valid = false; }
  if (!valid) return json({ error: 'Please sign in.' }, 401);
  await env.DB.prepare('DELETE FROM auth_attempts WHERE bucket=?').bind(bucket).run();
  const issued = await issueSession(env);
  return json({ csrf_token: issued.csrf, restore_epoch: issued.restoreEpoch }, 200, { 'set-cookie': issued.cookie });
}

export async function sessionInfo(request: Request, env: Env): Promise<{ csrf: string; restoreEpoch: number; tokenHash: string } | null> {
  const token = sessionCookie(request);
  if (!token) return null;
  const hash = await tokenHash(token, env);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT s.csrf_token,s.restore_epoch FROM auth_sessions s JOIN app_state a ON a.id=1
    WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch`).bind(hash, now).first<{ csrf_token: string; restore_epoch: number }>();
  return row ? { csrf: row.csrf_token, restoreEpoch: row.restore_epoch, tokenHash: hash } : null;
}

export async function sessionCsrf(request: Request, env: Env): Promise<string | null> {
  return (await sessionInfo(request, env))?.csrf ?? null;
}

export async function issueSession(env: Env): Promise<{ csrf: string; cookie: string; restoreEpoch: number }> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Math.floor(Date.now() / 1000);
  const state = await env.DB.prepare('SELECT restore_epoch FROM app_state WHERE id=1').first<{ restore_epoch: number }>();
  if (!state) throw new Error('Database is not initialized');
  const hash = await tokenHash(token, env);
  await env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').bind(now).run();
  await env.DB.prepare('INSERT INTO auth_sessions(token_hash,csrf_token,expires_at,restore_epoch) VALUES(?,?,?,?)').bind(hash, csrf, now + SESSION_SECONDS, state.restore_epoch).run();
  const secure = (env.TUINAPP_PUBLIC_ORIGIN ?? '').startsWith('https://') ? '; Secure' : '';
  return { csrf, restoreEpoch: state.restore_epoch, cookie: `tuinapp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}` };
}

export async function authorize(request: Request, env: Env): Promise<boolean> {
  const csrf = await sessionCsrf(request, env);
  if (!csrf) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  return request.headers.get('x-csrf-token') === csrf;
}

/** An SQL guard for a mutation, evaluated in the same D1 batch as the mutation itself. */
export function mutationSessionGuard(env: Env, tokenHash: string): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO transaction_assertions(ok)
    SELECT CASE WHEN EXISTS(SELECT 1 FROM auth_sessions s JOIN app_state a ON a.id=1
      WHERE s.token_hash=? AND s.expires_at>? AND s.restore_epoch=a.restore_epoch) THEN 1 ELSE 0 END`)
    .bind(tokenHash, Math.floor(Date.now() / 1000));
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = sessionCookie(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await tokenHash(token, env)).run();
  return new Response(null, { status: 204, headers: { 'set-cookie': 'tuinapp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' } });
}

async function sha256(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
