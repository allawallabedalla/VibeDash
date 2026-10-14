import { expect, test, type Page } from '@playwright/test';

/**
 * Live mode with a mocked VibeDash API (synthetic values only): the UI must
 * end in a clear state – never endless loading.
 */
const ENTITIES = [
  ['pv_power', 'PV', 'power', 'W'],
  ['load_power', 'House', 'power', 'W'],
  ['battery_power', 'Battery', 'power', 'W'],
  ['battery_soc', 'Battery', 'state_of_charge', '%'],
  ['grid_power', 'Grid', 'power', 'W'],
  ['pv_energy', 'PV', 'energy_counter', 'kWh'],
  ['load_energy', 'House', 'energy_counter', 'kWh'],
  ['feed_in_energy', 'Feed-in', 'energy_counter', 'kWh'],
  ['import_energy', 'Import', 'energy_counter', 'kWh'],
  ['living_temp', 'Living room', 'temperature', '°C'],
  ['living_humidity', 'Living room', 'humidity', '%'],
].map(([id, name, kind, unit]) => ({
  id,
  name,
  kind,
  unit,
  stepMs: 300_000,
  // One value the person has not confirmed yet (RISIKEN.md).
  confirmed: id !== 'load_power',
}));

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function influxMode(
  page: Page,
  series: (id: string) => ReturnType<typeof json>,
  entities: typeof ENTITIES = ENTITIES,
) {
  await page.route('**/api/health', (r) =>
    r.fulfill(
      json({
        ok: true,
        source: 'live',
        backends: ['homeassistant', 'influx'],
        timeZone: 'Europe/Berlin',
      }),
    ),
  );
  await page.route('**/api/entities', (r) =>
    r.fulfill(json({ timeZone: 'Europe/Berlin', entities })),
  );
  await page.route('**/api/series/*', (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()!;
    return r.fulfill(series(id));
  });
}

function synthetic(id: string) {
  const now = Date.now();
  const samples: [number, number][] = [];
  let counter = 1000;
  // The room sensor went silent three hours ago.
  const end = id === 'living_temp' ? now - 3 * 3_600_000 : now;
  for (let t = now - 2 * 86_400_000; t <= end; t += 300_000) {
    counter += 0.1;
    const v = id.endsWith('_energy')
      ? counter
      : id === 'battery_soc'
        ? 60
        : id === 'living_temp'
          ? 21.5
          : id === 'living_humidity'
            ? 48
            : 800;
    samples.push([t, v]);
  }
  return json({ name: id, samples });
}

test('database unreachable: clear "no data" state with retry', async ({ page }, info) => {
  await page.route('**/api/health', (r) =>
    r.fulfill(
      json({
        ok: true,
        source: 'live',
        backends: ['homeassistant', 'influx'],
        timeZone: 'Europe/Berlin',
      }),
    ),
  );
  await page.route('**/api/entities', (r) => r.fulfill(json({ error: 'timeout' }, 504)));
  await page.goto('/?lang=de');
  await expect(page.getByRole('alert')).toContainText('Keine Daten');
  await expect(page.getByRole('alert')).toContainText('Zeitüberschreitung');
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  await expect(page.getByText('Lade Daten')).toHaveCount(0);
  await page.screenshot({ path: `screenshots/state-error-${info.project.name}.png` });
});

test('one series times out: page renders, tile says "keine Daten", notice names it', async ({
  page,
}, info) => {
  await influxMode(page, (id) =>
    id === 'pv_power' ? json({ error: 'timeout' }, 504) : synthetic(id),
  );
  await page.goto('/?lang=de');
  const notice = page.getByRole('status').filter({ hasText: 'Nicht alle Daten da' });
  await expect(notice).toContainText('PV: Zeitüberschreitung (10 s)');
  const sun = page.locator('.tile', { hasText: 'Sonne' });
  await expect(sun).toContainText('–');
  await expect(sun).toContainText('keine Daten');
  await expect(page.locator('.lead')).toContainText('Home Assistant + InfluxDB');
  // Not enough history for forecasts: "noch offen", never a made-up number.
  await expect(page.locator('.tile', { hasText: 'Morgen' })).toContainText('noch offen');
  await expect(page.locator('.ts')).toContainText('keine Daten');
  await expect(page.locator('.tile', { hasText: 'Verbrauch' }).first()).toContainText(
    'wird geprüft',
  );
  await expect(page.locator('.tile', { hasText: 'Wohnzimmer' })).toContainText('Daten fehlen seit');
  // No battery capacity mapped: % only, never the demo's kWh.
  await expect(page.locator('.tile', { hasText: 'Akku' }).first()).not.toContainText('kWh');
  // Question groups are folded on the phone; a tap opens them.
  const confirm = page.getByText('Ein Wert ist noch nicht bestätigt');
  if (!(await confirm.isVisible())) {
    await page.locator('details.qgroup summary', { hasText: 'Bestätigen' }).click();
  }
  await expect(confirm).toBeVisible();
  await page.screenshot({
    path: `screenshots/state-partial-${info.project.name}.png`,
    fullPage: true,
  });
});

test('battery kWh from the nominal capacity; derived consumption named', async ({ page }) => {
  const entities = [
    ...ENTITIES.map((e) => (e.id === 'load_energy' ? { ...e, derived: true } : e)),
    {
      ...ENTITIES[0]!,
      id: 'battery_capacity',
      name: 'Battery capacity',
      kind: 'capacity',
      unit: 'kWh',
    },
  ];
  await influxMode(
    page,
    (id) => {
      if (id !== 'battery_capacity') return synthetic(id);
      // constant 12.5 kWh with one read error (0) as the latest value
      const now = Date.now();
      const samples = [3, 2, 1, 0].map((h) => [now - h * 3_600_000, h === 0 ? 0 : 12.5]);
      return json({ name: id, samples });
    },
    entities,
  );
  await page.goto('/?lang=de');
  const battery = page.locator('.tile', { hasText: 'Akku' }).first();
  await expect(battery).toContainText('7,5 / 12,5 kWh');
  await battery.getByRole('button').first().click();
  await expect(battery).toContainText('Nennkapazität laut Wechselrichter (12,5 kWh)');
  await expect(page.getByText('Verbrauch aus der Leistung aufsummiert')).toBeVisible();
});

test('no made-up weather outlook with real data', async ({ page }) => {
  await influxMode(page, synthetic);
  await page.goto('/?lang=de#/forecasts');
  await expect(page.getByRole('heading', { level: 1, name: 'Vorhersagen' })).toBeVisible();
  await expect(page.getByText('Wetter erfunden')).toHaveCount(0);
});

test('weather: asks for the location once, then shows the real forecast', async ({
  page,
  isMobile,
}, info) => {
  await influxMode(page, synthetic);
  let location: unknown = null;
  await page.route('**/api/location', async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as { place?: string };
      expect(body.place).toBe('Beispielstadt');
      location = { lat: 50.1, lon: 8.2, name: 'Beispielstadt', source: 'settings' };
      return r.fulfill(json({ location }));
    }
    return r.fulfill(json({ enabled: true, location }));
  });
  await page.route('**/api/weather', (r) =>
    r.fulfill(
      json({
        location,
        days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
          tag: new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10),
          sonneH: [9, 6, 2, 0, 7, 10, 3][i],
          strahlungMj: 10,
          tMin: 5 + i,
          tMax: 12 + i,
          regenMm: [0, 0, 3.2, 8, 0, 0, 0.4][i],
        })),
      }),
    ),
  );
  await page.goto('/?lang=de#/forecasts');
  await expect(page.getByText('fehlt der Standort')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `screenshots/weather-ask-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('textbox', { name: 'Ort, z. B. Stadt' }).fill('Beispielstadt');
  const save = page.getByRole('button', { name: 'Übernehmen' });
  if (isMobile) await save.tap();
  else await save.click();
  await expect(page.locator('.days li')).toHaveCount(7);
  await expect(page.getByText('Standort Beispielstadt')).toBeVisible();
  await page.screenshot({
    path: `screenshots/weather-ready-${info.project.name}.png`,
    fullPage: true,
  });
});

test('forecasting service: collecting, open and assessable states', async ({ page }, info) => {
  await influxMode(page, synthetic);
  await page.route('**/api/location', (r) => r.fulfill(json({ enabled: false, location: null })));
  await page.route('**/api/forecasts', (r) =>
    r.fulfill(json({ names: ['pv_tag', 'verbrauch_tag', 'neu_tag'] })),
  );
  await page.route('**/api/forecast/*/*', (r) => {
    const [, , , name, what] = new URL(r.request().url()).pathname.split('/');
    if (name === 'neu_tag') {
      return r.fulfill(
        json(
          what === 'status'
            ? { zustand: 'sammelt', tage: 12, benoetigt: 30, ab_ca: '2026-11-03' }
            : { zustand: 'offen', n: 0, quelle: 'rueckrechnung' },
        ),
      );
    }
    if (name === 'verbrauch_tag') {
      return r.fulfill(
        json(
          what === 'status'
            ? { zustand: 'offen', n: 6 }
            : { zustand: 'offen', n: 6, quelle: 'rueckrechnung' },
        ),
      );
    }
    return r.fulfill(
      json(
        what === 'status'
          ? { zustand: 'bewertbar', n: 40 }
          : {
              zustand: 'bewertbar',
              n: 40,
              quelle: 'rueckrechnung',
              korrekt_pct: 78.4,
              verlauf: [70, 74, 72, 78, 80, 79],
              schlaegt_faustregel_pct: 12.3,
            },
      ),
    );
  });
  await page.goto('/?lang=de#/forecasts');
  const cards = page.locator('article.card');
  await expect(cards.filter({ hasText: 'sammelt Daten' })).toContainText('12 von 30 Tagen');
  await expect(cards.filter({ hasText: 'Verbrauchsprognose' })).toContainText('offen');
  await expect(cards.filter({ hasText: 'Verbrauchsprognose' })).toContainText('n = 6');
  const sun = cards.filter({ hasText: 'Sonnenprognose' });
  await expect(sun).toContainText(/78\s?%/);
  await expect(sun).toContainText('schlägt Faustregel um 12 %');
  await expect(sun).toContainText('aus Rückrechnung');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `screenshots/service-${info.project.name}.png`, fullPage: true });
});

test('charging page from evcc: now, sessions, weighted solar share', async ({
  page,
  isMobile,
}, info) => {
  await page.route('**/api/health', (r) =>
    r.fulfill(json({ ok: true, source: 'demo', backends: [], evcc: true, timeZone: null })),
  );
  const now = Date.now();
  await page.route('**/api/evcc/now', (r) =>
    r.fulfill(
      json({
        pvW: 5200,
        homeW: 700,
        gridW: 300,
        batteryW: 0,
        batterySoc: 90,
        loadpoints: [
          {
            title: 'Garage',
            connected: true,
            charging: true,
            chargePowerW: 4200,
            sessionEnergyKWh: 6.4,
            sessionSolarPct: null,
            vehicleSoc: 58,
          },
        ],
      }),
    ),
  );
  await page.route('**/api/evcc/sessions*', (r) => {
    const year = new URL(r.request().url()).searchParams.get('year');
    if (year !== String(new Date().getFullYear())) return r.fulfill(json({ sessions: [] }));
    return r.fulfill(
      json({
        sessions: [
          {
            start: now - 2 * 86_400_000,
            end: now - 2 * 86_400_000 + 4 * 3_600_000,
            loadpoint: 'Garage',
            vehicle: 'Beispielauto',
            energyKWh: 20,
            solarPct: 90,
            price: null,
            socStart: 30,
            socEnd: 70,
          },
          {
            start: now - 5 * 86_400_000,
            end: now - 5 * 86_400_000 + 3 * 3_600_000,
            loadpoint: 'Garage',
            vehicle: 'Beispielauto',
            energyKWh: 10,
            solarPct: 30,
            price: null,
            socStart: 50,
            socEnd: 70,
          },
          {
            start: now - 6 * 86_400_000,
            end: now - 6 * 86_400_000 + 3_600_000,
            loadpoint: 'Garage',
            vehicle: 'Beispielauto',
            energyKWh: 5,
            solarPct: null,
            price: null,
            socStart: null,
            socEnd: null,
          },
        ],
      }),
    );
  });
  await page.goto('/?lang=de');
  const tab = page.getByRole('button', { name: 'Laden' });
  if (isMobile) await tab.tap();
  else await tab.click();
  await expect(page).toHaveURL(/#\/charging$/);
  await expect(page.locator('.tile', { hasText: 'Garage' })).toContainText('4,2');
  const solar = page.locator('.tile', { hasText: 'Sonnenanteil' });
  await expect(solar).toContainText('70'); // weighted by energy, not the plain mean (60)
  await expect(solar).toContainText('n = 2');
  await expect(solar).toContainText('1 ohne Angabe');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `screenshots/charging-${info.project.name}.png`, fullPage: true });
});

test('hourly PV forecast: day totals with range and n, hourly band, accuracy', async ({
  page,
  isMobile,
}, info) => {
  await influxMode(page, synthetic);
  await page.route('**/api/health', (r) =>
    r.fulfill(
      json({ ok: true, source: 'live', backends: ['influx'], timeZone: 'Europe/Berlin', pv: true }),
    ),
  );
  await page.route('**/api/location', (r) => r.fulfill(json({ enabled: false, location: null })));
  await page.route('**/api/forecasts', (r) => r.fulfill(json({ names: [] })));
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    const tag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(d);
    const start = Date.parse(`${tag}T00:00:00+02:00`);
    const stunden = Array.from({ length: 24 }, (_, h) =>
      new Date(start + h * 3_600_000).toISOString(),
    );
    const p50 = stunden.map(
      (_, h) => Math.max(0, 5 * Math.sin(((h - 6) / 14) * Math.PI)) * (offset ? 0.6 : 1),
    );
    return {
      tag,
      stunden,
      p10: p50.map((v) => v * 0.6),
      p50,
      p90: p50.map((v) => v * 1.25),
      summe: [
        p50.reduce((a, b) => a + b, 0) * 0.65,
        p50.reduce((a, b) => a + b, 0),
        p50.reduce((a, b) => a + b, 0) * 1.2,
      ],
      n_analog: 30,
      hinweis: null,
    };
  };
  await page.route('**/api/pv/status', (r) => r.fulfill(json({ zustand: 'bereit', tage: 60 })));
  await page.route('**/api/pv/prognose', (r) => r.fulfill(json({ prognosen: [day(0), day(1)] })));
  await page.route('**/api/pv/guete', (r) =>
    r.fulfill(
      json({
        zustand: 'bewertbar',
        n: 46,
        korrekt_pct: 81.2,
        verlauf: [76, 79, 80, 82, 81],
        im_band_pct: 78,
        schlaegt_faustregel_pct: 34,
      }),
    ),
  );
  await page.goto('/?lang=de#/forecasts');
  await expect(page.getByRole('heading', { name: 'Sonne stündlich' })).toBeVisible();
  const tiles = page.locator('.tile', { hasText: 'Sonne' }).filter({ hasText: 'n = 30' });
  await expect(tiles).toHaveCount(2);
  await expect(page.locator('article.card', { hasText: 'PV-Stundenmodell' })).toContainText(
    '78 % im Band',
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/pv-hourly-${info.project.name}.png`, fullPage: true });
  expect(isMobile !== undefined).toBe(true);
});

test('charge plan from the forecasting service (live): tiles, chart, what-if', async ({
  page,
}, info) => {
  await influxMode(page, synthetic);
  await page.route('**/api/health', (r) =>
    r.fulfill(
      json({
        ok: true,
        source: 'live',
        backends: ['influx'],
        plan: true,
        timeZone: 'Europe/Berlin',
      }),
    ),
  );
  const h0 = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const n = 30;
  const hours = Array.from({ length: n }, (_, i) => new Date(h0 + i * 3_600_000).toISOString());
  const sun = (k: number) =>
    hours.map((_, i) => Math.max(0, Math.sin((((i % 24) - 2) / 12) * Math.PI)) * k);
  await page.route('**/api/plan', (r) =>
    r.fulfill(
      json({
        zustand: 'bereit',
        stunden: hours,
        auto_kw: hours.map((_, i) => (i >= 3 && i < 6 ? 4.14 : 0)),
        kwh: 12.4,
        spanne: [8.3, 16.6],
        grund: 'sunBattery',
        pv_listen: [sun(6), sun(4)],
        last_listen: [hours.map(() => 0.5), hours.map(() => 0.7)],
        paar_pv: Array.from({ length: 300 }, (_, i) => i % 2),
        paar_last: Array.from({ length: 300 }, (_, i) => (i >> 1) % 2),
        akku: {
          kapazitaet_kwh: 10,
          max_laden_kw: 5,
          max_entladen_kw: 5,
          min_soc_pct: 5,
          reserve_kwh: 2,
        },
        auto: { kapazitaet_kwh: 60, phasen: 3, min_a: 6, max_a: 16 },
        soc_kwh: 6,
        geladen_kwh: 0,
        n_pv: 30,
        n_last: 40,
        ungeprueft: true,
      }),
    ),
  );
  await page.goto('/?lang=de#/charging');
  await expect(page.locator('.tile', { hasText: 'Auto laden' })).toContainText('12');
  await expect(page.locator('.tile', { hasText: 'Auto laden' })).toContainText('n = 300');
  await expect(page.getByText('ungeprüft: noch keine Daten bei dieser Temperatur')).toBeVisible();
  await expect(page.locator('.answer')).toBeVisible();
  await page.screenshot({ path: `screenshots/plan-live-${info.project.name}.png`, fullPage: true });
});

test('charge plan still collecting: says how many days, no plan', async ({ page }) => {
  await influxMode(page, synthetic);
  await page.route('**/api/health', (r) =>
    r.fulfill(
      json({
        ok: true,
        source: 'live',
        backends: ['influx'],
        plan: true,
        timeZone: 'Europe/Berlin',
      }),
    ),
  );
  await page.route('**/api/plan', (r) =>
    r.fulfill(json({ plan: 'haus', zustand: 'sammelt', tage: 9, benoetigt: 21 })),
  );
  await page.goto('/?lang=de#/charging');
  await expect(page.getByText('9 von 21 Tagen')).toBeVisible();
  await expect(page.locator('.tile', { hasText: 'Auto laden' })).toHaveCount(0);
});
