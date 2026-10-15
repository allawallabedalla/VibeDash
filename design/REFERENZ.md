# Design-Referenz: die Infografiken aus der Haus-Vorlage

> Hier liegt der **echte Code** der Infografiken, die im ursprünglichen Haus-Dashboard (Grafana-HTML-Panels) entstanden und vom Nutzer abgenommen wurden.
> ANLEITUNG.md beschreibt die Regeln nur in Worten – **dieser Ordner zeigt, wie es aussehen soll.**
> Bereinigt: keine Hausdaten, keine Adressen; API-Port durch `<API-PORT>` ersetzt.
> Es ist **Referenz, kein Bibliothekscode**: Grafana-spezifisches (`data.series`, `htmlNode`, Infinity) und Aktionen (Steuer-Knöpfe) **nicht übernehmen** – nur Optik, Proportionen, Farben, Verhalten nachbauen, in Svelte/SVG.

## Dateien und was daraus werden soll

| Datei | Inhalt | VibeDash-Baustein |
|---|---|---|
| `jetzt_infografiken.js/.css` | Seite „Jetzt“/Start: **Mini-Grafiken in SVG** (Abschnitt „Mini-Grafiken“ ab ~Zeile 92): Bogen (Anteil), Herkunft (gestapelter Balken Sonne/Akku/Netz), Akku-Füllstand, Pendel (Netz: Einspeisung oben / Bezug unten), Skala mit Gut-Bereich; Kacheln mit Symbol + 1–2 Wörtern, ⓘ-Erklärungen, Zeitraumwahl 7 T/30 T/Jahr/Gesamt | `Tile`, `SourceArc`, `Progress`, Grafik-Arten der Kachel |
| `kachel_grafik.js/.css` | Kachel-Reihe mit **einer kleinen Grafik je Zahl**: `ring` (conic-gradient + Maske), `skala {min,max,gut:[a,b]}`, `anteil`, `punkte {max}`, `spark` (Verlauf als Fläche), `vgl` (▲/▼ gegen vorher) | `TileRow`, `Tile`, `Sparkline` |
| `treffsicherheit.js/.css` | Seite „Machine Learning“: Ampelleiste oben, je Modell eine Karte mit **Balken 0–100 % „korrekt“ + Sparkline des Verlaufs**, Stufe gut/mäßig/schlecht/offen, n | `AccuracyCard`, `StatusBar` |
| `tagesleiste.js/.css` | Tagesleiste wie Apple Wetter: Tag · Symbol · Regen · **Tief ▬▬ Hoch** (gemeinsame Skala, Balkenfarbe nach Temperatur, 0-°C-Strich bei Frost) · Sonnenstunden · kWh (≈ = Prognose); vergangene Tage → Heute → Vorhersage; Handy-Spalten reduziert | `DayList` |
| `wetter_tage.js/.css` | kompakte Wetter-Kacheln je Tag (Übersicht) | `DayList` (kompakt) |
| `tipp_kacheln.js/.css` | Tipp-Kacheln mit Themen-Icon, Details per Klick aufklappen, „frühere Tipps“ eingeklappt | `Tile` (Text-Variante), `Explanation` |
| `reiter.js/.css` | Reiterleiste der 6 Hauptbereiche (aktiv hervorgehoben) + einzeiliger Pfad, auf Hauptseiten ausgeblendet | `Tabs` |

## Gestaltung in Zahlen (aus dem CSS)

- **Schrift:** System-Schrift (`-apple-system, "SF Pro Text", Inter, …`), Icons als Font-Awesome-Outline (eigene Icon-Schrift).
- **Farben (häufigste):** Text `#1D1D1F`, gedämpft `#6C6C70` / `#AEAEB2`, Linien `#C7C7CC` / `#D9D9E3`, Flächen `#F2F2F5` / `#EFEFF4` / `#FFFFFF`; Akzent Blau `#0A6FCC`, Lila `#5E5CE6`; Status Grün `#2E8B57`, Orange `#FF9F0A`, Rot `#FF3B30`; warme Hinweisflächen `#FFF6E5`, `#FFECEA`. (Apple-Health-nahe Palette; Tagesleiste nutzt eine Temperatur-Farbskala blau → grün → gelb → orange → rot.)
- **Rundungen:** Karten 14–20 px, kleine Elemente 6 px, Pillen 999 px.
- **Linien in Diagrammen:** kräftig und geschwungen; Prognose als **eigene** Linie (gestrichelt), nie an die Ist-Linie angeklebt; Spannen als weiches Band.

## Was der Nutzer ausdrücklich wollte (Rückmeldungen, die zu diesem Code führten)

1. „Jede Zahl mit kleiner Infografik“ – keine nackten Zahlen auf der ersten Ebene.
2. „Weich aussehen“, ruhig, nicht technisch.
3. Symbolketten wie „✓ ✓ ⏳ ✓“ **ersetzen durch Wörter** („Module ok · Akku ok · Nacht läuft“).
4. Tabellen nie allein – erst Kacheln, Tabellen als zweiter Abschnitt darunter.
5. Treffsicherheit: **Balken 0–100 % + Sparkline des Verlaufs** („ob sich das Modell entwickelt“).
6. Sonne als **gefülltes** Symbol (Umriss wirkte wie ein Zahnrad).
7. Netz: Einspeisung oben/positiv, Bezug unten/negativ (Pendel-Grafik).
8. iPhone gleichwertig: Spalten reduzieren statt quetschen, Datum unter dem Wochentag.

## Für den Agenten

- Zuerst diese Dateien lesen, dann die Bausteine in `src/` dagegen halten: Proportionen, Farben, Grafik-Arten, Texte.
- Galerie mit Demo-Daten bauen, **Screenshot Mac + iPhone** und mit dieser Referenz vergleichen; Abweichungen begründen oder beheben.
- Keine Screenshots echter Häuser ins Repo (deshalb liegen hier keine Bilder).
