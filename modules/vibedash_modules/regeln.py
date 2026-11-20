"""Rule checker for boards (Audit05 lessons, docs/GUIDELINE.md G-27 … G-34): pruefe(board) -> list of violations.

The same text rules as the visual rule test (tests/visual/regeln.spec.ts), on the board JSON a module answers. Empty
list = fine. /gesund passes the violations of the last board each module answered on as a hint (never changes ok);
modules/tests/test_regeln.py demands an empty list for the boards of all modules built from the test fixtures.
New rules are automated here and in the visual test (G-34); exceptions only with an audit ID.
"""

from __future__ import annotations

import re

# G-27: at most this many sections on the first level (without "more"); the rest waits behind "Details" (Audit05
# S4-02/DE4-05: Wartung had 46 tiles). The fixture boards have at most 9 today.
MAX_ERSTE_EBENE = 10

# G-31 (G-04 automated): a table without a graphic column is allowed only as a log/protocol (row = event, nothing to
# compare). Exact titles; a new entry needs a reason.
PROTOKOLL_TABELLEN = (
    "Ereignisse",  # knxlog: events of the last 24 h, one row each
    "Telegramme",  # knxlog: the latest raw bus telegrams
    "Lernstand aller Modelle",  # ml: on purpose without a graphic – learning progress must not be stressed (G-14)
)

# G-28: placeholders of a missing value that leaked into the text (Audit05 P4-05/S4-07 "None %").
_PLATZHALTER = re.compile(r"(?<![\w-])(?:None|NaN|null|undefined)(?![\w-])|\[object")
# G-28: a zero with a sign ("−0,0 kW", "-0") – the value is 0 (Audit05 N4-08)
_MINUS_NULL = re.compile(r"(?<![\w.,])[−-]0(?:[.,]0+)?(?![.,]?\d)")
# G-28: a negative value with the hyphen-minus instead of the real minus U+2212 ("-3" -> "−3")
_BINDESTRICH = re.compile(r"(?<![\w.,:/)\]–-])-(?=\d)")
# Emoji = Unicode Extended_Pictographic (as \p{Extended_Pictographic} in the visual tests; BMP part exact, the
# supplementary planes from U+1F000 on as one block). ANLEITUNG.md 5.3: outline icon + words, never emojis.
_EMOJI = re.compile(
    "[©®‼⁉™ℹ↔-↙↩↪⌚⌛⌨⏏⏩-⏳"
    "⏸-⏺Ⓜ▪▫▶◀◻-◾☀-☄☎☑☔☕☘☝"
    "☠☢☣☦☪☮☯☸-☺♀♂♈-♓♟♠♣♥"
    "♦♨♻♾♿⚒-⚗⚙⚛⚜⚠⚡⚧⚪⚫⚰⚱"
    "⚽⚾⛄⛅⛈⛎⛏⛑⛓⛔⛩⛪⛰-⛵⛷-⛺⛽"
    "✂✅✈-✍✏✒✔✖✝✡✨✳✴❄❇❌❎"
    "❓-❕❗❣❤➕-➗➡➰➿⤴⤵⬅-⬇⬛⬜⭐"
    "⭕〰〽㊗㊙\U0001f000-\U0001fffd]"
)
# G-29: "only reads" claims are wrong next to buttons that switch (Audit05 P4-08, S4-01, DE4-04)
_NUR_LESEN = re.compile(r"schaltet nichts|gesteuert wird nichts|switches nothing", re.IGNORECASE)
# sections whose buttons switch something in the house (a choice is sent to the house's logic at once)
SCHALT_TYPEN = ("choice",)

# keys that carry ids, colours or settings, not text the page shows
_TECHNISCH = {"id", "type", "color", "icon", "url", "kind", "key", "align", "slot", "group", "format", "state"}
_TECHNISCH |= {"selected", "col", "mode", "a", "b", "level", "levels", "actions", "done", "acked", "snoozed", "at"}


def _texte(x, pfad=""):
    """(path, text) of every string the page shows."""
    if isinstance(x, str):
        yield pfad, x
    elif isinstance(x, dict):
        for k, v in x.items():
            if k not in _TECHNISCH:
                yield from _texte(v, f"{pfad}.{k}" if pfad else k)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from _texte(v, f"{pfad}[{i}]")


def _name(i: int, s: dict) -> str:
    return f"Abschnitt {i + 1} „{s.get('title') or s.get('type')}“"


def pruefe_text(text: str) -> list[str]:
    """Text rules a–d (G-28, emojis) on one visible text; also used for the texts the visual test reads."""
    out = []
    if m := _PLATZHALTER.search(text):
        out.append(f"Platzhalter „{m.group(0)}“ (G-28)")
    if m := _MINUS_NULL.search(text):
        out.append(f"Minus vor null „{m.group(0)}“ (G-28)")
    elif m := _BINDESTRICH.search(text):
        out.append("Bindestrich statt Minus vor Zahl (G-28, echtes Minus U+2212)")
    if m := _EMOJI.search(text):
        out.append(f"Emoji U+{ord(m.group(0)):04X} (ANLEITUNG 5.3)")
    return out


def pruefe(board: dict) -> list[str]:
    """All rules on one board (JSON as in src/model/board.ts). -> violations, empty = fine."""
    if not isinstance(board, dict):
        return ["Board ist kein Objekt"]
    secs = [s for s in board.get("sections") or [] if isinstance(s, dict)]
    out: list[str] = []
    schaltet = any(s.get("type") in SCHALT_TYPEN for s in secs)

    for i, s in enumerate(secs):
        wo = _name(i, s)
        for pfad, text in _texte(s):
            out += [f"{wo} {pfad}: {v}" for v in pruefe_text(text)]
            # G-29: the option of a choice may describe itself ("Aus · VibeDash schaltet nichts")
            if schaltet and s.get("type") not in SCHALT_TYPEN and _NUR_LESEN.search(text):
                out.append(
                    f"{wo} {pfad}: „{_NUR_LESEN.search(text).group(0)}“ auf einer Seite mit Schalt-Knöpfen (G-29)"
                )
        # G-30: a percent sparkline is drawn on 0–100 – values outside break that scale
        if s.get("type") == "tiles":
            for t in s.get("tiles") or []:
                if isinstance(t, dict) and t.get("unit") == "%" and t.get("spark"):
                    bad = [v for v in t["spark"] if isinstance(v, (int, float)) and not 0 <= v <= 100]
                    if bad:
                        out.append(f"{wo} Kachel „{t.get('label')}“: Prozent-Verlauf außerhalb 0–100 ({bad[0]}) (G-30)")
        # G-31: every data table with a graphic column, logs excepted
        if (
            s.get("type") == "table"
            and s.get("rows")
            and not s.get("chart")
            and s.get("title") not in PROTOKOLL_TABELLEN
        ):
            out.append(f"{wo}: Tabelle ohne Grafik-Spalte (G-31)")

    erste = [s for s in secs if not s.get("more")]
    if len(erste) > MAX_ERSTE_EBENE:
        out.append(f"{len(erste)} Abschnitte in der ersten Ebene, höchstens {MAX_ERSTE_EBENE} – Rest mit „more“ (G-27)")
    return out
