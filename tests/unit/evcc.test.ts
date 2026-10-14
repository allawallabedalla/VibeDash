import { describe, expect, it } from 'vitest';
import { evccClient, parseSessions, parseState, solarShare } from '../../src/adapters/evcc';
import type { FetchLike } from '../../src/adapters/influx1';

// Synthetic values only, shaped like evcc's /api/state and /api/sessions.
describe('evcc state', () => {
  it('flips signs to the VibeDash convention (feed-in +, battery charging +)', () => {
    const now = parseState({
      pvPower: 5200,
      homePower: 800,
      grid: { power: -3100 }, // evcc: export is negative
      battery: { power: -1300, soc: 64 }, // evcc: charging is negative
      loadpoints: [
        {
          title: 'Garage',
          connected: true,
          charging: true,
          chargePower: 4100,
          chargedEnergy: 6500,
        },
      ],
    });
    expect(now.gridW).toBe(3100);
    expect(now.batteryW).toBe(1300);
    expect(now.batterySoc).toBe(64);
    expect(now.loadpoints[0]).toMatchObject({
      title: 'Garage',
      chargePowerW: 4100,
      sessionEnergyKWh: 6.5,
      sessionSolarPct: null,
    });
  });

  it('reads older evcc versions ({result: …}, gridPower, batteryPower, sessionEnergy)', () => {
    const now = parseState({
      result: {
        pvPower: 0,
        gridPower: 450,
        batteryPower: 200,
        batterySoc: 30,
        loadpoints: [{ sessionEnergy: 1200, sessionSolarPercentage: 80 }],
      },
    });
    expect(now.gridW).toBe(-450); // import
    expect(now.batteryW).toBe(-200); // discharging
    expect(now.loadpoints[0]).toMatchObject({
      title: '#1',
      sessionEnergyKWh: 1.2,
      sessionSolarPct: 80,
    });
  });
});

describe('evcc sessions', () => {
  const raw = [
    {
      created: '2026-06-01T08:00:00Z',
      finished: '2026-06-01T12:00:00Z',
      loadpoint: 'Garage',
      vehicle: 'Car',
      chargedEnergy: 20,
      solarPercentage: 90,
    },
    {
      created: '2026-06-03T18:00:00Z',
      finished: '2026-06-03T22:00:00Z',
      loadpoint: 'Garage',
      vehicle: 'Car',
      chargedEnergy: 10,
      solarPercentage: 30,
    },
    {
      created: '2026-06-04T18:00:00Z',
      finished: '0001-01-01T00:00:00Z',
      loadpoint: 'Garage',
      vehicle: 'Car',
      chargedEnergy: 5,
      solarPercentage: null,
    },
  ];

  it('parses kWh, solar share and running sessions, newest first', () => {
    const s = parseSessions(raw);
    expect(s.map((x) => x.energyKWh)).toEqual([5, 10, 20]);
    expect(s[0]!.end).toBeNull();
    expect(parseSessions({ result: raw })).toHaveLength(3);
  });

  it('weights the solar share by energy and leaves unknown shares out, counted', () => {
    const share = solarShare(parseSessions(raw));
    expect(share.pct).toBeCloseTo(((20 * 0.9 + 10 * 0.3) / 30) * 100); // 70 %, not the plain mean 60 %
    expect(share).toMatchObject({ n: 2, withoutShare: 1, energyKWh: 35 });
  });

  it('client asks /api/sessions with year and times out', async () => {
    let seen = '';
    const ok: FetchLike = async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => raw, text: async () => '' };
    };
    await evccClient({ url: 'http://evcc.example:7070/' }, ok).sessions(2026);
    expect(seen).toBe('http://evcc.example:7070/api/sessions?year=2026');
    const hang: FetchLike = (_u, init) =>
      new Promise((_r, rej) =>
        init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)),
      );
    await expect(evccClient({ url: 'http://e' }, hang, 30).now()).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});

describe('API: evcc', () => {
  it('serves now and sessions read-only, validates year, reports timeouts', async () => {
    const { handleApi } = await import('../../server/api');
    const deps = {
      mode: 'demo' as const,
      now: () => 0,
      log: () => {},
      evcc: {
        now: async () => parseState({ pvPower: 1 }),
        sessions: async (year?: number) => {
          if (year === 2025) throw Object.assign(new Error('t'), { name: 'TimeoutError' });
          return [];
        },
      },
    };
    const get = (p: string) => handleApi('GET', new URL(`http://h${p}`), deps);
    expect((await get('/api/evcc/now')).status).toBe(200);
    expect((await get('/api/evcc/sessions?year=2026')).body).toEqual({ sessions: [] });
    expect((await get('/api/evcc/sessions?year=abc')).status).toBe(400);
    expect((await get('/api/evcc/sessions?year=2025')).body).toEqual({ error: 'timeout' });
    expect((await get('/api/health')).body).toMatchObject({ evcc: true });
    expect((await handleApi('POST', new URL('http://h/api/evcc/now'), deps)).status).toBe(405);
  });
});
