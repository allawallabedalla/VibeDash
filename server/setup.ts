/**
 * Setup assistant (ERSTEINRICHTUNG.md, path B): a person without any software
 * knowledge connects inverter, grid meter and battery in the browser – only
 * yes/no answers, a look at the manufacturer app, a brand from a list.
 *
 * VibeDash itself still reads only. The assistant talks to evcc's own
 * configuration API (evcc is the universal reader of the starter pack) and
 * only ever creates METERS (grid, pv, battery) – never chargers, never control
 * (battery control, curtailment and dimming stay off). It is guarded by a
 * one-time setup code the installer prints, rate-limited, and closes itself
 * when the person says "done" (local/setup.json).
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { dirname } from 'node:path';

export type Usage = 'grid' | 'pv' | 'battery';
export const USAGES: Usage[] = ['grid', 'pv', 'battery'];

/** One field the person (or the scan) fills in, in plain words. */
export interface SetupParam {
  name: string;
  label: string;
  help: string;
  type: 'text' | 'number' | 'choice';
  choices?: string[];
  required: boolean;
  value?: string;
  unit?: string;
  /** shown only under "more (rarely needed)" */
  advanced: boolean;
}
export interface SetupTemplate {
  template: string;
  brands: string[];
  products: string[];
  note?: string;
  params: SetupParam[];
}

type O = Record<string, unknown>;
const isObj = (v: unknown): v is O => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * evcc's template list (GET /api/config/templates/meter) cut down to what a
 * layperson needs for one usage. Network connection only (no RS485 wiring);
 * demo templates only when explicitly allowed (CI).
 */
export function templatesFor(raw: unknown, usage: Usage, allowDemo = false): SetupTemplate[] {
  const out: SetupTemplate[] = [];
  for (const t of Array.isArray(raw) ? raw : []) {
    if (!isObj(t)) continue;
    const name = str(t.Template, 80);
    if (!name || (!allowDemo && name.startsWith('demo'))) continue;
    const params = (Array.isArray(t.Params) ? t.Params : []).filter(isObj);
    // only templates that can serve this usage
    const usageParam = params.find((p) => p.Name === 'usage');
    const choices = Array.isArray(usageParam?.Choice) ? usageParam!.Choice.map(String) : [];
    if (usageParam && choices.length && !choices.includes(usage)) continue;
    if (!usageParam && usage !== 'pv' && !name.includes(usage)) continue;
    const products = (Array.isArray(t.Products) ? t.Products : []).filter(isObj);
    const fields: SetupParam[] = [];
    let ok = true;
    for (const p of params) {
      const pname = str(p.Name, 40);
      if (!pname || pname === 'usage') continue;
      const usages = Array.isArray(p.Usages) ? p.Usages.map(String) : [];
      if (usages.length && !usages.includes(usage)) continue;
      if (pname === 'modbus') {
        // the network way only: address, port and unit id with the template's defaults
        const ch = Array.isArray(p.Choice) ? p.Choice.map(String) : [];
        if (ch.length && !ch.includes('tcpip')) {
          ok = false; // serial wiring only – not for laypeople
          break;
        }
        fields.push(
          {
            name: 'host',
            label: 'Adresse im Heimnetz',
            help: 'Findet die Suche; sonst aus der Router-App.',
            type: 'text',
            required: true,
            advanced: false,
          },
          {
            name: 'port',
            label: 'Port',
            help: 'Meist richtig vorbelegt.',
            type: 'number',
            required: true,
            value: String(p.Port ?? 502),
            advanced: true,
          },
          {
            name: 'id',
            label: 'Geräte-Nummer (Modbus-ID)',
            help: 'Meist richtig vorbelegt.',
            type: 'number',
            required: true,
            value: String(p.ID ?? 1),
            advanced: true,
          },
        );
        continue;
      }
      const choice = Array.isArray(p.Choice) ? p.Choice.map(String) : undefined;
      const def = p.Default !== undefined ? String(p.Default) : undefined;
      fields.push({
        name: pname,
        label: str(p.Description, 80) || pname,
        help: str(p.Help, 300),
        type: choice?.length
          ? 'choice'
          : p.Type === 'Int' || p.Type === 'Float'
            ? 'number'
            : 'text',
        ...(choice?.length ? { choices: choice } : {}),
        required: p.Required === true,
        ...(def !== undefined && def !== '' ? { value: def } : {}),
        ...(str(p.Unit, 10) ? { unit: str(p.Unit, 10) } : {}),
        advanced: p.Advanced === true || (p.Required !== true && def !== undefined),
      });
    }
    if (!ok) continue;
    const req = isObj(t.Requirements) ? str(t.Requirements.Description, 300) : '';
    out.push({
      template: name,
      brands: [...new Set(products.map((p) => str(p.Brand, 60)).filter(Boolean))],
      products: products.map((p) =>
        [str(p.Brand, 60), str(p.Description, 80)].filter(Boolean).join(' '),
      ),
      ...(req ? { note: req } : {}),
      params: fields,
    });
  }
  return out.sort((a, b) => (a.brands[0] ?? a.template).localeCompare(b.brands[0] ?? b.template));
}

/** The values the person entered, checked against the template's fields; never more. */
export function deviceBody(
  t: SetupTemplate,
  usage: Usage,
  values: Record<string, unknown>,
): { body: O } | { error: string } {
  const body: O = { type: 'template', template: t.template, usage };
  for (const p of t.params) {
    const raw = values[p.name] ?? p.value;
    const v = raw === undefined || raw === null ? '' : String(raw).trim();
    if (!v) {
      if (p.required) return { error: `missing:${p.name}` };
      continue;
    }
    if (v.length > 200) return { error: `too_long:${p.name}` };
    if (p.type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) return { error: `number:${p.name}` };
    if (p.type === 'choice' && p.choices && !p.choices.includes(v))
      return { error: `choice:${p.name}` };
    if (p.name === 'host' && !privateHost(v)) return { error: 'host_not_private' };
    body[p.name] = v;
  }
  if (t.params.some((p) => p.name === 'host')) body.modbus = 'tcpip';
  return { body };
}

/** Only addresses in the home network (RFC 1918) or local names – the assistant never reaches out. */
export function privateHost(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (m.slice(1).some((x) => Number(x) > 255)) return false;
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  return /^[a-z0-9-]{1,63}(\.(local|lan|home|fritz\.box|box))?$/i.test(h);
}

/** All hosts of a private /24 (or smaller) network, e.g. "192.168.178.0/24". */
export function cidrHosts(cidr: string): string[] {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m || !privateHost(`${m[1]}.1`)) return [];
  const bits = Number(m[3]);
  if (bits < 24 || bits > 30) return [];
  const size = 2 ** (32 - bits);
  const start = Number(m[2]) & ~(size - 1);
  return Array.from({ length: size - 2 }, (_, i) => `${m[1]}.${start + i + 1}`);
}

/** Ports that tell what a device is: Modbus TCP (502, 1502 Sungrow WiNet), web pages. */
export const SCAN_PORTS = [502, 1502, 80] as const;

function openPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((done) => {
    const s = new Socket();
    const end = (ok: boolean) => {
      s.destroy();
      done(ok);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => end(true));
    s.once('timeout', () => end(false));
    s.once('error', () => end(false));
    s.connect(port, host);
  });
}

/** Look (only connect, never send) which hosts answer on SCAN_PORTS; slow and polite: 16 at a time. */
export async function scan(
  cidr: string,
  probe: (host: string, port: number) => Promise<boolean> = (h, p) => openPort(h, p, 400),
): Promise<{ host: string; ports: number[] }[]> {
  const hosts = cidrHosts(cidr);
  const found: { host: string; ports: number[] }[] = [];
  for (let i = 0; i < hosts.length; i += 16) {
    const batch = hosts.slice(i, i + 16);
    const res = await Promise.all(
      batch.map(async (host) => {
        const ports: number[] = [];
        for (const p of SCAN_PORTS) if (await probe(host, p)) ports.push(p);
        return { host, ports };
      }),
    );
    for (const r of res) if (r.ports.length) found.push(r);
  }
  // Modbus first; devices with a web page only (older inverters with their own web API) stay as "maybe"
  // – the address field takes any address anyway (Fremdtest 6)
  const modbus = (r: { ports: number[] }) => r.ports.some((p) => p !== 80);
  return [...found.filter(modbus), ...found.filter((r) => !modbus(r))];
}

/** Setup code check: constant time, at most 5 wrong tries per 10 minutes. */
export function codeChecker(code: string, now: () => number = Date.now) {
  const wrong: number[] = [];
  return (given: unknown): 'ok' | 'wrong' | 'locked' => {
    const t = now();
    while (wrong.length && t - wrong[0]! > 600_000) wrong.shift();
    if (wrong.length >= 5) return 'locked';
    const a = Buffer.from(String(given ?? '').trim());
    const b = Buffer.from(code);
    if (code && a.length === b.length && timingSafeEqual(a, b)) return 'ok';
    wrong.push(t);
    return 'wrong';
  };
}

/** local/setup.json: answers to the safety questions and whether the assistant is closed. */
export interface SetupState {
  done?: string;
  answers?: Record<string, boolean>;
  /** "first visit becomes the owner" (general stick): sha256 of the code handed to the first visitor */
  owner?: string;
  /** devices the person confirmed in the assistant (amount, and direction for grid and battery) */
  confirmed?: Partial<Record<Usage, boolean>>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * General VibeDash stick (no personal code on it): whoever opens the assistant first claims it and gets a code,
 * like a new router or Home Assistant's onboarding. Afterwards the code is checked against the stored hash, with
 * the same limit of wrong tries as a printed code.
 */
export function claimChecker(read: () => SetupState, now: () => number = Date.now) {
  const wrong: number[] = [];
  return {
    claim(write: (s: SetupState) => void): string | null {
      const st = read();
      if (st.owner) return null;
      const code = String(randomInt(100000, 1000000));
      write({ ...st, owner: sha(code) });
      return code;
    },
    check(given: unknown): 'ok' | 'wrong' | 'locked' {
      const t = now();
      while (wrong.length && t - wrong[0]! > 600_000) wrong.shift();
      if (wrong.length >= 5) return 'locked';
      const owner = read().owner;
      const a = Buffer.from(sha(String(given ?? '').trim()));
      if (owner && a.length === owner.length && timingSafeEqual(a, Buffer.from(owner))) return 'ok';
      wrong.push(t);
      return 'wrong';
    },
  };
}
export function stateFile(path: string) {
  return {
    read(): SetupState {
      try {
        return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as SetupState) : {};
      } catch {
        return {};
      }
    },
    write(s: SetupState) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(s, null, 1) + '\n', { mode: 0o600 });
      renameSync(tmp, path);
    },
  };
}

/** evcc's configuration API with its admin password (set once on first use). */
export function evccAdmin(
  url: string,
  password: string,
  fetchFn: typeof fetch,
  timeoutMs = 15_000,
) {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown): Promise<Response> =>
    fetchFn(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  const login = async () => {
    let r = await call('POST', '/api/auth/login', { password });
    if (!r.ok) {
      // no admin password yet: set ours (only possible while none is set)
      await call('PUT', '/api/auth/password', { current: '', new: password });
      r = await call('POST', '/api/auth/login', { password });
    }
    const set = r.headers.get('set-cookie') ?? '';
    const m = /auth=[^;]+/.exec(set);
    if (!r.ok || !m) throw new Error(`evcc login ${r.status}`);
    cookie = m[0];
  };
  const json = async (method: string, path: string, body?: unknown) => {
    if (!cookie) await login();
    let r = await call(method, path, body);
    if (r.status === 401 || r.status === 403) {
      await login();
      r = await call(method, path, body);
    }
    const text = await r.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text.slice(0, 200);
    }
    return { status: r.status, data };
  };
  return {
    templates: () => json('GET', '/api/config/templates/meter?lang=de'),
    test: (body: O) => json('POST', '/api/config/test/meter', body),
    create: (body: O) => json('POST', '/api/config/devices/meter', body),
    devices: () => json('GET', '/api/config/devices/meter'),
    site: () => json('GET', '/api/config/site'),
    updateSite: (body: O) => json('PUT', '/api/config/site', body),
    /** evcc applies new devices after a restart; the container comes back by itself */
    restart: () => json('POST', '/api/system/shutdown'),
  };
}
