"""Notes on board items: done / acknowledged / comment / hidden / later (snooze), shared by all modules.

A board list item with "id" and "actions" gets buttons in VibeDash (src/model/board.ts); a click arrives as
POST /board/<module>/action {board, item, action, text?, date?}. The store is one JSON file
{item: {ack, deleted, done, vorher, snooze, comments: [{text, at}]}} plus a log of every action (.jsonl next to
it). Writes are atomic under a file lock (<file>.lock), so a house script may share the file.
"""

from __future__ import annotations

import fcntl
import json
import os
import time

ACTIONS = ("done", "ack", "comment", "delete", "undo", "snooze")
MESSAGES = {
    "de": {
        "ack": "zur Kenntnis genommen",
        "delete": "ausgeblendet",
        "comment": "Kommentar gespeichert",
        "undo": "zurückgenommen",
        "snooze": "verschoben bis {date}",
        "empty": "Kommentar leer",
        "future": "Datum muss in der Zukunft liegen",
        "unknown": "unbekannte Aktion",
    },
    "en": {
        "ack": "acknowledged",
        "delete": "hidden",
        "comment": "comment saved",
        "undo": "undone",
        "snooze": "put off until {date}",
        "empty": "empty comment",
        "future": "the date must be in the future",
        "unknown": "unknown action",
    },
}


class Notes:
    def __init__(self, path: str, lang: str = "de", log_path: str | None = None):
        self.path = path
        self.log_path = log_path or os.path.splitext(path)[0] + ".jsonl"
        self.msg = MESSAGES.get(lang, MESSAGES["de"])

    def load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _write(self, d: dict) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = f"{self.path}.tmp{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def _locked(self):
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        lock = open(self.path + ".lock", "w")  # noqa: SIM115 – closed by the caller's with-block
        fcntl.flock(lock, fcntl.LOCK_EX)
        return lock

    def log(self, entry: dict) -> None:
        os.makedirs(os.path.dirname(self.log_path) or ".", exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as f:
            line = {"zeit": time.strftime("%Y-%m-%dT%H:%M:%S"), **entry}
            f.write(json.dumps(line, ensure_ascii=False) + "\n")

    def change(self, item: str, action: str, text=None, day=None) -> tuple[bool, str]:
        """Generic note change (ack/comment/delete/undo/snooze) -> (ok, text)."""
        with self._locked():
            d = self.load()
            n = d.setdefault(item, {})
            today = time.strftime("%Y-%m-%d")
            if action == "ack":
                n["ack"] = today
            elif action == "delete":
                n["deleted"] = today
            elif action == "comment":
                t = " ".join(str(text or "").split())[:500]
                if not t:
                    return False, self.msg["empty"]
                n.setdefault("comments", []).append({"text": t, "at": time.strftime("%d.%m. %H:%M")})
                n["comments"] = n["comments"][-20:]
            elif action == "snooze":
                if not day or day <= today:
                    return False, self.msg["future"]
                n["snooze"] = day
            elif action == "undo":
                for k in ("snooze", "deleted", "ack", "done"):
                    if n.pop(k, None):
                        break
            else:
                return False, self.msg["unknown"]
            self._write(d)
        return True, self.msg[action].format(date=day)

    def remember(self, item: str, values: dict) -> None:
        """Set fields of a note (None = remove), e.g. the date before "done" for "undo"."""
        with self._locked():
            d = self.load()
            n = d.setdefault(item, {})
            for k, v in values.items():
                if v is None:
                    n.pop(k, None)
                else:
                    n[k] = v
            self._write(d)

    def apply(self, sections: list[dict], d: dict | None = None) -> list[dict]:
        """Work the notes into a board's lists: hide deleted, show comments, "acknowledged", done, later.
        Only items with an "id" (given by the module itself) – all others stay as they are."""
        d = self.load() if d is None else d
        today = time.strftime("%Y-%m-%d")
        for s in sections:
            if s.get("type") != "list":
                continue
            kept = []
            for it in s.get("items") or []:
                iid = it.get("id")
                n = (d.get(iid) or {}) if iid else {}
                acts = it.get("actions") or []
                if n.get("deleted") and "delete" in acts:
                    continue
                if n.get("ack"):
                    it["acked"] = n["ack"]
                    if it.get("state") in ("look", "open", "act"):
                        it["state"] = "ok"
                if n.get("comments"):
                    it["comments"] = n["comments"][-5:]
                if n.get("done") and "done" in acts:
                    it["done"] = n["done"]
                if n.get("snooze") and n["snooze"] > today:
                    it["snoozed"] = n["snooze"]
                    if it.get("state") in ("look", "open", "act"):
                        it["state"] = "ok"
                kept.append(it)
            s["items"] = kept
        return sections
