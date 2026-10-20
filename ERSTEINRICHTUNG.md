# VibeDash – Ersteinrichtung: vom Karton bis zum Dashboard

Für Menschen **ohne Computer-Wissen**. Diese Datei beginnt ganz am Anfang: Du hast einen Mini-PC gekauft (neu oder
gebraucht) und noch nichts eingerichtet. Ein Helfer – ein KI-Agent wie Claude Code oder ein Chat wie ChatGPT/Claude –
führt dich durch. Es gilt das **Laien-Prinzip** aus [INBETRIEBNAHME.md](INBETRIEBNAHME.md) Abschnitt 0: Du beantwortest
Ja/Nein-Fragen, schaust in eine App oder machst ein Foto. Alles ist **risikofrei** – im Zweifel passiert nichts.

> **Für den Helfer (Agent oder Chat):** Halte dich genau an diese Schritte. Frage immer nur eine Sache auf einmal,
> in Alltagssprache. Gib **nie** eigene Befehle aus dem Gedächtnis – nur die eine Zeile aus Schritt 2B, wörtlich aus
> diesem Repo. Bei Unsicherheit: Foto anfordern statt raten.

**Neu (20.10.2026): der VibeDash-Stick** – mit Claude Code am Laptop der einfachste Weg (Abschnitt „Stufe 0“).
Ohne Stick gilt weiter: **Entschieden (16.10.2026):** Betriebssystem **Ubuntu Server LTS** · gebrauchte Geräte werden **immer neu
aufgesetzt** · ohne Agent: **Installer + Einrichtungs-Assistent im Browser**.

Stand: Stufe 1, Weg A und Weg B (Installer-Zeile + Einrichtungs-Assistent im Browser) funktionieren – auf frischem
Ubuntu bei jeder Änderung automatisch getestet. Der Assistent bindet Solaranlage, Akku und Netzzähler an (nur lesend);
Wallbox und Steuerung kommen später über den Agenten (LADESTEUERUNG.md).

---

## Was du brauchst

- einen Mini-PC (Intel/AMD, mind. 8 GB Arbeitsspeicher, mind. 128 GB SSD)
- ein Netzwerkkabel zum Router (WLAN geht, Kabel ist zuverlässiger)
- einen USB-Stick mit mind. 8 GB – **er wird gelöscht**
- für die Einrichtung einmal: Bildschirm und Tastatur am Mini-PC (danach nicht mehr)
- einen anderen Computer (Laptop) für Schritt 1.2

## Stufe 0 · Der VibeDash-Stick (empfohlen, wenn du Claude Code hast)

Du brauchst nur: Claude Code am Laptop, den Mini-PC, ein Netzwerkkabel und einen leeren USB-Stick (mind. 2 GB).
Kein Bildschirm, keine Tastatur, kein BIOS-Menü, keine Router-Einstellung.

> **Für den Helfer (Agent):** Baue den Stick am Laptop mit `image/build.sh --key <öffentlicher SSH-Schlüssel>`
> (gibt es keinen, vorher `ssh-keygen -t ed25519` – nach Ja des Menschen). Es lädt Debian, prüft Prüfsumme und
> Signatur und schreibt `vibedash.iso` plus `vibedash-zugang.txt` (Einrichtungs-Code, Passwort – persönlich, nie
> weitergeben, nie committen). Schreiben auf den Stick: balenaEtcher, der Mensch klickt; vorher fragen „Ist das
> ausgewählte Laufwerk wirklich der USB-Stick (Name und Größe)? (Ja/Nein)“. Nach der Installation erreichst du das
> Gerät per `ssh vibedash@vibedash.local` (nur mit dem Schlüssel; `sudo` ohne Passwort). Was der Stick tut:
> `image/` (Debian 13, Antworten in `preseed.cfg`, danach `starter/install.sh` beim ersten Start).

1. Helfer fragt: **„Ist auf dem Mini-PC etwas, das du behalten willst – auch ein vorinstalliertes Windows?
   (Ja/Nein)“** Bei Ja: Stopp, erst sichern. Der Stick löscht die eingebaute Festplatte.
2. Stick, Netzwerkkabel (zum Router) und Strom in den Mini-PC stecken.
3. Einschalten und sofort mehrmals die **Startmenü-Taste** drücken (oft F7, F10, F11 oder F12 – der Helfer sagt dir,
   welche bei deinem Modell; im Zweifel ein Foto vom Startbild) und den USB-Stick wählen.
4. Warten. Nach 10 Sekunden installiert sich alles von selbst. **Wenn sich das Gerät von selbst ausschaltet**
   (nach etwa 10–30 Minuten): Stick abziehen, wieder einschalten. Hast du den Stick vergessen, passiert nichts – der
   Stick merkt, dass VibeDash schon drauf ist, löscht nichts und schaltet wieder aus.
5. Nach dem Einschalten richtet sich VibeDash selbst ein (etwa 5–15 Minuten, braucht Internet). Dann am Handy oder
   Laptop öffnen: **http://vibedash.local:8095/#/einrichten** und den **Einrichtungs-Code** vom Zugangszettel eingeben. Ab hier wie unten in Weg B, Schritt 2 (Assistent) – oder der Helfer macht es mit dir.

Klappt `vibedash.local` nicht: Der Helfer findet die Adresse in der Router-App (Gerät „vibedash“).

## Stufe 1 · Vom Karton zum laufenden Mini-PC

### 1.1 Gebrauchtes Gerät? (Ja/Nein)

Helfer fragt: **„Ist auf dem Mini-PC etwas gespeichert, das du behalten willst?“**

- **Nein** → weiter. Die Platte wird bei der Installation komplett gelöscht (das ist gewollt: kein fremder Rest).
- **Ja** → **Stopp.** Erst die Daten woanders sichern (lass dir dabei helfen). Ohne dieses Nein wird nichts gelöscht.

### 1.2 USB-Stick vorbereiten (am Laptop)

Der Helfer beschreibt Klick für Klick, du sagst, was du siehst:

1. Ubuntu Server LTS von der offiziellen Seite ubuntu.com herunterladen (nur von dort).
2. Das Programm **balenaEtcher** (etcher.balena.io) installieren und öffnen.
3. „Flash from file“ → die Ubuntu-Datei · „Select target“ → den USB-Stick · „Flash!“.
   Vorher fragt der Helfer: **„Ist das ausgewählte Laufwerk wirklich der USB-Stick (Name und Größe)? (Ja/Nein)“** –
   im Zweifel Foto vom Bildschirm.

### 1.3 Zwei Einstellungen im Mini-PC (BIOS)

Mini-PC einschalten und sofort mehrmals die Taste drücken, die beim Start kurz eingeblendet wird (oft Entf, F2 oder F10).
Klappt es nicht: **Foto vom Startbildschirm** – der Helfer sagt dir die Taste. Dann zwei Dinge, jeweils mit Foto zur
Kontrolle:

- **Nach Stromausfall automatisch einschalten** (heißt z. B. „After Power Loss: Power On“ oder „AC Recovery: On“).
- **Vom USB-Stick starten** (Startreihenfolge: USB zuerst).

Speichern und neu starten. Sonst nichts verändern.

### 1.4 Ubuntu Server installieren

Der Stick startet die Installation. Fast alles bleibt auf Vorgabe; der Helfer sagt bei jeder Frage, was zu wählen ist.
Wichtig:

- **Name des Geräts:** `hausserver`
- **Benutzer und Passwort:** ein Name (z. B. `haus`) und ein langes Passwort – **aufschreiben** (Passwort-App oder Papier).
- **„Install OpenSSH server“: Ja** (damit der Helfer später ohne Bildschirm hinkommt).
- Bei „Featured server snaps“: **nichts** auswählen.

Am Ende: Stick abziehen, neu starten. Danach braucht der Mini-PC keinen Bildschirm mehr.

### 1.5 Feste Adresse im Router (App)

In der Router-App (z. B. FRITZ!Box) den `hausserver` suchen und **„immer dieselbe IP-Adresse zuweisen“** einschalten.
Foto vom Bildschirm genügt; der Helfer liest die Adresse daraus ab.

## Stufe 2 · Welcher Helfer?

Helfer fragt: **„Nutzt du ein Werkzeug, das selbst Befehle auf dem Mini-PC ausführen kann – zum Beispiel Claude Code?
(Ja/Nein)“**

### Weg A · Mit Agent (Claude Code o. Ä.) – funktioniert heute

1. Am Mini-PC (Bildschirm oder per Fernzugang vom Laptop) die Installationszeile von Claude Code aus der offiziellen
   Anleitung (docs.claude.com) eingeben – das ist die einzige Zeile, die du tippst.
2. `claude` starten und sagen: **„Richte VibeDash ein“** mit dem Link zu diesem Repo.
3. Der Agent führt zuerst den Installer aus (`starter/install.sh`, wie Weg B) und trägt danach deine Geräte in
   `starter/evcc.yaml` ein – nur lesend, jede Zuordnung mit deinem Ja und einer Gegenprobe in der Hersteller-App.
4. Ab hier übernimmt der Agent alles: Repo holen, Datenbank, Dienste, Updates, Geräte finden, Dashboard. Du beantwortest
   nur Ja/Nein, schaust in Apps oder machst Fotos ([INBETRIEBNAHME.md](INBETRIEBNAHME.md), [AGENT.md](AGENT.md)).

### Weg B · Nur ein Chat (ChatGPT, Claude im Browser)

Ein Chat kann nichts auf dem Mini-PC ausführen. Damit du trotzdem nichts über Software wissen musst:

1. **Eine einzige Zeile** am Mini-PC einfügen (genau so, aus diesem Repo):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/allawallabedalla/VibeDash/main/starter/install.sh | sudo bash
   ```

   Sie fragt einmal nach deinem Passwort und richtet ein: Datenbank (nur intern, ohne Port nach außen), evcc als
   „Universal-Leser“ für Wechselrichter, Akku und Wallbox (ohne Geräte, nur lesend), VibeDash mit einem Benutzer ohne
   Schreibrechte, automatische Sicherheitsupdates. Zugangsdaten legt sie selbst an (nur für den Rechner lesbar).
   Nochmal ausführen ist sicher. Am Ende steht die Adresse für den Browser.

2. Danach im Browser die Adresse öffnen, die am Ende steht (`http://hausserver:8095/#/einrichten`), und den
   **Einrichtungs-Code** eingeben, der darunter steht. Der Assistent fragt:
   - vier Sicherheitsfragen (Ja/Nein),
   - „Darf ich im Heimnetz nach Geräten suchen?“ (Ja/Nein),
   - je Gerät: „Hast du eine Solaranlage / einen Batteriespeicher / einen Netzzähler?“ → Hersteller aus der Liste
     (steht auf dem Typenschild) → „Testen“ → **„Ich lese 3,2 kW. Zeigt deine Hersteller-App gerade ungefähr das?“**
   - Am Ende „Einrichtung abschließen“ – danach ist der Assistent geschlossen, niemand kann mehr etwas umstellen.
     Der Chat hilft dir nur beim Verstehen, er gibt keine Befehle.
3. **Schlägt dein Chat andere Befehle vor: nicht ausführen.** Nur die Zeile aus diesem Repo.

## Risikofrei – was nie passiert

- Nichts wird gelöscht ohne dein ausdrückliches Ja (Schritt 1.1, 1.2).
- Kein Gerät wird geöffnet, keine Leitung angefasst, kein Firmware-Update an Wechselrichter, Wallbox oder Heizung.
- Keine Portfreigaben im Router nach außen; das Dashboard ist nur zu Hause erreichbar.
- Steuern (z. B. Laden) erst viel später, mit eigener Frage und nach [LADESTEUERUNG.md](LADESTEUERUNG.md).
