"""Boards of every module, built from the synthetic fixtures of the existing tests (no house data).

Used by test_regeln.py (the rule checker must find nothing) and, with `python3 -m tests.boards` (in modules/), to
write the boards as JSON for the visual rule test (tests/visual/fixtures/boards/, G-34). test_regeln fails when those
files are older than the modules: then run the command again and commit the files.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from unittest import mock


def _run(cls, build):
    """setUp of an existing test class, build(test) -> board, tearDown."""
    t = cls()
    t.setUp()
    try:
        return build(t)
    finally:
        t.tearDown()
        t.doCleanups()


def _wartung():
    from .test_module import TestWartung

    return _run(TestWartung, lambda t: t.mod.board())


def _raeume():
    from .test_raeume import TestRaeume

    return _run(TestRaeume, lambda t: t.mod().board())


def _garten():
    from .test_garten import TestGartenSensor

    return _run(TestGartenSensor, lambda t: t.mod(t.area_cfg()).board())


def _auto():
    from vibedash_modules.auto import Module

    from .test_auto import TestAuto
    from .test_auto_zeitstrahl import _file

    def build(t):
        zs = _file(["2026-10-19", "2026-10-20"])  # charge timeline: today and tomorrow of the test clock
        t.addCleanup(shutil.rmtree, os.path.dirname(zs), True)
        cfg = {
            **t.cfg,
            "risiko": {"datei": "risiko.json"},
            "steuerung": {"status_url": "http://haus.invalid/s"},
            "zeitstrahl": zs,
        }
        m = Module(cfg, t.mod.path, post=lambda u, b: (200, {"sections": []}), clock=t.mod.clock)
        lage = {"knoepfe": {"aktiv": "automatik"}, "text": "wartet", "laeuft": False, "erzwungen": False}
        with mock.patch("vibedash_modules.auto.steuerung.status", return_value=lage):
            return m.board()

    return _run(TestAuto, build)


def _gebaeude():
    from .helpers import at
    from .test_gebaeude import RESULT, TestGebaeude

    def build(t):
        t.write(RESULT)
        stand = at(2026, 10, 19, 6)  # "updated" comes from the file time: fixed, so the board is the same every run
        os.utime(t.file, (stand, stand))
        return t.board()

    return _run(TestGebaeude, build)


def _knx():
    from .test_knx import NOW, Knx, TestKnx

    def build(t):
        return Knx(
            {"einschub_url": "http://haus.invalid/knx"}, lambda p: p, lambda u, tt=60: t.data, lambda: NOW
        ).board()

    return _run(TestKnx, build)


def _knxlog():
    from .test_knx import TestKnxLog

    return _run(TestKnxLog, lambda t: t.mod().board())


def _ml():
    from .test_ml_korrelation import TestMl

    return _run(TestMl, lambda t: t.board())


def _korrelation():
    from .test_ml_korrelation import TestKorrelation

    return _run(TestKorrelation, lambda t: t.board())


def _druck():
    from .test_druck import NOW, DruckTest, status

    def build(t):
        t0 = int(NOW * 1000)
        t.history([{"t": t0 - 600_000 + k * 60_000, "s": "PRINTING", "j": 7, "p": 1.0 + 4 * k} for k in range(10)])
        return t.mod(status())[0].board()

    return _run(DruckTest, build)


def _saugroboter():
    from vibedash_modules.saugroboter import Module

    from .test_saugroboter import NOW, TestAktionen, TestSaugroboter

    def build(t):
        live = _run(TestSaugroboter, lambda s: s)  # its fetch answers with the synthetic robot values
        return Module(t.cfg, lambda p: os.path.join(t.base, p), live.fetch, lambda: NOW).board()

    return _run(TestAktionen, build)


def _updates():
    from .test_updates import TestUpdates

    return _run(TestUpdates, lambda t: t.mod().board())


def _wasser():
    from vibedash_modules.wasser import board

    from .helpers import TZ
    from .test_wasser import LIVE, NOW, tag

    # a synthetic household to the minute (WC, shower, machine fillings) with 3 nights of use: the hint shows too;
    # without "personen" as before (its line chart has the small SVG axis text of DE4-11)
    return board.build(tag(night_l=3, days=10), dict(LIVE), NOW, TZ, board.TEXT)


BUILDERS = {
    "wartung": _wartung,
    "raeume": _raeume,
    "garten": _garten,
    "auto": _auto,
    "gebaeude": _gebaeude,
    "knx": _knx,
    "knxlog": _knxlog,
    "ml": _ml,
    "korrelation": _korrelation,
    "druck": _druck,
    "saugroboter": _saugroboter,
    "updates": _updates,
    "wasser": _wasser,
}


FIXTURES = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "visual", "fixtures", "boards")


def all_boards() -> dict[str, dict]:
    return {name: build() for name, build in BUILDERS.items()}


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else FIXTURES
    os.makedirs(out, exist_ok=True)
    for name, b in all_boards().items():
        with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(b, f, ensure_ascii=False, separators=(",", ":"), default=str)
            f.write("\n")
        print(name, len(b.get("sections", [])), "sections")
