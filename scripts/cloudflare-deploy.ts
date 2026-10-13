/** GitHub production rollout. Credentials are supplied only through environment variables. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be configured before production deployment`);
  return value;
}
function run(args: string[], capture = false, cwd?: string): string {
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Cloudflare command failed: ${args.slice(0, 3).join(' ')}${capture ? `\n${result.stderr}` : ''}`);
  return result.stdout ?? '';
}
export function deploy(env: NodeJS.ProcessEnv = process.env, runCommand = run, root = process.cwd()): void {
const path = (...parts: string[]) => resolve(root, ...parts);
const databaseId = required('CLOUDFLARE_D1_DATABASE_ID', env);
const project = required('CLOUDFLARE_PAGES_PROJECT', env);
const bucket = required('CLOUDFLARE_R2_BUCKET', env);
const account = required('CLOUDFLARE_ACCOUNT_ID', env);
required('CLOUDFLARE_API_TOKEN', env);
const origin = required('TUINAPP_PUBLIC_ORIGIN', env);
if (!/^[a-f0-9-]{36}$/i.test(databaseId) || !/^[a-f0-9]{32}$/i.test(account)) throw new Error('Invalid Cloudflare account/database identifier');
if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(project) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid Pages project or R2 bucket name');
if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Production origin must be an HTTPS origin without a trailing slash');

const schemaFiles = readdirSync(path('cloudflare/migrations')).filter(f => /^\d+.*\.sql$/.test(f)).sort();
const checksums = JSON.parse(readFileSync(path('cloudflare/migration-checksums.json'), 'utf8')) as Record<string,string>;
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
for (const file of schemaFiles) if (sha(path('cloudflare/migrations', file)) !== checksums[file]) throw new Error(`Migration checksum mismatch: ${file}`);
if (schemaFiles.length !== Object.keys(checksums).length) throw new Error('Migration files and checksum manifest differ');

const scratch = mkdtempSync(join(tmpdir(), 'tuinapp-deploy-'));
const pagesConfig = join(scratch, 'wrangler.jsonc');
const cronConfig = join(scratch, 'wrangler.scheduler.jsonc');
try {
  cpSync(path('dist'), join(scratch, 'dist'), { recursive: true });
  cpSync(path('cloudflare/migrations'), join(scratch, 'migrations'), { recursive: true });
  writeFileSync(pagesConfig, JSON.stringify({ name: project, pages_build_output_dir: './dist', compatibility_date: '2026-10-01',
    d1_databases: [{ binding: 'DB', database_name: project, database_id: databaseId, migrations_dir: 'migrations' }],
    r2_buckets: [{ binding: 'BACKUPS', bucket_name: bucket }], vars: { TUINAPP_PUBLIC_ORIGIN: origin },
  }, null, 2), { mode: 0o600, flag: 'wx' });
  writeFileSync(cronConfig, JSON.stringify({ name: `${project}-backups`, main: path('cloudflare/scheduler.ts'), compatibility_date: '2026-10-01', workers_dev: false,
    triggers: { crons: ['15 2 * * *'] },
    d1_databases: [{ binding: 'DB', database_name: project, database_id: databaseId, migrations_dir: 'migrations' }],
    r2_buckets: [{ binding: 'BACKUPS', bucket_name: bucket }],
  }, null, 2), { mode: 0o600, flag: 'wx' });
  const query = (sql: string) => {
    const result = JSON.parse(runCommand(['d1', 'execute', 'DB', '--config', pagesConfig, '--remote', '--command', sql, '--json'], true)) as { success: boolean; results: Record<string,unknown>[] }[];
    if (!Array.isArray(result) || result.some(r => !r.success)) throw new Error('D1 preflight query failed');
    return result.flatMap(r => r.results);
  };
  // Initial provisioning/import is deliberate, separate from subsequent push deployments.
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_state','d1_migrations')");
  if (tables.length !== 2) throw new Error('Production D1 must be initialized and imported first; follow docs/cloudflare-operations.md');
  const ledger = query('SELECT name FROM d1_migrations ORDER BY id').map(row => row.name);
  if (ledger.some((name, index) => name !== schemaFiles[index]) || ledger.length > schemaFiles.length) throw new Error('Remote migration history is not an exact prefix of this release; refusing rollout');
  const release = (env.GITHUB_SHA ?? createHash('sha256').update(readFileSync(path('dist/_worker.js'))).digest('hex')).slice(0, 40);
  if (!/^[a-f0-9]{7,40}$/i.test(release)) throw new Error('Invalid release revision');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const key = `releases/${stamp}-${release}.sql`;
  const dump = join(scratch, 'before-deploy.sql');
  const readback = join(scratch, 'verified.sql');
  runCommand(['d1', 'export', 'DB', '--config', pagesConfig, '--remote', '--output', dump]);
  if (readFileSync(dump).byteLength === 0) throw new Error('D1 export was empty');
  runCommand(['r2', 'object', 'put', `${bucket}/${key}`, '--remote', '--file', dump, '--content-type', 'application/sql']);
  runCommand(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--file', readback]);
  if (sha(dump) !== sha(readback)) throw new Error('Pre-deployment recovery dump failed R2 read-back verification');
  console.log(`Verified pre-deployment recovery dump: ${key}`);
  runCommand(['d1', 'migrations', 'apply', 'DB', '--config', pagesConfig, '--remote']);
  // Pages requires a standard config filename in its working directory.
  runCommand(['pages', 'deploy', 'dist', '--project-name', project, '--branch', 'main', '--commit-hash', release, '--commit-dirty=true'], false, scratch);
  runCommand(['deploy', '--config', cronConfig]);
  console.log('Site and daily backup Worker deployed. Check Cloudflare deployment status and the production health endpoint.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(pagesConfig, { force: true });
  rmSync(cronConfig, { force: true });
}

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) deploy();
