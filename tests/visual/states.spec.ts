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

async function influxMode(page: Page, series: (id: string) => ReturnType<typeof json>) {
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
    r.fulfill(json({ timeZone: 'Europe/Berlin', entities: ENTITIES })),
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
  await expect(page.getByText('Ein Wert ist noch nicht bestätigt')).toBeVisible();
  await page.screenshot({
    path: `screenshots/state-partial-${info.project.name}.png`,
    fullPage: true,
  });
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
