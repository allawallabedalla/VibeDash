"""Small text helpers shared by the modules that show a house program's own results (knx, knxlog)."""

from __future__ import annotations

import re

PUA = re.compile(r"[-]")


def clean(x, max_len=400) -> str:
    """Text without icon glyphs (private use area) and double spaces."""
    if x is None:
        return ""
    s = PUA.sub("", str(x))
    s = re.sub(r"[ \t]+", " ", s).strip()
    return s[:max_len]


def value_unit(x):
    """'244,1 × / Tag' -> ('244,1', '× / Tag'); short texts stay whole; else (text, None)."""
    t = clean(x, 40)
    if len(t) <= 9:
        return t, None
    m = re.match(r"^([!▲▼+\-−]?\s*[\d.,]+(?:\s*±\s*[\d.,]+)?)\s*(.+)$", t)
    return (m.group(1).strip(), m.group(2).strip()[:12]) if m else (t[:20], None)


def level(st):
    """Grades of the house program (io / beobachten / nio) -> ok / look / act."""
    return {"io": "ok", "beobachten": "look", "nio": "act"}.get(str(st or "").lower())


def unsigned_zero(x, nd):
    """x, but 0.0 when it rounds to zero at nd digits: −0,04 is shown as 0,0, never as "−0,0" (Audit05)."""
    return 0.0 if round(x, nd) == 0 else x


def number(x):
    try:
        v = float(x)
        return v if v == v and abs(v) != float("inf") else None
    except (TypeError, ValueError):
        return None
