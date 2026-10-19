# Floor plan tool

Turns a house plan (`haus.json`, the format the Räume tab reads) into what the tab needs: checked, with areas
and label points filled in, walls and a 3D model. **Run by the setup agent** (AGENT.md, "Floor plan"), never
by the dashboard – it has its own environment because it needs `shapely`.

```
cd tools/grundriss && uv sync
uv run python -m vibedash_grundriss pruefen   <haus.json>   # errors (exit 1) and hints
uv run python -m vibedash_grundriss ergaenzen <haus.json>   # fills missing area, label points, visible area
uv run python -m vibedash_grundriss modell    <haus.json>   # waende_plan.json (kept if present) + modell3d.json
uv run python -m vibedash_grundriss vorschau  <haus.json>   # vorschau.svg to compare with the drawing
```

- Format: top of `vibedash_grundriss/plan.py`; 3D settings (`modell`: walls, open rooms, railings, roof,
  separate blocks, stairs): top of `vibedash_grundriss/model3d.py`.
- `demo/haus.json` is a made-up house for tests and trying things out. A real plan stays in `local/`.
- Walls are an approximation (outer wall around the rooms, gaps between rooms as inner walls). Walls read
  from a drawing can be written to `waende_plan.json` before `modell` – the tool keeps them.
- Tests: `uv run pytest -q`, style `uv run ruff format --check . && uv run ruff check .` (CI job `grundriss`).
