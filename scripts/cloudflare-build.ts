import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
await build({ entryPoints: ['cloudflare/pages.ts'], outfile: 'dist/_worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
// Only private/dynamic routes consume a Function invocation. Assets stay on Pages CDN.
await writeFile('dist/_routes.json', JSON.stringify({ version: 1, include: ['/api', '/api/*', '/health'], exclude: [] }, null, 2));
