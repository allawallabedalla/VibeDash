"""Inputs of the module "druck" – only reading.

PrusaLink (API v1) of a Prusa printer in the house network, Digest login (user + password) or an API key:
  GET /api/v1/status   printer.state, temp_nozzle/target_nozzle, temp_bed/target_bed, job {id, progress,
                       time_remaining}
  GET /api/v1/job      the file of the running job (file.display_name) – asked once per job id
Nothing is ever sent to the printer except these two GETs.

History: one JSON line per reading in a file of the modules folder (written by the module's own period, see
__init__.py): {"t": ms, "s": state, "d": nozzle °C, "dz": nozzle target, "b": bed °C, "bz": bed target,
"p": progress %, "r": remaining s, "j": job id, "f": file name}; "s": "OFFLINE" when the printer did not answer.
"""

from __future__ import annotations

import json
import os
import threading
import urllib.request

TIMEOUT = 6


class Printer:
    """Reads the printer's status. `get(path) -> dict` can be replaced in tests."""

    def __init__(self, cfg: dict, get=None):
        url = str(cfg.get("url") or "").rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise ValueError("prusalink.url missing (http://<printer>)")
        if not (cfg.get("passwort") or cfg.get("api_key")):
            raise ValueError("prusalink.passwort or prusalink.api_key missing")
        self.url, self.cfg = url, cfg
        self.get = get or self._get

    def _get(self, path: str):
        headers = {"Accept": "application/json"}
        if self.cfg.get("api_key"):
            opener = urllib.request.build_opener()
            headers["X-Api-Key"] = str(self.cfg["api_key"])
        else:
            pw = urllib.request.HTTPPasswordMgrWithDefaultRealm()
            pw.add_password(None, self.url + "/", str(self.cfg.get("benutzer") or "maker"), str(self.cfg["passwort"]))
            opener = urllib.request.build_opener(urllib.request.HTTPDigestAuthHandler(pw))
        req = urllib.request.Request(self.url + path, headers=headers)  # noqa: S310 – address from the local config
        with opener.open(req, timeout=TIMEOUT) as r:
            body = r.read()
        return json.loads(body) if body else {}

    def reading(self, now_ms: int, names: dict) -> dict:
        """-> one history line (see top). `names` {job id: file name} is kept by the caller, so /job is asked once
        per job. A printer that does not answer gives {"t", "s": "OFFLINE"}."""
        try:
            st = self.get("/api/v1/status") or {}
        except Exception:  # noqa: BLE001 – switched off, Wi-Fi gone, wrong login: all "not reachable"
            return {"t": now_ms, "s": "OFFLINE"}
        p = st.get("printer") or {}
        out = {
            "t": now_ms,
            "s": str(p.get("state") or "UNKNOWN").upper()[:20],
            "d": _num(p.get("temp_nozzle")),
            "dz": _num(p.get("target_nozzle")),
            "b": _num(p.get("temp_bed")),
            "bz": _num(p.get("target_bed")),
        }
        job = st.get("job") or {}
        jid = job.get("id")
        if isinstance(jid, int) and not isinstance(jid, bool):
            out.update(j=jid, p=_num(job.get("progress")), r=_num(job.get("time_remaining")))
            if jid not in names:
                try:
                    f = (self.get("/api/v1/job") or {}).get("file") or {}
                    names[jid] = str(f.get("display_name") or f.get("name") or "")[:120]
                except Exception:  # noqa: BLE001 – the name is asked again next time
                    pass
            if names.get(jid):
                out["f"] = names[jid]
        return {k: v for k, v in out.items() if v is not None}


def _num(x):
    if isinstance(x, bool):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, 1) if v == v and abs(v) != float("inf") else None


_LOCK = threading.Lock()


def read_history(p: str, since_ms: int = 0) -> list:
    """History lines from `since_ms` on, oldest first; broken lines are skipped."""
    out = []
    try:
        with open(p, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if isinstance(r, dict) and isinstance(r.get("t"), (int, float)) and r["t"] >= since_ms:
                    out.append(r)
    except OSError:
        return []
    return out


def last_line(p: str):
    """The newest history line or None (reads only the end of the file)."""
    try:
        with open(p, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 4096))
            tail = f.read().splitlines()
    except OSError:
        return None
    for raw in reversed(tail):
        try:
            r = json.loads(raw)
            if isinstance(r, dict) and "t" in r:
                return r
        except ValueError:
            continue
    return None


def append(p: str, line: dict, keep_ms: int) -> None:
    """Add one line; once the oldest line is a day older than `keep_ms`, the file is rewritten without the old
    lines (atomically: temp file + rename)."""
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with _LOCK:
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")
        try:
            with open(p, encoding="utf-8") as f:
                first = json.loads(f.readline() or "{}")
        except (OSError, ValueError):
            return
        cut = line["t"] - keep_ms
        if isinstance(first.get("t"), (int, float)) and first["t"] < cut - 86_400_000:
            keep = read_history(p, cut)
            tmp = p + ".neu"
            with open(tmp, "w", encoding="utf-8") as f:
                for r in keep:
                    f.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
            os.replace(tmp, p)
