import { expect, test, type Locator, type Page } from '@playwright/test';
import { sanitizeBoard } from '../../src/model/board';

/**
 * The chart lens: hover (Mac) or a finger laid on and dragged (iPhone) shows a fine line,
 * a dot per line and a box with the time and every value with its unit; leaving or
 * lifting hides it; arrow keys step, Esc closes only the lens. The box stays inside the
 * chart: no sideways scrolling on the phone. Synthetic demo and fixture data only.
 */

/** hover with the mouse, or lay a finger on (pointerdown, no lift) */
async function point(page: Page, isMobile: boolean, el: Locator, fx: number, fy = 0.6) {
  const b = (await el.boundingBox())!;
  const x = b.x + b.width * fx;
  const y = b.y + b.height * fy;
  if (!isMobile) {
    await page.mouse.move(x - 20, y);
    await page.mouse.move(x, y, { steps: 3 });
    return;
  }
  const init = { clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, buttons: 1 };
  await el.dispatchEvent('pointerdown', init);
  await page.waitForTimeout(100);
  await el.dispatchEvent('pointermove', init);
}

async function lift(page: Page, isMobile: boolean, el: Locator) {
  if (isMobile) await el.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
  else await page.mouse.move(0, 0);
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

test('lens on a board line chart: time and both values with unit', async ({
  page,
  isMobile,
}, info) => {
  // synthetic: a day in 15-min steps, the actual line until now with a gap, the forecast dashed
  const step = 900_000;
  const from = Math.floor(Date.now() / step) * step - 60 * step;
  const x = Array.from({ length: 97 }, (_, i) => from + i * step);
  const wave = (i: number) => Math.max(0, 3 * Math.sin((Math.PI * i) / 96));
  const raw = {
    updated: Date.now(),
    sections: [
      {
        type: 'series',
        title: 'Leistung',
        unit: 'kW',
        x,
        lines: [
          {
            label: 'Sonne',
            color: 'sun',
            values: x.map((_, i) => (i > 60 || (i > 20 && i < 26) ? null : wave(i) * 1.1)),
          },
          { label: 'Prognose', color: 'sun', dashed: true, values: x.map((_, i) => wave(i)) },
        ],
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
  await point(page, isMobile, chart, 0.55);
  const box = chart.locator('.box.shown');
  await expect(box).toBeVisible();
  await expect(box.locator('.when')).toHaveText(/\d\d:\d\d/);
  await expect(box).toContainText(/Sonne\s*\d+,\d kW/);
  await expect(box).toContainText(/Prognose\s*\d+,\d kW/);
  await expect(box).toContainText(/Ist − Prognose\s*[+−]?\d+,\d kW/);
  await expect(chart.locator('svg.lens circle')).toHaveCount(2);
  await expect(chart.locator('[aria-live]')).toContainText('Ist − Prognose');
  await inside(page, box, chart);
  await chart.screenshot({ path: `screenshots/lens-board-${info.project.name}.png` });
  // a gap: "keine Daten" for the actual line
  await point(page, isMobile, chart, 0.3);
  await expect(box).toContainText(/Sonne\s*keine Daten/);
  // at the right edge the box turns to the left, still inside
  await point(page, isMobile, chart, 0.97);
  await inside(page, box, chart);
  await lift(page, isMobile, chart);
  await expect(box).toHaveCount(0);
});

test('lens on an enlarged tile curve; keys step, Esc closes the lens only', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?lang=de#/week');
  await page.getByRole('button', { name: 'Sonne vergrößern' }).click();
  const dialog = page.locator('dialog[open]');
  const chart = dialog.locator('.plot');
  await expect(chart).toBeVisible();
  await point(page, isMobile, chart, 0.5);
  const box = chart.locator('.box.shown');
  await expect(box).toBeVisible();
  await expect(box.locator('.when')).toHaveText(/\d+\.\d+\./);
  await expect(box).toContainText(/(\d+(,\d)? kWh|keine Daten)/);
  await inside(page, box, chart);
  await page.screenshot({ path: `screenshots/lens-zoom-${info.project.name}.png` });
  await lift(page, isMobile, chart);
  await expect(box).toHaveCount(0);

  // keyboard: focus, arrows step from the newest value, Esc hides the lens, the dialog stays
  await chart.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(box).toBeVisible();
  const first = await box.locator('.when').textContent();
  await page.keyboard.press('ArrowLeft');
  await expect(box.locator('.when')).not.toHaveText(first!);
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
