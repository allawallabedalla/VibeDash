import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshot test of every page for Mac 1440×900 and iPhone 390×844, light and
 * dark, plus the review-list checks a machine can do. Screenshots land in
 * `screenshots/` (CI artifact) and are looked at by a person.
 */
const pages = [
  { name: 'overview', hash: '#/' },
  { name: 'now', hash: '#/now' },
  { name: 'forecasts', hash: '#/forecasts' },
  { name: 'charging', hash: '#/charging' },
  { name: 'gallery', hash: '#/gallery' },
];

async function tap(page: Page, isMobile: boolean, locator: ReturnType<Page['locator']>) {
  if (isMobile) await locator.tap();
  else await locator.click();
}

for (const p of pages) {
  for (const lang of ['de', 'en'] as const) {
    test(`${p.name} ${lang}`, async ({ page, isMobile }, info) => {
      await page.goto(`/?lang=${lang}${p.hash}`);
      await expect(page.locator('.tile').first()).toBeVisible();
      await page.waitForTimeout(150); // uPlot draws after layout

      await page.screenshot({
        path: `screenshots/${p.name}-${lang}-${info.project.name}.png`,
        fullPage: true,
      });

      // No horizontal scrolling.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // No emoji anywhere in the visible text.
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);

      // Every approximation (≈) on a tile comes with n.
      const approxTiles = await page.locator('.tile').filter({ hasText: '≈' }).allInnerTexts();
      for (const tile of approxTiles) expect(tile).toMatch(/n = \d+/);

      // Touch targets at least 44 px.
      const small = await page.locator('button, a').evaluateAll((els) =>
        els
          .map((el) => ({ text: el.textContent?.trim(), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
          .map(({ text, r }) => `${text} ${r.width}×${r.height}`),
      );
      expect(small).toEqual([]);

      if (isMobile) {
        // Text at least 14 px on the phone (uPlot axis labels are canvas, not text).
        const tiny = await page.evaluate(() => {
          const out: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent?.trim()) continue;
            const el = n.parentElement!;
            if (el.closest('.sr')) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 14) out.push(`${n.textContent.trim()} (${size}px)`);
          }
          return out;
        });
        expect(tiny).toEqual([]);
      }
    });
  }
}

test('info opens by tap or click, not by hover', async ({ page, isMobile }, info) => {
  await page.goto('/?lang=de');
  const tile = page.locator('.tile').first();
  const button = tile.getByRole('button', { name: 'Erklärung öffnen' });

  await button.hover();
  await expect(tile.getByText('Was heißt das?')).toHaveCount(0);

  await tap(page, isMobile, button);
  await expect(tile.getByText('Was heißt das?')).toBeVisible();
  await page.screenshot({ path: `screenshots/info-open-${info.project.name}.png` });

  await tap(page, isMobile, tile.getByRole('button', { name: 'Erklärung schließen' }));
  await expect(tile.getByText('Was heißt das?')).toHaveCount(0);
});

test('time series period switch redraws the chart', async ({ page, isMobile }, info) => {
  await page.goto('/?lang=de');
  const card = page.locator('.ts');
  const canvas = card.locator('canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();

  const month = card.getByRole('button', { name: '30 Tage' });
  await tap(page, isMobile, month);
  await expect(month).toHaveAttribute('aria-pressed', 'true');
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  await card.screenshot({ path: `screenshots/timeseries-month-${info.project.name}.png` });
});

test('tabs navigate between pages', async ({ page, isMobile }) => {
  await page.goto('/?lang=de');
  await tap(page, isMobile, page.getByRole('button', { name: 'Vorhersagen' }));
  await expect(page).toHaveURL(/#\/forecasts$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vorhersagen' })).toBeVisible();
});

test('look-back table switches from 7 to 30 days', async ({ page, isMobile }) => {
  await page.goto('/?lang=de');
  const table = page.locator('table');
  await expect(table.locator('tbody tr')).toHaveCount(7);
  const card = page.locator('section', { has: table });
  await tap(page, isMobile, card.getByRole('button', { name: '30 Tage' }));
  await expect(table.locator('tbody tr')).toHaveCount(29);
});
