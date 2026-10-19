import copy
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

import pytest
from shapely.geometry import Polygon
from shapely.ops import unary_union

from vibedash_grundriss import model3d, plan, vorschau

DEMO = os.path.join(os.path.dirname(__file__), "..", "demo", "haus.json")


@pytest.fixture
def haus():
    return plan.load(DEMO)


def test_demo_is_valid(haus):
    errors, warnings = plan.check(haus)
    assert errors == []
    assert warnings == ["OG/flur_og: keine Messreihen-Namen (knx) – der Raum bleibt ohne Werte"]


@pytest.mark.parametrize(
    "change, expect",
    [
        (lambda h: h["geschosse"][0]["raeume"][1].update(id="wohnen"), "id doppelt"),
        (lambda h: h["geschosse"][0]["raeume"][0].update(polygon=[[0, 0], [1, 1]]), "weniger als 3 Punkte"),
        (lambda h: h["geschosse"][0]["raeume"][0].update(polygon=[[0, 0], [6, 5], [6, 0], [0, 5]]), "kreuzt sich"),
        (lambda h: h["geschosse"][0]["raeume"][0].update(art="keller"), "unbekannt"),
        (lambda h: h["geschosse"][0]["raeume"][1].update(polygon=[[3, 0], [9, 0], [9, 3.5], [3, 3.5]]), "überlappen"),
        (lambda h: h.update(geschosse=[]), "keine Geschosse"),
    ],
)
def test_check_finds_errors(haus, change, expect):
    change(haus)
    errors, _ = plan.check(haus)
    assert any(expect in e for e in errors), errors


def test_scale_warning(haus):
    haus["geschosse"][0]["raeume"][0]["polygon"] = [[0, 0], [600, 0], [600, 500], [0, 500]]
    _, warnings = plan.check(haus)
    assert any("Zentimeter" in w for w in warnings)


def test_complete_fills_only_missing(haus):
    haus["geschosse"][0]["raeume"][0]["flaeche_m2"] = 29.5  # given by the plan – stays
    done = plan.complete(haus)
    wohnen, kueche = haus["geschosse"][0]["raeume"][:2]
    assert wohnen["flaeche_m2"] == 29.5
    assert kueche["flaeche_m2"] == 10.08
    assert haus["ausschnitt"] == [-1.0, -4.0, 14.0, 8.0]
    assert all(r.get("zentrum") and r.get("zentrum_sichtbar") for _, r in plan.rooms(haus))
    assert Polygon(kueche["polygon"]).contains(Polygon([kueche["zentrum_sichtbar"]] * 3).centroid)
    again = copy.deepcopy(haus)
    assert plan.complete(again) == [] and again == haus  # idempotent
    assert len(done) > 20


def test_walls_between_rooms_not_on_them(haus):
    w = model3d.walls(haus)
    for g in haus["geschosse"]:
        rooms = unary_union([Polygon(r["polygon"]) for r in g["raeume"]])
        pieces = [Polygon(p) for p in w[g["id"]]]
        assert pieces and all(p.is_valid and not p.interiors for p in pieces)
        assert unary_union(pieces).intersection(rooms).area < 0.05  # walls stay outside the rooms
        assert all(p[0] == p[-1] for p in w[g["id"]])  # closed: the plan draws them as lines
    eg = unary_union([Polygon(p) for p in w["EG"]])
    assert eg.intersects(Polygon([(2, 4.95), (3, 4.95), (3, 5.17), (2, 5.17)]))  # wall between Wohnen and Bad
    assert not eg.intersects(Polygon([(6.01, 1), (6.11, 1), (6.11, 2), (6.01, 2)]))  # Wohnen/Küche open


def test_model(haus):
    m = model3d.model(haus)
    assert [g["id"] for g in m["geschosse"]] == ["EG", "OG"]
    eg, og = m["geschosse"]
    assert (eg["boden"], eg["hoehe"], og["boden"], og["hoehe"]) == (0.0, 2.6, 2.9, 2.5)
    assert og["gelaender"] and og["gelaender"][0]["hoehe"] == 1.0
    assert m["dach"]["form"] == "sattel" and set(m["dach"]["flaechen"]) == {"a", "b"}
    assert m["dach"]["first"] > m["dach"]["traufe"]
    assert m["treppen"] == [{"x0": 3.17, "x1": 5.95, "y0": 5.12, "y1": 7.0, "stufen": 15, "hoehe": 2.9}]
    assert m["bloecke"][0]["height"] == 3.0 and m["bloecke"][0]["walls"]


@pytest.mark.parametrize("form, faces", [("walm", 4), ("flach", 1), (None, 0)])
def test_roof_forms(haus, form, faces):
    haus["modell"]["dach"]["form"] = form
    m = model3d.model(haus)
    assert len((m.get("dach") or {}).get("flaechen", {})) == faces


def test_model_keeps_given_walls(haus):
    own = {"EG": [[[0, -0.3], [9, -0.3], [9, 0], [0, 0]]], "OG": []}
    m = model3d.model(haus, own)
    assert len(m["geschosse"][0]["waende"]) == 1
    assert m["geschosse"][1]["waende"] == []


def test_preview_is_svg(haus):
    plan.complete(haus)
    root = ET.fromstring(vorschau.svg(haus, model3d.walls(haus)))
    texts = [t.text for t in root.iter("{http://www.w3.org/2000/svg}text")]
    assert "Wohnen" in texts and "30,0 m²" in texts and "OG" in texts


def test_cli(tmp_path):
    shutil.copy(DEMO, tmp_path / "haus.json")
    run = lambda *a: subprocess.run([sys.executable, "-m", "vibedash_grundriss", *a], capture_output=True, text=True)  # noqa: E731
    assert run("pruefen", str(tmp_path / "haus.json")).returncode == 0
    assert run("ergaenzen", str(tmp_path / "haus.json")).returncode == 0
    assert "flaeche_m2" in (tmp_path / "haus.json").read_text(encoding="utf-8")
    r = run("modell", str(tmp_path / "haus.json"))
    assert r.returncode == 0, r.stdout + r.stderr
    assert json.loads((tmp_path / "modell3d.json").read_text())["geschosse"]
    walls = (tmp_path / "waende_plan.json").read_text()
    (tmp_path / "waende_plan.json").write_text('{"EG": [], "OG": []}')
    assert "bleibt" in run("modell", str(tmp_path / "haus.json")).stdout  # own walls are kept
    run("modell", str(tmp_path / "haus.json"), "--waende-neu")
    assert (tmp_path / "waende_plan.json").read_text() != '{"EG": [], "OG": []}' and walls
    assert run("vorschau", str(tmp_path / "haus.json")).returncode == 0
    assert (tmp_path / "vorschau.svg").exists()
    broken = json.loads((tmp_path / "haus.json").read_text())
    broken["geschosse"][0]["raeume"][1]["id"] = "wohnen"
    (tmp_path / "haus.json").write_text(json.dumps(broken))
    r = run("pruefen", str(tmp_path / "haus.json"))
    assert r.returncode == 1 and "FEHLER" in r.stdout
