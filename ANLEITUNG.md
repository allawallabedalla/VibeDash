# VibeDash – Projektanleitung: ruhige Haus-Dashboards, von einem KI-Agenten gebaut

> Projektname: **VibeDash** · Repo: github.com/allawallabedalla/VibeDash
> Diese Datei ist die Übergabe an eine neue Claude-Code-Sitzung in einem **neuen, leeren Repo**.
> Sie enthält bewusst **keine Daten aus einem echten Haus** (keine Adressen, IPs, Gruppenadressen, Grundrisse, Namen).

---

## 1. Die Idee in drei Sätzen

1. Klassische Dashboard-Software (Grafana, Homepage, Dashy) muss für alle passen und wird deshalb per Konfiguration angepasst – das ist für Nicht-Nerds zu schwer und sieht nie ruhig aus.
2. Mit einem KI-Agenten geht es umgekehrt: **Der Agent baut jedem Haus sein eigenes Dashboard** – aus festen Design-Bausteinen, mit geprüften Daten.
3. Das Projekt liefert deshalb **keine Riesen-App**, sondern drei Dinge: eine **Design-Sprache** (Bausteine), **Datenanschlüsse** und eine **Bauanleitung für den Agenten**.

## 2. Für wen

- Menschen mit Smart Home / PV / Wärmepumpe / E-Auto, die **auf einen Blick** wissen wollen, was los ist – ohne Diagramm-Lesen zu lernen.
- Ausdrücklich auch für Menschen mit ADHS: ein Blick, wenige Wörter, keine Reizüberflutung.
- Am Mac **und** am iPhone gleich gut.

## 3. Was es NICHT ist (Nicht-Ziele)

- Kein Grafana-Nachbau. Für tiefe Zeitreihen-Analysen bleibt Grafana (oder Ähnliches) – verlinkt als „zweite Ebene“.
- Keine YAML-Konfigurationswüste, kein Drag-and-drop-Editor.
- Keine Cloud. Alles läuft lokal im Heimnetz.
- Keine Steuerung (Schalten, Laden) im ersten Wurf – nur Anzeige.

---

## 4. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  Web-App (statisch gebaut, lokal ausgeliefert)              │
│  Seiten = Komposition aus Design-Bausteinen                 │
├─────────────────────────────────────────────────────────────┤
│  Design-Bausteine (Komponenten-Bibliothek)                  │
│  Kachel · Sparkline · Ring · Skala · Fortschritt · Tagesleiste│
│  Treffsicherheits-Karte · Zeitreihe weich · Herkunftsbogen  │
├─────────────────────────────────────────────────────────────┤
│  Einheitliches Datenmodell (Entitäten, Messwerte, Prognosen)│
├─────────────────────────────────────────────────────────────┤
│  Datenanschlüsse (Adapter)                                  │
│  InfluxDB 1.x · Home Assistant · generische JSON-API · CSV  │
└─────────────────────────────────────────────────────────────┘
        ▲
        │  baut und pflegt
┌───────┴─────────────────────────────────────────────────────┐
│  Agenten-Bauanleitung (CLAUDE.md / Skill)                   │
│  Inventur → Datenwahrheit prüfen → Seiten bauen → testen     │
└─────────────────────────────────────────────────────────────┘
```

### Technik-Empfehlung (Startpunkt, darf der Agent begründet ändern)

| Teil | Wahl | Warum |
|---|---|---|
| Sprache | TypeScript | Typen fürs Datenmodell, ein Ökosystem für Front- und Backend |
| Oberfläche | Svelte (oder reine Web Components) | klein, schnell am iPhone, wenig Boilerplate |
| Diagramme | uPlot (Zeitreihen) + eigenes SVG (Kachel-Grafiken) | uPlot ist winzig und schnell; Kachel-Grafiken sind einfache SVGs |
| Server | kleiner Node/Bun-Server **oder** gar keiner (App liest direkt eine JSON-API) | Adapter brauchen einen Ort für Zugangsdaten |
| Tests | Vitest (Logik) + Playwright (Screenshots Mac 1440 px / iPhone 390 px) | Optik ist das Produkt – sie muss getestet werden |
| Auslieferung | ein Docker-Image **und** ein statischer Build | Homelab-üblich |
| Prognose-Dienst (ab M7) | eigener kleiner Python-Dienst (FastAPI + scikit-learn) | ML-Werkzeuge sind in Python am besten; siehe Abschnitt 11 |

**Leistungsbudget:** erste Seite < 200 KB JavaScript, sichtbar < 1 s im Heimnetz am iPhone. Keine CDNs, alles lokal gebündelt.

**Nicht Rust/WebAssembly für die Oberfläche** – bringt bei Kacheln und Diagrammen nur Ladezeit. WASM höchstens später für interaktive Rechenspiele (z. B. „Was wäre, wenn ich jetzt lade?“).

---

## 5. Design-Regeln (das Herz des Projekts)

Diese Regeln sind aus echter Nutzung entstanden. Der Agent hält sie **immer** ein.

### Erste Ebene = Infografik, nicht Zahlenfriedhof
1. Jede Seite beginnt mit **Kacheln**: Wert groß, 1–2 Wörter Beschriftung, **eine kleine Grafik** (Ring, Skala, Anteil, Punkte, Sparkline, Vergleich ▲/▼).
2. **Tabellen nie allein** – immer mit Infografik davor; Tabellen kommen als zweiter Abschnitt unter die Kacheln.
3. **Symbol = Outline-Icon + 1–2 Wörter.** Keine Emojis, keine Symbolketten („✓ ✓ ⏳ ✓“ → „Module ok · Akku ok · Nacht läuft“).
4. **Details hinter ⓘ** – und ⓘ öffnet per **Antippen**, nicht per Darüberfahren (iPhone hat kein Hover).
5. **Weich und ruhig:** abgerundete Formen, sanfte Verläufe, kräftige aber geschwungene Linien, wenige Farben. Hell- und Dunkelmodus.
6. **IST zuerst**, dann Rückblick mit frei wählbarem Zeitraum.

### Zahlen ehrlich zeigen
7. **Jede Näherung mit Unsicherheit:** Spanne oder ± und Stichprobengröße n („≈ 18 kWh (12–25), n = 30“).
8. **Prognose = eigene, durchgehende Linie**, nie an die Ist-Linie angeklebt.
9. **Vorzeichen fest:** Einspeisung oben/positiv, Netzbezug unten/negativ.
10. **Modelle zeigen ihre Treffsicherheit**, nicht ihren „Lernfortschritt“: je Modell ein Balken 0–100 % „korrekt“ + Sparkline des Verlaufs („wird es besser?“).
11. **Keine Schein-Genauigkeit:** Was (noch) nicht bewertbar ist, heißt „offen · n = 2 · ab ca. …“ – nicht 100 %.

### Nicht nerven
12. **Hinweise nur bei Handlungsbedarf.** Kein „unter Soll – prüfen“, kein Dauer-Gelb.
13. Pushes (falls später) nur bei echten Defekten oder nötigen Handgriffen, kurz, mit Link zur Seite.

### Plattformen
14. **Mac und iPhone sind gleichwertig.** Jede Seite hat ein eigenes, bewusst gestaltetes Handy-Layout (kein bloßes Untereinanderstapeln).
15. Antippflächen ≥ 44 px, Schrift ≥ 14 px auf dem Handy.

---

## 6. Datenwahrheit (wichtiger als jeder Algorithmus)

Der Agent prüft Daten, **bevor** er sie darstellt oder Modelle darauf baut. Typische Fallen aus der Praxis:

| Falle | Regel |
|---|---|
| Schaltbefehl ≠ Zustand (z. B. Melder schickt „Ein“ und gleichzeitig „Helligkeit 0“) | Zustand immer aus **Rückmeldungen der Aktoren** (Status), nicht aus Befehlen |
| Leistung aufintegriert ≠ Energie | **Zählerstände** sind die Wahrheit; Integrale nur als Notlösung |
| Zwei Meldungen in derselben Sekunde | Reihenfolge des Eingangs behalten, **nie nach Wert sortieren** |
| Lücken (Sensor schweigt, Neustart) | Lücken sichtbar machen, nicht als 0 oder „gleich geblieben“ werten |
| Zeitumstellung, Zeitzonen | intern UTC, Anzeige lokal; Tage nach lokaler Zeit schneiden |
| Mehrfachläufe eines Jobs am Tag | je Tag den **planmäßigen** Lauf zählen |
| Bewertung von Modellen | nur mit Daten lernen, die **vor** dem bewerteten Tag bekannt waren; fairer Vergleich bei **gleichem Prognose-Vorlauf**; nie das Ergebnis gegen sich selbst prüfen (zirkulär) |
| Mittelwerte mit Vorzeichen | +40 % und −40 % ergeben 0 – für Fehler den **Betrag** mitteln |

**Wichtig:** Auffälligkeiten als **Frage an den Menschen** formulieren („Brennt in der Küche nachts wirklich Licht?“), nicht als Bug behaupten. Der Mensch kennt sein Haus.

---

## 7. Bausteine (erste Liste)

| Baustein | Zweck |
|---|---|
| `Kachel` | Wert + Wort + Mini-Grafik (Arten: ring, skala, anteil, punkte, spark, vergleich) + Status-Punkt |
| `KachelReihe` | 2–6 Kacheln, auf dem Handy 2 je Zeile |
| `Sparkline` | weicher Verlauf, optional Band (Spanne) |
| `Fortschritt` | Balken 0–100 % mit Wort („82 % korrekt“) |
| `TrefferKarte` | Modell: Balken „korrekt“ + Sparkline-Verlauf + n + Stufe (gut/mäßig/schlecht/offen) |
| `Tagesleiste` | Tage als Zeilen: Symbol · Tief ▬▬ Hoch · Regen · Sonnenstunden · kWh (wie eine Wetter-App) |
| `ZeitreiheWeich` | Ist-Linie + eigene Prognoselinie + Band; Zeitraumwahl |
| `Herkunftsbogen` | woher kommt der Strom gerade (Sonne/Akku/Netz) als weicher Bogen |
| `Ampelleiste` | Bereiche als ruhige Punkte (ok / ansehen / handeln) |
| `Reiter` | 6 Hauptbereiche als Leiste oben, auf dem Handy kompakt |
| `Erklaerung` | ⓘ-Inhalt: „Was heißt das?“ + „Woher kommt die Zahl?“ |

**Namen im Code (englisch):** Kachel = `Tile` · KachelReihe = `TileRow` · Sparkline = `Sparkline` · Fortschritt = `Progress` · TrefferKarte = `AccuracyCard` · Tagesleiste = `DayList` · ZeitreiheWeich = `SoftTimeSeries` · Herkunftsbogen = `SourceArc` · Ampelleiste = `StatusBar` · Reiter = `Tabs` · Erklaerung = `Explanation` (+ `InfoButton`).

**Seitenvorlage (anpassbar je Haus):** Übersicht · Jetzt · Wartung · Garten · Geräte-Historie · Vorhersagen (Treffsicherheit).

---

## 8. Datenanschlüsse (Reihenfolge)

1. **Demo-Daten (synthetisch)** – für Entwicklung, Tests und Screenshots. Realistische Tagesgänge, Lücken, Fehler absichtlich eingebaut.
2. **InfluxDB 1.x (InfluxQL)** – weit verbreitet in Homelabs.
3. **Home Assistant** (REST/WebSocket) – größte Zielgruppe; direkt nach Influx (M3b).
4. **evcc** – Energie/Wallbox mit vielen Gerätevorlagen (M6).
5. **Generische JSON-API** – für eigene Skripte.
6. Später: Prometheus, MQTT, CSV-Import.

Einheitliches Datenmodell: `Entitaet` (id, Name, Art, Raum, Einheit) · `Messreihe` (Zeit, Wert, Quelle, Lückeninfo) · `Prognose` (Zeitpunkt, erstellt_am, Vorlauf, Wert, Spanne) · `Bewertung` (Modell, n, korrekt_pct, Verlauf).

---

## 9. Qualität

- **Screenshot-Tests** jeder Seite: Mac (1440 × 900) und iPhone (390 × 844), hell und dunkel. Abweichungen werden angesehen, nicht nur gezählt.
- **Prüfliste je Seite:** erste Ebene nur Kacheln/Infografiken? keine Emojis? ⓘ per Tippen? Unsicherheiten angegeben? Prognose eigene Linie? Handy-Layout bewusst?
- **Keine echten Hausdaten im Repo**, auch nicht in Screenshots, Tests oder Commits. Zugangsdaten nur in `.env` (nicht eingecheckt).
- Kleine Commits, klare Nachrichten.

---

## 10. Fahrplan

| Meilenstein | Inhalt | Fertig, wenn … |
|---|---|---|
| M0 Gerüst | Repo, Lizenz, TypeScript + Svelte + uPlot, Lint, Tests, CI | `npm test` und Screenshot-Test laufen in CI |
| M1 Bausteine | 11 Bausteine + Demo-Daten + Galerie-Seite | Galerie sieht auf Mac und iPhone ruhig und stimmig aus |
| M2 Übersicht | erste echte Seite aus Demo-Daten | Seite besteht die Prüfliste |
| M3 InfluxDB-Anschluss | Adapter + Datenmodell-Abbildung | Übersicht läuft mit echter Influx (lokal, nicht im Repo) |
| M3b Home Assistant | Adapter (REST/WebSocket), Entitäten → Datenmodell; **direkt nach Influx** (siehe INBETRIEBNAHME.md) | Übersicht läuft mit einer HA-Testinstanz |
| M4 Jetzt + Vorhersagen | Echtzeit-Seite, Treffsicherheits-Karten | Prognosen mit Spanne und n, Bewertung fair |
| M5 Agenten-Bauanleitung | `AGENT.md`/Skill: wie ein Agent ein Haus inventarisiert, prüft und Seiten baut – **inkl. Inbetriebnahme-Ablauf** (INBETRIEBNAHME.md Abschnitt 3+4) | ein frischer Agent führt einen Menschen von „neuer PC“ bis „erste echte Kachel“, nur mit der Anleitung |
| M6 evcc | Adapter: „jetzt“ aus `/api/state`, Ladehistorie direkt aus evcc (`/api/sessions`); Verlauf sonst über Influx/HA (INBETRIEBNAHME.md 2a) | Energie-Seite läuft mit evcc-Demo |
| v0.1 | Doku, Beispiel-Screenshots, Docker-Image (`node:24-alpine`) | jemand Fremdes bekommt es in 15 min zum Laufen |
| M7–M9 Prognose-Modul | siehe Abschnitt 11; der Python-Dienst liegt **hinter** dem Node-Server | Browser spricht weiterhin nur mit dem Node-Server |
| M10 Geräte-Vorlagen | siehe INBETRIEBNAHME.md Abschnitt 5 (nur lesend) | Vorlage + Gegenprobe-Test je Gerät |
| M11 PV-Prognose | Stundenmodell, Dachflächen, Analogtag-Szenarien, p10/p50/p90 (LADESTEUERUNG.md); **Voraussetzung: mehrere Wochen Stundenverlauf in Influx oder HA** | Demo-Anlage: Tagesprognose mit Spanne, faire Treffsicherheit |
| M12 Ladeplan (Stufe A) | Lastmodell, Akkusimulation, 300 Szenarien, Plan + Infografik + Rückrechnung | Rückrechnung auf Demo-Daten: 0 kWh Netzbezug durchs Auto, Plan stabil |
| M12b Was-wäre-wenn | Schieber im Browser | Antwort < 1 s am iPhone |
| M13 Steuerung (Stufe B) | evcc-Anbindung **oder** eigener Wächter, alle Regeln aus LADESTEUERUNG.md Abschnitt 7; im fremden Haus zusätzlich RISIKEN.md | 4 Wochen Stufe A live ohne Fehlplanung; Wächter-Tests (Totmann, Stopp-Vorrang, Ausfall der Messung) grün |

---

## 11. Vorhersagen für beliebige Messreihen („Prognose-Modul“)

**Idee:** Jede angebundene Messreihe (Influx, Home Assistant, JSON-Endpunkt, Webhook) kann mit einem Klick eine Vorhersage bekommen. Ein lokaler Dienst lernt daran, bewertet sich ehrlich selbst und liefert Prognose + Spanne an die Bausteine.

### Architektur
- **Eigener lokaler Dienst** (Python: FastAPI + scikit-learn, optional LightGBM) – ML ist in Python am stärksten; die Oberfläche bleibt TypeScript.
- API (Vorschlag):
  - `POST /reihen` – Messreihe anmelden (Quelle, Einheit, Takt: Stunde/Tag, Ziel: Wert oder Ja/Nein)
  - `GET  /reihen/{id}/prognose?bis=…` – p10 / p50 / p90 je Zeitschritt, `erstellt_am`, `vorlauf_h`
  - `GET  /reihen/{id}/guete` – Treffsicherheit (siehe unten) inkl. Verlauf
  - `GET  /reihen/{id}/status` – Zustand und Klartext („sammelt Daten · 12 von 28 Tagen · ab ca. 03.11.“)
- Merkmale automatisch: Uhrzeit, Wochentag, Wochenende/Feiertag, **dunkel ja/nein** (Sonnenstand, berechnet), optional Wetterprognose (Open-Meteo – abschaltbar, da extern), optional andere Messreihen als Einflussgrößen.

### Verfahrens-Leiter (immer in dieser Reihenfolge, das einfachste Ausreichende gewinnt)
1. **Faustregeln:** wie gestern · wie vor 7 Tagen · gleitender Mittelwert · Mittel je Uhrzeit+Wochentag.
2. **Lineare/Ridge-Regression** mit Kalender + Wetter (extrapoliert sauber in neue Jahreszeiten).
3. **Gradient Boosting** mit Regularisierung (min. Blattgröße ≥ 20).
4. **Quantil-Regression** bzw. empirische Restfehler für die Spanne (p10/p90).
- Gewählt wird per **rollierender Rückrechnung** (nur Vergangenheit, gleicher Vorlauf wie live). Ein komplexeres Verfahren wird nur genommen, wenn es die Faustregel **gepaart um ≥ 2 Standardfehler** schlägt – sonst gewinnt die Faustregel. (Erfahrung aus der Praxis: Random Forest, KNN, SVM brachten bei Haus-Daten fast nie einen belegbaren Gewinn; KNN/Bäume extrapolieren nicht in neue Jahreszeiten.)
- Bei Ja/Nein-Zielen (z. B. „Licht an?“): **Wahrscheinlichkeiten** ausgeben, Dauer = Summe der Wahrscheinlichkeiten – nie hartes Ja/Nein mit Klassengewichten (blähte in der Praxis Dauern um +60–100 % auf).

### Status und Treffsicherheit (was der Mensch sieht)
| Zustand | Anzeige |
|---|---|
| zu wenig Daten | „sammelt Daten · 12 von 28 Tagen · ab ca. 03.11.“ (Fortschrittsbalken nur hier) |
| bewertbar, n klein | „offen · n = 6“ – **keine** Prozentzahl als Urteil |
| bewertbar | Treffsicherheits-Karte: Balken 0–100 % „korrekt“ + Sparkline des Verlaufs + n + Stufe gut/mäßig/schlecht + „schlägt Faustregel um x %“ |
| Datenbasis zweifelhaft | „Datenbasis wird geprüft“ statt Zahl |
- „Korrekt“ je Zieltyp klar definiert (z. B. Anteil Tage im 80-%-Band, oder 100 % − mittlerer |Fehler| in %), im ⓘ erklärt.
- **Kein Lernfortschritt-Theater** (Epochen, Loss-Kurven) – nur rückblickende Treffsicherheit.

### Ehrlichkeit (Pflicht, automatisch geprüft)
- Bewertung nur mit Daten **vor** dem bewerteten Zeitpunkt; Prognose wird zum Zeitpunkt der Entscheidung festgehalten (`erstellt_am`, `vorlauf_h`) und erst später gegen das Ist gehalten.
- Nie gegen sich selbst prüfen (z. B. Ist-Wert, der aus derselben Quelle stammt wie die Vorhersage).
- Fehler als **Betrag** mitteln; Richtung (zu hoch/zu niedrig) separat zeigen.
- Mehrere Läufe am Tag: nur der planmäßige zählt.
- **Jahreszeit-Warnung:** Liegt die Vorhersage außerhalb des gelernten Bereichs (z. B. erster Winter), steht „ungeprüft: noch keine Winterdaten“ dabei.
- Pro Reihe eine kurze **Modellkarte** (ⓘ): Verfahren, Merkmale, Trainingszeitraum, n, Treffsicherheit, bekannte Grenzen.

### In den Infografiken
- `Kachel`: „≈ 18 kWh“ + Spanne „(12–25)“ + Mini-Grafik mit Prognose als **eigener** gestrichelter Linie.
- `Sparkline`/`ZeitreiheWeich`: Ist durchgezogen, Prognose eigene Linie mit Band, Übergang sichtbar getrennt.
- `TrefferKarte` je Modell auf einer Seite „Vorhersagen“.

### Fahrplan-Ergänzung
| Meilenstein | Inhalt | Fertig, wenn … |
|---|---|---|
| M7 Prognose-Dienst | API, Faustregeln + Ridge, Rückrechnung, Status | Demo-Reihe (PV-Tag) bekommt Prognose + Spanne + ehrliche Güte |
| M8 Verfahrens-Leiter komplett | Boosting, Quantile, Ja/Nein-Ziele, Wetter optional | Leiter wählt pro Demo-Reihe nachvollziehbar, Modellkarte vorhanden |
| M9 Einbindung | Kachel/Sparkline/TrefferKarte zeigen Prognosen | Prüfliste Abschnitt 9 + Ehrlichkeitsregeln automatisch getestet |

---

## 12. Offene Entscheidungen (vom Menschen zu treffen)

1. ~~Name~~ – entschieden: **VibeDash**.
2. ~~Lizenz~~ – entschieden: **MIT** (`LICENSE`, Copyright allawallabedalla).
3. ~~Sprache~~ – entschieden: Code und README **englisch**, Oberfläche **Deutsch + Englisch** ab Start.
4. **Öffentlich ab Tag 1 oder erst ab v0.1?** Empfehlung: privat bis M2, dann öffentlich.
5. ~~Server~~ – entschieden (M3): reiner Node-Server (Node 24 LTS), führt nur benannte Abfragen aus `local/mapping.json` aus, nie InfluxQL aus dem Browser; Influx-Zugang nur mit Lese-Benutzer in `.env`; jede Anfrage mit 10 s Timeout und sichtbarem Fehlerzustand.

---

## 13. Erster Auftrag an Claude Code (zum Kopieren)

```
Lies ANLEITUNG.md und CLAUDE.md vollständig. Das ist ein neues, leeres Repo.

Ziel dieser Sitzung: Meilenstein M0 und der Anfang von M1.
1. Schlage mir zuerst kurz vor: Ordnerstruktur, Paketmanager, genaue Versionen
   (TypeScript, Svelte, uPlot, Vitest, Playwright), Lizenzdatei – warte auf mein Okay.
2. Dann: Gerüst anlegen, CI (Lint + Tests + Screenshot-Test Mac 1440 / iPhone 390),
   synthetische Demo-Daten (24 h und 30 Tage: PV, Hausverbrauch, Akku, Raumklima,
   mit absichtlichen Lücken und einem Sensor-Artefakt).
3. Die ersten drei Bausteine: Kachel (mit Grafik-Arten ring, skala, spark),
   Sparkline, Fortschritt – plus eine Galerie-Seite.
4. Screenshots von Mac und iPhone machen, selbst ansehen, gegen die Design-Regeln
   in Abschnitt 5 prüfen, nachbessern, dann mir zeigen.
Keine echten Hausdaten verwenden. Committe in kleinen Schritten, pushe nicht ohne Frage.
```
