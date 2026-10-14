"""Storage for the hourly PV model: plant, hourly actuals, GTI forecasts, made forecasts.

Same honesty rules as the daily store: GTI is only accepted if it was known
before the local day began (first value wins); a made forecast is kept once
per day and only if made before the day began.
"""

import json
import sqlite3
from contextlib import closing
from datetime import date, datetime
from zoneinfo import ZoneInfo

SCHEMA = """
CREATE TABLE IF NOT EXISTS pv_anlagen (id TEXT PRIMARY KEY, config TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pv_stunden (
  anlage TEXT NOT NULL, zeit TEXT NOT NULL, wert REAL NOT NULL, PRIMARY KEY (anlage, zeit)
);
CREATE TABLE IF NOT EXISTS pv_gti (
  anlage TEXT NOT NULL, zeit TEXT NOT NULL, flaeche TEXT NOT NULL, wert REAL NOT NULL,
  stand TEXT NOT NULL, PRIMARY KEY (anlage, zeit, flaeche)
);
CREATE TABLE IF NOT EXISTS pv_prognosen (
  anlage TEXT NOT NULL, tag TEXT NOT NULL, erstellt_am TEXT NOT NULL, vorlauf_h REAL NOT NULL,
  p10 REAL NOT NULL, p50 REAL NOT NULL, p90 REAL NOT NULL, PRIMARY KEY (anlage, tag)
);
"""


class PvStore:
    def __init__(self, db: sqlite3.Connection) -> None:
        self.db = db
        self.db.executescript(SCHEMA)

    def put_plant(self, pid: str, config: dict) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO pv_anlagen VALUES (?,?) "
                "ON CONFLICT(id) DO UPDATE SET config=excluded.config",
                (pid, json.dumps(config)),
            )

    def plant(self, pid: str) -> dict | None:
        with closing(self.db.execute("SELECT config FROM pv_anlagen WHERE id=?", (pid,))) as c:
            row = c.fetchone()
        return json.loads(row[0]) if row else None

    def put_hours(self, pid: str, rows: list[tuple[datetime, float]]) -> None:
        with self.db:
            self.db.executemany(
                "INSERT INTO pv_stunden VALUES (?,?,?) "
                "ON CONFLICT(anlage, zeit) DO UPDATE SET wert=excluded.wert",
                [(pid, t.isoformat(), v) for t, v in rows],
            )

    def hours(self, pid: str) -> dict[datetime, float]:
        with closing(
            self.db.execute("SELECT zeit, wert FROM pv_stunden WHERE anlage=?", (pid,))
        ) as c:
            return {datetime.fromisoformat(t): w for t, w in c.fetchall()}

    def put_gti(self, pid: str, tz: str, rows: list[tuple[datetime, str, float, datetime]]) -> int:
        zone = ZoneInfo(tz)
        accepted = 0
        with self.db:
            for t, plane, value, stand in rows:
                day_start = datetime.combine(t.astimezone(zone).date(), datetime.min.time(), zone)
                if stand >= day_start:
                    continue  # not known before the day began
                cur = self.db.execute(
                    "INSERT OR IGNORE INTO pv_gti VALUES (?,?,?,?,?)",
                    (pid, t.isoformat(), plane, value, stand.isoformat()),
                )
                accepted += cur.rowcount
        return accepted

    def gti(self, pid: str) -> dict[tuple[datetime, str], float]:
        with closing(
            self.db.execute("SELECT zeit, flaeche, wert FROM pv_gti WHERE anlage=?", (pid,))
        ) as c:
            return {(datetime.fromisoformat(t), f): w for t, f, w in c.fetchall()}

    def put_forecast(self, pid: str, day: date, made: datetime, lead_h: float, total) -> bool:
        with self.db:
            cur = self.db.execute(
                "INSERT OR IGNORE INTO pv_prognosen VALUES (?,?,?,?,?,?,?)",
                (pid, day.isoformat(), made.isoformat(), lead_h, *total),
            )
        return cur.rowcount == 1

    def forecasts(self, pid: str) -> list[dict]:
        with closing(
            self.db.execute(
                "SELECT tag, erstellt_am, vorlauf_h, p10, p50, p90 FROM pv_prognosen "
                "WHERE anlage=? ORDER BY tag",
                (pid,),
            )
        ) as c:
            cols = ["tag", "erstellt_am", "vorlauf_h", "p10", "p50", "p90"]
            return [dict(zip(cols, r, strict=True)) for r in c.fetchall()]
