# VibeDash – Inbetriebnahme: Geräte finden und anbinden

> Ergänzung zu ANLEITUNG.md (gehört inhaltlich zu M5 „Agenten-Bauanleitung“ und in `AGENT.md`).
> Frage, die das beantwortet: *„Ich installiere VibeDash auf einem neuen PC – wie werden mein Wechselrichter, meine Wallbox usw. gefunden?“*

## 0. Für wen: maximale Laien (verbindlich)

Davor – Mini-PC auspacken, Ubuntu Server LTS installieren, Helfer wählen (Agent oder nur Chat): **[ERSTEINRICHTUNG.md](ERSTEINRICHTUNG.md)**.

VibeDash ist für Menschen **ohne Heimserver- und Software-Wissen**. Das Versprechen:
**Mini-PC kaufen, Claude Code auf dieses Repo zeigen – alles Weitere macht der Agent.**
Datenbanken, Dienste, Updates, Konfiguration und das ganze Backend richtet der Agent selbst ein; der Mensch muss davon
nichts verstehen und bekommt keine Anleitungen zu Software-Werkzeugen.

**Der Mensch gibt nur diese Art von Eingaben:**

1. **Klare Ja/Nein-Fragen** – eine Frage auf einmal, in Alltagssprache, mit dem, was danach passiert.
   Ein „Nein“ (oder keine Antwort) heißt immer: nichts passiert.
   Beispiel: „Darf ich in deinem Heimnetz nach Geräten suchen? Ich schaue nur, ich verändere nichts. (Ja/Nein)“
2. **In eine Hersteller-App schauen** und sagen, was dort steht.
   Beispiel: „Öffne die App deines Wechselrichters. Steht dort gerade ungefähr 3 kW? (Ja/Nein)“
3. **Ein Foto machen** – Typenschild, Gerätedisplay, Geräteliste im Router.
   Beispiel: „Fotografiere bitte das Typenschild an der Seite des Wechselrichters.“

**Nie verlangt:** Befehle im Terminal, Konfigurationsdateien, IP-Adressen oder Ports eintippen, Begriffe wie Modbus,
Datenbank, Container erklären müssen, Passwörter erfinden, Programme selbst installieren.

**Risikofrei – ohne Ausnahme:**

- Der Agent **liest nur**. Er schaltet, lädt und steuert nichts und schreibt nie in ein Gerät (Steuerung nur später
  nach LADESTEUERUNG.md und mit eigenem Ja).
- **Nie** etwas öffnen, abschrauben oder am Zählerschrank, Wechselrichter-Gehäuse oder an Leitungen arbeiten.
  Keine Firmware-Updates an Geräten, keine Werksresets, keine Passwörter raten.
- Muss in einer Hersteller-App doch eine Einstellung eingeschaltet werden (z. B. lokale Schnittstelle), dann nur:
  Klick für Klick beschrieben, mit dem, was sie bewirkt, nur wenn sie nichts steuert und rückgängig zu machen ist,
  und nach einem eigenen Ja. Braucht es einen Installateur-Zugang: **nicht selbst** – „Frag deinen Installateur“.
- Im Zweifel: **nicht tun** und als offene Frage stehen lassen.
- RISIKEN.md geht der Agent vor jeder Einrichtung mit dem Menschen durch – ebenfalls als Ja/Nein-Fragen.

**Wie der Agent spricht:** kurze Sätze, keine Fachwörter, ein Schritt auf einmal, Fortschritt sichtbar
(„Schritt 3 von 7: Wechselrichter gefunden“). Am Ende eine Zusammenfassung in drei Zeilen: läuft · offen · was du
noch tun kannst (nur Ja/Nein, App, Foto).

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

### 2a. Wo der Verlauf herkommt (Datenhaltung)

- **evcc speichert Ladevorgänge selbst** (eigene Datenbank) und liefert sie per `GET /api/sessions` (JSON, mit `?format=csv` als CSV, filterbar nach `year`/`month`): je Ladung Start/Ende, Ladepunkt, Fahrzeug, geladene kWh (`chargedEnergy`), Sonnenanteil (`solarPercentage`), Preis, CO₂, Ladestand Anfang/Ende. → **Ladehistorie direkt aus evcc**, ohne Influx oder HA. (Geprüft am evcc-Quellcode, Okt. 2026.)
- **`/api/state` von evcc liefert nur „jetzt“** (PV, Haus, Netz, Akku, Wallbox) – keinen Verlauf. Vorzeichen bei evcc: Netzbezug und Akku-Entladen positiv; VibeDash dreht das um (Einspeisung und Akku-Laden positiv).
- **Verlauf für Leistung und Zähler** kommt aus einem Speicher, den es schon gibt: InfluxDB oder Home Assistant.
- **Weder Influx noch HA vorhanden?** → Einrichtung einer **InfluxDB vorschlagen**: ein Container (InfluxDB 1.x, z. B. `influxdb:1.11` – Version vor Einrichtung prüfen), eigener Schreib-Benutzer für evcc, eigener **Lese-Benutzer** für VibeDash. evcc schreibt per Schalter hinein (Abschnitt `influx:` in der evcc-Konfiguration). Danach Influx-Adapter wie gewohnt.
- **Eigener Speicher in VibeDash nur als letzter Ausweg** (mehr Teile, Lücken wenn VibeDash aus ist, doppelte Wahrheit).

### 2b. Voraussetzung für PV-Prognose und Ladeplan (M11/M12)

PV-Prognose und Ladeplan brauchen den **Stundenverlauf über mehrere Wochen** (Erzeugung, Hausverbrauch, Akku, Wallbox). Dafür ist **InfluxDB oder Home Assistant Voraussetzung**:
- **InfluxDB:** reicht, sobald evcc oder der Wechselrichter einige Wochen hineingeschrieben hat.
- **Home Assistant:** der normale Verlauf hält standardmäßig nur **10 Tage** (`purge_keep_days`). VibeDash liest für ältere Zeiträume die **Langzeit-Statistik** von HA (stündlich, unbegrenzt) – das reicht für M11/M12, **aber nur für Sensoren mit `state_class`** (bei Energiezählern meist gesetzt). Fehlt sie, den Recorder auf mindestens 60 Tage stellen.
- Nur evcc ohne Influx/HA reicht dafür **nicht**: evcc liefert Ladungen, aber keinen Stundenverlauf von PV und Haus.

## 3. Agenten-Inbetriebnahme (das Besondere an VibeDash)

Ablauf, den der Agent Schritt für Schritt mit dem Menschen geht:

1. **Erlaubnis einholen** – „Darf ich dein Heimnetz nach Geräten durchsuchen? Ich lese nur, ich schalte nichts.“ Ohne ausdrückliches Ja: kein Scan.
2. **Bestandsaufnahme (nur lesend)**
   - mDNS/SSDP-Ankündigungen, DHCP-Liste des Routers (falls der Mensch sie zeigt), Herstellerkennung über MAC-Präfix
   - bekannte Ports prüfen: 502 (Modbus), 3671 (KNX), 8123 (Home Assistant), 7070 (evcc), 1883 (MQTT), 80/443 (Web-Oberflächen)
   - **Nur verbinden und lesen** – keine Schreibbefehle, keine Logins mit geratenen Passwörtern.
3. **Nachfragen statt raten** – „Auf .114 antwortet ein Gerät von Hersteller X auf Port 502. Ist das dein Wechselrichter?“
4. **Gegenprobe mit etwas, das der Mensch kennt** – „Ich lese 3,2 kW Erzeugung. Zeigt deine Hersteller-App gerade ungefähr das?“ Vorzeichen und Richtung prüfen (Einspeisung vs. Bezug, Akku laden vs. entladen) – das ist die häufigste Fehlerquelle.
5. **Handgriffe klar ansagen** – was nur der Mensch kann, nur in den drei Formen aus Abschnitt 0 (Ja/Nein, App ansehen, Foto). Muss in einer App etwas eingestellt werden, Klick für Klick beschreiben und vorher als Ja/Nein fragen (Abschnitt 0, „Risikofrei“).
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
