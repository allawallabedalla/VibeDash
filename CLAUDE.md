# CLAUDE.md – Arbeitsregeln für dieses Repo

Projekt: ruhige Haus-Dashboards aus Design-Bausteinen, von einem Agenten je Haus zusammengesetzt.
Vollständiger Hintergrund, Architektur und Fahrplan: **ANLEITUNG.md** (zuerst lesen).

## Immer

- **Keine echten Hausdaten** im Repo: keine Adressen, IPs, Gruppenadressen, Grundrisse, Namen, Screenshots echter Häuser. Entwicklung und Tests nur mit synthetischen Demo-Daten. Zugangsdaten nur in `.env` (in `.gitignore`).
- **Design-Regeln aus ANLEITUNG.md Abschnitt 5 sind verbindlich.** Kurz:
  - erste Ebene = Kacheln mit Mini-Grafik, Tabellen nur als zweiter Abschnitt darunter
  - Outline-Icon + 1–2 Wörter, **keine Emojis**, keine Symbolketten
  - Details hinter ⓘ, öffnet per **Tippen** (kein Hover-only)
  - weich, ruhig, hell + dunkel; Mac und iPhone gleichwertig, eigenes Handy-Layout
  - jede Näherung mit Spanne/± und n; Prognose eigene Linie; Einspeisung oben/positiv
  - Modelle zeigen Treffsicherheit (0–100 % korrekt + Verlauf), nicht Lernfortschritt; „offen“ statt Schein-100 %
  - Hinweise nur bei Handlungsbedarf
- **Vorhersagen (Abschnitt 11):** einfachstes ausreichendes Verfahren gewinnt (Faustregel zuerst, komplexer nur bei gepaart ≥ 2 SE besser); Rückrechnung nur mit Vergangenheit und gleichem Vorlauf; angezeigt wird Treffsicherheit, kein Lernfortschritt; „sammelt Daten“ / „offen · n“ statt Schein-Prozent.
- **Datenwahrheit vor Darstellung** (Abschnitt 6): Zustand aus Aktor-Rückmeldung statt Befehl, Zählerstand statt Integral, Lücken sichtbar, gleiche Sekunde in Eingangsreihenfolge, Bewertung ohne Blick in die Zukunft und nie zirkulär, Fehler als Betrag mitteln. Auffälligkeiten als **Frage** an den Menschen, nicht als Bug.

## Arbeitsweise

- Vor größeren Entscheidungen (Abhängigkeiten, Struktur, Lizenz) kurz vorschlagen und auf Okay warten.
- Nach jeder sichtbaren Änderung: Playwright-Screenshots **Mac 1440×900 und iPhone 390×844, hell und dunkel**, selbst ansehen, gegen die Prüfliste (ANLEITUNG.md Abschnitt 9) prüfen, nachbessern.
- Leistungsbudget: erste Seite < 200 KB JS; keine CDNs, alles lokal gebündelt.
- Kleine Commits mit klaren Nachrichten. **Nicht pushen ohne Nachfrage.**
- Unsicherheiten und Grenzen im Chat offen nennen (n, Spanne, „nicht geprüft“).
- Antworten an den Menschen: kurz, gegliedert, ADHS-tauglich – Kernaussage zuerst.
