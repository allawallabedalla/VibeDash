# Changelog

## Unreleased

- **Laden: Automatik / Jetzt voll laden** (car module, `steuerung`): forwards to the house's charge control;
  force = 16 A incl. grid power until full, unplugged or back to automatic.

- **Choice section** on boards (`choice`, action `choose` with a value). First use: "Wie mutig laden?" on the
  charging page – Sicher / Mittel / Mutig until midnight, with what the car would get per level.

- **Modules (`modules/`):** tools that make a whole tab, shipped with VibeDash and switched on by a
  config in `local/modules/`. First module **Wartung** (maintenance plan): maintenance day as a walk,
  service appointments with lead time, open items with appointments, tick off / note / later / undo,
  calendar subscription (`/feed/wartung/kalender.ics`), starter plan as a template. Python standard
  library only; Docker image, user unit, starter pack, release script and CI include it. Boards may
  name a `module` instead of a `url`.

## 0.1.0 – first usable version

Display only: VibeDash reads and shows; it never switches a device.

- **Pages:** Overview, Now, Forecasts, Charging; gallery of all building blocks. German and
  English, light and dark, Mac and iPhone layouts.
- **Data:** demo household (synthetic), InfluxDB 1.x, Home Assistant (history + hourly
  long-term statistics), evcc (now + stored charging sessions). Named series only
  (`local/mapping.json`, checked at start), 10 s timeouts, read-only users.
- **Data truth:** gaps stay visible, meter readings over integrals, resets as questions,
  "being checked" until the person confirms a value, "data missing since …".
- **Weather:** Open-Meteo with the location rounded to ~1 km, found automatically; can be
  switched off (`WEATHER=off`).
- **Forecasting service (Python, optional):** method ladder (rules of thumb → Ridge →
  boosting, each only if better by ≥ 2 standard errors, paired), same lead time in the
  backtest and live, honest accuracy ("collecting", "open · n", %).
- **Hourly PV forecast (M11):** roof planes, GTI per plane, analog days, p10/p50/p90.
- **Charge plan, stage A (M12/M12b):** load model, 300 scenario pairings, battery
  simulation, cautious plan (no extra grid import in 30 of 31 cases), backtest with hourly
  replanning, "what if …?" in the browser. Planning and showing only.
- **Docker:** `node:24-alpine` (non-root), forecasting image `python:3.13-slim`.

Not included: charging control (stage B, M13 – needs ≥ 4 weeks of stage A live and the
grid-operator question settled), device templates (M10).
