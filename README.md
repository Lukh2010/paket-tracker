# Unterwegs · AliExpress & Cainiao Paket-Tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Platform: Linux KDE](https://img.shields.io/badge/Platform-Linux%20%7C%20KDE%20%7C%20Wayland-blue.svg)]()
[![Model Context Protocol](https://img.shields.io/badge/AI-Model%20Context%20Protocol%20(MCP)-purple.svg)]()

Moderner Sendungsverfolger für AliExpress- und Cainiao-Pakete mit nativer Desktop-App (KDE System-Tray), automatischem Hintergrund-Dienst und dedizierten KI-Schnittstellen (Model Context Protocol / REST API).

---

## 🌟 Highlights

- **Live-Tracking**: Fragt Cainiao direkt über offizielle Endpunkte mit deutscher Übersetzung aller Status-Stationen ab.
- **Dauerhafter Hintergrund-Dienst**: Läuft als unauffälliger Systemd-User-Service (`unterwegs.service`) auf Port 4317.
- **KDE Desktop-App & System-Tray**:
  - Sitzt im System-Tray mit Statusanzeige im Tooltip.
  - **Klick auf das Tray-Icon**: Fenster öffnen oder minimieren.
  - **Fenster schließen (*X*)**: Minimiert in den Tray – der Hintergrunddienst und die KI-Schnittstellen laufen nahtlos weiter.
  - **Single-Instance**: Klick im Anwendungsmenü bringt das bestehende Fenster sofort in den Vordergrund.
- **Zwei vollwertige KI-Schnittstellen**:
  - **MCP (Model Context Protocol)**: Standalone-Server (`unterwegs-mcp`) für Claude Desktop, Cursor, Antigravity, ChatGPT.
  - **REST API**: Strukturierte JSON- und Markdown-Endpunkte auf `localhost:4317`.
- **CLI-Steuerung**: Terminal-Tool `unterwegs` für schnelle Abfragen und Paketverwaltung.

---

## 🚀 Schnellstart & Nutzung

### Desktop-App
- **Per Anwendungsmenü**: Suche nach **„Unterwegs (AliExpress Tracker)“** im KDE-Starter oder KRunner.
- **Per Terminal**:
  ```bash
  # Öffnet oder fokussiert die Desktop-App
  unterwegs

  # Startet die Desktop-App minimiert im System-Tray
  unterwegs --background
  ```

### CLI-Befehle
```bash
# Aktuellen Sendungsstatus formatiert im Terminal anzeigen
unterwegs status

# Alle Sendungen live von Cainiao aktualisieren
unterwegs refresh

# Beliebige Sendungsnummer ad-hoc abfragen (ohne Speichern)
unterwegs track 00340435069718576091

# Neues Paket zur Überwachung hinzufügen
unterwegs add AP00844166750486 "Gashebel" "AliExpress Ersatzteil"

# MCP-Server starten
unterwegs mcp
```

### Systemd Hintergrund-Dienst
Der Hintergrund-Dienst stellt sicher, dass der Tracker und die KI-Schnittstellen 24/7 erreichbar sind:
```bash
# Dienst aktivieren und sofort starten
systemctl --user enable --now unterwegs.service

# Status prüfen
systemctl --user status unterwegs.service
```

---

## 📁 Projektstruktur

```
paket-tracker/
├── app/
│   ├── api/
│   │   ├── ai/
│   │   │   ├── summary/route.ts      # KI-Zusammenfassungs-Endpunkt
│   │   │   ├── parcels/route.ts      # KI CRUD-Endpunkt
│   │   │   ├── tools/route.ts        # LLM Tool-Definitionen
│   │   │   └── openapi.json/route.ts # OpenAPI 3.1 Spezifikation
│   │   ├── parcels/
│   │   │   ├── route.ts              # Paket-Liste & Sync
│   │   │   └── refresh/route.ts      # Cainiao Live-Refresh
│   │   └── track/route.ts            # Einzelabfrage Cainiao
│   ├── page.tsx                      # Web-UI mit Reaktivität & KI-Aktionen
│   └── globals.css                   # Modernes Styling (Tailwind 4)
├── desktop/
│   ├── main.cjs                      # Electron Hintergrund-Prozess & System-Tray
│   ├── preload.cjs                   # IPC-Schnittstelle
│   └── assets/                       # App-Icons (SVG, PNG, Tray)
├── lib/
│   ├── store.ts                      # Zentraler Singleton Paket-Speicher
│   └── tracking.ts                   # Cainiao API-Client & Status-Übersetzer
├── LICENSE                           # MIT Lizenz
└── README.md                         # Diese Dokumentation
```

Installierte System-Komponenten:
- `~/.local/bin/unterwegs`: CLI-Launcher & Terminal-Steuerung
- `~/.local/bin/unterwegs-mcp`: Python 3.13 MCP-Server für KI-Assistenten
- `~/.local/share/applications/unterwegs.desktop`: KDE-Desktop-Starter mit Icon
- `~/.config/systemd/user/unterwegs.service`: Systemd Autostart-Service

---

## 🤖 AI / Agent Integration Guide (Für KIs & LLMs)

> [!IMPORTANT]
> Dieser Bereich richtet sich an autonome KI-Modelle, Agenten und Sprachmodelle (z. B. ChatGPT, Claude, Antigravity, Cursor, LangChain).
> Wenn ein Nutzer dich nach seinen AliExpress-Paketen fragt, kannst du die Daten direkt über folgende Methoden in Echtzeit abgreifen:

### Methode 1: Lokale REST API (Port 4317)

Der Server lauscht lokal auf `http://localhost:4317` (bzw. `http://127.0.0.1:4317` oder `http://[::1]:4317`).

#### Endpunkt-Übersicht

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/ai/summary` | **Beste Wahl für Chat**: Liefert eine fertige Markdown-Zusammenfassung zur direkten Antwort an den Nutzer. |
| `GET` | `/api/ai/parcels` | Liefert alle überwachten Pakete als strukturierte JSON-Liste. |
| `POST` | `/api/ai/parcels` | Fügt ein neues Paket hinzu (`{ "number": "...", "name": "...", "note": "..." }`). |
| `DELETE` | `/api/ai/parcels?number=...` | Entfernt ein Paket aus dem Tracking. |
| `POST` | `/api/parcels/refresh` | Erzwingt eine Live-Aktualisierung aller Pakete bei Cainiao. |
| `GET` | `/api/track?number=...` | Fragt eine Sendungsnummer live bei Cainiao ab (ohne sie zu speichern). |
| `GET` | `/api/ai/tools` | Gibt die offiziellen OpenAI / Anthropic Function-Calling Tool-Deklarationen zurück. |
| `GET` | `/api/ai/openapi.json` | Gibt die vollständige OpenAPI 3.1 Spezifikation zurück. |

#### 1. Schnellabfrage: Fertige Markdown-Zusammenfassung
```bash
curl -s http://localhost:4317/api/ai/summary
```
**JSON-Rückgabebeispiel:**
```json
{
  "success": true,
  "markdownSummary": "📦 **AliExpress / Cainiao Paketübersicht**\nGesamt: 4 Pakete (4 unterwegs, 0 angekommen)\n\n### 🚀 Unterwegs:\n- **G3 Max · Hinterradmotor** (`00340435069718576091` / Int: `CNG00845096928460`)\n  - Status: **Abgangsland verlassen** (23. Sept., 22:05)\n  - Notiz: 850 W · AliExpress\n\n_Stand: 24. Sept., 09:20 · Quelle: Cainiao_",
  "totalCount": 4,
  "activeCount": 4,
  "deliveredCount": 0,
  "items": [
    {
      "number": "00340435069718576091",
      "name": "G3 Max · Hinterradmotor",
      "note": "850 W · AliExpress",
      "isDelivered": false,
      "status": "Abgangsland verlassen",
      "carrier": "Cainiao",
      "latestEventTime": "23. Sept., 22:05",
      "latestEventDescription": "Departed from departure country/region"
    }
  ]
}
```

#### 2. Paket per KI hinzufügen
```bash
curl -X POST http://localhost:4317/api/ai/parcels \
  -H "Content-Type: application/json" \
  -d '{
    "number": "00340435069718576091",
    "name": "3D-Drucker Düsen",
    "note": "AliExpress Bestellung vom 24. Sept."
  }'
```

#### 3. Python-Beispiel für Agenten
```python
import json
import urllib.request

def get_aliexpress_summary() -> str:
    """Holt die aktuelle Paketübersicht vom lokalen Tracker."""
    req = urllib.request.Request("http://localhost:4317/api/ai/summary")
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode())
        return data.get("markdownSummary", "Keine Daten verfügbar.")

# Im Agenten-Kontext aufrufen:
print(get_aliexpress_summary())
```

---

### Methode 2: Model Context Protocol (MCP)

Für agentische Systeme (wie Claude Desktop, Cursor, Antigravity, ChatGPT Desktop):

#### Konfiguration in `claude_desktop_config.json` oder `mcp_config.json`:
```json
{
  "mcpServers": {
    "unterwegs-tracker": {
      "command": "/home/lukheinbach/.local/bin/unterwegs-mcp"
    }
  }
}
```

#### Bereitgestellte MCP-Tools:
1. `get_package_summary()`: Liefert eine direkt lesbare Markdown-Übersicht für die Chat-Antwort.
2. `list_packages()`: Gibt die strukturierte Liste aller aktiven und zugestellten Pakete zurück.
3. `get_package_details(tracking_number)`: Gibt die vollständige Stationen-Timeline eines Pakets zurück.
4. `add_package(tracking_number, name, note)`: Fügt eine neue Sendung hinzu und ruft Cainiao-Daten ab.
5. `remove_package(tracking_number)`: Entfernt ein Paket aus der Liste.
6. `refresh_packages(tracking_number?)`: Erzwingt eine Live-Statusaktualisierung von Cainiao.
7. `track_single_number(tracking_number)`: Beliebige Sendung ohne Speicherung abfragen.

---

### Status-Codes von Cainiao & Übersetzung

| Cainiao Code | Deutsche Bedeutung | Typischer Schritt |
|---|---|---|
| `CW_INBOUND` | Im Versandlager angekommen | Start im Lager |
| `SC_INBOUND_SUCCESS` | Im Sortierzentrum bearbeitet | Transit in China |
| `SC_OUTBOUND_SUCCESS` | Sortierzentrum verlassen | Auf dem Weg zum Flughafen |
| `CC_EX_SUCCESS` | Ausfuhrzoll abgeschlossen | Zoll China |
| `LH_HO_AIRLINE` | Für den Weiterflug bereit | Airline-Übergabe |
| `LH_DEPART` | Abgangsland verlassen | Flug nach Europa / Deutschland |
| `LH_ARRIVE` | Im Zielland angekommen | Ankunft Zielflughafen |
| `CC_IM_SUCCESS` | Einfuhrzoll abgeschlossen | Zoll Deutschland |
| `GTMS_DELIVERING` | In Zustellung | Zustellfahrzeug |
| `GTMS_SIGNED` | Zugestellt | Erfolgreich abgeschlossen |

---

## 📄 Lizenz

Dieses Projekt steht unter der [MIT Lizenz](LICENSE) © 2026 Lukas Heinbach.
