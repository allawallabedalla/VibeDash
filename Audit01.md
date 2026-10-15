# Audit01 – VibeDash

**Stand:** Commit `14df8aa` (Branch `week/abgeschlossene-tage`, die am 14.10.2026 live laufende Version) · geprüft am 14.10.2026, ca. 22:00–23:30
**Methode:** 5 unabhängige Prüfer (Opus), nur lesend, in einer eigenen Kopie des Repos; Live-Instanz und echte Messdaten nur per GET/SELECT; Schreibtests nur gegen eine Wegwerf-Instanz auf localhost.
**Datenschutz:** Dieser Bericht enthält **keine Hausdaten** (keine Adressen, Hostnamen, Modellnamen, Koordinaten, absolute Messwerte) – Abweichungen nur relativ. Rohdaten, Skripte und Screenshots liegen außerhalb des Repos.

## Ergebnis in Kürze

| Bereich | kritisch | hoch | mittel | niedrig | gesamt |
|---|---|---|---|---|---|
| Datenwahrheit | 0 | 1 | 5 | 10 | 16 |
| Design und Plattformen | 0 | 1 | 11 | 8 | 21 |
| Sicherheit und Datenschutz | 0 | 0 | 5 | 12 | 17 |
| Prognosen und Ladeplan | 0 | 3 | 12 | 9 | 24 |
| Code, Tests, Betrieb, Doku | 0 | 4 | 12 | 10 | 26 |
| **Summe** | **0** | **9** | **45** | **49** | **104** |

**Gesamturteil:** Der Kern ist sauber und ehrlich gebaut. Alle 56 geprüften Tageswerte aus Zählern stimmen exakt mit den Rohdaten (0,00 %), es gibt keinen Weg, Abfragen einzuschleusen, keinen Schreibpfad zu Geräten, keine Leakage in der Prognose-Rückrechnung, 0 Emojis, ⓘ per Tippen, keine zu kleinen Schriften/Antippflächen am iPhone, 140/140 Unit- und 108/108 Visual-Tests grün. Die Schwächen liegen (1) in Nahtstellen, die erst mit dem echten Prognose-Dienst sichtbar werden, (2) in der Annahme „Heimnetz = vertrauenswürdig“ und im Betrieb aus dem Entwicklungsordner, (3) in Branch-/CI-Hygiene, (4) in einigen Stellen, an denen Zahlen nicht so ehrlich gezeigt werden, wie die eigenen Regeln es verlangen.

## Die 12 wichtigsten Punkte (Reihenfolge = Vorschlag zur Abarbeitung)

| # | ID | Schwere | Was | Warum zuerst |
|---|---|---|---|---|
| 1 | C-01 | hoch | CI auf `main` rot (Lint der Design-Referenz), PRs trotzdem gemergt | **behoben 14.10.** (`design/` von Lint/Prettier ausgenommen); offen: Branch-Schutz mit Pflicht-Checks einschalten |
| 2 | C-02 | hoch | Live-Stand und `main` laufen auseinander (4 Commits nur live, ohne PR) | sonst geht Arbeit verloren / Fremde bekommen eine andere Version |
| 3 | C-03 / S-03 | hoch / mittel | Hausdetails in der Design-Referenz (Modellname, Anlagengröße, Links auf die privaten Seiten) | **auf `main` bereinigt 14.10.**; offen: Branches `design/angleichen` und `week/…` neu auf `main` aufsetzen; Frage: Historie umschreiben? |
| 4 | DA-01 | hoch | Erfundener Demo-Satz („Heute Nacht 02:10–04:40 ohne Meldung“) im Live-ⓘ von Temperatur/Feuchte | verletzt „Zahlen ehrlich zeigen“ direkt |
| 5 | P-01 | hoch | Einstrahlung um 1 h verschoben (Open-Meteo = Mittel der *vorangehenden* Stunde) | verfälscht PV-Modell und Ladeplan, Tests merken es nicht |
| 6 | P-02 | hoch | Laden-Seite stürzt mit dem echten Prognose-Dienst ab (fehlende Felder `akku`/`auto`) | Blocker für M12 |
| 7 | P-03 | hoch | Live wird immer die älteste Wetterprognose benutzt | Training und Live mit verschiedenem Vorlauf |
| 8 | C-04 / S-05 | hoch / mittel | Dienst läuft direkt aus dem Entwicklungsordner; systemd-Unit ungehärtet (Nutzer mit sudo) | jeder Build ändert live sofort; Codeausführung = root |
| 9 | S-01 / S-02 | mittel | DNS-Rebinding möglich, kein Zugangsschutz im Heimnetz, Standort per POST änderbar | vor Stufe B (Steuern) zwingend |
| 10 | DE-01 | hoch | Kontrast im Hellmodus unter WCAG AA (`--muted`, ⓘ-Symbol) | betrifft jede Seite; Referenz-Farbe `#6C6C70` erfüllt AA |
| 11 | DA-02 / DA-04 / DA-05 | mittel | Integral statt vorhandener Akku-/Direkt-Zähler; fehlende Tage zählen still als 0; Zähler-Ausfall > 10 min ergibt > 1000 kWh | Zählerregel und Wochensummen |
| 12 | C-08 / DA-08 | mittel | Zeitumstellung (25.10.2026) rechnet Ladestand-Spanne/Grundlast mit festen 24 h, ungetestet | Frist in 11 Tagen |

## Schon während des Audits behoben

- **C-01:** `design/` (Referenz-Code) aus ESLint/Prettier ausgenommen → CI auf `main` sollte wieder grün sein (Commit `0dbf7af`).
- **S-03 (teilweise):** Design-Referenz auf `main` ohne Links auf die privaten Seiten, ohne Skriptnamen und ohne Anlagengröße (Commits `a0783b1`, `ac14af8`).

## Fragen an den Nutzer (gesammelt)

1. Historie bereinigen (Modellname in Commit `58f2b7f` und in zwei öffentlichen Branches) – oder belassen? (C-03/S-03)
2. Ältere Messreihe (rund 6,5 Monate Zählerstände) nach Qualitätsprüfung als Prognose-Historie nutzen? (P-22)
3. Ab welcher Dauer sollen Meldelücken überhaupt als Frage erscheinen? (DE-07, DA-11)
4. Laden-Reiter live absichtlich ausgeblendet? (DE)
5. Wetter standardmäßig an (Opt-out) so lassen? (S)
6. Wurden M3b (Home Assistant) und M6 (evcc) gegen echte Instanzen geprüft? (C)
7. Weitere Detailfragen stehen in den Bereichen unten (DA: F-1–F-4).

## Detailberichte

Die fünf ausführlichen Bereichsberichte (Belege, Messwerte, Screenshots) liegen **nur lokal beim Betreiber**, nicht in diesem öffentlichen Repo – sie enthalten Messwerte eines echten Hauses. (Eine frühere Fassung dieser Datei enthielt sie; am 15.10.2026 entfernt.)

