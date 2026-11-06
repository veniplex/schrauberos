# SchrauberOS

Dashboard für die Autowerkstatt – ein modularer Monolith, in dem **Module** (Bereiche) aus einzeln schaltbaren **Funktionen**
bestehen. Betrieben wird er als **ein Container mit einem Volume**: einmal aufsetzen, danach laufen Backups, Wiederherstellung,
Updates und alle Einstellungen über die Weboberfläche.

| Modul | Funktionen |
| --- | --- |
| **Werkstatt** | Termine · Reifenlager · Kunden · Fahrzeuge (unabhängig vom Kunden, mit Halter-Historie) |
| **Büro** | Rechnungsarchiv · Mitarbeiter (inkl. Abwesenheiten) · Fuhrpark |
| **IT & Netzwerk** | Netzwerk (Geräte, IP-Verwaltung, Verkabelung, Standorte; Status nur als Demo) · IT-Dokumentation |
| **Handbuch** | Unternehmenshandbuch (Markdown-Kapitel und -Seiten, Kapitel auf Rollen beschränkbar) – losgelöst von den anderen Modulen |
| **Verwaltung** *(Plattform, nicht abschaltbar)* | Benutzer · Rollen & Rechte · Einstellungen · Module & Funktionen · Backups · Updates · Audit-Log |

Dazu die Plattform: Anmeldung, Rechte, **Hilfe** für alle Benutzer, Deutsch/Englisch, Hell/Dunkel, Werkstatt-Branding.

## Schnell starten (Docker)

Zwei Dateien in einen leeren Ordner auf dem Server legen – `docker-compose.yml` und (optional) `.env` – und starten.

**`docker-compose.yml`**

```yaml
services:
  app:
    image: ghcr.io/veniplex/schrauberos:${SCHRAUBEROS_VERSION:-latest}
    restart: unless-stopped
    stop_grace_period: 30s
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      - app-data:/data

volumes:
  app-data:
```

**`.env`** (daneben; ohne die Datei gelten die Standardwerte, sie wird nur beim Neu-Erstellen des Containers gelesen)

```env
# Port auf dem Server
APP_PORT=3000
# Image-Version: latest oder z. B. 0.1.0 (Updates im Betrieb laufen über die Weboberfläche)
SCHRAUBEROS_VERSION=latest
```

**Starten**

```bash
# einmalig, solange das Repository privat ist: bei ghcr.io anmelden (GitHub-Token mit Recht "read:packages")
echo <TOKEN> | docker login ghcr.io -u <github-benutzer> --password-stdin

docker compose up -d
```

Dann `http://<server>:3000` öffnen: Die **Ersteinrichtung** legt Werkstattname, Zeitzone und den ersten Administrator an
(optional mit Beispieldaten). **Bis dahin darf die Anwendung nicht von außen erreichbar sein** – wer sie zuerst aufruft, wird
Administrator. Alles Weitere (Backups, Updates, Einstellungen, Module) geschieht in der Weboberfläche unter **Verwaltung**; am
Container muss nichts mehr angefasst werden. Alle Daten liegen im Volume `app-data` (lokale Platte, kein SMB/NFS). Mehr:
[Betrieb](#betrieb). Aus dem Quellcode bauen statt ziehen: `docker compose up -d --build` (im Repository).

## Zwei Arten von Dokumentation

* **Anwendungsdokumentation** (für die Nutzer): in der App unter **Hilfe**, für alle angemeldeten Benutzer sichtbar. Sie
  beschreibt nur, was man in der Anwendung tut. Die Quellen sind Markdown-Dateien in [`docs/`](docs) (die erste
  `# Überschrift` ist der Kapitelname), **gegliedert nach Modulen**:
  * `docs/platform/NN-name.md`: allgemeine Kapitel („Allgemein“), immer sichtbar – neue Datei genügt.
  * `docs/<modul>/<funktion>.md`: Kapitel einer Funktion. Jede Funktion meldet ihre Kapitel selbst an (`help.ts`, siehe unten) –
    sie erscheinen unter dem Modul der Funktion und **verschwinden, wenn die Funktion ausgeschaltet ist** oder die Anmeldung das
    Recht nicht hat. Der Test `src/modules/help.test.ts` verhindert verwaiste Dateien und kaputte Verweise.
* **Entwicklerdokumentation:** diese README.

## Inhalt dieser README

0. [Schnell starten (Docker)](#schnell-starten-docker) · 1. [Schnellstart Entwicklung](#schnellstart-lokale-entwicklung) · 2. [Befehle](#befehle) · 3. [Architektur](#architektur) ·
4. [Datenhaltung](#datenhaltung) · 5. [Container, Starter und Updates](#container-starter-und-updates) ·
6. [Neue Funktion anlegen](#eine-neue-funktion-anlegen) · 7. [Konventionen](#konventionen) · 8. [Tests](#tests) ·
9. [Release und Signaturschlüssel](#release-und-signaturschlüssel) · 10. [Betrieb](#betrieb) · 11. [Grenzen](#bekannte-grenzen)

## Schnellstart (lokale Entwicklung)

Voraussetzung: Node.js 22 oder neuer (getestet mit 24).

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run setup            # Prisma-Client, Datenbank anlegen und seeden (Entwicklungs-Admin, Beispieldaten)
npm run dev
```

→ <http://localhost:3000> · Login `admin` / `admin` (nur in der Entwicklung: dort legt der Seed den Administrator an; in Produktion
richtet man ihn über die Ersteinrichtung im Browser ein). Beispieldaten entfallen mit `SEED_DEMO="false"` in der `.env`.
Die Datenbank ist `dev.db` im Projektordner; Backups, Dateien und Update-Daten liegen lokal unter `.data/`.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run typecheck` | TypeScript prüfen |
| `npm run lint` | ESLint |
| `npm test` | Unit-, Architektur- und Katalog-Tests |
| `npm run build` | Produktions-Build |
| `npm run db:migrate -- <name>` | neue Migration anlegen, lokal anwenden, Client neu erzeugen |
| `npm run db:fresh` | lokale Datenbank löschen, neu anlegen und seeden |
| `npm run db:studio` | Datenbank im Browser ansehen |

Vor jedem Abschluss: `npm run typecheck && npm run lint && npm test` – bei größeren Änderungen zusätzlich `npm run build`.

## Architektur

### Begriffe

| Begriff | Bedeutung | Beispiel |
| --- | --- | --- |
| **Plattform** | Immer an, kennt keine Fachlogik: Login, Rechte-Engine, Layout, Datenbank, i18n, UI-Kit, **Hilfe**, **Verwaltung** (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit-Log) | `src/server`, `src/components`, `src/i18n`, `src/lib`, `src/platform`, `src/modules/admin` |
| **Modul** | Fachlicher Bereich, als Ganzes ein-/ausschaltbar | Werkstatt, Büro, IT |
| **Funktion** | Abgegrenzter Teil eines Moduls mit eigenen Seiten, Rechten, Texten, Einstellungen; einzeln schaltbar | Termine, Reifenlager, Rechnungsarchiv |
| **Querschnittsfunktion** | Baustein, den mehrere Funktionen nutzen (`src/capabilities`) | Dokumentation (Markdown-Seiten mit Kapiteln und Rollen-Sichtbarkeit; genutzt von `handbook.manual` und `it.docs`) |
| **Adapter** | Anbindung an ein Fremdsystem (geplant: Werbas, Active Directory) | `src/server/integrations` |

Das Modul `admin` ist ein **Pflichtmodul** (`required: true`) und seine Funktionen sind ebenfalls Pflicht: Sie sind Plattform und
lassen sich nicht ausschalten (sonst sperrt man sich aus). Die Seite „Module & Funktionen“ zeigt nur die fachlichen Module.

### Aufbau des Codes

```text
src/
  modules/
    catalog.ts            Katalog aller Module und Funktionen (Quelle der Wahrheit)
    define.ts             Typen und defineModule()/defineFeature()
    features.ts           Aktivierung: Schalter lesen/schreiben (Datenbank)
    registry.ts           sammelt Dashboard-Bausteine und Einstellungs-Reiter der Funktionen ein
    default-roles.ts      mitgelieferte Rollen
    workshop/ office/ it/ admin/      je Modul: module.ts + ein Ordner je Funktion
      <funktion>/feature.ts, public.ts, actions.ts, queries.ts, domain.ts, forms.tsx, widgets.tsx, settings-tab.tsx …
  capabilities/docs/      Querschnittsfunktion Dokumentation
  platform/               Plattform-Bausteine (Konto, Hilfe)
  app/                    Next.js-Routen (dünn: laden Daten, setzen Bausteine zusammen)
  server/ components/ i18n/ lib/   Plattform
  launcher/               Launcher (siehe unten)
docker/                   Starter (bootstrap.c) und BASE_VERSION
docs/                     Anwendungsdokumentation (Hilfe in der App): platform/, <modul>/<funktion>.md
prisma/                   schema.prisma, migrations/, seed.ts (nur Entwicklung)
```

Die Routen unter `src/app/(app)` liegen in Routengruppen, die den Modulen entsprechen (`(workshop)`, `(office)`, `(it)`,
`(admin)`); die Gruppen ändern keine URL.

### Der Katalog

Jede Funktion beschreibt sich in einer `feature.ts` (`defineFeature`). `catalog.ts` führt alle zusammen und leitet daraus alles
Weitere ab: die Typen `Permission` und `FeatureId`, die Rechte-Gruppen der Rollenverwaltung, Navigation, Dashboard-Bausteine,
Einstellungs-Reiter und die Seite „Module & Funktionen“.

### Module und Funktionen ein-/ausschalten

* Gespeichert werden nur **Abweichungen** vom Standard „an“ (Tabelle `FeatureSetting`).
* **Wirksam** ist eine Funktion, wenn ihr Modul an ist, sie selbst an ist **und** alle harten Abhängigkeiten (`requires`) wirksam sind.
* Die Sitzung filtert die Rechte einer Person nach den **wirksamen** Funktionen. Ausgeschaltete Funktionen haben deshalb schlicht
  keine Rechte: `requirePermission()` liefert **404**, Navigation, Widgets und Einstellungs-Reiter erscheinen nicht, Server
  Actions und API-Routen scheitern an derselben Prüfung. **Daten bleiben beim Ausschalten erhalten.**

### Regeln für sauber getrennten Code

Diese Regeln prüfen `src/architecture.test.ts` und `src/modules/catalog.test.ts`.

1. **Plattform kennt keine einzelne Funktion.** `src/server`, `src/components`, `src/i18n`, `src/lib`, `src/platform` und
   `src/capabilities` importieren nichts aus `src/modules/<modul>/<funktion>` (Ausnahmen: `catalog`, `define`, `features`,
   `registry`, `types`, `default-roles`).
2. **Funktionen sprechen nur über `public.ts` miteinander** – und nur, wenn die Abhängigkeit in der `feature.ts` deklariert ist:
   `requires` (zwingend) oder `uses` (optional).
3. **Weiche Abhängigkeiten werden zur Laufzeit geprüft** (`session.features.has("workshop.customers")`).
4. **Jede Seite und jede Server Action prüft selbst** (`requirePermission` / `requireSession`). Navigation und `proxy.ts` sind
   Komfort, kein Schutz.
5. **Einstellungen und Texte gehören der Funktion** (`settings-tab.tsx` → `settingsTabs`, `widgets.tsx` → `widgets`, beides in
   `registry.ts` eingesammelt; Texte in `src/i18n/messages/modules/<funktion>.de.ts` / `.en.ts`).
6. **Globale UI-Bausteine** (`src/components/ui`) kennen keine Fachlogik – und sind der **einzige** Ort, an dem Buttons, Felder, Tabellen,
   Karten usw. definiert werden (siehe „UI-Bausteine“ unter Konventionen).
7. **Betriebsaufgaben sind Funktionen der App**, keine Umgebungsvariablen oder Kommandos am Server.

## Datenhaltung

* **SQLite**, eine Datei (WAL-Modus, `synchronous=FULL`), im Container unter `/data`. Reicht für eine Werkstatt mit einigen
  Dutzend Nutzern über viele Jahre; Schreibvorgänge laufen nacheinander und dauern Millisekunden. Voraussetzung: **lokale Platte**
  (keine SMB-/NFS-Freigabe). Grenzen: keine mehreren App-Instanzen, keine Hochverfügbarkeit.
* Schema nur in `prisma/schema.prisma`. **Keine Enums und keine Json-Felder** – Zustände sind Strings mit festen Werten im Code
  (hält einen späteren Datenbankwechsel offen). Textsuche immer über `contains()` aus `src/server/search.ts` (SQLite unterscheidet
  bei Umlauten Groß-/Kleinschreibung).
* **Geld** als ganze Cent (`Int`), Eingabe über `parseMoneyToCents`.
* **Dateien** (Rechnungsbelege, Doku-Bilder) liegen als normale Dateien unter `/data/files` (`src/server/files.ts`) mit lesbaren
  ASCII-Pfaden, z. B. `rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1234.pdf`; die Datenbank hält nur den relativen `path`
  (`InvoiceFile`, `DocImage`). Dateien werden **nie überschrieben oder verändert** (bei gleichem Namen kommt ein Zähler dazu,
  Umbenennen läuft über Hardlink) – deshalb genügen Hardlinks für Backups. Ausgeliefert nur über Route Handler mit Rechteprüfung.
* **Fahrzeuge** (`Vehicle.customerId`) sind optional – nie `vehicle.customer.x` ohne Prüfung; Anzeigenamen über `customerDisplayName()`.
* **Sensible Mitarbeiterdaten** (Notfallkontakt, Krankheit) nur mit `employees.sensitive`.
* **Einstellungen zur Laufzeit** liegen in `AppSetting`; Geheimnisse (Update-Token) verschlüsselt über `setSecret/getSecret`
  (`src/server/settings.ts`), Schlüsseldatei `/data/secret.key` – bewusst nicht Teil der Backups.

### Migrationen

Die Historie in `prisma/migrations` beginnt mit einer **eingefrorenen Baseline** (`00000000000000_baseline`). Diese und alle
veröffentlichten Migrationen werden **nie verändert** (die App prüft Prüfsummen und verweigert veränderte). Nach einer
Schema-Änderung:

```bash
npm run db:migrate -- add_warranty    # legt die Migration an, wendet sie lokal an, erzeugt den Client neu
```

Im Betrieb wendet die App offene Migrationen beim Start **selbst** an (`src/server/migrate.ts`, gleiche Tabelle
`_prisma_migrations` wie die Prisma-CLI, vorher automatische Sicherung); es gibt keine Prisma-CLI im Container.
Migrationen müssen **abwärtskompatibel zur Vorversion** des Codes sein (erst Spalte hinzufügen, später entfernen), weil ein
Web-Update bei Problemen auf die vorherige Version zurückfällt – auf dem dann bereits migrierten Schema (sie toleriert
Migrationen, die sie nicht kennt). Prisma verlangt bei Daten-verlustigen Änderungen eine Bestätigung im Terminal; geht das nicht
(`migrate dev` bleibt dann stumm), SQL per `prisma migrate diff --from-schema … --to-schema … --script` erzeugen und als
Migrationsordner ablegen.

### Gleichzeitiges Bearbeiten

Bearbeiten-Formulare tragen die Version der Zeile (`updatedAt`) als Feld `version` mit (`versionOf(row)` aus
`src/lib/concurrency.ts`). Die Server Action belegt die Zeile mit `claimed(...)` und meldet sonst `common.conflict`, statt still
zu überschreiben. Prüfung und Schreiben, die zusammengehören (z. B. Doppelbelegung eines Arbeitsplatzes), laufen in
`db.$transaction`. Neue Bearbeiten-Formulare müssen das übernehmen (nur Tabellen mit `updatedAt`).

## Container, Starter und Updates

Ein Container, ein Volume (`/data`). Das Image ist **`FROM scratch`** und enthält nur den **Starter** und die eingebaute App-Version
für den ersten Start – kein Betriebssystem, keine Shell, keinen Paketmanager. Jede App-Version ist ein **selbständiges, signiertes
Paket** und bringt alles andere mit:

| Bestandteil | Wo | Aktualisierung |
| --- | --- | --- |
| **Starter** (`docker/bootstrap.c`, statisch, ~150 Zeilen) | Image | praktisch nie (nur bei geändertem Vertrag: `docker/BASE_VERSION`) |
| **Launcher** (`src/launcher/main.ts`, mit esbuild zu `launcher.mjs`) | Paket | mit jedem Update |
| **Node** und **Systembibliotheken** (glibc, libstdc++, nss, Lader) | Paket (`runtime/`) | mit jedem Update |
| **Anwendung** samt `node_modules`, Migrationen, Hilfe | Paket | mit jedem Update |

Vom Host kommt nur der Kernel. Gestartet wird über den mitgelieferten Lader
(`runtime/<lader> --library-path runtime/lib runtime/node …`).

* **Starter:** wählt das Verzeichnis der aktiven Version (Zeiger `<DATA_DIR>/app/active`, sonst `/app`) und startet dessen
  Launcher. Exit-Code 42 des Launchers = neu auswählen; stürzt der Launcher einer installierten Version zweimal kurz hintereinander
  ab, nimmt er die eingebaute Version und vermerkt das in `<DATA_DIR>/app/launcher-crash`. Er beantwortet auch den Docker-Healthcheck
  (`/bootstrap --healthcheck`).
* **Launcher:** startet nur die App seiner eigenen Version, spielt vorgemerkte Datenbank-Wiederherstellungen ein und macht
  Rückfälle (frische Version nicht gesund → Zeiger auf die Vorversion + Code 42; wiederhergestellte Datenbank nicht gesund →
  vorherige zurück). Eine installierte Version verwirft sich selbst, wenn die eingebaute neuer ist (neues Image gezogen).
* **Die App migriert sich selbst:** `src/instrumentation.ts` → `src/server/startup.ts`: Sicherung vor Migrationen, Migrationen,
  Basisdaten, Zeitzone, Backup-Zeitplan. `/api/health` meldet erst danach „ok“; scheitert etwas, beendet sich der Prozess.
* **Keine Fremdprogramme:** Archive bearbeitet die npm-Bibliothek `tar` – es gibt kein System-`tar`.
* **Zustand:** `<DATA_DIR>/app/state.json` (+ Zeiger `active`); reine, getestete Logik in `src/lib/updates` (`state.ts`, `store.ts`,
  `restore.ts`). `writeState` schreibt immer auch den Zeiger.
* `docker/BASE_VERSION` nur erhöhen, wenn sich der Vertrag des Starters ändert (Zeiger-Format, Exit-Codes, Aufruf der Laufzeit)
  oder die Architektur wechselt – solche Releases bieten kein Web-Update, sondern verlangen ein neues Image.

### Update-Ablauf (Funktion `admin.updates`)

1. Backup anlegen („Vor Update“; scheitert es, wird abgebrochen).
2. Neuestes GitHub-Release holen, **Ed25519-Signatur** des `manifest.json` prüfen (gegen den eingebauten öffentlichen Schlüssel),
   Paket laden und **SHA-256/Größe** gegen das Manifest prüfen.
3. Nach `<DATA_DIR>/app/versions/<version>` entpacken, `state.json`/`active` schreiben, Neustart (Exit-Code 42).
4. Starter → Launcher der neuen Version → Gesundheitsprüfung (90 s) oder Rückfall.

### Backups und Wiederherstellung (Funktion `admin.backup`)

Ein Backup ist ein **Ordner** `<DATA_DIR>/backups/schrauberos-<Zeitpunkt>-<Art>/` mit `database.db.gz` (konsistenter, geprüfter
Online-Schnappschuss), `files/` (**Hardlinks** auf `/data/files`) und `info.json`. Arten: `auto`, `manual`, `upload`,
`pre-update`, `pre-restore`, `pre-migration`. Download als gestreamtes `.tar`, Upload nimmt `.tar`, `.tar.gz` und reine SQLite-Dateien
(dann ohne Dateien) und prüft streng (nur Ordner/normale Dateien, gültige Datenbank, nicht von einer neueren Version).
Wiederherstellung: App prüft, legt `pre-restore` an, stellt `restore/pending.db` (+ `pending-files/`) bereit und beendet sich; der
Launcher tauscht Datenbank samt WAL und Dateien, bestätigt nach gesundem Start oder setzt alles zurück. Zeitplan:
`src/server/backup/scheduler.ts` (Einstellung in `AppSetting`).

## Eine neue Funktion anlegen

Beispiel: Funktion `warranty` im Modul `workshop`.

1. Ordner `src/modules/workshop/warranty/` anlegen.
2. **`feature.ts`** mit `defineFeature({...})`: ID, Modul, Name/Beschreibung (Übersetzungsschlüssel), Reihenfolge, Abhängigkeiten
   (`requires` / `uses`), Rechte-Gruppe mit Schlüsseln (`warranty.view` …), Navigation, Routen-Präfixe.
3. In **`src/modules/catalog.ts`** eintragen (Import und `FEATURES`). Ab jetzt kennt das System Rechte, Aktivierung und Admin-Seite.
4. **Texte** in `src/i18n/messages/modules/warranty.de.ts` / `.en.ts` (englisch typisiert als `typeof warrantyDe`), in `de.ts` /
   `en.ts` einbinden; nötig sind `feature.name`, `feature.description`, Beschriftungen unter `permissionGroups.*` und `permissions.*`.
5. **Seiten** unter `src/app/(app)/(workshop)/warranty/`. **Jede Seite beginnt mit `await requirePermission("…")`, jede Server
   Action ebenfalls.**
6. Optional: `widgets.tsx` (`export const widgets: WidgetDef[]`) und `settings-tab.tsx` (`export const settingsTabs`), beides in
   `registry.ts` eintragen.
   **Hilfe:** `help.ts` (`export const help: HelpTopicDef[]` mit `id`, `feature`, `permission`, `doc`), Kapitel als Markdown unter
   `docs/workshop/warranty.md` (nur Bedienung in der App, kein Entwicklerthema), `help.ts` in **`src/modules/help.ts`** eintragen.
   Eine Funktion darf mehrere Kapitel beitragen (`id` dann mit Zusatz, z. B. `workshop.warranty.claims`).
7. Soll eine andere Funktion etwas nutzen, exportiert `public.ts` genau das – und die andere deklariert `requires`/`uses`.
8. Neue Rechte in `default-roles.ts` den passenden Rollen zuordnen (Administratoren haben sie sofort).
9. Bearbeiten-Formulare: `version` mitschicken und in der Action `claimed(...)` nutzen (siehe oben); Dateien nur über `files.ts`;
   löschende/wichtige Aktionen mit `audit(...)` protokollieren (Aktion in `src/lib/audit-actions.ts` + Texte `audit.actions.*`).
10. `npm run typecheck && npm run lint && npm test` – der Architektur-Test meldet verbotene Importe und fehlende Deklarationen.

## Konventionen

* **Next.js 16**: `middleware` heißt `proxy.ts`; `params`, `searchParams`, `cookies()` sind Promises. Doku: `node_modules/next/dist/docs/`.
  `cacheComponents` ist bewusst aus (komplett eingeloggte, dynamische App).
* **Übersetzungen:** `de.ts` definiert die Struktur, `en.ts` muss identisch sein (sonst Typfehler). Dynamische Schlüssel über
  `td(key, fallback)`, Plural über `<key>_one` / `<key>_other` und `tp()`.
* **Design:** nur Tokens aus `src/app/tokens.css` bzw. Tailwind-Utilities (`bg-surface`, `text-ink-muted` …), keine Rohfarben;
  Hell/Dunkel über `light-dark()`.
* **UI-Bausteine:** Die Oberfläche besteht aus den Bausteinen in `src/components/ui` – `Button`/`LinkButton`/`SubmitButton`/
  `ConfirmSubmitButton`, `Input`/`SearchInput`/`Select`/`Textarea`/`Checkbox`/`ColorInput`/`ColorPicker`/`FileInput`/`Field`,
  `Card`/`CardLink`/`Table`/`FilterBar`/`Badge`/`ChipLink`/`NavLink`/`Alert`/`EmptyState`/`PageHeader`, `Disclosure`, `Menu`,
  `SegmentedControl`, `UrlModal`. Wer ein Element braucht, nimmt den Baustein; fehlt eine Variante, wird sie **dort** ergänzt, damit
  eine Änderung am Aussehen überall wirkt. `src/components/ui/ui-kit.test.ts` erzwingt das: außerhalb von `components/ui` sind rohe
  `<button>`, `<input>` (außer `type="hidden"`), `<select>`, `<textarea>`, `<table>`, `<label>`, `<details>`, `<dialog>`,
  `window.confirm` und die Klassen der Bausteine (`btn`, `input`, `card`, `badge`, `table`, `plate`, `field-*`) verboten.
  **Ausnahme für Spezialfälle:** Eine Funktion (`src/modules`, `src/capabilities`) darf ein eigenes Element mitbringen, wenn das Kit
  es nicht abdeckt (z. B. die Editorfläche des Markdown-Editors); die Datei sagt das mit einem Kommentar `ui-kit-exception: <Grund>`.
  Solche Elemente bauen, wo möglich, trotzdem auf den Bausteinen auf.
* **React:** kein `useEffect` mit synchronem `setState`; kein `Date.now()`/`new Date()` im Komponenten-Rumpf (Helfer aus `src/lib/dates.ts`).
* **Server-only Code** darf vom Seed-Skript nicht importiert werden; dafür gibt es `src/server/db-client.ts`.
* Commit-Nachrichten enden mit der `Co-Authored-By`-Zeile des verwendeten KI-Assistenten, falls einer beteiligt war.

## Tests

`node:test` über `tsx`: Fachlogik (`*.test.ts` neben dem Code), Aktivierungslogik, Katalog (gültige Abhängigkeiten, eindeutige Rechte,
Übersetzungen vorhanden), Architekturregeln, Migrations-Läufer (inkl. Verträglichkeit mit der Prisma-CLI), Backups/Restore (echte
SQLite-Dateien), Dateispeicher, optimistische Sperre und gleichzeitige Buchungen gegen eine echte Datenbank, Update-Zustand und Rückfälle.

## Release und Signaturschlüssel

### Warum es einen Schlüssel gibt

Ein Web-Update installiert Code, der aus dem Internet kommt und danach mit vollem Zugriff auf alle Daten läuft. Die Echtheit darf
deshalb nicht allein davon abhängen, dass ein GitHub-Konto oder -Token sicher ist. Jedes Release enthält ein `manifest.json`
(Version, Starter-Vertrag `base`, Architektur, Paketname, SHA-256, Größe), das die Pipeline mit einem **privaten Ed25519-Schlüssel
signiert**. Die App kennt nur den **öffentlichen Schlüssel** und installiert nichts, dessen Signatur nicht passt oder dessen Prüfsumme
abweicht.

| Schlüssel | Wo er liegt | Wofür |
| --- | --- | --- |
| **privat** | GitHub-Repository-Secret **`RELEASE_SIGNING_KEY`** (nie im Repo, nie im Image) | signiert in der Pipeline das Manifest |
| **öffentlich** | `src/modules/admin/updates/release-key.ts` (`RELEASE_PUBLIC_KEY`, im Code und damit im Image) | die App prüft damit jedes Release |

Forks können einen eigenen öffentlichen Schlüssel über die Umgebungsvariable `UPDATE_PUBLIC_KEY` (PEM) setzen.

### Schlüsselpaar erzeugen

Mit OpenSSL (3.x):

```bash
openssl genpkey -algorithm ed25519 -out release-signing-key.pem     # privat – geheim halten
openssl pkey -in release-signing-key.pem -pubout -out release-public-key.pem   # öffentlich
```

oder nur mit Node:

```bash
node -e "const c=require('crypto'),f=require('fs');const k=c.generateKeyPairSync('ed25519');f.writeFileSync('release-signing-key.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));f.writeFileSync('release-public-key.pem',k.publicKey.export({type:'spki',format:'pem'}))"
```

Die private Datei beginnt mit `-----BEGIN PRIVATE KEY-----`, die öffentliche mit `-----BEGIN PUBLIC KEY-----`.

### Schlüssel setzen

1. **Privaten Schlüssel als Secret hinterlegen** (der komplette PEM-Text samt `BEGIN`/`END`-Zeilen):

   ```bash
   gh secret set RELEASE_SIGNING_KEY --repo veniplex/schrauberos < release-signing-key.pem
   gh secret list --repo veniplex/schrauberos        # prüfen: RELEASE_SIGNING_KEY ist aufgeführt
   ```

   Oder im Browser: Repository → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*, Name
   `RELEASE_SIGNING_KEY`, Wert = Inhalt der Datei.
2. **Öffentlichen Schlüssel eintragen:** den Inhalt von `release-public-key.pem` in `src/modules/admin/updates/release-key.ts` als
   `RELEASE_PUBLIC_KEY` einsetzen, committen und pushen.
3. Beides muss **zusammengehören**. Die Pipeline prüft das vor jedem Release (`scripts/make-release.mjs` verifiziert die frische
   Signatur gegen den eingebauten öffentlichen Schlüssel) und bricht bei einem falschen Secret ab – nicht erst bei den Anwendern.
4. Die private Datei sicher aufbewahren (Passwortmanager) und danach vom Rechner löschen. GitHub zeigt das Secret nie wieder an.

### Schlüssel ersetzen oder verloren

Weil der öffentliche Schlüssel **im Image** steht, erkennen bereits laufende Installationen Releases, die mit einem neuen Schlüssel
signiert sind, nicht mehr an (die Update-Seite meldet „Signatur ungültig“). Nach einem Schlüsselwechsel muss also **jede
Installation einmal ein neues Image ziehen**; danach laufen Web-Updates wieder. Den Schlüssel nur bei Verlust oder Kompromittierung
wechseln: neues Paar erzeugen, Secret ersetzen (`gh secret set …` überschreibt), öffentlichen Schlüssel eintragen, Release
veröffentlichen, Installationen einmal per `docker compose pull && docker compose up -d` aktualisieren.

### Eine Version veröffentlichen

1. `version` in `package.json` auf die neue Nummer setzen (z. B. `0.2.0`), committen, pushen.
2. Tag setzen und pushen: `git tag v0.2.0 && git push origin v0.2.0`.
3. Die GitHub-Action (`.github/workflows/docker-publish.yml`) prüft Typen/Lint/Tests, baut das Image nach `ghcr.io` (`0.2.0`, `0.2`,
   `latest`) und – Job *Release* – das Paket (`docker buildx build --target bundle`), erzeugt `manifest.json` samt Signatur
   (`scripts/make-release.mjs`) und legt das GitHub-Release mit Paket, Manifest und Signatur an (Änderungen aus den Commits).

Die Pipeline bricht ab, wenn Tag und `package.json` nicht übereinstimmen. Nur Versionen der Form `x.y.z` sind installierbar;
Images von `main` heißen `x.y.z-dev.<sha>` und werden von Web-Updates nie angeboten.

Lokal ein Paket bauen und signieren (zum Testen):

```bash
docker build --target bundle --build-arg APP_VERSION=0.2.0 --output type=tar,dest=bundle.tar .
tar -xf bundle.tar version.json && gzip -c bundle.tar > schrauberos-0.2.0.tar.gz
RELEASE_SIGNING_KEY="$(cat release-signing-key.pem)" node scripts/make-release.mjs \
  --archive schrauberos-0.2.0.tar.gz --bundle . --out .
```

### Update-Token in der App

Ist das Repository privat, braucht die App zum Lesen der Releases ein GitHub-Token (Einstellungen → Updates): *Fine-grained personal
access token*, nur dieses Repository, Berechtigung *Contents: Read-only*. Es liegt verschlüsselt in der Datenbank
(`src/server/secrets.ts`, Schlüsseldatei `/data/secret.key`) und gehört nicht zu den Backups.

## Betrieb

### Installation

```bash
# einmalig (Repo privat): am Server bei ghcr.io anmelden – Token mit Recht "read:packages"
echo <TOKEN> | docker login ghcr.io -u <github-benutzer> --password-stdin
docker compose up -d
```

In **Portainer** genügt es, den Inhalt von `docker-compose.yml` als Stack einzufügen. Danach im Browser `http://<server>:3000`
öffnen: Die **Ersteinrichtung** legt Werkstattname, Zeitzone und den ersten Administrator an. **Vorher darf die Anwendung nicht von
außen erreichbar sein** – wer sie zuerst aufruft, wird Administrator. Alles Weitere erledigt die Weboberfläche (Verwaltung →
Backups, Updates, Einstellungen). Das Volume `app-data` muss auf einer **lokalen Platte** liegen.

Optional, nur beim Neu-Erstellen des Containers: `.env` neben der `docker-compose.yml` (Vorlage `docker.env.example`) mit `APP_PORT`
und `SCHRAUBEROS_VERSION` (Image-Version, Standard `latest`).

### Was im Volume liegt

```text
/data/schrauberos.db (+ -wal, -shm)   Datenbank
/data/files/                          Belege und Bilder, lesbare Pfade (rechnungen/<Jahr>/<eingang|ausgang>/…, doku/<bereich>/…)
/data/backups/<name>/                 Backups (database.db.gz, files/ als Hardlinks, info.json)
/data/app/                            state.json, active, versions/<version>/ (installierte Pakete), launcher-crash
/data/restore/                        vorgemerkte/ersetzte Daten während einer Wiederherstellung
/data/secret.key                      Schlüssel für verschlüsselte Einstellungen (nicht in Backups)
```

### Notfall ohne Weboberfläche

Startet die Anwendung gar nicht, liegen die Backups trotzdem im Volume. Von Hand: Container stoppen, aus
`/data/backups/<name>/database.db.gz` die Datenbank entpacken (`gunzip`) und als `/data/schrauberos.db` ablegen (alte
`schrauberos.db-wal`/`-shm` löschen), den Ordner `files/` des Backups nach `/data/files` kopieren, Container starten. Logs:
`docker compose logs app` (Starter, Launcher und Anwendung schreiben nach stdout).

### Weiteres

* **HTTPS/Reverse Proxy:** Hinter einem Proxy mit HTTPS erkennt die App das am Header `x-forwarded-proto` und setzt das
  Cookie-Flag „Secure“ selbst (erzwingen: `SESSION_COOKIE_SECURE=true|false`). Erscheint beim Speichern „Invalid Server Actions
  request“, leitet der Proxy den öffentlichen Host nicht per `x-forwarded-host` weiter – dann die Domain in `next.config.ts` unter
  `experimental.serverActions.allowedOrigins` eintragen.
* **Zeitzone:** Einstellungen → Werkstatt; wird bei jedem Start angewendet.
* **Image neu ziehen** ist nur nötig, wenn ein Release den Vertrag des Starters ändert (die Update-Seite sagt es) oder bei einem
  Schlüsselwechsel: `docker compose pull && docker compose up -d` (die Daten bleiben).

## Bekannte Grenzen

* Listen (Kunden, Reifen, Rechnungen) laden bis zu 100–300 bzw. alle Datensätze und filtern teils im Speicher – für typische
  Betriebsgrößen in Ordnung, bei Bedarf Pagination ergänzen.
* Dateien wachsen mit dem Archiv; Backups verweisen per Hardlink darauf (kaum Zusatzplatz), schützen aber nicht vor dem Ausfall des
  Datenträgers – Kopien außerhalb des Servers über „Herunterladen“.
* Backups sind unverschlüsselt.
* Die Suche unterscheidet bei Umlauten Groß-/Kleinschreibung (SQLite).
* Urlaubstage zählen Mo–Fr ohne Feiertage; kein Genehmigungs-Workflow.
* Nicht enthalten: E-Mail/SMS-Erinnerungen, Druck-Etiketten/QR-Codes für Lagerplätze, Ressourcen-Kalender pro Mitarbeiter, echte
  Netzwerk-Überwachung (derzeit Demo), Zwei-Faktor-Anmeldung. Anmeldung rein lokal; Active Directory ist über `AuthProvider` in
  `src/server/auth/providers.ts` vorgesehen.
* Werbas-Anbindung (später): Kunden/Fahrzeuge tragen `externalSource`/`externalId`/`syncedAt`; `src/server/integrations/werbas/`
  enthält Austauschformat und Abgleichslogik, offen ist nur `client.ts`.
* Gebaut wird `linux/amd64`.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite) · eigene Sitzungs-Authentifizierung (bcrypt,
serverseitige Sitzungen) · eigene schlanke i18n · Zod · react-markdown + remark-gfm · node-tar · esbuild. Design-Tokens in
`src/app/tokens.css`.
