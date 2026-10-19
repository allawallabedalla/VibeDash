"""Command line of the floor plan tool. Run by the setup agent (AGENT.md "Grundriss"), never by the dashboard:

  uv run python -m vibedash_grundriss pruefen   <haus.json>
  uv run python -m vibedash_grundriss ergaenzen <haus.json>               fills missing area, label points, view
  uv run python -m vibedash_grundriss modell    <haus.json> [--waende-neu] writes waende_plan.json (only if missing,
                                                                         or with --waende-neu) and modell3d.json
  uv run python -m vibedash_grundriss vorschau  <haus.json> [<out.svg>]  preview to compare with the drawing

Output files go next to haus.json. Exit code 1 when the plan has errors.
"""

from __future__ import annotations

import json
import os
import sys

from . import model3d, plan, vorschau


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("pruefen", "ergaenzen", "modell", "vorschau"):
        print(__doc__)
        return 2
    cmd, path = argv[0], argv[1]
    folder = os.path.dirname(os.path.abspath(path))
    haus = plan.load(path)
    errors, warnings = plan.check(haus)
    for e in errors:
        print("FEHLER", e)
    for w in warnings:
        print("Hinweis", w)
    if errors:
        return 1
    if cmd == "pruefen":
        n = sum(1 for _ in plan.rooms(haus))
        print(f"ok: {len(haus['geschosse'])} Geschosse, {n} Räume")
        return 0
    if cmd == "ergaenzen":
        done = plan.complete(haus)
        if done:
            plan.save(path, haus)
        print(f"ergänzt: {len(done)}" + "".join(f"\n  {d}" for d in done))
        return 0
    walls_path = os.path.join(folder, "waende_plan.json")
    walls = None
    if os.path.exists(walls_path) and "--waende-neu" not in argv:
        walls = plan.load(walls_path)
        print("Wände: vorhandene waende_plan.json bleibt")
    if cmd == "vorschau":
        out = argv[2] if len(argv) > 2 and not argv[2].startswith("--") else os.path.join(folder, "vorschau.svg")
        with open(out, "w", encoding="utf-8") as f:
            f.write(vorschau.svg(haus, walls if walls is not None else model3d.walls(haus)))
        print("Vorschau:", out)
        return 0
    if walls is None:
        walls = model3d.walls(haus)
        plan.save(walls_path, walls)
        print("Wände:", {g: len(v) for g, v in walls.items()}, "->", walls_path)
    m = model3d.model(haus, walls)
    out = os.path.join(folder, "modell3d.json")
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False)
    os.replace(tmp, out)
    print(
        "3D:",
        {g["id"]: len(g["waende"]) for g in m["geschosse"]},
        "Dach",
        (m.get("dach") or {}).get("form", "keins"),
        "Treppen",
        len(m["treppen"]),
        "Blöcke",
        len(m["bloecke"]),
        "->",
        out,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
