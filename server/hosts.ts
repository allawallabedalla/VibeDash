/**
 * Which Host header the server answers (Audit01 S-01): a page on a foreign
 * domain that points its DNS at this server (DNS rebinding) counts as "same
 * origin" for the browser; checking the Host header stops it.
 */
import { hostname, networkInterfaces } from 'node:os';

/** Host names without port, lower case: localhost, this machine's names and addresses, plus ALLOWED_HOSTS. */
export function allowedHosts(env: Record<string, string | undefined>): Set<string> {
  const out = new Set(['localhost', '127.0.0.1', '::1']);
  const name = hostname().toLowerCase();
  out.add(name);
  out.add(`${name}.local`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) out.add(a.address.toLowerCase());
  }
  if (env.HOST && env.HOST !== '0.0.0.0' && env.HOST !== '::') out.add(env.HOST.toLowerCase());
  for (const h of (env.ALLOWED_HOSTS ?? '').split(',')) {
    const v = h.trim().toLowerCase();
    if (v) out.add(v);
  }
  return out;
}

/** The host part of a Host header ("name:8095", "[::1]:8095", "name"). */
export function hostOf(header: string | undefined): string | null {
  if (!header) return null;
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  const i = h.lastIndexOf(':');
  return i > -1 && h.indexOf(':') === i ? h.slice(0, i) : h;
}
