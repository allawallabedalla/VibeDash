import { readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sanitizeBoard } from '../../src/model/board';

/**
 * Rule checker for the interface (Audit05 lessons, ~/docs/GUIDELINE.md G-27 … G-34): every page in demo mode
 * plus every house tab (boards of all modules, built from the synthetic fixtures of the module tests:
 * tests/visual/fixtures/boards/, made with `python3 -m tests.boards` in modules/), "Details" opened, on all four
 * projects (Mac/iPhone × light/dark). The same text rules check the board JSON in modules/vibedash_modules/regeln.py.
 * A new rule is automated here (G-34); a rule today's pages break gets a narrow exception with its audit ID –
 * anything new fails. Already checked by pages.spec.ts on the fixed pages (not repeated there): horizontal
 * scrolling and phone text size of HTML text.
 */

const fixed = [
  { name: 'overview', hash: '#/' },
  { name: 'week', hash: '#/week' },
  { name: 'now', hash: '#/now' },
  { name: 'forecasts', hash: '#/forecasts' },
  { name: 'charging', hash: '#/charging' },
  { name: 'gallery', hash: '#/gallery' },
  { name: 'zeitstrahl', hash: '#/zeitstrahl' },
];
/** pages pages.spec.ts does not cover: overflow and HTML text size are checked here */
const uncovered = (name: string) => name.startsWith('b/') || name === 'zeitstrahl';

const FIX = 'tests/visual/fixtures/boards';
const boards = readdirSync(FIX)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

/** G-27: at most this many sections/cards on the first level (before "Details"). Today's most: 10 (Auto tab). */
const MAX_FIRST_LEVEL = 10;

/** G-31 (G-04 automated): tables without a graphic column allowed only as logs (caption = card title). */
// „Lernstand aller Modelle“: on purpose without a graphic – learning progress must not be stressed (G-14)
const LOG_TABLES = ['Ereignisse', 'Telegramme', 'Lernstand aller Modelle'];

/**
 * Known violations of today's pages, each with its audit ID. Fix the cause, then delete the line (a stale entry
 * fails as well). Keys: page name; each rule lists the beginnings of the violation texts it tolerates.
 */
const EXCEPTIONS: Record<string, Partial<Record<Rule, { id: string; hits: string[] }>>> = {};

/**
 * G-09 (DE4-11): phone text below 14 px that is known today, per page the smallest size allowed until it is fixed.
 * SVG text counts at its drawn size (font size × the SVG's scale): the board charts scale their axis text down.
 */
const SMALL_TEXT: Record<string, { svg?: number; html?: number; id: string }> = {
  // board charts: axis text scaled with the SVG (11.9 px); charge timeline: 11 px; choice sub-line 13.6 px
  'b/auto': { html: 11, svg: 11.9, id: 'DE4-11' },
  'b/druck': { svg: 11.9, id: 'DE4-11' },
  'b/fuehler': { svg: 11.9, id: 'DE4-11' },
  'b/garten': { svg: 11.9, id: 'DE4-11' },
  'b/knx': { svg: 11.9, id: 'DE4-11' },
  'b/knxlog': { svg: 11.9, id: 'DE4-11' },
  'b/saugroboter': { html: 13.6, id: 'DE4-11' },
  'b/updates': { html: 13.6, id: 'DE4-11' },
  zeitstrahl: { html: 11, svg: 12, id: 'DE4-11' },
};

type Rule = 'text' | 'claim' | 'levels' | 'table' | 'spark' | 'overflow' | 'font';

// ── G-28: the same patterns as modules/vibedash_modules/regeln.py ───────────────────────────────────────────
const PLACEHOLDER = /(?<![\w-])(?:None|NaN|null|undefined)(?![\w-])|\[object/;
const MINUS_ZERO = /(?<![\w.,])[−-]0(?:[.,]0+)?(?![.,]?\d)/;
const HYPHEN = /(?<![\w.,:/)\]–-])-(?=\d)/;
const EMOJI = /\p{Extended_Pictographic}/u;
// G-29: "only reads" claims next to buttons that switch (Audit05 P4-08, S4-01, DE4-04)
const CLAIM = /schaltet nichts|gesteuert wird nichts|switches nothing/i;

function textRules(line: string): string[] {
  const out: string[] = [];
  let m: RegExpMatchArray | null;
  if ((m = line.match(PLACEHOLDER))) out.push(`Platzhalter „${m[0]}“ (G-28): ${line}`);
  if ((m = line.match(MINUS_ZERO))) out.push(`Minus vor null „${m[0]}“ (G-28): ${line}`);
  else if (HYPHEN.test(line)) out.push(`Bindestrich statt Minus (G-28): ${line}`);
  if ((m = line.match(EMOJI))) out.push(`Emoji „${m[0]}“ (ANLEITUNG 5.3): ${line}`);
  return out;
}

async function openBoard(page: Page, id: string) {
  const raw = JSON.parse(readFileSync(`${FIX}/${id}.json`, 'utf8')) as unknown;
  await page.route('**/api/health', (r) =>
    r.fulfill({
      contentType: 'application/json',
      // demo data for the house pages, the module boards as tabs (as the server lists them)
      body: JSON.stringify({
        ok: true,
        source: 'demo',
        boards: boards.map((b) => ({ id: b, title: b, icon: 'info', actions: true, calc: true })),
      }),
    }),
  );
  // the server checks every board answer (sanitizeBoard) before the page sees it – here as well
  await page.route(`**/api/board/${id}`, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(sanitizeBoard(raw)) }),
  );
  await page.goto(`/?lang=de#/b/${id}`);
  await expect(page.getByText(/Stand|Daten aus/).first()).toBeVisible();
}

/** Everything a page shows, after the first-level count: "Details" and <details> opened. */
async function inspect(page: Page, isMobile: boolean) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main [role="status"]', { hasText: /Lade|Loading/ })).toHaveCount(0);
  await page.waitForTimeout(200); // charts draw after layout

  // G-27: blocks of the first level = tile rows and cards not inside another, before the "Details" button
  const levels = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const more = main.querySelector('button.more');
    return [...main.querySelectorAll('.card, .row')].filter((el) => {
      if (el.parentElement?.closest('.card, .row')) return false;
      if (!el.getClientRects().length) return false;
      return !more || !!(el.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING);
    }).length;
  });

  const more = page.locator('main button.more[aria-expanded="false"]');
  if (await more.count()) {
    await more.first().click();
    await page.waitForTimeout(300);
  }
  await page.evaluate(() =>
    document.querySelectorAll<HTMLDetailsElement>('main details').forEach((d) => (d.open = true)),
  );
  await page.waitForTimeout(200);

  const found = await page.evaluate(
    ({ mobile, claim }) => {
      const main = document.querySelector('main')!;
      const visible = (el: Element) => {
        const st = getComputedStyle(el);
        return (
          st.visibility !== 'hidden' && st.display !== 'none' && el.getClientRects().length > 0
        );
      };
      // visible text: lines of the rendered text plus SVG texts
      const lines = main.innerText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const svgTexts = [...main.querySelectorAll('svg text')]
        .filter(visible)
        .map((t) => t.textContent?.trim() ?? '')
        .filter(Boolean);

      // G-29: switching buttons = a choice (sent to the house's logic at once); its options may describe themselves
      const switches = main.querySelectorAll('.choice button').length;
      const claims: string[] = [];
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        if (el.closest('.choice') || !visible(el)) continue;
        const s = n.textContent?.trim() ?? '';
        if (new RegExp(claim, 'i').test(s)) claims.push(s);
      }

      // G-31: tables without a graphic column (caption = title)
      const tables = [...main.querySelectorAll('table')]
        .filter(visible)
        .filter((t) => !t.querySelector('.gcol'))
        .map((t) => t.querySelector('caption')?.textContent?.trim() ?? '(ohne Titel)');

      // G-30: a percent tile's sparkline is drawn on 0–100
      const sparks = [...main.querySelectorAll('.tile')]
        .filter((t) => t.querySelector('.unit')?.textContent?.trim() === '%')
        .flatMap((t) =>
          [...t.querySelectorAll('.spark svg')].map((s) => ({
            label: t.querySelector('.label, h3')?.textContent?.trim() ?? '',
            lo: s.getAttribute('data-lo'),
            hi: s.getAttribute('data-hi'),
          })),
        )
        .filter((s) => s.lo !== '0' || s.hi !== '100')
        .map((s) => `${s.label} ${s.lo}–${s.hi}`);

      // G-09 on the phone: HTML text ≥ 14 px; SVG text at its drawn size
      const small: { svg: number; html: number; svgText: string; htmlText: string } = {
        svg: Infinity,
        html: Infinity,
        svgText: '',
        htmlText: '',
      };
      if (mobile) {
        const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const s = n.textContent?.trim();
          if (!s) continue;
          const el = n.parentElement!;
          if (el.closest('.sr') || !visible(el)) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          const svg = el.closest('svg');
          if (svg) {
            const drawn = size * (svg.getScreenCTM()?.a ?? 1);
            if (drawn < small.svg) [small.svg, small.svgText] = [drawn, s];
          } else if (size < small.html) [small.html, small.htmlText] = [size, s];
        }
      }
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      return { lines, svgTexts, switches, claims, tables, sparks, small, overflow };
    },
    { mobile: isMobile, claim: CLAIM.source },
  );
  return { levels, ...found };
}

function check(name: string, r: Awaited<ReturnType<typeof inspect>>, isMobile: boolean) {
  const ex = EXCEPTIONS[name] ?? {};
  const used = new Set<string>();
  const allowed = (rule: Rule, text: string) => {
    const hit = ex[rule]?.hits.find((h) => text.includes(h));
    if (hit) used.add(`${rule}:${hit}`);
    return !!hit;
  };
  const out: string[] = [];
  // G-28 + emojis (ANLEITUNG 5.3): placeholders, minus, emojis in all visible text
  for (const l of new Set([...r.lines, ...r.svgTexts]))
    for (const v of textRules(l)) if (!allowed('text', l)) out.push(v);
  // G-29
  if (r.switches)
    for (const c of r.claims)
      if (!allowed('claim', c)) out.push(`„schaltet nichts“ neben Schalt-Knöpfen (G-29): ${c}`);
  // G-27 (the gallery shows every building block once – a catalogue, not a page to read)
  if (name !== 'gallery' && r.levels > MAX_FIRST_LEVEL)
    out.push(`${r.levels} Abschnitte in der ersten Ebene, höchstens ${MAX_FIRST_LEVEL} (G-27)`);
  // G-31
  for (const t of r.tables)
    if (!LOG_TABLES.includes(t) && !allowed('table', t))
      out.push(`Tabelle ohne Grafik (G-31): ${t}`);
  // G-30
  for (const s of r.sparks) out.push(`Prozent-Verlauf nicht auf 0–100 (G-30): ${s}`);
  if (uncovered(name)) {
    // G-09: no horizontal scrolling
    if (r.overflow > 0) out.push(`seitliches Scrollen ${r.overflow} px (G-09)`);
    if (isMobile && r.small.html < (SMALL_TEXT[name]?.html ?? 14))
      out.push(`Handy-Schrift ${r.small.html} px < 14 (G-09): ${r.small.htmlText}`);
  }
  const small = SMALL_TEXT[name];
  if (isMobile && r.small.svg < (small?.svg ?? 14) - 0.05)
    out.push(`Grafik-Schrift ${r.small.svg.toFixed(1)} px < 14 (G-09): ${r.small.svgText}`);
  if (isMobile && small) {
    // fixed: the exception goes
    if (small.svg && r.small.svg >= 14) out.push(`Ausnahme ${small.id} veraltet – löschen: svg`);
    if (small.html && r.small.html >= 14) out.push(`Ausnahme ${small.id} veraltet – löschen: html`);
  }
  // an exception whose cause is gone fails too: delete it
  for (const [rule, e] of Object.entries(ex))
    for (const h of e!.hits)
      if (!used.has(`${rule}:${h}`))
        out.push(`Ausnahme ${e!.id} veraltet – löschen: ${rule} „${h}“`);
  return out;
}

for (const p of fixed) {
  for (const lang of ['de', 'en'] as const) {
    test(`rules ${p.name} ${lang}`, async ({ page, isMobile }) => {
      await page.goto(`/?lang=${lang}${p.hash}`);
      await expect(page.locator('main h1, main .tile').first()).toBeVisible();
      const r = await inspect(page, isMobile);
      expect(check(p.name, r, isMobile)).toEqual([]);
    });
  }
}

for (const id of boards) {
  test(`rules board ${id}`, async ({ page, isMobile }) => {
    await openBoard(page, id);
    const r = await inspect(page, isMobile);
    expect(check(`b/${id}`, r, isMobile)).toEqual([]);
  });
}

test('rule patterns find their counter-examples', () => {
  const hit = (l: string) => textRules(l).length > 0;
  for (const bad of [
    'Lernstand None %',
    'NaN kWh',
    '[object Object]',
    '−0,0 kW',
    '-0',
    'Netz -1,1 kW',
    'Tipp 🌱',
  ])
    expect(hit(bad), bad).toBe(true);
  for (const ok of [
    '−1,1 kW',
    '2026-10-19',
    '1-2 Wörter',
    'Mo–Fr',
    '−0,5',
    '≈ 18 kWh (12–25), n = 30',
    '✓',
  ])
    expect(hit(ok), ok).toBe(false);
  expect(CLAIM.test('Nur lesen – gesteuert wird nichts.')).toBe(true);
});
