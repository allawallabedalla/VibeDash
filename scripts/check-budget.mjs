// Fails the build if the JavaScript loaded by the first page exceeds 200 KB.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 200 * 1024;
const html = readFileSync('dist/index.html', 'utf8');
const scripts = [
  ...html.matchAll(
    /<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="\.?\/?([^"]+\.js)"/g,
  ),
].map((m) => m[1]);
const total = [...new Set(scripts)].reduce((sum, f) => sum + statSync(join('dist', f)).size, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`first page JS: ${kb(total)} (limit ${kb(LIMIT)})`);
if (total > LIMIT) process.exit(1);
