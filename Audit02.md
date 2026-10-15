# Audit02 – VibeDash live

**Stand:** Commit `9fcc443` (live seit 15.10.2026 10:23 aus dem Release-Verzeichnis; Branch `audit01`, zum Prüfzeitpunkt **nur lokal**, nicht auf GitHub) · geprüft am 15.10.2026
**Methode:** 4 unabhängige Prüfer (Opus), nur lesend: jede live gezeigte Zahl gegen die Rohdaten, alle Seiten und Zeiträume auf Mac/iPhone hell/dunkel (36 Zustände), Sicherheit/Betrieb/Last der laufenden Instanz, Herkunft und Ehrlichkeit der Prognosen. Schreibtests nur gegen Wegwerf-Instanzen. Live-Build byte-gleich mit dem geprüften Commit.
**Datenschutz:** Dieser Bericht enthält **keine Hausdaten**. Die ausführlichen Bereichsberichte mit Messwerten und Screenshots bleiben lokal beim Betreiber.

## Ergebnis in Kürze

**Neue Befunde: 60** (0 kritisch · 6 hoch · 25 mittel · 29 niedrig)

| Bereich | hoch | mittel | niedrig | gesamt |
|---|---|---|---|---|
| Live-Daten (N-) | 0 | 6 | 6 | 12 |
| Design und Plattformen (DE2-) | 3 | 8 | 7 | 18 |
| Sicherheit und Betrieb (B-) | 1 | 7 | 8 | 16 |
| Prognosen (P-25 … P-38) | 2 | 4 | 8 | 14 |

**Nachverfolgung Audit01 (104 Befunde), grob:** etwa 18 behoben (davon 3 nur im Code), etwa 25 teilweise, der Rest offen. Ausdrücklich behoben u. a.: erfundener Demo-Satz im ⓘ (DA-01), Akku/Direkt aus Zählern (DA-02), Zähler-Ausfall > 10 min (DA-05), Zeitumstellung weitgehend (DA-08/C-08), Kontrast hell (DE-01, bis auf zwei Stellen), Dauerbanner (DE-06), Schutz gegen DNS-Rebinding (S-01), eigenes Release-Verzeichnis statt Entwicklungsordner (C-04), Einstrahlung 1 h verschoben (P-01, mit Test), Laden-Seite mit echtem Dienst (P-02, im Code).

**Gesamturteil:** Die Kernzahlen stimmen weiterhin exakt (über 100 Einzelwerte gegen die Rohdaten). Die neuen Schwächen sitzen in den neuen Funktionen (Jahresansicht, gehaltene Werte, Laden-Seite, Prognose-Etiketten), im Betrieb (Rollback, Erreichbarkeit, Dateirechte des Dienstes) und in der Repo-Hygiene (live ≠ `main`, kein Branch-Schutz). Mehrere Befunde betreffen direkt die Kernidee „Zahlen ehrlich zeigen“.

## Die 12 wichtigsten Punkte

| # | ID | Schwere | Was |
|---|---|---|---|
| 1 | B-05 | mittel | `Audit01.md` auf `main` enthielt Hauswerte in den Detailteilen → **am 15.10. entfernt** (nur Zusammenfassung bleibt). Offen: Historie bereinigen oder lassen (Frage). |
| 2 | B-01 | hoch | **Rollback funktioniert praktisch nicht:** ältere Releases lehnen neue Mapping-Schlüssel ab (Endlos-Neustart), kein Health-Check, keine automatische Rückkehr. |
| 3 | P-25 / P-26 / N-05 | hoch | **Falsche Prognose bewertet und falsch beschriftet:** Kurven „Prognose (Vorabend)“ und die Karte „Sonnenprognose · schlecht“ zeigen bzw. bewerten die eingebaute Faustregel, nicht die angezeigte Hausprognose. Nachgerechnete Tage erscheinen als „Vorabend“ (P-27). |
| 4 | DE2-01 | hoch | Sonne-Kachel zeichnet die heutige Ist-Linie flach bei 0, obwohl Leistung anliegt. |
| 5 | DE2-02 | hoch | Laden-Seite: Stunden-Achse um 6 h verschoben. |
| 6 | DE2-03 | hoch | iPhone: Texte in „Wetter und Ertrag“ überlappen, Seite scrollt seitlich (10 von 18 iPhone-Zuständen). |
| 7 | B-07 | mittel | Live ≠ `main`: 2 Live-Commits nie gepusht, nie durch die CI; `main` ohne Branch-Schutz, Direkt-Pushes mit roter CI. |
| 8 | B-02 / B-04 | mittel | Live im ganzen Heimnetz erreichbar, Standort per POST ohne `Origin` änderbar; Schreibprüfung mit Lücken, nicht atomar. |
| 9 | B-03 | mittel | Dienst kann wegen `ProtectHome=read-only` das ganze Home lesen (u. a. SSH-Schlüssel, fremde `.env`) → nur die benötigten Pfade freigeben. |
| 10 | N-02 / N-03 | mittel | Gehaltene Werte zeigen ihr Alter nicht („jetzt“ statt „zuletzt 15:32“); Lückenfragen nennen das Ende der Haltezeit; Abdeckungsregel zählt gehaltene Werte mit. |
| 11 | N-01 / DE2-06 | mittel | Jahresansicht übernimmt die ältere Messreihe ungeprüft (Überlauf, Rücksprünge; Summe −6 %), fehlende Tage als 0, „seit 1.1.“ obwohl Daten erst Ende März beginnen. |
| 12 | B-08 / DE2-05 | mittel | Jeder Seitenaufruf ≈ 105 Influx-Abfragen ohne Cache; erste Seite 222 KiB JS ungepackt (über Budget, gzip würde 63 % sparen), iPhone 2,7–3,7 s bis Inhalt. |

Weitere wichtige: Laden-Seite ist hausspezifisch eingebaut (N-07: Plan-Vertrag, Skala, Quellen-Wort fest im Code), doppelte Endzeile setzt Ladungs-kWh auf 0 (N-06), Spanne des Ladeplans falsch als „10–90 %“ beschriftet (P-30), Urteil „schlecht“ schon bei n = 8 ohne Intervall (P-06/DE2-09), Zeitraumwahl springt beim Nachladen auf „Heute“ zurück (DE2-04), Netz-Kachel ohne Totband (DE2-08).

## Antworten auf Fragen der Prüfer (vom Betreiber bzw. aus dem Hauswissen)

| Frage | Antwort |
|---|---|
| Netzbezug April–September in der älteren Reihe fast 0, Integral 2–3,6× höher – was stimmt? | Der **Bezugszähler** stimmt (nie übergelaufen). Das **Integral** der damaligen Netzleistung ist falsch (die frühere Bridge las nur eine Phase und erfand Bezug). → immer Zähler. |
| Ist die „gemessene“ Sonnenscheindauer der hauseigenen Wetterreihe eine Station? | **Nein, ein Modell** (Wetterdienst-Rückblick). Beide Werte als Schätzung kennzeichnen. |
| Ist der Außenfühler am 13.10. ab 15:32 ausgefallen? | **Nein.** Er sendet zyklisch etwa alle 5 min und steht lückenlos in den Rohdaten – bis auf die Umzugslücke ~15:42–16:06. Zeigt VibeDash ab 15:32 Stille, ist das ein Lese-/Abfragefehler in VibeDash (gehört zu N-03). |
| Spanne des Ladeplans: Median = untere Grenze – Absicht? | Ja: **untere Zahl = vorsichtiger Plan** (1/31-Quantil über 300 Szenarien), **obere = bei gutem Wetter möglich**. Kein 10–90-%-Band → Beschriftung ändern (P-30). |
| Ab welcher Dauer wird eine Meldelücke zur Frage? | Je Sensorart: Reihen mit festem Takt (z. B. 10 s) ab ~30 min; Sensoren, die nur bei Änderung melden, erst nach ~12 h; bekannte Ereignisse nie. |
| Soll die Seite sich selbst aktualisieren? | Ja: „Jetzt“-Werte alle 30–60 s, Tages-/Wochenwerte beim Wechsel des Zeitraums oder alle 15 min. |
| Sehr kurze Ladesitzungen? | Je Tag zusammenfassen (Sitzungen mit < 90 min Abstand = eine Ladung). |
| Ortsname im Fuß „Nächste 7 Tage“? | Lokal ja, aber nie in Screenshots/Repo. |
| Offen beim Betreiber | Erreichbarkeit im Heimnetz + `LOCATION_WRITE=off`; welcher Hostname erlaubt sein soll (Router-Name bekommt 421); Sicherung von `~/.config/vibedash/` (vom Haus-Backup bisher nicht erfasst); Historie wegen Audit01 bereinigen oder lassen. |
