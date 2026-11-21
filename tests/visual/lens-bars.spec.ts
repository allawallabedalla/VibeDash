import { expect, test, type Locator, type Page } from '@playwright/test';
import { sanitizeBoard } from '../../src/model/board';

/**
 * The lens of bar charts (DayBars on boards and pages, StackDayBars, DayRanges): hover
 * (Mac) or a finger laid on and dragged (iPhone) underlays the bar and shows a box with
 * its label ("13:00–13:15") and value with unit; a gap "keine Daten", after the running
 * quarter "noch nicht", the mean "Mittel x"; leaving or lifting hides it; arrow keys
 * step, Esc closes. The box stays inside the chart. Synthetic demo data only.
 */

/** hover with the mouse, or lay a finger on (pointerdown, no lift) – at bar i of n */
async function point(page: Page, isMobile: boolean, el: Locator, i: number, n: number) {
  const b = (await el.boundingBox())!;
  const x = b.x + (b.width * (i + 0.5)) / n;
  const y = b.y + b.height * 0.7;
  if (!isMobile) {
    await page.mouse.move(x - 4, y);
    await page.mouse.move(x, y, { steps: 2 });
    return;
  }
  const init = { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, buttons: 1 };
  await el.dispatchEvent('pointerdown', init);
  await page.waitForTimeout(100);
  await el.dispatchEvent('pointermove', init);
}

async function inside(page: Page, box: Locator, chart: Locator) {
  const b = (await box.boundingBox())!;
  const c = (await chart.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(c.x - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(
    parseFloat(await box.evaluate((e) => getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(14);
}

const quarters = Array.from(
  { length: 96 },
  (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
);

test('lens on board bars: quarter hour from–to, litres, gap, not yet, mean', async ({
  page,
  isMobile,
}, info) => {
  // synthetic: water per quarter hour until 14:45 (running), a gap 07:30–08:15, the rest to come
  const values = quarters.map((_, i) =>
    i > 59 ? null : i >= 30 && i < 33 ? null : [0, 0, 3, 12, 48, 6][i % 6]!,
  );
  const raw = {
    updated: Date.now(),
    sections: [
      {
        type: 'bars',
        title: 'Wann lief Wasser?',
        unit: 'l',
        labels: quarters,
        values,
        partial: 59,
        color: 'climate',
      },
      {
        type: 'bars',
        title: 'Verbrauch je Tag',
        unit: 'l',
        labels: ['1.3.', '2.3.', '3.3.', '4.3.', '5.3.', '6.3.', '7.3.'],
        values: [96.4, 120, null, 88, 101.25, 93, 40],
        partial: 6,
        mean: 99.6,
        color: 'climate',
      },
    ],
  };
  await page.route('**/api/health', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        source: 'demo',
        boards: [{ id: 'test', title: 'Test', icon: 'info', actions: true }],
      }),
    }),
  );
  await page.route('**/api/board/test', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(sanitizeBoard(raw)) }),
  );
  await page.goto('/?lang=de#/b/test');
  const chart = page.locator('.plot').first();
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();

  await point(page, isMobile, chart, 52, 96);
  const box = chart.locator('.box.shown');
  await expect(box).toBeVisible();
  await expect(box.locator('.when')).toHaveText('13:00–13:15');
  await expect(box).toContainText('48 l');
  await expect(chart.locator('.hl')).toBeVisible();
  await expect(chart.locator('[aria-live]')).toContainText('13:00–13:15 · 48 l');
  await inside(page, box, chart);
  await chart.screenshot({ path: `screenshots/lens-bars-${info.project.name}.png` });

  await point(page, isMobile, chart, 31, 96);
  await expect(box).toContainText('keine Daten');
  await point(page, isMobile, chart, 59, 96);
  await expect(box.locator('.when')).toHaveText('14:45–15:00 · bis jetzt');
  await point(page, isMobile, chart, 80, 96);
  await expect(box).toContainText('noch nicht');
  // at the right edge the box turns to the left, still inside
  await point(page, isMobile, chart, 95, 96);
  await inside(page, box, chart);
  if (isMobile) await chart.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
  else await page.mouse.move(0, 0);
  await expect(box).toHaveCount(0);

  // days with a mean: keys from the newest day, Esc closes
  const days = page.locator('.plot').nth(1);
  await days.scrollIntoViewIfNeeded();
  await days.focus();
  await page.keyboard.press('ArrowLeft');
  const dbox = days.locator('.box.shown');
  await expect(dbox.locator('.when')).toHaveText('7.3. · bis jetzt');
  await expect(dbox).toContainText('40 l');
  await expect(dbox).toContainText(/Mittel\s*100 l/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dbox.locator('.when')).toHaveText('4.3.');
  await page.keyboard.press('ArrowLeft');
  await expect(dbox).toContainText('keine Daten');
  await page.keyboard.press('Escape');
  await expect(dbox).toHaveCount(0);
});

test('lens on the week page: load per day, battery range', async ({ page, isMobile }, info) => {
  await page.goto('/?lang=de#/week');
  const load = page.locator('.card', { hasText: 'Verbrauch je Tag' }).locator('.plot').first();
  await load.scrollIntoViewIfNeeded();
  await point(page, isMobile, load, 6, 7);
  const box = load.locator('.box.shown');
  await expect(box).toBeVisible();
  await expect(box.locator('.when')).toContainText('bis jetzt');
  await expect(box).toContainText(/\d+(,\d+)? kWh|keine Daten/);
  await inside(page, box, load);
  await page.screenshot({ path: `screenshots/lens-week-${info.project.name}.png` });

  const soc = page.locator('.card', { hasText: 'Hausakku von–bis' }).locator('.plot').first();
  await soc.scrollIntoViewIfNeeded();
  await point(page, isMobile, soc, 2, 7);
  await expect(soc.locator('.box.shown')).toContainText(/\d+–\d+ %|keine Daten/);
  await inside(page, soc.locator('.box.shown'), soc);
});
