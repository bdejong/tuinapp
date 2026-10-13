import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { createPasswordHash } from '../cloudflare/auth';

// Accept a pipe for secret managers; interactive input is hidden by the terminal.
let password: string;
if (!process.stdin.isTTY) {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
} else {
  const { Writable } = await import('node:stream');
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('Choose the owner password (at least 12 characters): ');
  muted = true;
  password = await prompt.question('');
  prompt.close();
  process.stdout.write('\n');
}
if (password.length < 12) throw new Error('Choose a password of at least 12 characters.');
console.log(`TUINAPP_PASSWORD_HASH=${await createPasswordHash(password)}`);
console.log(`TUINAPP_SESSION_SECRET=${randomBytes(32).toString('base64url')}`);
