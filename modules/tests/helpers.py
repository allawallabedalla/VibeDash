"""Synthetic test house: a temp modules folder with the starter plan and a fixed clock."""

import json
import os
import shutil
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

TEMPLATES = os.path.join(os.path.dirname(__file__), "..", "templates")
TZ = ZoneInfo("Europe/Berlin")


def at(y, m, d, h=12):
    return datetime(y, m, d, h, tzinfo=TZ).timestamp()


def folder(plan_patch=None, cfg_patch=None):
    base = tempfile.mkdtemp(prefix="vd-modules-")
    with open(os.path.join(TEMPLATES, "wartungsplan.json"), encoding="utf-8") as f:
        plan = json.load(f)
    plan.update(plan_patch or {})
    with open(os.path.join(base, "wartungsplan.json"), "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False)
    with open(os.path.join(TEMPLATES, "wartung.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.update(cfg_patch or {})
    with open(os.path.join(base, "wartung.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False)
    return base


def cleanup(base):
    shutil.rmtree(base, ignore_errors=True)
