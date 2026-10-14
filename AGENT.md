# AGENT.md – how an agent builds a VibeDash for one home

You are building a calm dashboard for **one specific home** from the building blocks in
`src/components/`. You do not invent new visual styles. You check the data before you show
it. You ask the person when something looks odd.

Read first: `CLAUDE.md` (rules), `ANLEITUNG.md` sections 5 and 6 (design and data truth).

---

## 0. Ground rules

- **No real home data in the repository.** Mappings, hostnames, credentials, screenshots of
  the real home stay local (`.env`, `local/` – both git-ignored). Tests use demo data only.
- **Data truth before display.** Every number on screen must be traceable to a source.
- **Oddities are questions, not bugs.** "Does the kitchen light really burn at night?"
- **First level = tiles with a small graphic.** Tables only as a second section.

## 1. Inventory (what is there?)

With the InfluxDB 1.x adapter (`src/adapters/influx1.ts`):

1. `inventory.measurements()` → list measurements.
2. For each candidate: `inventory.fieldKeys(m)`, `inventory.tagKeys(m)`,
   `inventory.tagValues(m, key)`.
3. Pull 2–3 days of raw samples for each candidate and look at them (min, max, step,
   gaps) before deciding what it is.
4. Write one entry per entity into `local/mapping.json` (git-ignored; start from
   `local/mapping.example.json`): `name`, `kind`, `unit`, `room`, `measurement`, `field`,
   `tags`, `scale`, `stepMs`. Use the standard series names the pages expect
   (`pv_power`, `load_power`, `battery_soc`, `grid_power`, `pv_energy`, …).
5. Start the server (`pnpm build && pnpm start`). It refuses an invalid mapping with a
   clear list of errors. The browser can only ask for these names – never send InfluxQL.

The Influx user in `.env` must be **read-only**.

Prefer, in this order:

| Need                    | Use                                                        | Avoid                     |
| ----------------------- | ---------------------------------------------------------- | ------------------------- |
| Energy per day          | meter reading (`energy_counter`), difference per local day | integrating power         |
| State of a light/switch | actuator **status/feedback**                               | the command that was sent |
| Battery state           | state of charge in % from the battery                      | estimates from power      |

Ask the person when the mapping is ambiguous ("Is `meter_2` the heat pump?").

## 2. Check the data (before any page)

Run these checks per entity and write down the result:

| Check                  | How                                                       | If it fails                                        |
| ---------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Gaps                   | `findGaps(series)`                                        | keep them visible (null), mention in ⓘ             |
| Meter resets           | `counterResets(samples)`                                  | daily value counts 0 for that step; ask the person |
| Single-sample spikes   | value far outside the usual range for one sample          | flag, do not delete; ask                           |
| Same-second messages   | equal timestamps                                          | keep arrival order, never sort by value            |
| Time zone              | all times UTC ms; days cut in local time (`localDateKey`) | fix the mapping, not the display                   |
| Duplicate jobs per day | more than one run per day                                 | count the scheduled run                            |
| Sign convention        | feed-in positive, import negative                         | flip with `scale: -1` in the mapping               |

Questions for the person go into the "Questions for you" card (see `src/app/questions.ts`).
Only when an action may be needed. No permanent yellow.

## 3. Models and forecasts (only if asked for)

- Learn only from data known **before** the forecast time (the demo models run at 20:00
  the evening before, from complete days only).
- Evaluate with the **same lead time** for every day.
- Check against the meter reading, **never against the model itself**.
- Mean errors as **absolute** values (`meanAbsPctError`).
- Show accuracy as `AccuracyCard`: % correct + trend + n + level. Fewer than 7 checked
  days → "open", never 100 %.
- Every approximation carries its range and n: `≈ 29 kWh · 18–41 · n = 7`.

## 4. Build the pages

Template (adapt per home, drop what the home does not have):
Overview · Now · Maintenance · Garden · Device history · Forecasts.

Per page:

1. Start with a `TileRow` of 2–6 `Tile`s: value large, 1–2 words, one graphic
   (`ring`, `scale`, `spark`). Outline icon, no emoji.
2. Then cards: `SoftTimeSeries` (actual + own forecast line + band, period choice),
   `SourceArc`, `Sparkline`, `DayList`.
3. Then, if needed, a `DataTable` as the second section, with a period choice.
4. Details go behind ⓘ (`info: { what, source }`), opened by tap.
5. Texts in `src/i18n/de.ts` and `en.ts` (same keys, same placeholders – a test checks it).

Reuse `src/app/tiles.ts` for standard tiles. Look at `src/pages/Overview.svelte` as the
reference page.

## 5. Test and look

1. `pnpm lint && pnpm check && pnpm test`
2. `pnpm test:visual` – screenshots of every page: Mac 1440×900 and iPhone 390×844,
   light and dark, in `screenshots/`.
3. **Look at every screenshot** and go through the review list:
   - first level only tiles/infographics?
   - no emoji, no symbol chains?
   - ⓘ opens by tap?
   - every approximation with range and n?
   - forecast its own line?
   - phone layout designed, not just stacked? labels not cut off?
4. Fix, repeat, then show the person.

The visual test already enforces: no horizontal scroll, no emoji, touch targets ≥ 44 px,
text ≥ 14 px on the phone, ⓘ by tap, ≈ always with n.

## 6. Budget

First page < 200 KB JavaScript, no CDNs, everything bundled locally.
