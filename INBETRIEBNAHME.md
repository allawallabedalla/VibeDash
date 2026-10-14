# VibeDash – Inbetriebnahme: Geräte finden und anbinden

> Ergänzung zu ANLEITUNG.md (gehört inhaltlich zu M5 „Agenten-Bauanleitung“ und in `AGENT.md`).
> Frage, die das beantwortet: *„Ich installiere VibeDash auf einem neuen PC – wie werden mein Wechselrichter, meine Wallbox usw. gefunden?“*

## 1. Ehrliche Ausgangslage

- Nach der Installation zeigt VibeDash **Demo-Daten**. Echte Werte brauchen eine **Datenquelle** und eine **Zuordnung** (`local/mapping.json`).
- Geräte vollautomatisch zu finden geht **nicht zuverlässig**: Jede Geräteart spricht anders, Register und Bedeutungen sind herstellerspezifisch, und manche Geräte muss der Mensch erst umstellen.

| Gerät | Zugang | automatisch findbar? |
|---|---|---|
| Wechselrichter | meist Modbus TCP (Port 502), oft **herstellereigene Register**, selten SunSpec | Port ja – Bedeutung der Register nur mit Herstellerwissen |
| Wallbox | oft **OCPP: die Wallbox ruft den Server an** – Server-Adresse muss in der Wallbox/App eingetragen werden; manche auch Modbus/HTTP | nein – Handgriff am Gerät nötig |
| Stromzähler / Smart Meter | Modbus, IR-Lesekopf, Hersteller-API | teils |
| KNX | IP-Gateway (Port 3671); Bedeutung der Gruppenadressen steht im ETS-Projekt | Gateway ja – Bedeutung nein (ETS-Export oder Nachfragen) |
| Matter / HomeKit / Zigbee / Thread | über Bridge oder Home Assistant | teils (mDNS) |
| Cloud-Geräte | Hersteller-API mit Login | nein |

## 2. Drei Wege zu echten Daten (in dieser Reihenfolge anbieten)

1. **Home Assistant vorhanden?** → HA-Adapter nutzen. HA hat Erkennung und Integrationen für tausende Geräte bereits gelöst. *Für die meisten Menschen der schnellste Weg.*
2. **evcc vorhanden (Energie/Wallbox)?** → evcc-API als Quelle; evcc bringt Vorlagen für sehr viele Wechselrichter, Wallboxen und Zähler mit.
3. **Nichts davon?** → **Agenten-Inbetriebnahme** (Abschnitt 3): der Agent findet, prüft und bindet an – mit dem Menschen zusammen.

Fahrplan-Folge: **Home-Assistant-Adapter direkt nach dem Influx-Adapter** (vor M5/M6 ziehen), evcc-Adapter danach.

## 3. Agenten-Inbetriebnahme (das Besondere an VibeDash)

Ablauf, den der Agent Schritt für Schritt mit dem Menschen geht:

1. **Erlaubnis einholen** – „Darf ich dein Heimnetz nach Geräten durchsuchen? Ich lese nur, ich schalte nichts.“ Ohne ausdrückliches Ja: kein Scan.
2. **Bestandsaufnahme (nur lesend)**
   - mDNS/SSDP-Ankündigungen, DHCP-Liste des Routers (falls der Mensch sie zeigt), Herstellerkennung über MAC-Präfix
   - bekannte Ports prüfen: 502 (Modbus), 3671 (KNX), 8123 (Home Assistant), 7070 (evcc), 1883 (MQTT), 80/443 (Web-Oberflächen)
   - **Nur verbinden und lesen** – keine Schreibbefehle, keine Logins mit geratenen Passwörtern.
3. **Nachfragen statt raten** – „Auf .114 antwortet ein Gerät von Hersteller X auf Port 502. Ist das dein Wechselrichter?“
4. **Gegenprobe mit etwas, das der Mensch kennt** – „Ich lese 3,2 kW Erzeugung. Zeigt deine Hersteller-App gerade ungefähr das?“ Vorzeichen und Richtung prüfen (Einspeisung vs. Bezug, Akku laden vs. entladen) – das ist die häufigste Fehlerquelle.
5. **Handgriffe klar ansagen** – was nur der Mensch kann, als kurze Anleitung: „Trag in der Wallbox-App als OCPP-Server `ws://<VibeDash-Rechner>:<Port>/` ein.“
6. **Anbinden** – Adapter-Konfiguration + Eintrag in `local/mapping.json` schreiben (nie ins Repo), Zugangsdaten nur in `.env`.
7. **Datenwahrheit prüfen** (ANLEITUNG.md Abschnitt 6) – Zähler statt Integral, Status statt Befehl, Lücken, Zeitzone; mindestens 24 h beobachten, Auffälligkeiten als **Frage** an den Menschen.
8. **Protokoll** – kurze Zusammenfassung „Gefunden · angebunden · offen · vom Menschen zu tun“.

## 4. Harte Sicherheitsregeln

- **Nur mit Zustimmung scannen**, nur das eigene Heimnetz, langsam (keine Port-Flut).
- **Niemals schreiben oder steuern** in der Inbetriebnahme – kein Modbus-Write, kein Schalten, keine Ladebefehle. Steuern ist nicht Teil von VibeDash v0.x.
- **Keine Passwörter raten**, keine Standard-Logins durchprobieren.
- **Jede Zuordnung bestätigt der Mensch**, bevor sie gespeichert wird.
- Gefundene Gerätedaten (IPs, Seriennummern, Namen) bleiben **lokal** – nie in Repo, Issues, Logs oder Screenshots.

## 5. Ergänzung Fahrplan

| Meilenstein | Inhalt | Fertig, wenn … |
|---|---|---|
| M3b Home Assistant | Adapter (REST/WebSocket), Entitäten → Datenmodell | Übersicht läuft mit einer HA-Testinstanz |
| M5 Agenten-Bauanleitung | **inkl. Inbetriebnahme-Ablauf** (Abschnitt 3+4) in `AGENT.md` | ein frischer Agent führt einen Menschen von „neuer PC“ bis „erste echte Kachel“, nur mit der Anleitung |
| M6 evcc | Adapter | Energie-Seite läuft mit evcc-Demo |
| M10 Geräte-Vorlagen | erste Vorlagen für häufige Wechselrichter/Wallboxen (nur lesend), Gemeinschaft kann ergänzen | Vorlage + Gegenprobe-Test je Gerät |
