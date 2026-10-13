import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function sha(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
const schemaFiles = readdirSync(resolve('cloudflare/migrations'))
  .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/iu.test(name))
  .sort();

function verifyMigrations(): void {
  const manifest = JSON.parse(readFileSync(resolve('cloudflare/migration-checksums.json'), 'utf8')) as Record<string, string>;
  for (const name of schemaFiles) {
    const actual = sha(readFileSync(resolve('cloudflare/migrations', name)));
    if (manifest[name] !== actual) throw new Error(`Released Cloudflare migration checksum changed: ${name}`);
  }
  if (Object.keys(manifest).length !== schemaFiles.length) throw new Error('Cloudflare migration checksum manifest has unknown entries');
  process.stdout.write('Cloudflare migration checksums verified.\n');
}

if (process.argv[2] === 'verify-migrations') verifyMigrations();
else {
  process.stderr.write('Usage: node scripts/cloudflare-data.ts verify-migrations\n');
  process.exitCode = 2;
}
