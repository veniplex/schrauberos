# SchrauberOS

Dashboard für die Autowerkstatt – modular aufgebaut, damit mit der Zeit beliebig viele Features dazukommen können.
Die Anwendung ist in vier **Bereiche** gegliedert (Navigation, Dashboard und Rechte folgen derselben Einteilung):

| Bereich | Inhalt |
| --- | --- |
| **Werkstatt** | **Termine** (Woche/Tag/Liste, Doppelbelegungs-Schutz) · **Reifenlager** (Einzelreifen mit DOT/Alter, Profil, Zustand, Lagerort, „Wechsel fällig“) · **Kunden** · **Fahrzeuge** (unabhängig vom Kunden, Halterwechsel mit Historie) · **Dokumentation** für Mechaniker |
| **Büro** | **Rechnungsarchiv** (Eingang/Ausgang, Zahlungsstatus, Beleg-Upload) · **Mitarbeiter** (Stammdaten, Zuordnung zum Benutzerkonto, Qualifikationen, Notfallkontakt) · **Abwesenheiten** (Monatskalender) · **Fuhrpark** (Firmenwagen, Fälligkeiten, Kilometer & Kosten, Führerscheinkontrolle) · **Dokumentation** für Assistenz/Verwaltung/Geschäftsführung |
| **IT & Netzwerk** | Geräte-Inventar · IP-Verwaltung (VLANs, Subnetze, freie Adressen) · Verkabelung mit Port-Übersicht · Standorte · **Dokumentation** für IT-Admins · Erreichbarkeits-Status derzeit **nur als Demo** |
| **Verwaltung** | Benutzer · Rollen & Rechte · Einstellungen (Werkstatt-Profil, Arbeitsplätze, Terminarten, Reifen-Regeln) |

Dazu: Deutsch (Standard) und Englisch · Hell, Dunkel und System (Standard), pro Benutzer gespeichert · Werkstattname, Logo und Akzentfarbe individuell einstellbar.

## Schnellstart (lokale Entwicklung, SQLite)

Voraussetzung: Node.js 22 oder neuer (getestet mit 24).

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run setup            # Prisma-Client, Datenbank-Migrationen, Seed (inkl. Demo-Daten)
npm run dev
```

→ <http://localhost:3000> · Login `admin` / `admin` (beim ersten Login muss ein eigenes Passwort vergeben werden).

Demo-Daten (Kunden, Fahrzeuge, Reifen, Termine, Netzwerk, Mitarbeiter, Fuhrpark, Rechnungen, Doku-Seiten) entfallen mit `SEED_DEMO="false"` in `.env`.

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
* **Backups:** `docker compose exec db pg_dump -U schrauberos schrauberos > backup.sql` – enthält auch **Rechnungs-Belege und Doku-Bilder**, denn die liegen in der Datenbank. Die Datenbank wächst also mit dem Archiv; bei vielen Belegen Backup-Größe und Speicherplatz im Blick behalten.
* **Update:** `docker compose pull && docker compose up -d` – neue Migrationen werden beim Start der App automatisch angewendet.
* **Version festlegen:** `SCHRAUBEROS_VERSION=1.0.0` in der `.env` (Tags `vX.Y.Z` im Repo erzeugen versionierte Images), sonst `latest`.
* **Zeitzone:** Termine werden in der Zeitzone `TZ` (Standard `Europe/Berlin`) ein- und ausgegeben.
* **Reverse Proxy:** Sollte beim Speichern „Invalid Server Actions request“ erscheinen, leitet der Proxy den öffentlichen Host nicht per `x-forwarded-host` weiter. Dann die Domain in `next.config.ts` unter `experimental.serverActions.allowedOrigins` eintragen.

## Architektur

```
src/
  app/                  Next.js App Router (Seiten, dünn gehalten)
    (app)/              geschützter Bereich mit Navigation
    login/, forbidden/, api/
  modules/              ein Ordner pro Feature  ← hier wächst die Anwendung
    permissions.ts      zentrale Liste aller Berechtigungen, den Bereichen zugeordnet (+ Standardrollen)
    registry.ts         Liste aktiver Module → Navigation und Dashboard-Widgets
    appointments/ tires/ customers/ vehicles/ docs/            (Werkstatt, Doku auch Büro/IT)
    invoices/ employees/ fleet/                                (Büro)
    network/                                                   (IT)
    core/                                                      (Verwaltung)
  server/               serverseitige Infrastruktur
    db.ts, db-client.ts Prisma-Client (SQLite lokal / PostgreSQL produktiv, gewählt über DATABASE_URL)
    auth/               Sitzungen, Passwörter, Anmelde-Provider (Platz für Active Directory)
    integrations/werbas Austauschformat + Sync für Kunden/Fahrzeuge aus Werbas
  lib/domain/           reine Fachlogik ohne Framework (Reifen, Fuhrpark, Rechnungen, Mitarbeiter, Netzwerk …) – getestet
  lib/money.ts          Geldbeträge: immer ganze Cent, Parsing "1.234,56"
  i18n/                 Übersetzungen (messages/de.ts ist die Quelle, en.ts muss dieselbe Struktur haben;
                        Texte größerer Module liegen in messages/modules/<modul>.de.ts / .en.ts)
  components/           UI-Bausteine und App-Shell
prisma/                 schema.prisma (SQLite, Quelle der Wahrheit), seed.ts, migrations/
prisma/postgres/        daraus abgeleitetes Postgres-Schema + eigene Migrationen
```

### Ein neues Feature hinzufügen (Rezept)

1. **Berechtigungen** in `src/modules/permissions.ts` ergänzen: neue Gruppe in `PERMISSION_GROUPS` **und** einem Bereich in `PERMISSION_AREAS` zuordnen. Beschriftungen in `i18n/messages/de.ts` **und** `en.ts` (`permissions.*`, `permissionGroups.*`). Sie erscheinen automatisch in der Rollenverwaltung; Administratoren haben neue Rechte sofort.
2. **Modul** anlegen: `src/modules/<name>/manifest.ts` mit Navigationseintrag (`section`: `workshop`, `office`, `it` oder `admin`) und optional Dashboard-Widgets (`area`) und in `src/modules/registry.ts` eintragen.
3. **Seiten** unter `src/app/(app)/<name>/` anlegen. Jede Seite beginnt mit `await requirePermission("…")`, **jede Server Action ebenfalls** (die Navigation versteckt nur, sie schützt nicht).
4. **Datenmodell** in `prisma/schema.prisma` ändern (siehe unten) und Texte in beiden Sprachen pflegen – fehlende Schlüssel melden `npm run typecheck`.
5. **Bestehende Installationen:** Standardrollen werden nie überschrieben. Sollen bestehende Rollen ein neues Recht automatisch bekommen, einen Eintrag in `DEFAULT_GRANTS` in `prisma/seed.ts` ergänzen (wird je Eintrag genau einmal angewendet).

### Datenbank: SQLite lokal, PostgreSQL produktiv

Beide Datenbanken werden aus **einem** Schema bedient. Deshalb im Schema bewusst keine Enums/Json-Felder: Zustände sind Strings, die in `src/lib/domain/constants.ts` bzw. den Domain-Dateien definiert sind.

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

## Berechtigungen, Rollen & Benutzer

* Berechtigungen sind Strings der Form `modul.aktion` (z. B. `tires.edit`). Rollen bündeln sie; Benutzer können mehrere Rollen haben, die Rechte addieren sich. In der Rollenverwaltung sind sie nach Bereich gegliedert.
* Rollen mit `isAdmin` haben immer alle Rechte (auch künftige).
* Mitgelieferte Rollen: Administrator, Geschäftsführung, Büro / Verwaltung, Serviceberater, Mechaniker, Lager, IT-Administrator. Jede Rolle sieht nur ihre Bereiche – z. B. sehen IT-Admins keine Kunden/Rechnungen, das Büro nicht den IT-Bereich, Mechaniker nur Werkstatt.
* Dokumentation hat je Bereich eigene Rechte (`docsWorkshop`, `docsOffice`, `docsIt`: lesen/bearbeiten).
* Schutzregeln: der letzte aktive Administrator kann weder gelöscht noch deaktiviert werden; Admin-Rollen dürfen nur von Admins vergeben werden; das eigene Konto kann nicht deaktiviert werden.
* Fünf Fehlversuche sperren ein Konto für 15 Minuten. Passwortänderung oder Deaktivierung beendet bestehende Sitzungen.
* `roles.manage` und `users.manage` sind faktisch administrative Rechte (damit lassen sich Rechte erweitern) – entsprechend sparsam vergeben.

### Active Directory (später)

Jeder Benutzer hat eine `authSource` (`local` oder z. B. `ldap`). Für AD genügt es, in `src/server/auth/providers.ts` einen `AuthProvider` zu implementieren und zu registrieren; Rollen und Rechte bleiben in der eigenen Datenbank (z. B. Zuordnung AD-Gruppe → Rolle beim ersten Login). Die Benutzerverwaltung zeigt externe Konten bereits an und blendet Passwortfelder dafür aus.

## Werkstatt

* **Fahrzeuge** sind eigenständig und brauchen keinen Kunden. Der Halter wechselt über „Halterwechsel“ (Datum, Notiz, Historie); Reifensätze und Termine bleiben am Fahrzeug. Wird ein Kunde gelöscht, bleiben seine Fahrzeuge ohne Halter erhalten.
* **Reifenlager:** Zustand je Reifen (Profiltiefe, Alter aus dem DOT-Code, Zustand); Grenzwerte stellt man unter Einstellungen → Werkstatt ein.
* **Werkstatt-Dokumentation** (Markdown) für Arbeitsanweisungen, Checklisten, Notfallpläne – wichtige Seiten lassen sich anheften und erscheinen auf der Übersicht.

## Büro

* **Rechnungsarchiv:** Eingang (Lieferanten) und Ausgang (Kunden) getrennt, Status offen/bezahlt/storniert, „überfällig“ wird aus der Fälligkeit berechnet, Summen je Richtung und Jahr, Dopplungsschutz (Nummer + Partner), Netto + MwSt. werden gegen Brutto geprüft. Der **Beleg (PDF/PNG/JPEG/WebP, max. 10 MB)** liegt in der Datenbank und wird nur mit dem Recht `invoices.view` ausgeliefert.
* **Mitarbeiter:** Stammdaten, Zuordnung zu einem Benutzerkonto (jedes Konto nur einmal, beide Seiten verlinkt), Qualifikationen mit Ablaufdatum, Urlaubstage-Übersicht (Mo–Fr, Feiertage werden nicht abgezogen). **Besonders schützenswert** (Recht `employees.sensitive`): Notfallkontakt und Krankheit – ohne das Recht erscheinen Krankheitstage nur als neutrale „abwesend“-Einträge.
* **Fuhrpark:** Firmenwagen mit Fahrer (Mitarbeiter), Fälligkeiten (HU, Service nach Datum/Kilometer, Versicherung, Leasing – Warnung 60 Tage vorher), Kilometerverlauf (Rückwärtssprünge werden abgelehnt), Kosten je Kategorie mit Kosten pro Kilometer, **Führerscheinkontrolle** (Halterpflicht, Intervall 6 Monate, „nie kontrolliert“ wird rot markiert).
* **Büro-Dokumentation** (Markdown) für Abläufe, Vorlagen, Ansprechpartner.

## IT & Netzwerk

Eigener Navigationsbereich (Modul `src/modules/network/`), sichtbar nur mit dem Recht `network.view`.

* **Geräte:** Inventar mit Art, Hersteller/Modell, Seriennummer, Standort/Rack, Garantie (Hinweise bei abgelaufen/bald ablaufend), Notizen. Zugangsdaten werden bewusst **nicht** gespeichert.
* **IP-Verwaltung:** VLANs, Subnetze (IPv4, /16–/30) mit Auslastung, Adressen (statisch, DHCP-Reservierung, reserviert, Gateway), freie Bereiche, „nächste freie Adresse“. Geprüft wird: gültige IPv4, liegt im Subnetz, keine Dopplung, gültige MAC.
* **Verkabelung:** Kabelliste (Gerät/Port ↔ Gerät/Port), Port-Übersicht bei Geräten mit Port-Anzahl (Switch/Patchfeld), ein Port kann nur einmal belegt werden. Standorte/Räume werden unter „Verkabelung & Standorte“ gepflegt.
* **Erreichbarkeit (Demo):** Die Status-Anzeige (online/langsam/offline, Dashboard-Widget und Übersicht) ist **simuliert** und überall als „Demo“ gekennzeichnet – es findet kein Netzwerkzugriff statt. Die Schnittstelle dafür ist `StatusProvider` in `src/modules/network/monitoring.ts`; für echte Checks (Ping/Port, Zeitplan, Verlauf) wird dort ein weiterer Anbieter implementiert und in `getStatusProvider()` ausgewählt. Dabei beachten: Der Docker-Container muss die Geräte im LAN erreichen können.
* **IT-Dokumentation** (Markdown) für Anleitungen, Konzepte, Betriebswissen.

## Dokumentation (Markdown)

Je Bereich (Werkstatt, Büro, IT) eine eigene Wissenssammlung unter `/docs/<bereich>` mit eigenen Rechten:

* Markdown mit GitHub-Erweiterungen: Überschriften, Listen, Aufgabenlisten, Tabellen, Code, Zitate, Links, Bilder. Rohes HTML wird **nicht** ausgegeben (kein XSS), gefährliche Link-Ziele werden entschärft.
* Editor mit Werkzeugleiste und Live-Vorschau; Bilder per Knopf hochladen oder aus der Zwischenablage einfügen (PNG/JPEG/WebP/GIF, max. 2 MB, in der Datenbank gespeichert, nur für Leser des jeweiligen Bereichs abrufbar).
* Kategorien, Volltextsuche über Titel und Inhalt, Inhaltsverzeichnis, Anheften (Übersicht), **Versionsverlauf** mit Wiederherstellen (letzte 30 Fassungen je Seite).
* Die Adresse (Slug) einer Seite bleibt stabil, auch wenn der Titel geändert wird.

## Demo-Daten

`SEED_DEMO=true` legt Beispieldaten für alle Bereiche an (Kunden, Fahrzeuge inkl. Halterwechsel und einem Fahrzeug ohne Halter, Reifen, Termine, Netzwerk, Mitarbeiter mit Abwesenheiten/Qualifikationen, drei Firmenwagen, Rechnungen, Doku-Seiten). In Produktion (`SEED_DEMO=false`) starten alle Bereiche leer.

## Werbas-Anbindung (später)

Kunden und Fahrzeuge tragen `externalSource`/`externalId`/`syncedAt`. `src/server/integrations/werbas/` enthält das neutrale Austauschformat (`types.ts`) und die Abgleichslogik (`sync.ts`, Upsert über `externalId`, lokale Datensätze bleiben unberührt, Reifen/Termine hängen an denselben Fahrzeug-IDs).
Offen ist nur `client.ts`: sobald klar ist, wie Werbas Daten bereitstellt (REST, Datenbank-Sicht, Export-Datei), wird dort ein `WerbasClient` implementiert und per Skript/Scheduler aufgerufen.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite/PostgreSQL) · eigene Sitzungs-Authentifizierung (bcrypt, serverseitig gespeicherte Sitzungen) · eigene schlanke i18n · Zod-Validierung · react-markdown + remark-gfm.

Design-Tokens (Farben, Radien, Schriften) liegen zentral in `src/app/tokens.css`; Hell/Dunkel nutzen `light-dark()`, die Akzentfarbe kommt aus dem Werkstatt-Profil.

## Bekannte Grenzen / nächste Ideen

* Listen (Kunden, Reifen, Rechnungen) laden bis zu 100–300 bzw. alle Datensätze und filtern teils im Speicher – für typische Betriebsgrößen in Ordnung, bei Bedarf Pagination ergänzen.
* Belege und Bilder liegen in der Datenbank (einfaches Backup, kein extra Speicher) – bei sehr großem Archiv wäre ein Objektspeicher/Volume die Alternative.
* Urlaubstage zählen Mo–Fr ohne Feiertage; es gibt keinen Genehmigungs-Workflow für Urlaubsanträge.
* Noch nicht enthalten: E-Mail/SMS-Erinnerungen (Fälligkeiten erscheinen nur im Dashboard), Audit-Log, Druck-Etiketten/QR-Codes für Lagerplätze, Ressourcen-Kalender pro Mitarbeiter, echte Netzwerk-Überwachung.
* Die Anmeldung ist rein lokal (siehe oben für AD); Zwei-Faktor ist nicht vorgesehen.
