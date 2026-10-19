# VibeDash modules

Tools that make a whole tab in VibeDash – shipped with VibeDash, switched on per house by a config
file. They run as one small local service (Python 3.11+, **standard library only**, nothing to
install). Only the VibeDash server talks to it; the browser never does.

| Module     | Tab     | What it does                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wartung`  | Wartung | Maintenance plan: maintenance day as a walk through the house (time budget, most urgent first), service appointments with lead time, open one-off items (also with a time), tick off / note / acknowledge / later / undo, calendar subscription for the phone (one event per Saturday)                                                                      |
| `raeume`   | Räume   | Floor plan with live values per room (temperature, humidity, valve, light, motion), tap a room for all values, today's light and motion to play back, optional 3D view. Only reads.                                                                                                                                                                         |
| `garten`   | Garten  | Garden weather (today, tomorrow, frost in the next 3 days, rain of the week), rain per day (7/30 days back, 3 ahead), garden tips with history. Weather from the house's InfluxDB or straight from Open-Meteo. Only reads.                                                                                                                                  |
| `auto`     | Auto    | The car: state of charge, when to plug in, course without charging, sun for the car, driving profile, charges seen by the car, model accuracy, the car's own data, and a calculator "plug in at …" (weekday + time) that asks the house's charge planner. Only reads and calculates. Shown on the charging page with `onPage: "charging"` (one tab "Auto"). |
| `gebaeude` | Gebäude | What the measurements say about the building: cooling down (τ), heat storage, sun gain, heat pump per degree and time of day, hot water in the PV time, tilted window, front door, PV forecast per weather – each with range and n – and the levers that follow. Shows the result of a daily analysis. Only reads.                                          |
| `knx`      | KNX     | Light and operation over 7 days, defects, reports per kind, light per day, daily rhythm, night activity, best light ideas, light per room – the KNX results of the house program. Only reads.                                                                                                                                                               |
| `knxlog`   | KNX-Log | The last 24 hours on the bus: telegrams (values decoded), devices with their last sign of life, light, presence, doors, defects, traffic per 15 min. Only reads.                                                                                                                                                                                            |

## Switch a module on

1. Copy `templates/<name>.json` to `local/modules/<name>.json` (the modules folder, `MODULES_DIR`).
2. For `wartung` also copy `templates/wartungsplan.json` (a general starter plan) and adapt it with the
   person (move-in date, places, tasks). For `raeume` draw the house's floor plan in the format of
   `templates/raeume_haus.json`. Never put a real house's plan into the repo.
3. Add the tab to `local/mapping.json`:
   `{ "id": "wartung", "title": "Wartung", "icon": "wrench", "module": "wartung" }`.

No config file = module off. The service reads configs on every request (no restart needed).

## Run

- **Docker:** service `modules` in `compose.example.yaml` / `starter/compose.yaml`; `./local/modules`
  is mounted at `/data`.
- **User unit:** `deploy/vibedash-modules.service` runs the code of the live release
  (`~/.local/share/vibedash/current/modules`) with `MODULES_DIR=~/.config/vibedash/local/modules`;
  `scripts/release.sh` copies `modules/` into each release, restarts the unit and checks `/gesund`.
- **By hand:** `cd modules && MODULES_DIR=../local/modules python3 -m vibedash_modules`
  (127.0.0.1:8091; `MODULES_HOST`, `MODULES_PORT`).

The VibeDash server finds it at `MODULES_URL` (default `http://127.0.0.1:8091`).

## HTTP (internal)

|                               |                                                                       |
| ----------------------------- | --------------------------------------------------------------------- |
| `GET /gesund`                 | `{ok, modules, errors}`                                               |
| `GET /board/<module>`         | board JSON (contract: `src/model/board.ts`)                           |
| `POST /board/<module>/action` | `{board, item, action, text?, date?}`, header `X-VibeDash-Action: 1`  |
| `GET /feed/<module>/<file>`   | e.g. `kalender.ics`; VibeDash passes it on at `/feed/<module>/<file>` |

## Module `wartung` – config keys

| Key                             | Meaning                                                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`, `notizen`, `protokoll`  | files (relative to the modules folder): plan, notes, action log (.jsonl)                                                                                                                                                         |
| `sprache`, `zeitzone`           | `de`/`en`, e.g. `Europe/Berlin`                                                                                                                                                                                                  |
| `bereiche`                      | `[{id, titel}]` – areas of the plan (`gruppen[].bereich`) in board order                                                                                                                                                         |
| `layout`                        | order of the board: `kern`, `plan:<bereich>`, `plan:*`, `einschub:<teil>` (default `["kern","plan:*"]`)                                                                                                                          |
| `ort_zeigen`                    | areas whose items also show the station                                                                                                                                                                                          |
| `kalender_url`                  | the feed address as the phone sees it, shown on the board (e.g. `http://<host>:<port>/feed/wartung/kalender.ics`)                                                                                                                |
| `kalender_uid`, `kalender_name` | UID domain and name of the calendar                                                                                                                                                                                              |
| `fahrzeug`                      | optional `{status, name, werkstatt}` – vehicle inspection from a status file `{wartung_tage, abgerufen}`                                                                                                                         |
| `einschub_url`                  | optional house service: `{"teile": {teil: [sections]}, "werte": {key: text}, "kacheln": [tiles]}` – the house's own sections in the tab (`einschub:<teil>` in `layout`), readings next to tasks with `"daten": key`, extra tiles |
| `texte`                         | optional wording overrides (keys in `wartung/board.py`, `TEXT`)                                                                                                                                                                  |

The plan format (field names in German, as the person reads them) is described at the top of
`vibedash_modules/wartung/plan.py` and in `templates/wartungsplan.json`. Ticking off writes the plan
atomically under a file lock (`<plan>.lock`), so a house script may share the file.

## Module `raeume` – config keys

| Key             | Meaning                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grundriss`     | `{haus, waende?, modell3d?}` – plan files (relative to the modules folder or absolute). `haus`: floors with rooms (`id`, `name`, `art`, `polygon` in metres, `zentrum`, `flaeche_m2`, `knx` = the room's names in the series)                                                          |
| `influx`        | `{url, db}` (+ optional `klima`, `feld`, `tag_typ`, `tag_raum`, `helligkeit`, `helligkeit_feld`) – InfluxDB 1.x, read only: last value per room tag of `raumklima` (`typ` ist, ist_matter, ist_decke, soll, stellgroesse, feuchte, aussen_temp, aussen_feuchte) and `helligkeit` (lux) |
| `namen`         | `{room_id: [names]}` – more names of a room in the series                                                                                                                                                                                                                              |
| `gleicher_raum` | `{room_id: room_id}` – a room without own readings shows another room's climate (open-plan rooms, one heating zone)                                                                                                                                                                    |
| `zeitzone`      | day start of the light/motion timeline, default `Europe/Berlin`                                                                                                                                                                                                                        |
| `einschub_url`  | optional house service for light and motion of today (`?seit=<ms>`): `{"licht": {"vorher": [[raum, quelle, an]], "wechsel": [[ts, raum, quelle, an]]}, "bewegung": [[ts, raum]], "letzte_bewegung": {room_id: ts}}` (see `raeume/board.py`)                                            |
| `texte`         | optional wording overrides (keys in `raeume/board.py`, `TEXT`; floor names as `floor_<id>`)                                                                                                                                                                                            |

## Module `garten` – config keys

| Key        | Meaning                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wetter`   | `influx` (the house keeps daily weather in InfluxDB) or `open-meteo` (fetched by the module, cached 1 h); default `influx` when `influx.db` is set                                                |
| `influx`   | `{url, db, measurement?}` – daily weather, read only: tag `art` = `gemessen` / `prognose`, fields `tmax`, `tmin`, `regen_mm`, `sonne_h`, time = local midnight (default measurement `wetter_tag`) |
| `standort` | `{lat, lon}` – location for `open-meteo`                                                                                                                                                          |
| `tipps`    | optional tip history `[{"date": "YYYY-MM-DD", "tip": "- …\n- …"}]`, newest last – written by a tip writer (e.g. an LLM job of the house)                                                          |
| `zeitzone` | default `Europe/Berlin`                                                                                                                                                                           |
| `texte`    | optional wording overrides (keys in `garten/board.py`, `TEXT`)                                                                                                                                    |

## Module `auto` – config keys

| Key                       | Meaning                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `betrieb`                 | `aus` (default: only show the forecast file), `schatten` (compute the forecast from the account files into `schatten_prognose`, no call to the maker, nothing else written) or `an` (fetch, compute and write every `takt_min`) |
| `prognose`                | the forecast file the board shows (written in `an`; format at the top of `vibedash_modules/auto/board.py`)                                                                                                                      |
| `konto`                   | `{app, token, status, fahrten}` – the maker's account (`auto/hersteller.py`, Stellantis first): app keys, token (rewritten, mode 600), status and trips without location                                                        |
| `plan`                    | optional charge plan of the house (`{tage: [{tag, kwh, kwh_p90, pv_kwh, bloecke}]}`) – sun for the car                                                                                                                          |
| `influx`                  | optional `{url, db, wallbox: {measurement, feld}, schreiben}` – wallbox meter (read); with `schreiben` the history `auto_cloud`, `auto_fahrt`, `auto_prognose` is written (`an` only)                                           |
| `takt_min`, `versatz_min` | default 15 and 9 (runs at :09, :24, :39, :54); the service skips the first slot after a start                                                                                                                                   |
| `herzschlag`              | optional `{abruf, prognose}` – files touched after a good run (for the house's watchdogs)                                                                                                                                       |
| `zeitzone`                | e.g. `Europe/Berlin` (day start of the calculator)                                                                                                                                                                              |
| `rechner`                 | optional `{url, tage}` – the house's charge planner: `POST {board, value}` (value = day × 1440 + minutes, local) with header `X-Haus-Rechnung: 1` answers `{"sections": [...]}` and changes nothing; empty = no calculator      |
| `texte`                   | optional wording overrides (keys in `auto/board.py` `TEXT` and `auto/__init__.py` `CALC`), e.g. the maker's account and app name                                                                                                |

First sign-in to the maker's account (once, by hand; the person opens the address and pastes back the
redirect address): `python3 -m vibedash_modules.auto.hersteller login-url <app.json>`, then
`… code <app.json> <token.json> <redirect address>`. Modules with a period run in their own thread of the
service (`app.ticker`), never in a request.

Sections carry `slot` (`top`, `plan`): the charging page shows them above its own tiles, after its plan,
the rest at the end. Mapping: `{ "id": "auto", "title": "Auto", "icon": "plugCar", "module": "auto", "onPage": "charging" }`.

## Module `gebaeude` – config keys

| Key         | Meaning                                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ergebnis`  | path of the result file the daily building analysis writes (relative to the modules folder or absolute); its modification time is the board's "as of"                       |
| `kennwerte` | building data the analysis uses: `h_wk` (heat loss W/K, energy certificate), `flaechen` {room: m²}, `ventile` {room: [valve series]}, `raum_namen`, `haus_raeume`, `og_ref` |
| `texte`     | optional wording overrides (keys in `gebaeude/board.py`, `TEXT`)                                                                                                            |

Result file: `{"auskuehlen", "sonne", "wp_tageszeit", "warmwasser", "pv_prognose", "kippfenster", "haustuer"}`, each
`{status: ok | sammelt | fehler, text: method, …values}` – the fields per part are listed in `gebaeude/board.py`
and `tests/test_gebaeude.py`. A part that is not `ok` shows as "collecting" or is left out.

## Module `knx` – config keys

| Key            | Meaning                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `einschub_url` | house service with the KNX results (`?bis=<ms>`): `{kopf, defekte, arten, tage: {7d, 30d, 90d}, alltag, profil, nacht: {7d, 30d, 90d}, karten, licht}` (fields in `knx/board.py`) |
| `zeitzone`     | default `Europe/Berlin`                                                                                                                                                           |

## Module `knxlog` – config keys

| Key                                  | Meaning                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `einschub_url`                       | house service with the raw data of the last 24 h (`?von=&bis=` in ms): `{telegramme: [[ms, ga, name, source, raw]], tueren: [[ms, name, open]], protokoll: [{zeit, raum, was, wie}]}` |
| `inventar`                           | device list and group address names (`templates/knx_inventar.json`), default `knx_inventar.json` – exported from the house's ETS project, never into the repo                         |
| `gruppen`                            | `[{label, color, prefix: [main groups]}]` – lines of "traffic per 15 min"                                                                                                             |
| `messwerte`, `stellgroessen`         | group address prefixes of cyclic readings and valve values (left out of lists)                                                                                                        |
| `tuer_prefix`, `prozent_prefix`      | 1 bit shown as open/closed; 1 byte shown as %                                                                                                                                         |
| `bridge`                             | optional `{adresse, name}` of a bridge/visualisation that sends on the bus                                                                                                            |
| `ohne_anlass`, `ohne_anlass_name`    | devices (addresses, name beginnings) that only send on occasion – not marked when silent                                                                                              |
| `arten`                              | `[[name beginning, kind]]` – device kinds for "telegrams per kind"                                                                                                                    |
| `raum_namen`, `tueren`, `tuer_sonst` | room renames; door names (`{enthaelt, name}`)                                                                                                                                         |
| `zeitzone`                           | default `Europe/Berlin`                                                                                                                                                               |

## Tests

`python3 -m unittest discover -s tests -t .` (synthetic house only), lint with `ruff` (CI).
