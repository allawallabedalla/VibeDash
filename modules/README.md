# VibeDash modules

Tools that make a whole tab in VibeDash – shipped with VibeDash, switched on per house by a config
file. They run as one small local service (Python 3.11+, **standard library only**, nothing to
install). Only the VibeDash server talks to it; the browser never does.

| Module    | Tab     | What it does                                                                                                                                                                                                                                                                           |
| --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wartung` | Wartung | Maintenance plan: maintenance day as a walk through the house (time budget, most urgent first), service appointments with lead time, open one-off items (also with a time), tick off / note / acknowledge / later / undo, calendar subscription for the phone (one event per Saturday) |
| `raeume`  | Räume   | Floor plan with live values per room (temperature, humidity, valve, light, motion), tap a room for all values, today's light and motion to play back, optional 3D view. Only reads.                                                                                                    |

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

## Tests

`python3 -m unittest discover -s tests -t .` (synthetic house only), lint with `ruff` (CI).
