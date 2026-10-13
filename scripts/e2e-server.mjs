import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/cloudflare-e2e.ts'], {
  stdio: 'inherit',
  env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
