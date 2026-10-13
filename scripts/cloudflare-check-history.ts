/** CI guard: adding migrations is allowed; editing/removing migrations from the base is not. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const base = process.argv[2];
if (!base || !/^[a-f0-9]{40,64}$/i.test(base)) throw new Error('Supply the base Git commit SHA');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', 'cloudflare/migrations'], { encoding: 'utf8' }).trim().split('\n').filter(f => f.endsWith('.sql'));
for (const file of files) {
  const previous = execFileSync('git', ['show', `${base}:${file}`]);
  const current = readFileSync(file);
  if (!current.equals(previous)) throw new Error(`Published migration changed: ${file}. Add a new migration instead.`);
}
console.log(`Verified ${files.length} existing migrations are unchanged.`);
