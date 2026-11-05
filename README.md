# SchrauberOS

Dashboard für die Autowerkstatt – modular aufgebaut, damit mit der Zeit beliebig viele Features dazukommen können.

**Heute enthalten**

| Bereich | Inhalt |
| --- | --- |
| Terminplanung | Wochen-, Tages- (Spalten = Arbeitsplätze) und Listenansicht, Termine per Klick anlegen, Doppelbelegung von Arbeitsplätzen wird verhindert |
| Digitale Reifenliste | Eingelagerte Reifensätze je Fahrzeug, Einzelreifen mit DOT/Alter, Profiltiefe, Zustand und Lagerort; Hinweise „Bald erneuern/Erneuern“; „Wechsel fällig“ + Terminplanung direkt aus der Liste |
| Kunden & Fahrzeuge | Stammdaten, Kennzeichen, Verknüpfung zu Reifen und Terminen; vorbereitet für den Import aus Werbas |
| Benutzer, Rollen, Rechte | Eigene Benutzerverwaltung, frei definierbare Rollen mit granularen Berechtigungen, Admin-Schutzregeln |
| Personalisierung | Werkstattname, Logo, Akzentfarbe, Öffnungszeiten, Kalenderraster, Arbeitsplätze, Terminarten, Reifen-Regeln |
| Darstellung | Deutsch (Standard) und Englisch · Hell, Dunkel und System (Standard), pro Benutzer gespeichert |

## Schnellstart (lokale Entwicklung, SQLite)

Voraussetzung: Node.js 22 oder neuer (getestet mit 24).

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run setup            # Prisma-Client, Datenbank-Migrationen, Seed (inkl. Demo-Daten)
npm run dev
```

→ <http://localhost:3000> · Login `admin` / `admin` (beim ersten Login muss ein eigenes Passwort vergeben werden).

Demo-Daten (Kunden, Autos, Reifen, Termine) entfallen mit `SEED_DEMO="false"` in `.env`.

Nützliche Befehle:

```bash
npm run test         # Unit-Tests (Fachlogik)
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run db:studio    # Datenbank im Browser ansehen
npm run db:reset     # lokale Datenbank neu aufbauen (löscht alle Daten!)
```

## Produktion mit Docker (PostgreSQL)

Auf GitHub baut eine Action bei jedem Push auf `main` das Image und legt es in der GitHub Container Registry ab
(`ghcr.io/veniplex/schrauberos`). Auf dem Server braucht es nur zwei Dateien: `docker-compose.yml` und `.env`.

```bash
# einmalig (Repo privat): am Server bei ghcr.io anmelden – Token mit Recht "read:packages"
echo <TOKEN> | docker login ghcr.io -u <github-benutzer> --password-stdin

# Konfiguration
cp docker.env.example .env      # Passwörter & Co. anpassen

docker compose pull
docker compose up -d
```

Das startet zwei Dienste: `db` (PostgreSQL, Daten im Volume `db-data`, nicht nach außen veröffentlicht) und `app`
(Port `APP_PORT`, Standard 3000). Die App wendet beim Start selbst die Datenbank-Migrationen an und legt Rollen und den
Erst-Admin an (idempotent, siehe `docker-entrypoint.sh`).
Aus dem Quellcode bauen statt ziehen: `docker compose up -d --build`.

Wichtig im Betrieb:

* **`POSTGRES_PASSWORD` ändern** (ohne Wert startet Compose gar nicht).
* **HTTPS:** Ist die App über HTTPS erreichbar (Reverse Proxy/Tunnel), `SESSION_COOKIE_SECURE=true` setzen. Bei reinem HTTP im LAN muss es `false` bleiben, sonst ist kein Login möglich.
* **Backups:** `docker compose exec db pg_dump -U schrauberos schrauberos > backup.sql`
* **Update:** `docker compose pull && docker compose up -d` – neue Migrationen werden beim Start der App automatisch angewendet.
* **Version festlegen:** `SCHRAUBEROS_VERSION=1.0.0` in der `.env` (Tags `vX.Y.Z` im Repo erzeugen versionierte Images), sonst `latest`.
* **Zeitzone:** Termine werden in der Zeitzone `TZ` (Standard `Europe/Berlin`) ein- und ausgegeben.

## Architektur

```
src/
  app/                  Next.js App Router (Seiten, dünn gehalten)
    (app)/              geschützter Bereich mit Navigation (Übersicht, Termine, Reifen, Kunden, Admin, Einstellungen)
    login/, forbidden/, api/
  modules/              ein Ordner pro Feature  ← hier wächst die Anwendung
    permissions.ts      zentrale Liste aller Berechtigungen (+ Standardrollen)
    registry.ts         Liste aktiver Module → Navigation und Dashboard-Widgets
    appointments/ tires/ customers/ core/
  server/               serverseitige Infrastruktur
    db.ts, db-client.ts Prisma-Client (SQLite lokal / PostgreSQL produktiv, gewählt über DATABASE_URL)
    auth/               Sitzungen, Passwörter, Anmelde-Provider (Platz für Active Directory)
    integrations/werbas Austauschformat + Sync für Kunden/Fahrzeuge aus Werbas
  lib/domain/           reine Fachlogik ohne Framework (Reifen-Zustand, Kennzeichen, Öffnungszeiten) – getestet
  i18n/                 Übersetzungen (messages/de.ts ist die Quelle, en.ts muss dieselbe Struktur haben)
  components/           UI-Bausteine und App-Shell
prisma/                 schema.prisma (SQLite, Quelle der Wahrheit), seed.ts, migrations/
prisma/postgres/        daraus abgeleitetes Postgres-Schema + eigene Migrationen
```

### Ein neues Feature hinzufügen (Rezept)

1. **Berechtigungen** in `src/modules/permissions.ts` ergänzen (neue Gruppe oder Schlüssel) und die Beschriftungen in `i18n/messages/de.ts` **und** `en.ts` (`permissions.*`, `permissionGroups.*`). Sie erscheinen automatisch in der Rollenverwaltung; Administratoren haben neue Rechte sofort.
2. **Modul** anlegen: `src/modules/<name>/manifest.ts` mit Navigationseintrag und optional Dashboard-Widgets (async Server Components) und in `src/modules/registry.ts` eintragen.
3. **Seiten** unter `src/app/(app)/<name>/` anlegen. Jede Seite beginnt mit `await requirePermission("…")`, **jede Server Action ebenfalls** (die Navigation versteckt nur, sie schützt nicht).
4. **Datenmodell** in `prisma/schema.prisma` ändern (siehe unten) und Texte in beiden Sprachen pflegen – fehlende Schlüssel melden `npm run typecheck`.

### Datenbank: SQLite lokal, PostgreSQL produktiv

Beide Datenbanken werden aus **einem** Schema bedient. Deshalb im Schema bewusst keine Enums/Json-Felder: Zustände sind Strings, die in `src/lib/domain/constants.ts` definiert sind.

Nach einer Schema-Änderung:

```bash
npm run db:migrate                 # SQLite-Migration erzeugen + anwenden (prompt: Name)
npm run db:sync-pg                 # Postgres-Schema aus schema.prisma ableiten
# Postgres-Migration erzeugen – gegen eine kurzlebige Postgres-Instanz:
docker run -d --name so-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=schrauberos -p 55432:5432 postgres:17-alpine
DATABASE_URL="postgresql://postgres:dev@localhost:55432/schrauberos" npx prisma migrate dev --name <name>
docker rm -f so-pg
npm run db:generate                # Client wieder für SQLite erzeugen (passiert auch bei `npm run dev`)
```

Beide Migrations-Ordner (`prisma/migrations`, `prisma/postgres/migrations`) gehören ins Repository.
Case-insensitive Suche: `contains()` aus `src/server/search.ts` verwenden (kapselt den Unterschied SQLite/Postgres).

## Berechtigungen & Benutzer

* Berechtigungen sind Strings der Form `modul.aktion` (z. B. `tires.edit`). Rollen bündeln sie; Benutzer können mehrere Rollen haben, die Rechte addieren sich.
* Rollen mit `isAdmin` haben immer alle Rechte (auch künftige).
* Schutzregeln: der letzte aktive Administrator kann weder gelöscht noch deaktiviert werden; Admin-Rollen dürfen nur von Admins vergeben werden; das eigene Konto kann nicht deaktiviert werden.
* Fünf Fehlversuche sperren ein Konto für 15 Minuten. Passwortänderung oder Deaktivierung beendet bestehende Sitzungen.
* `roles.manage` und `users.manage` sind faktisch administrative Rechte (damit lassen sich Rechte erweitern) – entsprechend sparsam vergeben.

### Active Directory (später)

Jeder Benutzer hat eine `authSource` (`local` oder z. B. `ldap`). Für AD genügt es, in `src/server/auth/providers.ts` einen `AuthProvider` zu implementieren und zu registrieren; Rollen und Rechte bleiben in der eigenen Datenbank (z. B. Zuordnung AD-Gruppe → Rolle beim ersten Login). Die Benutzerverwaltung zeigt externe Konten bereits an und blendet Passwortfelder dafür aus.

## Werbas-Anbindung (später)

Kunden und Fahrzeuge tragen `externalSource`/`externalId`/`syncedAt`. `src/server/integrations/werbas/` enthält das neutrale Austauschformat (`types.ts`) und die Abgleichslogik (`sync.ts`, Upsert über `externalId`, lokale Datensätze bleiben unberührt, Reifen/Termine hängen an denselben Fahrzeug-IDs).
Offen ist nur `client.ts`: sobald klar ist, wie Werbas Daten bereitstellt (REST, Datenbank-Sicht, Export-Datei), wird dort ein `WerbasClient` implementiert und per Skript/Scheduler aufgerufen.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite/PostgreSQL) · eigene Sitzungs-Authentifizierung (bcrypt, serverseitig gespeicherte Sitzungen) · eigene schlanke i18n · Zod-Validierung.

Design-Tokens (Farben, Radien, Schriften) liegen zentral in `src/app/tokens.css`; Hell/Dunkel nutzen `light-dark()`, die Akzentfarbe kommt aus dem Werkstatt-Profil.

## Bekannte Grenzen / nächste Ideen

* Listen (Kunden, Reifen) laden bis zu 100 bzw. alle Datensätze und filtern teils im Speicher – für typische Werkstattgrößen (einige Tausend Sätze) in Ordnung, bei Bedarf Pagination ergänzen.
* Noch nicht enthalten: E-Mail/SMS-Erinnerungen, Audit-Log, Druck-Etiketten/QR-Codes für Lagerplätze, Ressourcen-Kalender pro Mitarbeiter.
* Die Anmeldung ist rein lokal (siehe oben für AD); Zwei-Faktor ist nicht vorgesehen.
