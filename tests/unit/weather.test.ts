import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/adapters/influx1';
import {
  forecastUrl,
  parseForecast,
  parseGeocode,
  roundLocation,
  weatherClient,
} from '../../src/adapters/openmeteo';
import { handleApi, type ApiDeps } from '../../server/api';
import { fromEnv, fromHomeAssistant, readSettings, writeSettings } from '../../server/location';

// Made-up coordinates and values only.
const FAKE = { lat: 50.123456, lon: 8.987654 };

describe('Open-Meteo', () => {
  it('sends only a rounded location (about 1 km)', () => {
    expect(roundLocation(FAKE)).toEqual({ lat: 50.12, lon: 8.99 });
    const url = forecastUrl(FAKE, 'Europe/Berlin');
    expect(url).toContain('latitude=50.12');
    expect(url).toContain('longitude=8.99');
    expect(url).not.toContain('50.1234');
  });

  it('parses daily values and keeps missing ones as null', () => {
    const days = parseForecast({
      daily: {
        time: ['2026-10-14', '2026-10-15'],
        sunshine_duration: [21600, null],
        shortwave_radiation_sum: [9.5, 3.1],
        temperature_2m_min: [6.1, 4],
        temperature_2m_max: [14.2, 11],
        precipitation_sum: [0, 4.2],
      },
    });
    expect(days[0]).toEqual({
      tag: '2026-10-14',
      sonneH: 6,
      strahlungMj: 9.5,
      tMin: 6.1,
      tMax: 14.2,
      regenMm: 0,
    });
    expect(days[1]!.sonneH).toBeNull();
    expect(() => parseForecast({})).toThrow();
  });

  it('geocodes a place name to a rounded location', () => {
    expect(
      parseGeocode({ results: [{ name: 'Exampletown', latitude: 50.1111, longitude: 8.2222 }] }),
    ).toEqual({
      lat: 50.11,
      lon: 8.22,
      name: 'Exampletown',
    });
    expect(parseGeocode({ results: [] })).toBeNull();
  });

  it('caches for an hour and times out', async () => {
    let calls = 0;
    const ok: FetchLike = async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ daily: { time: [] } }),
        text: async () => '',
      };
    };
    const c = weatherClient(ok);
    await c.forecast(FAKE, 'Europe/Berlin', 0);
    await c.forecast(FAKE, 'Europe/Berlin', 1000);
    expect(calls).toBe(1);
    const hang: FetchLike = (_u, init) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    await expect(weatherClient(hang, 30).forecast(FAKE, 'Europe/Berlin')).rejects.toMatchObject({
      name: 'TimeoutError',
    });
  });
});

describe('location', () => {
  it('reads env, writes and reads local settings, all rounded', () => {
    expect(fromEnv({ LATITUDE: '50.123456', LONGITUDE: '8.987654' })).toEqual({
      lat: 50.12,
      lon: 8.99,
      source: 'env',
    });
    expect(fromEnv({ LATITUDE: '200', LONGITUDE: '1' })).toBeNull();
    const path = join(mkdtempSync(join(tmpdir(), 'vd-')), 'local', 'settings.json');
    writeSettings(path, { ...FAKE, name: 'Exampletown' });
    expect(JSON.parse(readFileSync(path, 'utf8')).location).toEqual({
      lat: 50.12,
      lon: 8.99,
      name: 'Exampletown',
    });
    expect(readSettings(path)).toMatchObject({ lat: 50.12, source: 'settings' });
  });

  it('takes the location from Home Assistant, but not 0/0', async () => {
    const ha =
      (lat: number, lon: number): FetchLike =>
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ latitude: lat, longitude: lon }),
        text: async () => '',
      });
    expect(
      await fromHomeAssistant({ url: 'http://ha', token: 't' }, ha(50.123, 8.456)),
    ).toMatchObject({
      lat: 50.12,
      source: 'homeassistant',
    });
    expect(await fromHomeAssistant({ url: 'http://ha', token: 't' }, ha(0, 0))).toBeNull();
  });
});

describe('API: location and weather', () => {
  function deps(over: Partial<NonNullable<ApiDeps['weather']>> = {}): ApiDeps {
    let stored: unknown = null;
    return {
      mode: 'demo',
      now: () => 0,
      log: () => {},
      weather: {
        enabled: true,
        location: async () => (stored as never) ?? null,
        setLocation: async (l) => (stored = { ...roundLocation(l), source: 'settings' }) as never,
        geocode: async () => ({ lat: 50.11, lon: 8.22, name: 'Exampletown' }),
        forecast: async () => [],
        ...over,
      },
    };
  }
  const post = (d: ApiDeps, body: unknown, extra = {}) =>
    handleApi('POST', new URL('http://h/api/location'), d, {
      body: JSON.stringify(body),
      contentType: 'application/json',
      host: 'h',
      origin: 'http://h',
      ...extra,
    });

  it('stores a location from the browser or a place name', async () => {
    const d = deps();
    expect((await handleApi('GET', new URL('http://h/api/weather'), d)).status).toBe(404);
    expect((await post(d, FAKE)).status).toBe(200);
    expect((await handleApi('GET', new URL('http://h/api/location'), d)).body).toMatchObject({
      location: { lat: 50.12 },
    });
    expect((await post(d, { place: 'Exampletown' })).body).toMatchObject({
      location: { lat: 50.11 },
    });
  });

  it('refuses cross-origin, non-JSON, oversized and invalid writes', async () => {
    const d = deps();
    expect((await post(d, FAKE, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(d, FAKE, { contentType: 'text/plain' })).status).toBe(415);
    expect((await post(d, { lat: 999, lon: 0 })).status).toBe(400);
    expect((await post(d, { place: 'x'.repeat(2000) })).status).toBe(400);
    expect((await handleApi('POST', new URL('http://h/api/series/pv_power'), d)).status).toBe(405);
  });

  it('makes no external request when WEATHER=off', async () => {
    let called = false;
    const d = deps({ enabled: false, forecast: async () => ((called = true), []) });
    expect((await handleApi('GET', new URL('http://h/api/weather'), d)).status).toBe(404);
    expect((await handleApi('GET', new URL('http://h/api/location'), d)).body).toEqual({
      enabled: false,
      location: null,
    });
    expect((await post(d, FAKE)).status).toBe(409);
    expect(called).toBe(false);
  });
});
