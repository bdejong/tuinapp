import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { CURRENT_SCHEMA_VERSION, parseBackup } from '../cloudflare/dump.ts';
import { buildRestoreSql } from '../cloudflare/restore.ts';

type Runner = (args: string[], sensitive?: boolean) => string;
type Config = { name?: string; d1_databases?: { binding?: string; database_name?: string; database_id?: string }[]; r2_buckets?: { binding?: string; bucket_name?: string }[] };
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const schemaDir = resolve('cloudflare/migrations');

function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function runCloudflare(args: string[], sensitive = false, cwd = process.cwd()): string {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status !== 0) throw new Error(sensitive ? 'Sensitive Cloudflare command failed; output was suppressed.' : `Cloudflare command failed (${args.slice(0, 3).join(' ')}): ${result.stderr.slice(0, 1000)}`);
  return result.stdout ?? '';
}

function jsonRows(stdout: string): Record<string, unknown>[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (Array.isArray(parsed)) return parsed.flatMap((entry) => {
    const item = entry as { success?: boolean; results?: Record<string, unknown>[] };
    if (item.success === false) throw new Error('D1 preflight query failed.');
    return item.results ?? [];
  });
  const result = parsed as { success?: boolean; result?: { success?: boolean; results?: Record<string, unknown>[] }[] };
  if (result.success === false || result.result?.some((item) => item.success === false)) throw new Error('D1 preflight query failed.');
  return result.result?.flatMap((item) => item.results ?? []) ?? [];
}

function listMigrations(): { files: string[]; hashes: Record<string, string> } {
  const names = readdirSync(schemaDir).filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/iu.test(name)).sort();
  const manifest = JSON.parse(readFileSync('cloudflare/migration-checksums.json', 'utf8')) as Record<string, string>;
  const hashes: Record<string, string> = {};
  for (const name of names) {
    hashes[name] = sha(readFileSync(join(schemaDir, name)));
    if (manifest[name] !== hashes[name]) throw new Error(`Released migration checksum mismatch: ${name}`);
  }
  if (!names.length || names.length !== Object.keys(manifest).length) throw new Error('Migration files and checksum manifest differ.');
  return { files: names, hashes };
}

function loadProductionConfig(path: string): { config: Config; database: string; bucket: string; configPath: string } {
  const configPath = resolve(path);
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
  const dbs = config.d1_databases ?? [];
  const buckets = config.r2_buckets ?? [];
  const db = dbs.find((item) => item.binding === 'DB');
  const bucket = buckets.find((item) => item.binding === 'BACKUPS');
  if (config.name !== 'tuinapp' || dbs.length !== 1 || db?.database_name !== 'tuinapp' || !/^[a-f0-9-]{36}$/i.test(db.database_id ?? '') || buckets.length !== 1 || bucket?.bucket_name !== 'tuinapp-backups') {
    throw new Error('Restore requires the explicit production wrangler.jsonc config for tuinapp and tuinapp-backups.');
  }
  return { config, database: db.database_name, bucket: bucket.bucket_name, configPath };
}

function flags(argv: string[]): { input: string; config: string; confirmed: boolean } {
  let input = '', config = '', confirmed = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--config') config = argv[++i] ?? '';
    else if (arg === '--confirm-restore') confirmed = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!input) input = arg;
    else throw new Error('Specify one backup file.');
  }
  if (!input || !config || !confirmed) throw new Error('Usage: cloudflare-restore <downloaded-backup.json|legacy-backup.sql> --config wrangler.jsonc --confirm-restore');
  return { input, config, confirmed };
}

async function exactConfirm(database: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error(`Interactive confirmation is required: run in a terminal and type RESTORE ${database}.`);
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  let input: string;
  try {
    input = await terminal.question(`This replaces all garden data in production database ${database}. Type RESTORE ${database} to continue: `);
  } finally { terminal.close(); }
  if (input !== `RESTORE ${database}`) throw new Error('Restore confirmation did not match; no changes were made.');
}

export async function restoreDownloadedBackup(argv: string[], run: Runner = runCloudflare, confirm: (database: string) => Promise<void> = exactConfirm): Promise<{ recoveryKey: string; generation: number }> {
  const args = flags(argv);
  const { database, bucket, configPath } = loadProductionConfig(args.config);
  await confirm(database);

  const sourceBytes = readFileSync(resolve(args.input));
  const sourceText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
  const parsed = await parseBackup(sourceText);
  const { files: migrations } = listMigrations();
  const configArgs = ['--config', configPath, '--remote'];
  const stateRows = jsonRows(run(['d1', 'execute', database, ...configArgs, '--command', 'SELECT schema_version,generation,restore_epoch FROM app_state WHERE id=1', '--json']));
  if (stateRows.length !== 1) throw new Error('Production D1 app_state is missing or ambiguous.');
  const state = stateRows[0] as { schema_version: number; generation: number; restore_epoch: number };
  if (state.schema_version !== CURRENT_SCHEMA_VERSION || !Number.isSafeInteger(state.generation) || !Number.isSafeInteger(state.restore_epoch)) throw new Error('Production D1 schema or restore state is not supported.');
  const ledger = jsonRows(run(['d1', 'execute', database, ...configArgs, '--command', 'SELECT name FROM d1_migrations ORDER BY id', '--json'])).map((row) => String(row.name));
  if (JSON.stringify(ledger) !== JSON.stringify(migrations)) throw new Error('Production D1 migration ledger is not an exact match for this release.');
  const importSql = buildRestoreSql(parsed.dataset, { schemaVersion: state.schema_version, generation: state.generation, restoreEpoch: state.restore_epoch }, migrations);

  const scratch = mkdtempSync(join(tmpdir(), 'tuinapp-restore-'));
  const nativeExport = join(scratch, 'native-before-restore.sql');
  const readback = join(scratch, 'verified-before-restore.sql');
  const generated = join(scratch, 'validated-restore.sql');
  const recoveryKey = `releases/manual-restore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sql`;
  try {
    writeFileSync(generated, importSql, { flag: 'wx', mode: 0o600 });
    // Wrangler's native export emits a temporary signed download URL in logs. Keep all output suppressed.
    run(['d1', 'export', database, ...configArgs, '--output', nativeExport], true);
    const nativeBytes = readFileSync(nativeExport);
    if (!nativeBytes.byteLength) throw new Error('Native D1 pre-restore export is empty.');
    run(['r2', 'object', 'put', `${bucket}/${recoveryKey}`, '--config', configPath, '--remote', '--file', nativeExport, '--content-type', 'application/sql']);
    run(['r2', 'object', 'get', `${bucket}/${recoveryKey}`, '--config', configPath, '--remote', '--file', readback]);
    if (sha(nativeBytes) !== sha(readFileSync(readback))) throw new Error(`Pre-restore R2 recovery failed read-back verification (${recoveryKey}).`);
    try {
      run(['d1', 'execute', database, ...configArgs, '--file', generated], true);
    } catch {
      throw new Error(`D1 import failed or its completion could not be confirmed. Inspect production before retrying; verified recovery is in R2 at ${recoveryKey}.`);
    }
    let verifiedGeneration: number | null = null;
    try {
      const checkRows = jsonRows(run(['d1', 'execute', database, ...configArgs, '--command', 'SELECT schema_version,generation,restore_epoch,(SELECT count(*) FROM plants) AS plants,(SELECT count(*) FROM activities) AS activities,(SELECT count(*) FROM imports) AS imports FROM app_state WHERE id=1', '--json']));
      const verified = checkRows[0] as { schema_version: number; generation: number; restore_epoch: number; plants: number; activities: number; imports: number } | undefined;
      if (!verified || verified.schema_version !== state.schema_version || verified.generation !== state.generation + 1 || verified.restore_epoch !== state.restore_epoch + 1 || verified.plants !== parsed.dataset.plants.length || verified.activities !== parsed.dataset.activities.length || verified.imports !== parsed.dataset.imports.length) throw new Error('Counts or restore metadata did not match the validated input.');
      if (jsonRows(run(['d1', 'execute', database, ...configArgs, '--command', 'PRAGMA foreign_key_check', '--json'])).length) throw new Error('Foreign key check returned violations.');
      const sequences = jsonRows(run(['d1', 'execute', database, ...configArgs, '--command', "SELECT name,seq FROM sqlite_sequence WHERE name IN ('plants','activities') ORDER BY name", '--json']));
      const expectedSequences = [...parsed.dataset.sqlite_sequence].sort((a, b) => a.name.localeCompare(b.name));
      if (JSON.stringify(sequences) !== JSON.stringify(expectedSequences)) throw new Error('SQLite sequence values did not match the validated input.');
      verifiedGeneration = verified.generation;
    } catch {
      throw new Error(`Import completed but post-restore verification could not be confirmed. Inspect production; verified recovery is in R2 at ${recoveryKey}.`);
    }
    return { recoveryKey, generation: verifiedGeneration! };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('Usage: ./scripts/cloudflare-restore.sh BACKUP.json --config wrangler.jsonc --confirm-restore\n\nRequires a terminal confirmation phrase before writing. The command validates the backup file, stores a verified native D1 export in private R2, then imports generated canonical SQL.\n');
  } else {
  try {
    const result = await restoreDownloadedBackup(process.argv.slice(2));
    process.stdout.write(`Restore verified at generation ${result.generation}. Recovery copy: ${result.recoveryKey}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Restore failed.'}\n`);
    process.exitCode = 1;
  }
  }
}
