# Unterwegs

Lokaler Paket-Tracker für AliExpress und Cainiao mit deutscher Oberfläche und einer Electron-Desktop-App für Linux. Mehrere Artikel mit derselben Sendungsnummer erscheinen als gemeinsames Paket; die einzelnen Artikel und Bestelllinks bleiben erhalten.

## Funktionen

- Sendungsverlauf, Zeitpunkt der letzten erfolgreichen Abfrage und sichtbare Abruffehler.
- Gemeinsame Pakete mit mehreren Artikeln und einer gemeinsamen Zeitleiste.
- Links zu DHL oder DPD, wenn der Zusteller erkannt wird; frühere Trackingnummern bleiben erhalten.
- Desktop-Tray und Benachrichtigungen bei neuen Statusänderungen, optional mit Ruhezeit 22–08 Uhr.
- Aktualisierung alle 30 Minuten, solange die Desktop-App läuft und aktive Sendungen vorhanden sind.
- Lokale REST-Schnittstellen, CLI und optionaler MCP-Server.

## Installation & Nutzung (Linux)

### Option 1: AppImage (empfohlen)

Jeder GitHub-Commit und jedes Release erzeugt über GitHub Actions automatisch ein fertiges, portables Linux-AppImage mit integriertem Node-Server und Desktop-Client:

1. Lade `Unterwegs-*.AppImage` aus den [GitHub Releases](https://github.com/Lukh2010/paket-tracker/releases/latest) herunter.
2. Mache die Datei ausführbar:
   ```bash
   chmod +x Unterwegs-*.AppImage
   ```
3. Starte das AppImage per Doppelklick oder im Terminal:
   ```bash
   ./Unterwegs-*.AppImage
   ```

### Option 2: Installation aus dem Quellcode

Die Quellinstallation verwendet den lokalen Entwicklungsserver. Getestete Desktop-Umgebung: KDE unter Linux.

Voraussetzungen: Git, **Node.js 22.13 oder neuer**, npm sowie ein separat installiertes **Electron** mit dem Befehl `electron` im Suchpfad. Die CLI-Abfragen benötigen zusätzlich `curl` und `jq`. Die Linux-Paketnamen unterscheiden sich je nach Distribution.

```bash
git clone https://github.com/Lukh2010/paket-tracker.git
cd paket-tracker
npm ci
npm run desktop
```

Die Desktop-App startet den lokalen Server auf Port 4317 selbst, wenn dort noch keiner läuft. Das erste Fenster kann beim Start kurz warten. Anschließend mit **+** die eigene Trackingnummer hinzufügen. Ein neuer Benutzer startet mit einer leeren Liste.

Alternativ im Projektordner:

```bash
# Desktop und CLI
./bin/unterwegs
./bin/unterwegs --background
./bin/unterwegs status
./bin/unterwegs refresh
./bin/unterwegs track DEINE_SENDUNGSNUMMER
./bin/unterwegs add DEINE_SENDUNGSNUMMER "Mein Paket" "Optionale Notiz"
```

Mit `UNTERWEGS_ELECTRON=/pfad/zu/electron ./bin/unterwegs` lässt sich ein anderer Electron-Pfad wählen. `UNTERWEGS_NODE` setzt den Node-Pfad für den von Electron gestarteten Server.

Für einen Menüeintrag und den CLI-Befehl im Benutzerverzeichnis:

```bash
./scripts/install-desktop.sh
```

Das Skript erstellt Verknüpfungen zur aktuellen Projektkopie und einen Menüeintrag, ohne Administratorrechte. Den Projektordner danach nicht verschieben. Es aktiviert keinen Autostart. Zum Entfernen nur die durch das Skript angelegten Links `~/.local/bin/unterwegs`, `~/.local/bin/unterwegs-mcp` und den Menüeintrag `~/.local/share/applications/unterwegs.desktop` löschen; eigene Daten bleiben bestehen. Bei eigenen XDG-Verzeichnissen liegt der Menüeintrag entsprechend dort.

## Daten und Hintergrundbetrieb

Die Desktop-App sichert Paketdaten unter `${XDG_DATA_HOME:-~/.local/share}/unterwegs/`. `UNTERWEGS_DATA_DIR` kann ein anderes absolutes Datenverzeichnis festlegen; für alle beteiligten Prozesse denselben Wert verwenden. Das Verzeichnis enthält Paketdaten, Benachrichtigungseinstellungen und gegebenenfalls Cainiao-Cookies. Es gehört nicht ins Repository.

Die Sicherung erfolgt regelmäßig durch die laufende Desktop-App. Nach Änderungen mindestens einen Sicherungszyklus (ca. 30 Sekunden) abwarten. Beim Neustart liest der lokale Entwicklungsserver diese Sicherung, alternativ `data/parcels.json` im Projekt. Vor Updates das Datenverzeichnis sichern. Ein leer gespeicherter Paketbestand bleibt leer.

Das Schließen des Fensters lässt die App im Tray weiterlaufen. **Beenden** im Tray beendet die Desktop-App und einen von ihr gestarteten Server. Ein separat laufender Server bleibt bestehen. Für Autostart kann die Desktop-App über die Autostart-Einstellungen der Desktop-Umgebung hinzugefügt werden.

Nur zum Entwickeln der Weboberfläche:

```bash
npm run dev:local
```

Danach im Browser `http://localhost:4317` öffnen. **Reiner Browserbetrieb hat keine verlässliche dauerhafte Speicherung:** Der Worker hält Änderungen im Arbeitsspeicher; die Desktop-App übernimmt die Sicherung auf dem Host. Der aktuelle Speicher ist nicht für öffentliches Hosting oder mehrere Nutzer ausgelegt. Die lokale API besitzt keine Anmeldung und darf nicht über eine öffentliche Netzwerkschnittstelle oder einen Tunnel freigegeben werden.

## Optionale MCP-Anbindung

Python 3.10 oder neuer wird benötigt. Die optionale Abhängigkeit ist getrennt von der Desktop-App:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-mcp.txt
.venv/bin/python bin/unterwegs-mcp
```

Im MCP-Client als Befehl den absoluten Pfad zu `.venv/bin/python` und als Argument den absoluten Pfad zu `bin/unterwegs-mcp` eintragen. Der Tracker muss für Live-Abfragen laufen. Ohne Server kann MCP vorhandene lokale Sicherungen lesen; Änderungen im Offline-Fallback werden erst bei einem Serverneustart eingelesen. MCP ist für die normale Desktop-Nutzung nicht erforderlich.

## Lokale API

Basisadresse: `http://localhost:4317`.

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/ai/summary` | Strukturierte Übersicht und Markdown-Zusammenfassung |
| GET | `/api/ai/parcels` | Artikel und gruppierte Sendungen |
| POST | `/api/ai/parcels` | Artikel hinzufügen: `number`, `name`, optional `note` |
| DELETE | `/api/ai/parcels?number=…` | Artikel entfernen |
| POST | `/api/parcels/refresh` | Cainiao-Daten aktualisieren |
| GET | `/api/track?number=…` | Einzelne Nummer abfragen |
| GET | `/api/ai/tools` | Werkzeugdefinitionen |
| GET | `/api/ai/openapi.json` | OpenAPI-Beschreibung |

`items` enthält einzelne Artikel, `shipments` die gruppierten Pakete. `totalCount`, `activeCount` und `deliveredCount` zählen Pakete; `articleCount` zählt Artikel. Fehler verändern den Zeitpunkt der letzten erfolgreichen Abfrage nicht.

## Entwicklung und Prüfung

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run build:appimage
npm run test:appimage
```

GitHub Actions prüft diese Schritte automatisch. Lint prüft den Anwendungscode; die unveränderten generierten UI-Bausteine unter `components/ui` und deren `hooks/use-mobile.ts` sind ausgenommen, da deren Vorlage eigene Regelverstöße enthält. Der Typecheck erfasst auch diese Bausteine. Tests verwenden temporäre Daten und keine echten Trackingabfragen. Der Build enthält keine lokale Paketsicherung; `npm start` startet eine lokale Vorschau des Worker-Builds, keinen vollständig installierten Desktop-Dienst. Für den normalen Desktop-Betrieb die oben beschriebene Quellinstallation verwenden.

Tracking hängt von Cainiao ab. Verifizierung, Netzwerkprobleme oder Änderungen am Anbieter können Abrufe verhindern. Alte Daten bleiben dann sichtbar und werden als fehlgeschlagene Aktualisierung gekennzeichnet.

## Datenschutz und Beiträge

Keine echten Sendungsnummern, Bestelllinks, Cookies oder Zugangsdaten in Issues, Screenshots oder Testdaten aufnehmen. Beispiele sind Platzhalter. Lokale Daten, Python-Umgebungen und Builddateien werden von Git ausgeschlossen. Vor einer Veröffentlichung zusätzlich die Git-Historie prüfen: Entfernen aus aktuellen Dateien entfernt Daten nicht aus älteren Commits.

Lizenz: [MIT](LICENSE).
