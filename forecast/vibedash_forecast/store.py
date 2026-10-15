"""SQLite storage: series, daily values, features known in advance, made forecasts.

Honesty rules enforced here:
- A forecast is stored once per target day (the first, scheduled run counts);
  later runs never overwrite it.
- A feature for a day (e.g. weather forecast) is only accepted if it was known
  before that day began, and the first value wins - no look into the future.
"""

import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS reihen (
  id TEXT PRIMARY KEY,
  einheit TEXT NOT NULL,
  takt TEXT NOT NULL,
  ziel TEXT NOT NULL,
  nichtnegativ INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS werte (
  reihe TEXT NOT NULL, tag TEXT NOT NULL, wert REAL NOT NULL,
  PRIMARY KEY (reihe, tag)
);
CREATE TABLE IF NOT EXISTS merkmale (
  reihe TEXT NOT NULL, tag TEXT NOT NULL, name TEXT NOT NULL, wert REAL NOT NULL,
  stand TEXT NOT NULL,
  PRIMARY KEY (reihe, tag, name)
);
-- every run of a feature, so a forecast for a day can use the newest run known before it
CREATE TABLE IF NOT EXISTS merkmal_laeufe (
  reihe TEXT NOT NULL, tag TEXT NOT NULL, name TEXT NOT NULL, wert REAL NOT NULL,
  stand TEXT NOT NULL,
  PRIMARY KEY (reihe, tag, name, stand)
);
CREATE TABLE IF NOT EXISTS prognosen (
  reihe TEXT NOT NULL, tag TEXT NOT NULL, erstellt_am TEXT NOT NULL, vorlauf_h REAL NOT NULL,
  p10 REAL NOT NULL, p50 REAL NOT NULL, p90 REAL NOT NULL, verfahren TEXT NOT NULL,
  PRIMARY KEY (reihe, tag)
);
"""


@dataclass(frozen=True)
class Reihe:
    id: str
    einheit: str
    takt: str
    ziel: str
    nichtnegativ: bool


class Store:
    def __init__(self, path: str = ":memory:") -> None:
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(SCHEMA)
        # older databases kept only the first run per feature (merkmale): carry those over once
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO merkmal_laeufe SELECT * FROM merkmale")

    def close(self) -> None:
        self.db.close()

    # series -------------------------------------------------------------
    def put_reihe(self, r: Reihe) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO reihen VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                "einheit=excluded.einheit, takt=excluded.takt, ziel=excluded.ziel, "
                "nichtnegativ=excluded.nichtnegativ",
                (r.id, r.einheit, r.takt, r.ziel, int(r.nichtnegativ)),
            )

    def get_reihe(self, rid: str) -> Reihe | None:
        with closing(self.db.execute("SELECT * FROM reihen WHERE id=?", (rid,))) as c:
            row = c.fetchone()
        return Reihe(row[0], row[1], row[2], row[3], bool(row[4])) if row else None

    # values -------------------------------------------------------------
    def put_werte(self, rid: str, werte: list[tuple[str, float]]) -> None:
        with self.db:
            self.db.executemany(
                "INSERT INTO werte VALUES (?,?,?) ON CONFLICT(reihe, tag) DO UPDATE SET "
                "wert=excluded.wert",
                [(rid, tag, wert) for tag, wert in werte],
            )

    def werte(self, rid: str) -> list[tuple[date, float]]:
        with closing(
            self.db.execute("SELECT tag, wert FROM werte WHERE reihe=? ORDER BY tag", (rid,))
        ) as c:
            return [(date.fromisoformat(t), w) for t, w in c.fetchall()]

    # features known in advance -----------------------------------------
    def put_merkmal(self, rid: str, tag: str, name: str, wert: float, stand: datetime) -> bool:
        """Keep every run of a feature known before the day began (Audit01 P-03)."""
        if stand.date() >= date.fromisoformat(tag):
            return False
        with self.db:
            cur = self.db.execute(
                "INSERT OR IGNORE INTO merkmal_laeufe VALUES (?,?,?,?,?)",
                (rid, tag, name, wert, stand.isoformat()),
            )
        return cur.rowcount == 1

    def merkmale(self, rid: str) -> dict[date, dict[str, float]]:
        """Per day the newest run known before it began: live and backtest use the
        same, freshest lead instead of whichever run came first."""
        out: dict[date, dict[str, float]] = {}
        with closing(
            self.db.execute(
                "SELECT tag, name, wert FROM merkmal_laeufe WHERE reihe=? ORDER BY stand",
                (rid,),
            )
        ) as c:
            for t, n, w in c.fetchall():
                out.setdefault(date.fromisoformat(t), {})[n] = w  # later stand overwrites
        return out

    # made forecasts -----------------------------------------------------
    def put_prognose(
        self,
        rid: str,
        tag: date,
        erstellt_am: datetime,
        vorlauf_h: float,
        p: tuple[float, float, float],
        verfahren: str,
    ) -> bool:
        """The first (scheduled) forecast for a day counts; later runs are ignored."""
        with self.db:
            cur = self.db.execute(
                "INSERT OR IGNORE INTO prognosen VALUES (?,?,?,?,?,?,?,?)",
                (rid, tag.isoformat(), erstellt_am.isoformat(), vorlauf_h, *p, verfahren),
            )
        return cur.rowcount == 1

    def prognosen(self, rid: str) -> list[dict]:
        with closing(
            self.db.execute(
                "SELECT tag, erstellt_am, vorlauf_h, p10, p50, p90, verfahren FROM prognosen "
                "WHERE reihe=? ORDER BY tag",
                (rid,),
            )
        ) as c:
            cols = ["tag", "erstellt_am", "vorlauf_h", "p10", "p50", "p90", "verfahren"]
            return [dict(zip(cols, row, strict=True)) for row in c.fetchall()]
