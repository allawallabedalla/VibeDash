# VibeDash

Calm home dashboards for smart homes, solar, heat pumps and EVs – composed by an AI agent
from a fixed set of design building blocks, on top of checked data.

VibeDash is not one big app. It ships three things:

1. a **design language** (building blocks: tiles, sparklines, progress bars, …),
2. **data adapters** (demo data first; InfluxDB, generic JSON API and Home Assistant later),
3. a **build guide for the agent** that assembles one dashboard per home.

Everything runs locally. No cloud, no CDN.

> Status: early (milestones M0–M2). Three pages (Overview, Now, Forecasts) and a gallery
> of all building blocks, running on synthetic demo data. Agent build guide: [AGENT.md](AGENT.md). Project background and roadmap (German): [ANLEITUNG.md](ANLEITUNG.md).

## Quick start

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm dev          # http://localhost:5173 (#/, #/now, #/forecasts, #/gallery; ?lang=de|en, ?theme=light|dark)
```

## Scripts

| Command            | What it does                                                |
| ------------------ | ----------------------------------------------------------- |
| `pnpm lint`        | ESLint + Prettier check                                     |
| `pnpm check`       | Type check (svelte-check)                                   |
| `pnpm test`        | Unit tests (Vitest)                                         |
| `pnpm build`       | Static build into `dist/`                                   |
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
