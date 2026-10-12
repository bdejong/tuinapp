import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const env = { ...process.env };
let cargo = 'cargo';
if (spawnSync(cargo, ['--version'], { stdio: 'ignore' }).error) {
  const cached = join(homedir(), '.cache/tuinapp-toolchain');
  if (existsSync(join(cached, 'cargo/bin/cargo'))) {
    cargo = join(cached, 'cargo/bin/cargo');
    env.CARGO_HOME = join(cached, 'cargo'); env.RUSTUP_HOME = join(cached, 'rustup');
  }
}
const result = spawnSync(cargo, process.argv.slice(2), { env, stdio: 'inherit' });
if (result.error) console.error('Rust is required. Install the stable toolchain from https://rustup.rs.');
process.exit(result.status ?? 1);
