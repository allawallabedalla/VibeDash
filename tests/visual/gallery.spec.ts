import { expect, test } from '@playwright/test';

/**
 * Screenshot test of the gallery for Mac 1440×900 and iPhone 390×844, light
 * and dark, plus the checks from the review list that a machine can do.
 * Screenshots land in `screenshots/` (CI artifact) and are looked at by a person.
 */
for (const lang of ['de', 'en'] as const) {
  test(`gallery ${lang}`, async ({ page, isMobile }, info) => {
    await page.goto(`/?lang=${lang}`);
    await expect(page.locator('.tile').first()).toBeVisible();

    await page.screenshot({
      path: `screenshots/gallery-${lang}-${info.project.name}.png`,
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

    // Touch targets at least 44 px.
    const small = await page.locator('button').evaluateAll((els) =>
      els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width < 44 || r.height < 44)
        .map((r) => `${r.width}×${r.height}`),
    );
    expect(small).toEqual([]);

    if (isMobile) {
      // Text at least 14 px on the phone.
      const tiny = await page.evaluate(() => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim()) continue;
          const size = parseFloat(getComputedStyle(n.parentElement!).fontSize);
          if (size < 14) out.push(`${n.textContent.trim()} (${size}px)`);
        }
        return out;
      });
      expect(tiny).toEqual([]);
    }
  });
}

test('info opens by tap or click, not by hover', async ({ page, isMobile }, info) => {
  await page.goto('/?lang=de');
  const tile = page.locator('.tile').first();
  const button = tile.getByRole('button', { name: 'Erklärung öffnen' });

  await button.hover();
  await expect(tile.getByText('Was heißt das?')).toHaveCount(0);

  if (isMobile) await button.tap();
  else await button.click();
  await expect(tile.getByText('Was heißt das?')).toBeVisible();
  await page.screenshot({ path: `screenshots/info-open-${info.project.name}.png` });

  const close = tile.getByRole('button', { name: 'Erklärung schließen' });
  if (isMobile) await close.tap();
  else await close.click();
  await expect(tile.getByText('Was heißt das?')).toHaveCount(0);
});

test('time series period switch redraws the chart', async ({ page, isMobile }, info) => {
  await page.goto('/?lang=de');
  const card = page.locator('.ts');
  const canvas = card.locator('canvas');
  await expect(canvas).toBeVisible();
  const before = await canvas.screenshot();

  const month = card.getByRole('button', { name: '30 Tage' });
  if (isMobile) await month.tap();
  else await month.click();
  await expect(month).toHaveAttribute('aria-pressed', 'true');
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  await card.screenshot({ path: `screenshots/timeseries-month-${info.project.name}.png` });
});
