# AGENT.md – how an agent builds a VibeDash for one home

You are building a calm dashboard for **one specific home** from the building blocks in
`src/components/`. You do not invent new visual styles. You check the data before you show
it. You ask the person when something looks odd.

Read first: `CLAUDE.md` (rules), `ANLEITUNG.md` sections 5, 6 and 11 (design, data truth,
forecasting) and `INBETRIEBNAHME.md` (onboarding, the source of section 1 below).

---

## 0. Ground rules

- **No real home data in the repository.** Mappings, hostnames, credentials, screenshots of
  the real home stay local (`.env`, `local/` – both git-ignored). Tests use demo data only.
- **Data truth before display.** Every number on screen must be traceable to a source.
- **Oddities are questions, not bugs.** "Does the kitchen light really burn at night?"
- **First level = tiles with a small graphic.** Tables only as a second section.

## 1. Onboarding: from a new PC to the first real tile

After installation VibeDash shows **demo data**. Real values need a **data source** and a
**mapping** (`local/mapping.json`). Finding devices fully automatically does **not** work
reliably: every device type speaks differently, registers are vendor-specific, and some
devices need a manual step by the person. Say so honestly.

### 1.1 Pick the path (offer in this order)

1. **Home Assistant present?** → use the Home Assistant adapter (planned as M3b, right
   after Influx). HA already solved discovery for thousands of devices.
2. **evcc present (energy/wallbox)?** → evcc as source (planned as M6).
3. **InfluxDB already collecting?** → Influx adapter (available now, section 2).
4. **None of these?** → agent-led onboarding (1.2), together with the person.

Until the HA and evcc adapters exist, tell the person which path is available today.

### 1.2 Agent-led onboarding, step by step with the person

1. **Ask for permission.** "May I search your home network for devices? I only read, I
   switch nothing." No explicit yes → no scan.
2. **Inventory (read-only).**
   - mDNS/SSDP announcements, the router's DHCP list (if the person shows it), vendor from
     the MAC prefix.
   - Check known ports: 502 (Modbus), 3671 (KNX), 8123 (Home Assistant), 7070 (evcc),
     1883 (MQTT), 80/443 (web interfaces).
   - **Connect and read only** – no write commands, no logins with guessed passwords.
3. **Ask instead of guessing.** "A device from vendor X answers on port 502 at .114. Is
   that your inverter?"
4. **Cross-check with something the person knows.** "I read 3.2 kW generation. Does your
   vendor app show about that right now?" Check sign and direction (feed-in vs. import,
   battery charging vs. discharging) – the most common source of errors.
5. **State manual steps clearly.** What only the person can do, as a short instruction:
   "In the wallbox app, enter `ws://<VibeDash computer>:<port>/` as OCPP server."
6. **Connect.** Write the adapter configuration and the entry in `local/mapping.json`
   (never into the repo); credentials only in `.env`.
7. **Check data truth** (`ANLEITUNG.md` section 6 and section 3 below): meter readings over
   integrals, status over commands, gaps, time zone; observe for **at least 24 h**; oddities
   as **questions** to the person.
8. **Report.** A short summary: "found · connected · open · to do by the person".

### 1.3 Hard safety rules

- **Scan only with consent**, only the own home network, slowly (no port flood).
- **Never write or control** during onboarding – no Modbus write, no switching, no charging
  commands. Control is not part of VibeDash v0.x.
- **Never guess passwords**, never try default logins.
- **The person confirms every mapping** before it is saved.
- Device data found (IPs, serial numbers, names) stays **local** – never in the repo,
  issues, logs or screenshots.

## 2. Inventory of a data source (InfluxDB 1.x)

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

## 3. Check the data (before any page)

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

## 4. Models and forecasts (only if asked for)

The full rules are in `ANLEITUNG.md` section 11 (forecasting module, M7–M9: a Python
service **behind** the Node server; the browser only talks to the Node server). In short:
the simplest sufficient method wins (rules of thumb first; something more complex only if
it beats them by ≥ 2 standard errors, paired); "collecting data · 12 of 28 days" or
"open · n = 6" instead of a percentage.

- Learn only from data known **before** the forecast time (the demo models run at 20:00
  the evening before, from complete days only).
- Evaluate with the **same lead time** for every day.
- Check against the meter reading, **never against the model itself**.
- Mean errors as **absolute** values (`meanAbsPctError`).
- Show accuracy as `AccuracyCard`: % correct + trend + n + level. Fewer than 7 checked
  days → "open", never 100 %.
- Every approximation carries its range and n: `≈ 29 kWh · 18–41 · n = 7`.

## 5. Build the pages

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

## 6. Test and look

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

## 7. Budget

First page < 200 KB JavaScript, no CDNs, everything bundled locally.
