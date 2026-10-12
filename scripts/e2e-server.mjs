import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// This server only binds loopback and always uses disposable test data.
const directory = mkdtempSync(join(tmpdir(), 'tuinapp-browser-test-'));
const binary = resolve('target/debug/tuinapp-server');
const database = join(directory, 'web.sqlite');
const command = process.env.TUINAPP_GOLDEN_DB ? ['import', '--source', process.env.TUINAPP_GOLDEN_DB, '--database', database] : ['init', '--database', database];
const seed = spawnSync(binary, command, { stdio: 'inherit' });
if (seed.status !== 0) { rmSync(directory, { recursive: true, force: true }); process.exit(1); }
const hash = spawnSync(binary, ['hash-password', '--stdin'], { input: 'tuinapp-browser-test-only-password', encoding: 'utf8' });
if (hash.status !== 0) throw new Error('Could not initialize test login');
const child = spawn(binary, ['serve', '--database', database, '--backup-dir', join(directory, 'backups'), '--bind', '127.0.0.1:4173', '--public-origin', 'http://127.0.0.1:4173'], { env: { ...process.env, TUINAPP_PASSWORD_HASH: hash.stdout.trim() }, stdio: 'inherit' });
let stopping = false;
function stop() { if (!stopping) { stopping = true; child.kill('SIGINT'); } }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exit(stopping ? 0 : code ?? 1); });
