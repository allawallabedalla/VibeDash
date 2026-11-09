"""Module "updates": software updates of the house computer – how many are open (security first), whether a restart
is due, how the last run went, and a choice „Jetzt“ that asks the house to install them.

VibeDash installs nothing itself. A tap only stores a wish in a small file (config "wunsch"); a fixed service of the
house (running with the rights it needs, outside VibeDash) sees the file, installs the updates of the system's own
package sources and writes the result back. The wish carries no package names or commands – it can only say "now".

Config (local/modules/updates.json, template modules/templates/updates.json):
  stand       status file the house writes (relative to the modules folder or absolute), format below
  wunsch      wish file this module writes, default "update_wunsch.json"
  warten_min  a wish the house has not picked up after this many minutes counts as lost, default 30
  zeitzone    default "Europe/Berlin"
  texte       optional wording overrides (keys of TEXT)

Status file (written by the house, e.g. every 10 minutes and after each run):
  {"geprueft": iso,                              when the house last looked
   "listen": iso,                                when the package lists were last fetched (optional)
   "pakete": [{"name", "von", "nach", "sicherheit": bool}],
   "neustart": {"noetig": bool, "laeuft": "6.1.1", "neu": "6.1.2"},        (optional)
   "lauf": {"start": iso, "ende": iso | null, "ok": bool | null, "anzahl": int, "text": str}}   last run (optional)
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

ITEM = "updates:jetzt"
STALE_S = 26 * 3600  # the house looks every few minutes; a day without a look is worth a note

TEXT = {
    "title": "Updates",
    "choice": "Installieren",
    "later": "Später",
    "later_sub": "nichts tun",
    "now": "Jetzt",
    "now_sub": "{n} Pakete",
    "now_none": "nichts offen",
    "security": "Sicherheit",
    "security_tile": "Wichtig",
    "security_sub": "Sicherheitslücken",
    "other": "Sonstige",
    "restart": "Neustart",
    "restart_yes": "nötig",
    "restart_no": "nein",
    "last": "Zuletzt",
    "never": "noch nie",
    "packages": "Pakete",
    "list": "Offene Pakete",
    "none": "Alles aktuell.",
    "waiting": "Wartet auf das Haus (≤ 1 min).",
    "lost": "Das Haus hat den Wunsch nicht übernommen – bitte erneut tippen.",
    "running": "Installiert seit {t} Uhr …",
    "done_ok": "Fertig um {t} Uhr: {n} Pakete installiert.",
    "done_fail": "Fehlgeschlagen um {t} Uhr: {text}",
    "stale": "Stand vom {t} – das Haus hat seitdem nicht mehr nachgesehen.",
    "lists": "Paketlisten vom {t} Uhr.",
    "info_what": "Ein Tippen auf „Jetzt“ legt nur einen Wunsch ab. Das Haus installiert dann alle offenen Updates "
    "aus den Paketquellen des Systems (nichts wird entfernt) und meldet das Ergebnis hier. Ein Neustart passiert "
    "nie von selbst.",
    "info_source": "Paketverwaltung des Hauscomputers; VibeDash legt nur den Wunsch in einer Datei ab.",
}


def _load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _ts(s) -> float | None:
    try:
        return datetime.fromisoformat(str(s)).timestamp()
    except ValueError:
        return None


def _write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o644)  # the house reads it
    os.replace(tmp, path)


class Module:
    name = "updates"
    feeds: dict = {}

    def __init__(self, cfg: dict, path, clock=time.time):
        if not cfg.get("stand"):
            raise ValueError("stand missing")
        self.cfg, self.clock = cfg, clock
        self.stand_file = path(cfg["stand"])
        self.wish_file = path(cfg.get("wunsch") or "update_wunsch.json")
        self.wait_s = float(cfg.get("warten_min") or 30) * 60
        self.tz = ZoneInfo(cfg.get("zeitzone") or "Europe/Berlin")
        self.t = {**TEXT, **(cfg.get("texte") or {})}

    # --- state -------------------------------------------------------------------------------------------------
    def _hm(self, ts: float) -> str:
        return datetime.fromtimestamp(ts, self.tz).strftime("%H:%M")

    def _day(self, ts: float) -> str:
        return datetime.fromtimestamp(ts, self.tz).strftime("%d.%m.")

    def state(self) -> dict:
        """-> {phase: idle | waiting | lost | running, wish_ts, run} from the wish and the house's last run."""
        now = self.clock()
        stand = _load(self.stand_file)
        run = stand.get("lauf") if isinstance(stand.get("lauf"), dict) else {}
        wish = _load(self.wish_file)
        wish_ts = _ts(wish.get("gesetzt")) if wish.get("wunsch") == "installieren" else None
        start = _ts(run.get("start"))
        if start is not None and not run.get("ende") and now - start < 3 * 3600:
            return {"phase": "running", "wish_ts": wish_ts, "run": run, "stand": stand}
        if wish_ts is not None and (start is None or start < wish_ts):
            phase = "waiting" if now - wish_ts < self.wait_s else "lost"
            return {"phase": phase, "wish_ts": wish_ts, "run": run, "stand": stand}
        return {"phase": "idle", "wish_ts": wish_ts, "run": run, "stand": stand}

    # --- board -------------------------------------------------------------------------------------------------
    def _note(self, st: dict) -> str:
        t, run = self.t, st["run"]
        if st["phase"] == "waiting":
            return t["waiting"]
        if st["phase"] == "lost":
            return t["lost"]
        if st["phase"] == "running":
            return t["running"].format(t=self._hm(_ts(run.get("start")) or self.clock()))
        end = _ts(run.get("ende"))
        if end is None:
            return ""
        if run.get("ok"):
            return t["done_ok"].format(t=self._hm(end), n=int(run.get("anzahl") or 0))
        return t["done_fail"].format(t=self._hm(end), text=str(run.get("text") or "")[:200])

    def board(self) -> dict:
        t, now = self.t, self.clock()
        st = self.state()
        stand = st["stand"]
        pkgs = [p for p in stand.get("pakete") or [] if isinstance(p, dict) and p.get("name")]
        sec = [p for p in pkgs if p.get("sicherheit")]
        n = len(pkgs)
        busy = st["phase"] in ("waiting", "running")
        choice = {
            "type": "choice",
            "title": t["choice"],
            "id": ITEM,
            "selected": "jetzt" if busy else "spaeter",
            "options": [
                {"value": "spaeter", "label": t["later"], "sub": t["later_sub"]},
                {
                    "value": "jetzt",
                    "label": t["now"],
                    "sub": t["now_sub"].format(n=n) if n else t["now_none"],
                    **({"disabled": True} if not n and not busy else {}),
                },
            ],
            "slot": "top",
            "info": {"what": t["info_what"], "source": t["info_source"]},
        }
        note = self._note(st)
        if note:
            choice["note"] = note

        rs = stand.get("neustart") if isinstance(stand.get("neustart"), dict) else {}
        run = st["run"]
        end = _ts(run.get("ende"))
        tiles = [
            {
                "label": t["security_tile"],
                "value": str(len(sec)),
                "unit": t["packages"],
                "sub": t["security_sub"],
                "state": "look" if sec else "ok",
            },
            {"label": t["other"], "value": str(n - len(sec)), "unit": t["packages"], "state": "ok"},
            {
                "label": t["restart"],
                "value": t["restart_yes"] if rs.get("noetig") else t["restart_no"],
                "state": "look" if rs.get("noetig") else "ok",
                **(
                    {"sub": f"Kernel {rs.get('laeuft')} → {rs.get('neu')}"}
                    if rs.get("noetig") and rs.get("laeuft") and rs.get("neu")
                    else {}
                ),
            },
            {
                "label": t["last"],
                "value": self._day(end) if end else t["never"],
                "state": "act" if end and run.get("ok") is False else "ok",
                **({"sub": f"{int(run.get('anzahl') or 0)} {t['packages']}"} if end and run.get("ok") else {}),
            },
        ]
        checked = _ts(stand.get("geprueft"))
        tiles_sec = {"type": "tiles", "title": t["title"], "tiles": tiles}
        if checked is None or now - checked > STALE_S:
            tiles_sec["note"] = t["stale"].format(
                t=datetime.fromtimestamp(checked, self.tz).strftime("%d.%m. %H:%M") if checked else "–"
            )

        items = [
            {
                "text": str(p["name"])[:80],
                "meta": f"{p.get('von') or '?'} → {p.get('nach') or '?'}"
                + (f" · {t['security']}" if p.get("sicherheit") else ""),
            }
            for p in sorted(pkgs, key=lambda p: (not p.get("sicherheit"), str(p["name"])))
        ][:60]
        lst: dict = (
            {"type": "list", "title": t["list"], "items": items}
            if items
            else {"type": "text", "title": t["list"], "text": t["none"]}
        )
        lists = _ts(stand.get("listen"))
        if lists:
            lst["note"] = t["lists"].format(t=datetime.fromtimestamp(lists, self.tz).strftime("%d.%m. %H:%M"))
        return {"sections": [choice, tiles_sec, lst]}

    # --- action ------------------------------------------------------------------------------------------------
    def action(self, d: dict):
        """{item: "updates:jetzt", action: "choose", value: "jetzt" | "spaeter"} -> stores or withdraws the wish."""
        if d.get("item") != ITEM or d.get("action") != "choose":
            return 404, {"ok": False, "text": "keine Aktion"}
        value = d.get("value")
        if value not in ("jetzt", "spaeter"):
            return 400, {"ok": False, "text": "unbekannte Wahl"}
        st = self.state()
        stamp = datetime.fromtimestamp(self.clock(), self.tz).isoformat(timespec="seconds")
        if value == "spaeter":
            if st["phase"] == "running":
                return 409, {"ok": False, "text": "Läuft schon – bitte abwarten."}
            _write(self.wish_file, {"gesetzt": stamp})
            return 200, {"ok": True, "text": "Updates: später"}
        if st["phase"] in ("waiting", "running"):
            return 200, {"ok": True, "text": "Ist schon unterwegs."}
        _write(self.wish_file, {"wunsch": "installieren", "gesetzt": stamp})
        return 200, {"ok": True, "text": "Updates werden installiert"}
