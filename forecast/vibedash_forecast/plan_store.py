"""Storage for the charge plan (M12): configuration, hourly house load without the car,
hourly battery state, hourly temperature, and cached backtest days."""

import json
import sqlite3
from contextlib import closing
from datetime import date, datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS plan_anlagen (id TEXT PRIMARY KEY, config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plan_stunden (
  plan TEXT NOT NULL, art TEXT NOT NULL, zeit TEXT NOT NULL, wert REAL NOT NULL,
  PRIMARY KEY (plan, art, zeit)
);
CREATE TABLE IF NOT EXISTS plan_pruefung (
  plan TEXT NOT NULL, tag TEXT NOT NULL, schluessel TEXT NOT NULL, ergebnis TEXT NOT NULL,
  PRIMARY KEY (plan, tag)
);
"""

KINDS = ("last", "soc", "temp")


class PlanStore:
    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db
        self.db.executescript(SCHEMA)

    def put_config(self, pid: str, config: dict) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO plan_anlagen VALUES (?,?) "
                "ON CONFLICT(id) DO UPDATE SET config=excluded.config",
                (pid, json.dumps(config)),
            )
            # a changed battery/car changes every backtest day
            self.db.execute("DELETE FROM plan_pruefung WHERE plan=?", (pid,))

    def config(self, pid: str) -> dict | None:
        with closing(self.db.execute("SELECT config FROM plan_anlagen WHERE id=?", (pid,))) as c:
            row = c.fetchone()
        return json.loads(row[0]) if row else None

    def put_hours(self, pid: str, kind: str, rows: list[tuple[datetime, float]]) -> None:
        assert kind in KINDS
        with self.db:
            self.db.executemany(
                "INSERT INTO plan_stunden VALUES (?,?,?,?) "
                "ON CONFLICT(plan, art, zeit) DO UPDATE SET wert=excluded.wert",
                [(pid, kind, t.isoformat(), v) for t, v in rows],
            )

    def hours(self, pid: str, kind: str) -> dict[datetime, float]:
        with closing(
            self.db.execute(
                "SELECT zeit, wert FROM plan_stunden WHERE plan=? AND art=?", (pid, kind)
            )
        ) as c:
            return {datetime.fromisoformat(t): w for t, w in c.fetchall()}

    def check(self, pid: str, day: date, key: str) -> dict | None:
        with closing(
            self.db.execute(
                "SELECT schluessel, ergebnis FROM plan_pruefung WHERE plan=? AND tag=?",
                (pid, day.isoformat()),
            )
        ) as c:
            row = c.fetchone()
        return json.loads(row[1]) if row and row[0] == key else None

    def put_check(self, pid: str, day: date, key: str, result: dict) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO plan_pruefung VALUES (?,?,?,?) ON CONFLICT(plan, tag) "
                "DO UPDATE SET schluessel=excluded.schluessel, ergebnis=excluded.ergebnis",
                (pid, day.isoformat(), key, json.dumps(result)),
            )
