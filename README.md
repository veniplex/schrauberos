# SchrauberOS

Dashboard für die Autowerkstatt – ein modularer Monolith, in dem **Module** (Bereiche) aus einzeln schaltbaren **Funktionen** bestehen.
Administratoren können Module und Funktionen im laufenden Betrieb ein- und ausschalten (Daten bleiben erhalten).

| Modul | Funktionen |
| --- | --- |
| **Werkstatt** | Termine · Reifenlager · Kunden · Fahrzeuge (unabhängig vom Kunden, mit Halter-Historie) · Dokumentation |
| **Büro** | Rechnungsarchiv · Mitarbeiter (inkl. Abwesenheiten) · Fuhrpark · Dokumentation |
| **IT & Netzwerk** | Netzwerk (Geräte, IP-Verwaltung, Verkabelung, Standorte; Status nur als Demo) · Dokumentation |
| **Verwaltung** | Benutzer · Rollen & Rechte · Einstellungen · Module & Funktionen · Audit-Log · Handbuch |

Dazu: Deutsch (Standard) und Englisch · Hell, Dunkel und System · Werkstattname, Logo und Akzentfarbe individuell einstellbar.

## Dokumentation

Die ausführliche Dokumentation ist **Teil der App**: **Verwaltung → Handbuch** (Recht `handbook.view`). Die Quellen liegen als Markdown in [`docs/`](docs):

* [Architektur](docs/01-architektur.md) – Begriffe (Plattform, Modul, Funktion, Querschnittsfunktion), Aktivierung, Regeln
* [Entwicklung](docs/02-entwicklung.md) – Befehle, Datenbank, Rezept für neue Funktionen, Konventionen
* [Betrieb](docs/03-betrieb.md) – Docker, Portainer, HTTPS, Backups, Updates
* [Funktionen](docs/04-funktionen.md) – Rechte, Werkstatt, Büro, IT, Dokumentation, Audit-Log, Werbas

## Schnellstart (lokale Entwicklung, SQLite)

Voraussetzung: Node.js 22 oder neuer (getestet mit 24).

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run setup            # Prisma-Client, Datenbank, Seed (inkl. Demo-Daten)
npm run dev
```

→ <http://localhost:3000> · Login `admin` / `admin` (beim ersten Login muss ein eigenes Passwort vergeben werden).

```bash
npm run typecheck && npm run lint && npm test   # Prüfungen
npm run db:fresh                                # lokale Datenbank neu aufbauen (löscht alle Daten!)
```

## Produktion mit Docker (PostgreSQL)

Ein GitHub-Workflow baut bei jedem Push auf `main` das Image (`ghcr.io/veniplex/schrauberos`). Auf dem Server genügen `docker-compose.yml` und `.env`:

```bash
cp docker.env.example .env      # Passwörter & Co. anpassen
docker compose pull && docker compose up -d
```

Einzelheiten (ghcr.io-Anmeldung, Portainer, HTTPS, Backups, Updates, Reverse Proxy) stehen im Handbuch, Kapitel *Betrieb*.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite/PostgreSQL) · eigene Sitzungs-Authentifizierung ·
eigene schlanke i18n · Zod · react-markdown. Design-Tokens liegen in `src/app/tokens.css`; Hell/Dunkel nutzen `light-dark()`.
