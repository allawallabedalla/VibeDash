"""Find and load module configs: <MODULES_DIR>/<name>.json (MODULES_DIR default local/modules)."""

from __future__ import annotations

import importlib
import json
import os
import sys

from . import KNOWN


def modules_dir() -> str:
    return os.path.abspath(os.environ.get("MODULES_DIR", "local/modules"))


def load_modules(base: str | None = None) -> dict:
    """-> {"modules": {name: Module}, "errors": {name: text}, "dazu": {name: [other names]}} for every known module
    with a readable config file. Broken configs are reported, not fatal: one module must not stop the others.
    "dazu" (optional config key): modules whose sections are shown below this module's own, on the same tab, and
    whose buttons work there too – two modules on one tab (Audit05: fewer tabs). Each entry is a module name or
    {"modul": name, "nur": [section title or type, …]} to bring only some of its sections.
    "mehr" (optional config key, list of section titles): these sections wait behind "Details" at the end of the tab
    (second level, nothing is lost; also for sections brought by "dazu")."""
    base = base or modules_dir()
    out, errors, dazu, mehr = {}, {}, {}, {}
    for name in KNOWN:
        f = os.path.join(base, f"{name}.json")
        if not os.path.exists(f):
            continue
        try:
            with open(f, encoding="utf-8") as fh:
                cfg = json.load(fh)
            if not isinstance(cfg, dict):
                raise ValueError("config must be a JSON object")
            mod = importlib.import_module(f".{name}", __package__)

            def path(p, _base=base):
                return p if os.path.isabs(p) else os.path.join(_base, p)

            extra = _dazu(cfg.pop("dazu", None))
            more = cfg.pop("mehr", None)
            if more is not None and not (isinstance(more, list) and all(isinstance(x, str) for x in more)):
                raise ValueError("mehr must be a list of section titles")
            out[name] = mod.Module(cfg, path)
            if extra:
                dazu[name] = {k: v for k, v in extra.items() if k in KNOWN and k != name}
            if more:
                mehr[name] = more
        except Exception as e:  # noqa: BLE001 – reported via /gesund
            errors[name] = f"{type(e).__name__}: {e}"[:200]
    return {"modules": out, "errors": errors, "dazu": dazu, "mehr": mehr}


def _dazu(raw) -> dict:
    """Config "dazu" -> {module: None (all sections) | [titles or types]}; anything else is a config error."""
    if raw is None:
        return {}
    if not isinstance(raw, list):
        raise ValueError("dazu must be a list")
    out = {}
    for x in raw:
        if isinstance(x, str):
            out[x] = None
        elif isinstance(x, dict) and isinstance(x.get("modul"), str) and isinstance(x.get("nur", []), list):
            out[x["modul"]] = [str(n) for n in x.get("nur", [])] or None
        else:
            raise ValueError("dazu: entries are module names or {modul, nur}")
    return out


def board_of(mods: dict, name: str) -> dict | None:
    """Board of module `name` with the sections of its "dazu" modules appended (a broken one is skipped and noted)."""
    mod = mods["modules"].get(name)
    if not mod:
        return None
    b = mod.board()
    for other, only in mods.get("dazu", {}).get(name, {}).items():
        m = mods["modules"].get(other)
        try:
            ob = m.board() if m else None
        except Exception as e:  # noqa: BLE001 – the own sections still show
            ob = None
            print(f"board {name}+{other}: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        if not ob:
            continue
        secs = [s for s in ob.get("sections", []) if only is None or s.get("title") in only or s.get("type") in only]
        b = {**b, "sections": [*b.get("sections", []), *secs]}
        times = [t for t in (b.get("updated"), ob.get("updated")) if t is not None]
        b["updated"] = min(times) if times else None  # the older part decides how fresh the tab is
    more = mods.get("mehr", {}).get(name)
    if more:
        b = {**b, "sections": [{**s, "more": True} if s.get("title") in more else s for s in b.get("sections", [])]}
    return b


def owner_of(mods: dict, name: str, item) -> str:
    """Module that answers a button: a "dazu" module when the item id starts with its name ("updates:jetzt")."""
    if isinstance(item, str) and ":" in item:
        prefix = item.split(":", 1)[0]
        if prefix in mods.get("dazu", {}).get(name, {}) and prefix in mods["modules"]:
            return prefix
    return name


def calc_owner(mods: dict, name: str) -> str:
    """Module that answers a calculator: the tab's own, else the first "dazu" module that has one."""
    own = mods["modules"].get(name)
    if own is not None and hasattr(own, "calc"):
        return name
    for other in mods.get("dazu", {}).get(name, {}):
        if hasattr(mods["modules"].get(other), "calc"):
            return other
    return name
