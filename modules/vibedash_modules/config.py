"""Find and load module configs: <MODULES_DIR>/<name>.json (MODULES_DIR default local/modules)."""

from __future__ import annotations

import importlib
import json
import os

from . import KNOWN


def modules_dir() -> str:
    return os.path.abspath(os.environ.get("MODULES_DIR", "local/modules"))


def load_modules(base: str | None = None) -> dict:
    """-> {name: Module} for every known module with a readable config file. Broken configs are reported, not
    fatal: one module must not stop the others."""
    base = base or modules_dir()
    out, errors = {}, {}
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

            out[name] = mod.Module(cfg, path)
        except Exception as e:  # noqa: BLE001 – reported via /gesund
            errors[name] = f"{type(e).__name__}: {e}"[:200]
    return {"modules": out, "errors": errors}
