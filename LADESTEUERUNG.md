# VibeDash – Ladeplanung und Ladesteuerung mit PV-Prognose

> Ergänzung zu ANLEITUNG.md. Beschreibt ein in der Praxis erprobtes Verfahren (ein Haus, ~7 Monate Daten, Rückrechnung über 176 Tage) – **ohne Daten dieses Hauses**.
> Ziel: **Das E-Auto lädt so viel Sonnenstrom wie möglich, ohne dass dafür Netzstrom fließt** – auch nicht indirekt, weil der Hausakku abends leer ist.

## 0. Zwei Stufen – Steuern kommt zuletzt

| Stufe | Was | Risiko |
|---|---|---|
| **A Planen & zeigen** | PV-Prognose, Verbrauchsprognose, Ladeplan als Infografik, „Was wäre, wenn …?“ | keins – es wird nichts geschaltet |
| **B Steuern** | Plan an die Wallbox geben (bevorzugt über **evcc**, sonst eigener Adapter) | hoch – nur mit allen Sicherheitsregeln aus Abschnitt 7 |

Stufe B wird erst gebaut, wenn Stufe A mindestens 4 Wochen live richtig plant (Abschnitt 8).

---

## 1. Eingaben

| Eingabe | Quelle | Hinweis |
|---|---|---|
| PV-Erzeugung je Stunde (Ist) | Wechselrichter / Zähler | **Zählerstand** ist Wahrheit, nicht aufintegrierte Leistung |
| Hausverbrauch je Stunde (Ist) | Zähler, **ohne** Auto | Auto-Ladung aus der Wallbox-Messung abziehen |
| Hausakku: Ladestand, Kapazität, max. Lade-/Entladeleistung, Entladegrenze | Wechselrichter/Akku | Ladestand-Sprünge auf 0 % als Messfehler erkennen |
| Wallbox: Ladeleistung, geladene kWh je Sitzung, Stecker an/aus | Wallbox (OCPP/Modbus) oder evcc | Häppchen-Sitzungen je Tag zusammenfassen |
| Auto: Akkukapazität, ggf. Ladestand | Auto-API (optional) | ohne Ladestand: Obergrenze = Kapazität − heute schon geladen |
| Wetterprognose je Stunde | Open-Meteo: **Einstrahlung auf die geneigte Fläche (GTI)** je Dachfläche, Temperatur | kostenlos, ohne Schlüssel; für die Rückrechnung archivierte Läufe („previous runs“) verwenden |
| Dachflächen | Neigung, Ausrichtung, kWp je Fläche | einmal vom Menschen bestätigen |

## 2. PV-Prognose (Stundenmodell)

1. **Physik statt Blackbox:** Erzeugung(h) = Σ über Dachflächen *kᵢ · GTIᵢ(h)*.
   *kᵢ* (Wirkungsfaktor je Fläche) per nichtnegativer kleinster Quadrate aus den letzten ~45 Tagen gelernt, täglich neu. Wechselrichter-Grenzen (Abregelung, Einspeisegrenze) als Deckel.
2. **Unsicherheit über Analogtage (KNN-artig):** Für den Prognosetag die ~30 vergangenen Tage mit dem ähnlichsten **prognostizierten Klarheitsindex** suchen; deren **relativer Prognosefehler** (Ist ÷ Prognose je Stunde) wird auf die neue Prognose angewendet → 30 PV-Szenarien.
3. **Ergebnis:** p10/p50/p90 je Stunde und Tag, Prognose mit Erstellungszeitpunkt und Vorlauf.
4. **Was die Rückrechnung gezeigt hat:** Random Forest, Ridge, Gradient Boosting und eine 2-Merkmal-Regression waren für die Tagessumme gleich gut (Unterschiede ≤ 0,5 kWh, nicht belegbar); KNN, SVM und einzelne Entscheidungsbäume waren schlechter. **Die Güte begrenzt das Eingangswetter, nicht das Verfahren** → frisches Wetter (mehrmals täglich neu holen) bringt mehr als ein komplexeres Modell.

## 3. Verbrauchsprognose (Hauslast ohne Auto)

1. **Tagesniveau:** lineare Regression *c₀ + c₁·HGT + c₂·Wochenende* (HGT = Heizgradtage, Basis 18 °C), **mittelwerttreu** (kein robuster Fit, der rechtsschiefe Last systematisch unterschätzt) + Rest-Mittel der letzten 14 Tage als Niveaukorrektur.
2. **Stundenform:** je Stunde *aₕ + bₕ·HGT*, auf das Tagesniveau skaliert.
3. **Keine Kalenderstufen** („ab November +3 kWh“) – die Temperaturabhängigkeit macht das stetig.
4. **Szenarien:** Last-Reste von ~30 Tagen mit ähnlicher HGT, **ohne Zurücklegen** gezogen.
5. **Ehrlich kennzeichnen:** Liegt die HGT außerhalb des gelernten Bereichs (erster Winter), steht „ungeprüft: noch keine Winterdaten“ dabei.

## 4. Szenarien und Planung

1. **300 Paarungen** aus 30 PV-Szenarien × 30 Last-Szenarien, mehrere Tage über den Akku gekoppelt (feste, reproduzierbare Zuordnung).
2. **Zufall pro Kalendertag fest:** Startwert = (Tag, fester Seed). Sonst springt der Plan bei gleichen Eingaben alle 15 min um mehrere kWh.
3. **Akkusimulation je Szenario:** Ladestand stündlich, Lade-/Entladegrenzen, Entladegrenze, Reserve (z. B. 2 kWh).
4. **Gieriger Ladeplan:** Ein Ladeschritt (z. B. 15 min mit Stufe 6–16 A) wird nur aufgenommen, wenn er im **vorsichtigen Quantil α ≈ 1/31** der 300 Szenarien **weder jetzt noch abends, nachts oder am Folgetag** zusätzlichen Netzbezug verursacht – also auch nicht dadurch, dass der Hausakku vor der nächsten Sonne leer wird.
   - *Nicht* das Minimum über wenige Szenarien nehmen: Ein Stichproben-Minimum ist ein instabiles Extremquantil (Plan streute in der Praxis um ±4 kWh je Tag).
   - *Nicht* einfach mehr Analogtage nehmen: verwässert die Ähnlichkeit und verschiebt die Verteilung.
5. **Ladefenster:** rund um die Uhr erlaubt (auch abends/nachts aus dem Akku), solange Regel 4 hält.
6. **Obergrenze:** Autoakku-Kapazität − heute schon geladen (oder Ziel-Ladestand, wenn das Auto ihn liefert).
7. **Neuplanung:** alle 15 min mit aktuellem Ladestand und frischester Wetterprognose.
8. **Ausgabe:** je Tag geplante kWh mit Spanne, Ladezeitfenster, Stromstärke, Begründung in Worten („Sonne+Akku reichen bis morgen 9 Uhr“).

**Rechenaufwand:** wenige Sekunden je Lauf auf einem Mini-PC (30 Einzelpläne für die Spanne, Quantil über 300 Szenarien).

## 5. Darstellung (Stufe A)

- **Kachel „Auto laden“:** „heute ≈ 18 kWh (12–25) · 10–16 Uhr · 6 A · Sonne+Akku“ + Mini-Grafik.
- **Tagesleiste:** heute / morgen / übermorgen mit PV-Prognose, Verbrauch, möglicher Ladung (je mit Spanne).
- **Stundengrafik:** PV-Band (p10–p90), Hauslast, geplante Ladeblöcke, Akkuverlauf – Prognose als eigene Linie, Ist durchgezogen.
- **„Was wäre, wenn …?“-Schieber:** „Jetzt mit 16 A laden“ → zeigt sofort, ob und wann Netzstrom nötig würde (Kandidat für WebAssembly, da 300 Szenarien im Browser).
- **Treffsicherheit (Seite Vorhersagen):** Netzbezug durchs Auto je Ladetag, geplant vs. geladen, PV-Tagesfehler, Lastfehler – ehrlich mit n.

## 6. Rückrechnung (Pflicht vor jeder Änderung am Verfahren)

- Über alle verfügbaren Tage, **nur mit damals verfügbaren Daten**: Modelle je Woche nur aus Daten davor gefittet, Wetter aus archivierten Prognoseläufen, gleiche Regeln wie live (Fenster, Reserve, Neuplanungs-Takt).
- Kennzahlen: **kWh Netzbezug durchs Auto gesamt + Tage mit > 0,1 kWh** (Ziel ≈ 0), kWh ins Auto je Tag, Last-Bias (Ist − Prognose), Streuung des Plans über mehrere Startwerte, Eingriffe der Mindestlinie.
- **Abnahme:** neue Variante nur live, wenn Netzbezug nicht schlechter, Bias näher an 0, Streuung kleiner – gepaart verglichen, mit Unsicherheit.
- Referenzwerte aus der Praxis (ein Haus, 176 Tage): Netzbezug durchs Auto 0 kWh; Streuung des Plans für morgen Median 3,2 → 2,0 kWh nach Umstellung auf 300 Paarungen + Quantil; Preis: −3,6 % Ladung ins Auto.

## 7. Stufe B: Steuern – Sicherheitsregeln (alle Pflicht)

1. **Ausdrücklich einschalten** (Schalter „Automatik“), Standard = aus. Jederzeit per Knopf übersteuerbar („jetzt voll laden“ / „Automatik aus“).
2. **Totmann:** Ist der Plan älter als z. B. 30 min oder fehlt die Messung → **Laden stoppen** (nie „weiterladen wie zuletzt“).
3. **Stopp hat Vorrang vor Start**; doppelte oder widersprüchliche Befehle dürfen eine laufende Stopp-Entscheidung nicht aufheben.
4. **Mindestlinie:** Fällt der Hausakku unter die geplante Linie **und** reicht er nicht mehr für die Nacht + Reserve → stoppen.
5. **Nur Laden zu Hause** steuern; fremde Sitzungen (App/Karte) nicht anfassen.
6. **Jeder Befehl protokolliert** (Zeit, Grund, Ergebnis); fehlgeschlagene Befehle mit Wiederholung und Meldung.
7. **Wächter getrennt vom Planer:** eigener kleiner Dienst, der nur Plan + Messung liest und schaltet; Planer-Absturz darf nie zu Dauerladen führen.
8. **Bevorzugt über evcc:** evcc kann viele Wallboxen bereits sicher schalten; VibeDash liefert dann nur Plan/Ziel. *(Ob die evcc-Schnittstelle externe Ladeziele/Grenzen in der nötigen Form annimmt, ist ungeprüft – vor M13 klären.)*
9. **Pushes nur bei Handlungsbedarf** („Automatik gestoppt: Messung fehlt seit 20 min“), nie bei normalem Betrieb.

## 8. Fahrplan

| Meilenstein | Inhalt | Fertig, wenn … |
|---|---|---|
| M11 PV-Prognose | Stundenmodell, Dachflächen, Analogtag-Szenarien, p10/p50/p90 | Demo-Anlage: Tagesprognose mit Spanne, faire Treffsicherheit |
| M12 Ladeplan (Stufe A) | Lastmodell, Akkusimulation, 300 Szenarien, Plan + Infografik + Rückrechnung | Rückrechnung auf Demo-Daten: 0 kWh Netzbezug durchs Auto, Plan stabil |
| M12b Was-wäre-wenn | Schieber im Browser | Antwort < 1 s am iPhone |
| M13 Steuerung (Stufe B) | evcc-Anbindung **oder** eigener Wächter, alle Regeln aus Abschnitt 7 | 4 Wochen Stufe A live ohne Fehlplanung; Wächter-Tests (Totmann, Stopp-Vorrang, Ausfall der Messung) grün |
