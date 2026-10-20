import { expect, test, type Page } from '@playwright/test';

/**
 * Screenshot test of every page for Mac 1440×900 and iPhone 390×844, light and
 * dark, plus the review-list checks a machine can do. Screenshots land in
 * `screenshots/` (CI artifact) and are looked at by a person.
 */
const pages = [
  { name: 'overview', hash: '#/' },
  { name: 'week', hash: '#/week' },
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

      // Text contrast at least WCAG AA (Audit01 DE-01): 4.5:1, large text 3:1.
      const lowContrast = await page.evaluate(() => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = ([r, g, b]: number[]) =>
          [r!, g!, b!]
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
        const bgOf = (el: Element | null): number[] => {
          // mix semi-transparent backgrounds up to the first solid one
          const stack: number[][] = [];
          for (let e = el; e; e = e.parentElement) {
            const c = rgb(getComputedStyle(e).backgroundColor);
            if (c.length >= 3 && (c[3] ?? 1) > 0) {
              stack.push(c);
              if ((c[3] ?? 1) >= 1) break;
            }
          }
          let out = rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
          for (const c of stack.reverse()) {
            const a = c[3] ?? 1;
            out = out.map((v, i) => a * c[i]! + (1 - a) * v);
          }
          return out;
        };
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent?.trim();
          if (!text) continue;
          const el = n.parentElement!;
          if (el.closest('svg, .sr, [aria-hidden="true"]')) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none' || !el.getClientRects().length)
            continue;
          const fg = rgb(st.color);
          if ((fg[3] ?? 1) < 1 || Number(st.opacity) < 1) continue;
          const a = lum(fg);
          const b = lum(bgOf(el));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const size = parseFloat(st.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(st.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) out.push(`${text.slice(0, 30)} ${ratio.toFixed(2)}`);
        }
        return out;
      });
      expect(lowContrast).toEqual([]);

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

test('the page period switch redraws the chart and the autarky', async ({
  page,
  isMobile,
}, info) => {
  await page.goto('/?lang=de');
  const card = page.locator('.ts');
  const canvas = card.locator('canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();
  const autarkyNote = card.locator('xpath=ancestor::section[1]').locator('.note');

  const month = page.locator('.period').getByRole('button', { name: '30 Tage' });
  await tap(page, isMobile, month);
  await expect(month).toHaveAttribute('aria-pressed', 'true');
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  // under the curve: the autarky of the 30 days, with their dates
  await expect(autarkyNote).toContainText('Eigenstrom im Zeitraum');
  await card.screenshot({ path: `screenshots/timeseries-month-${info.project.name}.png` });

  // ±3 days: hourly, with the days ahead
  await tap(page, isMobile, page.locator('.period').getByRole('button', { name: '±3 Tage' }));
  await expect(canvas).toBeVisible();
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

test('charge plan accuracy (demo backtest in a worker)', async ({ page }, info) => {
  await page.goto('/?lang=de#/forecasts');
  const card = page.locator('.card', { hasText: 'Ladeplan' });
  await expect(card).toContainText('Netzstrom durchs Auto', { timeout: 20_000 });
  await expect(card).toContainText(/n = \d+/);
  await card.screenshot({ path: `screenshots/plan-accuracy-${info.project.name}.png` });
});
