/** gzip for larger JSON answers; long series shrink to about a quarter. */
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const MIN_BYTES = 1024;

/** True when the client accepts gzip (and did not switch it off with q=0). */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  return value.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (name !== 'gzip' && name !== '*') return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/** The body to send, gzipped when worth it and accepted. */
export async function encodeBody(
  text: string,
  acceptEncoding: string | string[] | undefined,
): Promise<{ body: Buffer | string; headers: Record<string, string> }> {
  const vary = { Vary: 'Accept-Encoding' };
  if (Buffer.byteLength(text) < MIN_BYTES || !acceptsGzip(acceptEncoding)) {
    return { body: text, headers: vary };
  }
  return { body: await gzipAsync(text), headers: { ...vary, 'Content-Encoding': 'gzip' } };
}

const packed = new Map<string, Buffer>();

/**
 * Built text files (JS, CSS, HTML, SVG, JSON) gzipped once and kept in
 * memory; images and fonts as they are. Key: path + modification time.
 */
export async function gzipStatic(
  path: string,
  type: string,
  body: Buffer,
  acceptEncoding: string | string[] | undefined,
  mtimeMs = 0,
): Promise<{ body: Buffer; headers: Record<string, string> }> {
  const vary = { Vary: 'Accept-Encoding' };
  const text = /^(text\/|application\/json|image\/svg)/.test(type);
  if (!text || body.length < MIN_BYTES || !acceptsGzip(acceptEncoding)) {
    return { body, headers: vary };
  }
  const key = `${path}|${mtimeMs}`;
  let z = packed.get(key);
  if (!z) {
    z = await gzipAsync(body, { level: 9 });
    if (packed.size > 200) packed.clear();
    packed.set(key, z);
  }
  return { body: z, headers: { ...vary, 'Content-Encoding': 'gzip' } };
}
