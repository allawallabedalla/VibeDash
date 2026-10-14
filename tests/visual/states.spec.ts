import { expect, test, type Page } from '@playwright/test';

/**
 * Influx mode with a mocked VibeDash API (synthetic values only): the UI must
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
].map(([id, name, kind, unit]) => ({ id, name, kind, unit, stepMs: 300_000 }));

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

async function influxMode(page: Page, series: (id: string) => ReturnType<typeof json>) {
  await page.route('**/api/health', (r) =>
    r.fulfill(json({ ok: true, source: 'influx', timeZone: 'Europe/Berlin' })),
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
  for (let t = now - 2 * 86_400_000; t <= now; t += 300_000) {
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
    r.fulfill(json({ ok: true, source: 'influx', timeZone: 'Europe/Berlin' })),
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
  await expect(page.locator('.lead')).toContainText('InfluxDB');
  // Not enough history for forecasts: "noch offen", never a made-up number.
  await expect(page.locator('.tile', { hasText: 'Morgen' })).toContainText('noch offen');
  await expect(page.locator('.ts')).toContainText('keine Daten');
  await page.screenshot({
    path: `screenshots/state-partial-${info.project.name}.png`,
    fullPage: true,
  });
});

test('no made-up weather outlook with real data', async ({ page }) => {
  await influxMode(page, synthetic);
  await page.goto('/?lang=de#/forecasts');
  await expect(page.getByRole('heading', { level: 1, name: 'Vorhersagen' })).toBeVisible();
  await expect(page.getByText('Nächste 7 Tage')).toHaveCount(0);
});
