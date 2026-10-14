# VibeDash

Calm home dashboards for smart homes, solar, heat pumps and EVs – composed by an AI agent
from a fixed set of design building blocks, on top of checked data.

VibeDash is not one big app. It ships three things:

1. a **design language** (building blocks: tiles, sparklines, progress bars, …),
2. **data adapters** (demo data and InfluxDB 1.x now; Home Assistant next, then evcc),
3. a **build guide for the agent** that assembles one dashboard per home.

Everything runs locally. No cloud, no CDN.

> Status: early (milestones M0–M2, M3 in progress). Three pages (Overview, Now, Forecasts)
> and a gallery of all building blocks; synthetic demo data or InfluxDB 1.x via the server. Agent build guide incl. onboarding: [AGENT.md](AGENT.md) (German source: [INBETRIEBNAHME.md](INBETRIEBNAHME.md)). Project background and roadmap (German): [ANLEITUNG.md](ANLEITUNG.md).

## Quick start

Requires Node 24 (current LTS) and pnpm 10.

```sh
pnpm install
pnpm dev          # http://localhost:5173 (#/, #/now, #/forecasts, #/gallery; ?lang=de|en, ?theme=light|dark)
```

## Connect InfluxDB 1.x

The browser only talks to the VibeDash server. The server runs **only the named series**
listed in `local/mapping.json` – there is no way to send a query from the browser.

1. Create a **read-only** InfluxDB user for VibeDash (it never writes):

   ```sql
   CREATE USER vibedash_read WITH PASSWORD '…'
   GRANT READ ON "your_db" TO vibedash_read
   ```

2. Copy `.env.example` to `.env` and fill in URL, database, user and password.
   `.env` is git-ignored. Credentials never go into the URL.
3. Copy `local/mapping.example.json` to `local/mapping.json` (git-ignored) and map your
   measurements/fields/tags to the series names. The file is checked at start; any typo or
   unknown key stops the server with a clear message.
4. Build and start:

   ```sh
   pnpm build
   pnpm start        # http://localhost:8080
   ```

Without `local/mapping.json` the server runs in demo mode.

API (read-only, `GET` only): `/api/health`, `/api/entities`,
`/api/series/<name>?range=1h|24h|7d|31d`. Every Influx request times out after 10 s; the
page then shows "keine Daten" with the reason and a retry button, never endless loading.

## Scripts

| Command            | What it does                                                |
| ------------------ | ----------------------------------------------------------- |
| `pnpm lint`        | ESLint + Prettier check                                     |
| `pnpm check`       | Type check (svelte-check)                                   |
| `pnpm test`        | Unit tests (Vitest)                                         |
| `pnpm build`       | Static build into `dist/`, server into `dist-server/`       |
| `pnpm start`       | Run the server (serves `dist/` and the API)                 |
| `pnpm budget`      | Fail if the first page loads more than 200 KB JavaScript    |
| `pnpm test:visual` | Screenshots Mac 1440×900 and iPhone 390×844, light and dark |

Screenshots are written to `screenshots/` (and uploaded as a CI artifact) to be looked at
by a person. The visual test also checks: no horizontal scrolling, no emoji, touch targets
≥ 44 px, text ≥ 14 px on the phone, and that ⓘ opens on tap, not on hover.

## Layout

```
src/model/       data model (entities, series, forecasts, ratings) and helpers
src/demo/        synthetic demo household with deliberate gaps and a sensor artifact
src/components/  building blocks (Tile, Sparkline, Progress, …)
src/i18n/        German and English UI texts
src/styles/      design tokens, light and dark
src/app/         app shell, router, shared tile definitions, data questions
src/pages/       Overview, Now, Forecasts
src/gallery/     gallery page
src/adapters/    InfluxDB 1.x adapter (query builder, parser, client)
server/          read-only Node server: config, mapping schema, API, static files
local/           your mapping.json (git-ignored); mapping.example.json is made up
tests/unit/      Vitest
tests/visual/    Playwright
```

## Building blocks

| Component        | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `Tile`           | value + 1–2 words + one small graphic (ring, scale, spark), ⓘ     |
| `TileRow`        | 2–6 tiles; two per row on the phone                               |
| `Sparkline`      | soft line, optional range band, gaps stay open                    |
| `Progress`       | bar 0–100 % with a word; "open" instead of a fake 100 %           |
| `AccuracyCard`   | model accuracy: bar, trend, n, level (good / fair / poor / open)  |
| `DayList`        | days as rows like a weather app, yield with range                 |
| `SoftTimeSeries` | uPlot: actual line, separate forecast line with band, period pick |
| `SourceArc`      | where the power comes from right now (sun / battery / grid)       |
| `StatusBar`      | areas as calm dots; colour only when action is needed             |
| `Tabs`           | main areas; compact icon bar on the phone                         |
| `Explanation`    | content behind ⓘ: what it means, where the number comes from      |

## Principles

- First level is tiles with a small graphic; tables only as a second section.
- Every approximation shows its range and n. Forecasts get their own line.
- Gaps stay visible. Meter readings beat integrated power.
- Hints only when action is needed.

## Privacy

No real household data in this repository – no addresses, IPs, floor plans or
screenshots of real homes. Credentials belong in `.env` (git-ignored).

## License

[MIT](LICENSE) © allawallabedalla
