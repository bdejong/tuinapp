import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { deploy } from '../../scripts/cloudflare-deploy';

let root: string;
const env = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'test-only', CLOUDFLARE_D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000', CLOUDFLARE_PAGES_PROJECT: 'tuinapp', CLOUDFLARE_R2_BUCKET: 'tuinapp-backups', TUINAPP_PUBLIC_ORIGIN: 'https://tuin.example.test', GITHUB_SHA: 'b'.repeat(40) };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tuinapp-release-test-'));
  mkdirSync(join(root, 'dist')); mkdirSync(join(root, 'cloudflare/migrations'), { recursive: true });
  writeFileSync(join(root, 'dist/_worker.js'), 'export default {}');
  writeFileSync(join(root, 'cloudflare/scheduler.ts'), 'export default {}');
  const sql = 'CREATE TABLE test(id INTEGER);';
  writeFileSync(join(root, 'cloudflare/migrations/0001_initial.sql'), sql);
  writeFileSync(join(root, 'cloudflare/migration-checksums.json'), JSON.stringify({ '0001_initial.sql': createHash('sha256').update(sql).digest('hex') }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks(); });
function fakeRunner(options: { corrupt?: boolean; failUpload?: boolean; futureLedger?: boolean } = {}) {
  const calls: string[][] = [];
  let staging: string | undefined;
  const run = (args: string[], _capture = false, cwd?: string): string => {
    calls.push(args);
    if (args[0] === 'd1' && args[1] === 'execute') {
      const sql = args[args.indexOf('--command') + 1];
      const results = sql.includes('sqlite_master') ? [{ name: 'app_state' }, { name: 'd1_migrations' }] : [{ name: options.futureLedger ? '9999_future.sql' : '0001_initial.sql' }];
      return JSON.stringify([{ success: true, results }]);
    }
    if (args[1] === 'export') writeFileSync(args[args.indexOf('--output') + 1], 'verified native SQL dump');
    if (args[0] === 'r2' && args[2] === 'put' && options.failUpload) throw new Error('R2 unavailable');
    if (args[0] === 'r2' && args[2] === 'get') writeFileSync(args[args.indexOf('--file') + 1], options.corrupt ? 'corrupt' : 'verified native SQL dump');
    if (args[0] === 'pages') {
      expect(args).not.toContain('--config'); expect(cwd).toBeDefined(); staging = cwd;
      const config = JSON.parse(readFileSync(join(cwd!, 'wrangler.jsonc'), 'utf8'));
      expect(config.d1_databases[0].database_id).toBe(env.CLOUDFLARE_D1_DATABASE_ID);
      expect(existsSync(join(cwd!, 'dist/_worker.js'))).toBe(true);
    }
    return '';
  };
  return { run, calls, get staging() { return staging; } };
}
it('verifies offsite export before migration and uses supported Pages config discovery', () => {
  const runner = fakeRunner(); deploy(env, runner.run, root);
  const operations = runner.calls.map(args => args.slice(0, 3).join(' '));
  expect(operations.indexOf('r2 object get')).toBeLessThan(operations.indexOf('d1 migrations apply'));
  expect(operations.indexOf('d1 migrations apply')).toBeLessThan(operations.indexOf('pages deploy dist'));
  expect(existsSync(runner.staging!)).toBe(false);
});
it.each([{ corrupt: true }, { failUpload: true }, { futureLedger: true }])('does not migrate or deploy after failed recovery/preflight: %j', options => {
  const runner = fakeRunner(options); expect(() => deploy(env, runner.run, root)).toThrow();
  expect(runner.calls.some(args => args[1] === 'migrations' || args[0] === 'pages' || args[0] === 'deploy')).toBe(false);
});
it('refuses changed migration files before contacting Cloudflare', () => {
  writeFileSync(join(root, 'cloudflare/migrations/0001_initial.sql'), 'DROP TABLE test;');
  const run = vi.fn(); expect(() => deploy(env, run, root)).toThrow('checksum mismatch'); expect(run).not.toHaveBeenCalled();
});
