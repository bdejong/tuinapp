import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { createPasswordHash } from '../cloudflare/auth';
import { scheduledBackup } from '../cloudflare/backups';
import { parseDump, type Dataset, type TableName, TABLES } from '../cloudflare/dump';
import type { Env } from '../cloudflare/types';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const port = Number(process.env.TUINAPP_E2E_PORT ?? 4173);
const root = resolve(process.cwd());
const dist = resolve(root, 'dist');
const scratch = mkdtempSync(join(tmpdir(), 'tuinapp-cloudflare-e2e-'));
const workerBuild = await build({ entryPoints: ['cloudflare/pages.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
const workerCode = workerBuild.outputFiles[0].text;
const password = 'tuinapp-browser-test-only-password';
const passwordHash = await createPasswordHash(password);
const secret = 'e2e-session-secret-with-at-least-32-bytes-long';
const mime: Record<string,string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json', '.woff2':'font/woff2' };
function serveAsset(request: Request): Response {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\0') || pathname.split('/').includes('..')) return new Response('Not found', {status:404});
  if (pathname === '/') pathname = '/index.html';
  let filename = resolve(dist, `.${pathname}`);
  if (!filename.startsWith(`${dist}${sep}`)) return new Response('Not found', {status:404});
  try { if (!statSync(filename).isFile()) throw new Error('not file'); }
  catch { filename = join(dist, 'index.html'); }
  try { return new Response(readFileSync(filename), { headers: { 'content-type': mime[extname(filename)] ?? 'application/octet-stream', 'cache-control':'no-store' } }); }
  catch { return new Response('Build the web application before running browser tests.', {status:503}); }
}

const mf = new Miniflare({
  host: '127.0.0.1', port,
  resourcePersistencePath: join(scratch,'storage'),
  workers: [{ config: {
    name: 'tuinapp-e2e', compatibilityDate: '2026-10-01',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: workerCode } } },
    env: {
      DB: {type:'d1',name:'tuinapp-e2e'}, BACKUPS:{type:'r2',name:'tuinapp-e2e'},
      ASSETS:{type:'fetcher',handler:serveAsset},
      TUINAPP_PASSWORD_HASH:{type:'text',value:passwordHash},
      TUINAPP_SESSION_SECRET:{type:'text',value:secret},
      TUINAPP_PUBLIC_ORIGIN:{type:'text',value:`http://127.0.0.1:${port}`},
    },
  }}],
});

function statements(sql: string): string[] {
  return sql.split(/;\s*(?=(?:CREATE|UPDATE|INSERT|ALTER|DROP|DELETE)\b)/iu).map(part=>part.trim().replace(/;$/u,'')).filter(Boolean);
}
async function loadDataset(db: D1Database, dataset: Dataset) {
  for (const table of Object.keys(TABLES) as TableName[]) {
    const columns = TABLES[table];
    const batches: D1PreparedStatement[][] = [];
    for (let i=0;i<dataset[table].length;i+=40) {
      batches.push(dataset[table].slice(i,i+40).map(row=>db.prepare(`INSERT INTO "${table}" (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...columns.map(c=>row[c]))));
    }
    for (const batch of batches) if (batch.length) await db.batch(batch);
  }
  for (const row of dataset.sqlite_sequence) {
    await db.prepare('DELETE FROM sqlite_sequence WHERE name=?').bind(row.name).run();
    await db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').bind(row.name,row.seq).run();
  }
}
async function main() {
  const env: Env = {
    DB: await mf.getD1Database('DB','tuinapp-e2e') as unknown as D1Database,
    BACKUPS: await mf.getR2Bucket('BACKUPS','tuinapp-e2e') as unknown as R2Bucket,
    TUINAPP_PASSWORD_HASH: passwordHash, TUINAPP_SESSION_SECRET: secret,
    TUINAPP_PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,
  };
  for (const file of ['0001_initial.sql','0002_data_generation.sql']) {
    const sql = readFileSync(resolve(root,'cloudflare/migrations',file),'utf8');
    for (const statement of statements(sql)) await env.DB.prepare(statement).run();
  }
  const golden = process.env.TUINAPP_GOLDEN_DB;
  if (golden) {
    const output = join(scratch,'converted-golden');
    const conversion = spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cloudflare-data.ts','convert-golden',resolve(golden),output],{cwd:root,encoding:'utf8'});
    if (conversion.status !== 0) throw new Error(`Read-only golden conversion failed: ${conversion.stderr || conversion.stdout}`);
    const dump = readFileSync(join(output,'tuinapp-golden.sql'),'utf8');
    await loadDataset(env.DB,parseDump(dump).dataset);
  }
  await scheduledBackup(env);
  await mf.ready;
  process.stdout.write(`Cloudflare e2e Worker listening at http://127.0.0.1:${port}\n`);
}

try { await main(); }
catch (error) { await mf.dispose(); rmSync(scratch,{recursive:true,force:true}); throw error; }
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,async()=>{ await mf.dispose(); rmSync(scratch,{recursive:true,force:true}); process.exit(0); });
