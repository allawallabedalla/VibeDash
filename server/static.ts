/** Serve the built app from dist/; no directory listing, no path escapes. */
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export async function staticFile(
  distDir: string,
  pathname: string,
): Promise<{
  status: number;
  type: string;
  body: Buffer;
  immutable: boolean;
  path: string;
  mtimeMs: number;
} | null> {
  const root = resolve(distDir);
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  const file = rel === '/' ? join(root, 'index.html') : resolve(root, normalize('.' + rel));
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    const s = await stat(file);
    if (!s.isFile()) return null;
    return {
      status: 200,
      type: TYPES[extname(file)] ?? 'application/octet-stream',
      body: await readFile(file),
      immutable: rel.startsWith('/assets/'),
      path: file,
      mtimeMs: s.mtimeMs,
    };
  } catch {
    return null;
  }
}
