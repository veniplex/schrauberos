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

Das **Einrichtungs-Token** steht im Container-Log: `docker compose logs app` (Zeile `[setup] Einrichtungs-Token: …`; die Datei
`setup-token` im Volume enthält denselben Wert). Dann `http://<server>:3000` öffnen: Die **Ersteinrichtung** verlangt dieses Token
und legt Werkstattname, Zeitzone und den ersten Administrator an (optional mit Beispieldaten) und zeigt zum Schluss dessen
**Wiederherstellungs-Code** (Notzugang) zum Ausdrucken – bewahren wie ein Passwort. Ohne Token kann niemand die
Einrichtung übernehmen; trotzdem sollte die Anwendung bis zum Abschluss nicht von außen erreichbar sein. Alles Weitere (Backups, Updates, Einstellungen, Module) geschieht in der Weboberfläche unter **Verwaltung**; am
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
| `npm run db:baseline` | **bis zur Veröffentlichung:** aus `schema.prisma` die eine Baseline-Migration neu erzeugen (ersetzt alle Migrationsordner) |
| `npm run db:migrate -- <name>` | **ab der Veröffentlichung:** neue Migration anlegen, lokal anwenden, Client neu erzeugen |
| `npm run db:check` | Drift-Check: stimmt `schema.prisma` mit den Migrationen überein? (läuft auch in der Pipeline) |
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
  **Doku-Bilder** (`src/capabilities/docs/images.ts`) per Rückwärtssuche: sichtbar, wenn eine für den Betrachter sichtbare Seite (aktueller
  Inhalt, nicht `DocVersion`) die Adresse `/api/docs/images/<id>` enthält; Bilder ohne Seite sehen nur Bearbeiter. Kapitel mit Seiten sind
  nicht löschbar (sonst würde eine Beschränkung aufgehoben).
* **Fahrzeuge** (`Vehicle.customerId`) sind optional – nie `vehicle.customer.x` ohne Prüfung; Anzeigenamen über `customerDisplayName()`.
* **Sensible Mitarbeiterdaten** (Notfallkontakt, Krankheit) nur mit `employees.sensitive`.
* **Einstellungen zur Laufzeit** liegen in `AppSetting`; Geheimnisse (Update-Token) verschlüsselt über `setSecret/getSecret`
  (`src/server/settings.ts`), Schlüsseldatei `/data/secret.key` – bewusst nicht Teil der Backups.

### Migrationen

Es gibt immer **eine Baseline** (`prisma/migrations/00000000000000_baseline`). Ihre erste Zeile ist der Marker `-- schrauberos:baseline unreleased`
(bzw. `frozen`); den Marker kennen Wächter und Skripte.

* **Solange nichts veröffentlicht ist (`unreleased`, der Stand von v0.2.0):** keine einzelnen Migrationen. Nach **jeder** Schema-Änderung
  `npm run db:baseline` – das Skript erzeugt die Baseline aus `schema.prisma` neu und ersetzt dabei alle anderen Migrationsordner; danach
  `npm run db:fresh`. So laufen Migrations-, Backup-/Concurrency-Tests, Harness und Drift-Check immer gegen den aktuellen Stand. Es gibt
  **keine Rückwärtskompatibilität zu 0.1.0**: Beim Start erkennt die App eine fremde Migrationshistorie (Baseline mit anderer Prüfsumme,
  fremde Namen, Tabellen ohne Historie) und startet **nicht** (siehe unten). Unbekannte *neuere* Migrationen in der Datenbank bleiben erlaubt
  (Rückfall auf eine ältere Version nach der Veröffentlichung).
* **Mit der Veröffentlichung** (Release-Block): Marker auf `frozen` setzen (einziger Commit am Verlauf). Ab dann werden die Baseline und alle
  veröffentlichten Migrationen **nie verändert** (die App prüft Prüfsummen und verweigert veränderte); `db:baseline` verweigert die
  Arbeit, Schema-Änderungen gehen so:

```bash
npm run db:migrate -- add_warranty    # legt die Migration an, wendet sie lokal an, erzeugt den Client neu
```

* **Wächter** (`src/lib/migration-guard.ts`, Test `migration-guard.test.ts`): Jede Migration nach der Baseline darf kein `DROP`/`RENAME`, keine neue
  Spalte `NOT NULL` ohne `DEFAULT`, keinen neuen `UNIQUE`-Index auf einer Bestandstabelle (Ausnahme: neue nullable Spalte) und kein
  `DELETE`/`UPDATE` enthalten. Eine **begründete Ausnahme** steht als Kommentarzeile in der Migration:
  `-- guard:allow <regel>: <Begründung>` (Regeln `drop`, `rename`, `not-null`, `unique`, `data-change`; Begründung Pflicht, fällt im Review auf).
  Prisma-Tabellenumbauten (`RedefineTables`) enthalten `DROP`/`RENAME` – statt dessen additiv arbeiten.
* **Drift-Check** `npm run db:check` (`prisma migrate diff --from-migrations … --to-schema … --exit-code`, Wegwerf-Datenbank legt Prisma selbst an): schlägt
  an, wenn `schema.prisma` und Migrationen auseinanderlaufen; läuft in der Pipeline im Check-Job.

Im Betrieb wendet die App offene Migrationen beim Start **selbst** an (`src/server/migrate.ts`, gleiche Tabelle
`_prisma_migrations` wie die Prisma-CLI, vorher automatische Sicherung); es gibt keine Prisma-CLI im Container.
Migrationen müssen **abwärtskompatibel zur Vorversion** des Codes sein (erst Spalte hinzufügen, später entfernen), weil ein
Web-Update bei Problemen auf die vorherige Version zurückfällt – auf dem dann bereits migrierten Schema (sie toleriert
Migrationen, die sie nicht kennt). Prisma verlangt bei Daten-verlustigen Änderungen eine Bestätigung im Terminal; geht das nicht
(`migrate dev` bleibt dann stumm), SQL per `prisma migrate diff --from-schema … --to-schema … --script` erzeugen und als
Migrationsordner ablegen.

**Fremdes Volume („Neuinstallation nötig“):** Erkennt `runMigrations` eine fremde Historie, wirft es `MigrationError("foreignHistory")` *bevor* es irgendetwas
anwendet oder sichert. `startApp` fängt das: Status `reinstall` (`src/server/startup-state.ts`), klare Meldung im Log, **kein** `process.exit` (das gäbe
eine Neustart-Schleife über Starter/Docker), die Datenbank bleibt unangetastet. `/api/health` antwortet 503 `{"status":"reinstall"}`, das Root-Layout zeigt
nur den Hinweis (`src/app/reinstall-notice.tsx`, zweisprachig), und der Launcher wertet das (`src/lib/updates/health.ts`) als endgültig: Bei einem Update oder
einer Wiederherstellung fällt er sofort zurück statt 90 s zu warten, sonst läuft der Container ungesund weiter, ohne zu starten und ohne Schleife.
Test: `src/server/startup.test.ts` (präpariertes altes Volume), `migrate.test.ts`.

### Ersteinrichtung und Einrichtungs-Token

Beim App-Start (`src/server/startup.ts`) erzeugt `ensureSetupToken` (`src/server/setup-token.ts`), solange es **keinen Benutzer** gibt, ein
zufälliges Token (160 Bit), schreibt es als `<DATA_DIR>/setup-token` (Modus 0600, nicht Teil der Backups) und ins Container-Log. Die
Ersteinrichtung (`src/app/setup/actions.ts`) prüft in dieser Reihenfolge: gibt es schon einen Benutzer (→ `/login`, nichts anderes
wird angefasst), Token (Vergleich über SHA-256 in konstanter Zeit, global gedrosselt: 5 freie Versuche, dann 5 s … 60 s), Eingaben,
dann Anlegen in einer Transaktion; **erst danach** wird die Zeitzone angewendet (`applyTimezone`, vorher `isValidTimezone`) und das
Token gelöscht. Dasselbe gilt für die Einstellungen (Zeitzone erst nach dem Speichern). Das Token ist die bewusste Ausnahme vom Grundsatz
„alles über die Weboberfläche“: **einmalige Installationshandlung, kein laufender Betrieb**.

### Gleichzeitiges Bearbeiten

Bearbeiten-Formulare tragen die Version der Zeile (`updatedAt`) als Feld `version` mit (`versionOf(row)` aus
`src/lib/concurrency.ts`). Die Server Action belegt die Zeile mit `claimed(...)` und meldet sonst `common.conflict`, statt still
zu überschreiben. Prüfung und Schreiben, die zusammengehören (z. B. Doppelbelegung eines Arbeitsplatzes), laufen in
`db.$transaction`. Neue Bearbeiten-Formulare müssen das übernehmen (nur Tabellen mit `updatedAt`).

### Anmeldung, Sitzung und Rechte-Hierarchie

* **Sitzung:** serverseitig (Tabelle `Session`, nur der Hash des Tokens), Cookie `so_session` im HTTP-LAN, **`__Host-so_session`** (Secure)
  über HTTPS. **Gelesen wird nur der Name, der zum Übertragungsweg passt** (unter HTTPS ausschließlich `__Host-…`, ein untergeschobenes
  Klartext-Cookie zählt nicht – Cookie Tossing; `src/lib/session-cookie.ts`, gilt auch im Proxy). Abmelden löscht den `__Host-`-Cookie mit
  `Secure`, Pfad `/` und `Max-Age=0` (`cookies().delete()` täte das nicht, der Browser verwürfe es). Der Proxy (`src/proxy.ts`) prüft nur, ob ein Cookie da ist, und leitet
  **nie von `/login` weg** – die Anmeldeseite prüft die Sitzung selbst (totes Cookie → Formular statt Schleife). Ausgenommen vom Proxy
  (`config.matcher`, getestet): Statik, `manifest.webmanifest`, `sw.js`, Icons, `/api/health`, `/api/v1/*` (Bearer-Token), `/api/ical/*`
  (Token in der URL); übrige `/api/*` ohne Cookie antworten mit 401.
* **Passwörter:** scrypt aus `node:crypto` (`src/server/auth/scrypt.ts`, N=2^15, r=8, p=1, Kosten stehen im Hash). Anmeldungen: höchstens **2** Berechnungen
  gleichzeitig (`hashSemaphore`, teilt sich den libuv-Thread-Pool), Warteschlange begrenzt (voll → „bitte kurz warten“). Alles, was nicht hinter einer Flut
  fremder Anmeldungen warten darf – Passwort setzen, Passwortabfrage im Konto, das Hashen des neuen Passworts beim Notzugang und die Anmeldung von einem
  bekannten Gerät –, läuft auf dem **eigenen Pfad** `ownerSemaphore` (1 gleichzeitig; zusammen bleibt ein Thread des Pools frei). **Unbekannte Namen rechnen
  keinen Hash**: Die Antwort wird per Timer auf die gemessene typische Hash-Dauer aufgefüllt (`hashStats.typicalMs`), sonst ließen sich die Hash-Plätze mit
  erfundenen Namen belegen. Länge: 8–128 Zeichen, zusätzlich höchstens 512 Bytes (`src/lib/password-rules.ts`).
* **Drosselung** (`src/lib/login-throttle.ts`, Zustand `src/server/auth/throttle.ts`): je Konto 3 freie Versuche, dann 2 s, 4 s, 8 s … höchstens
  90 s – **keine harte Sperre**, gleich für unbekannte Namen. Prüfen und Belegen laufen synchron ohne `await` dazwischen (Schwung paralleler Versuche
  kommt nur bis zu den freien Versuchen durch); abgewiesene Versuche verlängern nichts; gedrosselte Anmeldungen kosten nur einen Timer, keinen
  Hash. Der Speicher verdrängt bei Überlauf **nie eine laufende Wartezeit** zugunsten eines neuen Namens (zuerst Einträge ohne Wartezeit, dann bis zum
  Doppelten der Grenze wachsen, darüber der am frühesten ablaufende). Die Zähler stehen zusätzlich atomar in der Datenbank (`User.failedLogins/lockedUntil`,
  überstehen Neustarts; geschrieben ohne `updatedAt`, damit das Benutzerformular keinen Schein-Konflikt meldet); die Administration hebt sie auf
  der Benutzerseite auf. Das **globale Fehlversuchs-Budget** (30/min) verlangsamt, weist nie ab. **IP-Limit** nur mit der Einstellung
  „Hinter Reverse-Proxy“ (Einstellungen → Sicherheit): dann zählt der **letzte** Eintrag von `X-Forwarded-For`, sonst wird der Header ignoriert.
  Audit-Einträge für Fehlversuche sind gedrosselt, unbekannte Namen stehen nur als Kürzel darin. Der Passwortwechsel im Konto hat ein eigenes Limit.
  Uhr/Warten sind in Tests über `authRuntime` (`src/server/auth/runtime.ts`) ersetzbar.
* **Bekanntes Gerät** (`src/server/auth/devices.ts`, Tabelle `KnownDevice`): Gegen den **Dauerbeschuss eines Kontos** – wer ohne Pause auf einen Namen schießt,
  gewinnt jedes frei werdende Zeitfenster der Konto-Wartezeit und sperrte so den Besitzer praktisch aus – setzt die App nach jeder erfolgreichen Anmeldung
  ein zufälliges 256-Bit-Cookie (`so_device`, unter HTTPS `__Host-so_device`; HttpOnly, SameSite=Lax, 180 Tage, gleitend), in der Datenbank nur der SHA-256-Hash,
  gebunden an das Konto (höchstens 10 je Konto). Eine Anmeldung **mit gültigem Cookie dieses Kontos** unterliegt nicht der Konto-Wartezeit (und nicht der
  Datenbank-Sperre), sondern einer eigenen Drosselung je Gerät (`loginThrottle.devices`: 5 freie Versuche, dann 2 s … 90 s) und dem globalen Budget; ihre
  Fehlversuche zählen nicht gegen das Konto. Ohne Cookie (neues Gerät, Angreifer) bleibt die Konto-Wartezeit, Ausweg: abwarten (≤ 90 s) oder der
  Wiederherstellungs-Code. Das Cookie ersetzt nie das Passwort. Geräte werden vergessen bei Passwortänderung/Deaktivierung durch die Administration, beim
  Passwortwechsel im Konto (andere Geräte) und beim Notzugang. **Restrisiko:** Wer das Geräte-Cookie *und* ein Ratefenster am selben Gerät hat, ist durch das
  Geräte-Limit gebremst, aber nicht durch die Konto-Wartezeit; ein gestohlenes Geräte-Cookie erleichtert Raten also nur im Rahmen des Geräte-Limits.
* **Rücksprungziel** (`?next=`): `safeNext` (`src/lib/safe-next.ts`) löst per `new URL` auf und vergleicht den Origin.
* **Rechte-Hierarchie** (`src/lib/rbac.ts`, DB-Teil `src/server/rbac/hierarchy.ts`): Ein Nicht-Admin ändert nur Konten, deren **Rohrechte**
  (ungefiltert nach Funktionsaktivierung) eine Teilmenge der eigenen sind, vergibt/entzieht nur Rollen, die er vollständig besitzt, ändert Rollen nur
  um selbst besessene Rechte (Differenz), nie die eigene Rolle und nie Administrator-Rollen. Rechte mit `adminOnly` in der `feature.ts`
  (`permissions.adminOnly`: Benutzer, Rollen, Einstellungen, Module, Backups, Updates) vergeben nur Administratoren; Standardrollen enthalten sie nie
  (Test). Prüfen und Schreiben laufen in einer Transaktion. Arbeitsplätze/Terminarten hängen am eigenen Recht `appointments.configure`.

### Notzugang: Wiederherstellungs-Code

Jedes Administrator-Konto kann genau einen **Wiederherstellungs-Code** haben (Tabelle `RecoveryCode`, nur der SHA-256-Hash). Der Code hat
160 Bit Zufall in 8 Gruppen zu 5 Zeichen (4 Nutzzeichen + Prüfzeichen, `src/lib/recovery-code.ts`) und wird **nur in der Antwort der Server
Action** angezeigt (Einrichtung, Konto, Einlösen): eigene Seite mit Pflicht-Bestätigung „habe ich gesichert“ und Druckansicht
(`RecoveryCodeView`), nie in URL, Log oder Audit. Erzeugen/Neu-Erzeugen nur für Administrator-Konten und mit erneuter Passwortabfrage
(`src/platform/account/recovery-actions.ts`, im Konto).

**Einlösen** (`/login/recover`, `src/server/auth/recovery.ts`): eigener Pfad, **nicht** über die scrypt-Semaphore der Anmeldungen (das Hashen des neuen Passworts läuft auf `ownerSemaphore`, nie hinter einer Flut von Anmeldungen). SHA-256, Vergleich in
konstanter Zeit über alle gespeicherten Hashes; Drosselung **ausschließlich global** (`loginThrottle.recovery`: Budget verlangsamt ab 10
Versuchen/min um je 200 ms bis 5 s, weist nie ab) und je Adresse nur mit der Proxy-Einstellung – **nie pro Konto**. Alle Fehler (kein
Code, falsch, Prüfsumme, benutzt, Konto inaktiv/kein Administrator) liefern dieselbe Meldung und werden per Timer auf eine feste Dauer
(1,2–1,5 s) aufgefüllt, ebenso der Erfolg. Bei Erfolg in **einer Transaktion**: Code verbrauchen (Löschen der Zeile entscheidet bei
Gleichzeitigkeit), neues Passwort, alle Sitzungen des Kontos löschen, `resetSecondFactor` (Erweiterungsstelle für 2FA, P1b-5), Hinweis
anlegen, bekannte Geräte vergessen, **neuer Code** (der alte ist ungültig). Kein automatisches Anmelden. Der Hinweis „Notzugang wurde verwendet“ (`RecoveryNotice`;
überlebt das Löschen des Kontos, der Name steht in `userName`) erscheint als Banner (`RecoveryBanner` im Layout) beim Konto und bei allen Administratoren, bis sie ihn bestätigen; Audit
`auth.recoveryCreated/Used/Failed` (Fehlversuche gedrosselt, ohne Code-Material). Der Code gehört zu den Daten: Nach einer
Backup-Wiederherstellung kann ein gedruckter Code veraltet sein (Hinweis in Hilfe und Wiederherstellungs-Rückfrage).

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
* **Fehler-, Lade- und Wartezustände:** `not-found.tsx`, `error.tsx`, `loading.tsx` liegen unter `src/app` (Wurzel: ohne Navigation bzw. mit Navigation für Angemeldete) und `src/app/(app)` (im Anwendungsrahmen, die Navigation bleibt); `global-error.tsx` ersetzt das Wurzel-Layout und ist fest zweisprachig. Der Anwendungsrahmen steht in `src/app/app-shell.tsx`. `error.tsx` erkennt „Server Action nicht gefunden“ (offener Tab nach einem Web-Update, `src/lib/stale-deployment.ts`) und lädt **einmal** neu (kein Neuladen in Schleife). Jeder Dashboard-Baustein läuft in einer eigenen Fehlergrenze (`WidgetBoundary`): ein werfendes Widget zerstört die Übersicht nicht. Jeder Link der Bausteine (`LinkButton`, `NavLink`, `CardLink`, `TextLink`, `ChipLink`, `MenuLink`) zeigt über `LinkPending` (`useLinkStatus`) nach 150 ms ein Lade-Symbol und meldet die Navigation an den dünnen Fortschrittsbalken `NavProgress` (Wurzel-Layout). Neue Link-Bausteine übernehmen `LinkPending`.
* **React:** kein `useEffect` mit synchronem `setState`; kein `Date.now()`/`new Date()` im Komponenten-Rumpf (Helfer aus `src/lib/dates.ts`).
* **Server-only Code** darf vom Seed-Skript nicht importiert werden; dafür gibt es `src/server/db-client.ts`.
* Commit-Nachrichten enden mit der `Co-Authored-By`-Zeile des verwendeten KI-Assistenten, falls einer beteiligt war.

## Tests

`node:test` über `tsx`. **Testharness** `src/test/harness.ts`: `createTestEnv()` legt eine echte temporäre SQLite an (alle Migrationen), macht sie zur
Datenbank der Anwendung und ersetzt nur den Rand von Next.js (`redirect()`/`notFound()` werfen abfangbare Signale, `cookies()`/`headers()` lesen einen
Fake-Browser, `server-only`/`next/cache` sind leer). Der zu testende Code wird **danach** mit `await import(...)` geladen; `env.role()`, `env.user()`,
`env.signIn()`, `form({...})` und `redirectOf(() => action(...))` bilden Formulare und Sitzungen nach (Beispiele: `src/modules/admin/users/actions.test.ts`,
`src/server/auth/login.test.ts`). Außerdem: Fachlogik (`*.test.ts` neben dem Code), Aktivierungslogik, Katalog (gültige Abhängigkeiten, eindeutige Rechte,
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

Forks können einen eigenen öffentlichen Schlüssel über die Umgebungsvariable `UPDATE_PUBLIC_KEY` (PEM) setzen (zugleich Wurzel, siehe unten;
getrennt: `UPDATE_ROOT_PUBLIC_KEY`).

### Schlüsselkette: Wurzelschlüssel → Release-Schlüssel

Damit ein **verlorener** (oder planmäßig gewechselter) Release-Schlüssel ersetzt werden kann, ohne dass jede Installation ein neues Image
braucht, gibt es zwei Ebenen (`src/lib/updates/keychain.ts`, getestet):

| Schlüssel | Wo er liegt | Wofür |
| --- | --- | --- |
| **Wurzelschlüssel** (`ROOT_PUBLIC_KEY` in `release-key.ts`) | öffentlich im Code/Image; der **private Teil bleibt offline** (Passwortmanager/Datenträger, nie GitHub-Secret, nie Server) | beglaubigt Release-Schlüssel, signiert nie Pakete |
| **Release-Schlüssel** (`RELEASE_PUBLIC_KEY`, privat: Secret `RELEASE_SIGNING_KEY`) | siehe oben | signiert das Manifest jedes Releases |

Die App vertraut dem eingebauten Release-Schlüssel **und** jedem Schlüssel mit einer gültigen Beglaubigung des Wurzelschlüssels
(`release-keys.json`, wird dem Release beigelegt und unter `<DATA_DIR>/app/release-keys.json` gemerkt; bei jeder Verwendung erneut
gegen die Wurzel geprüft). **Jede Beglaubigung trägt ein Ablaufdatum (`--valid-until`, Pflicht)**; eine unbefristete wird von der App abgelehnt und vom
Skript gar nicht erst erzeugt. Nicht beglaubigte Schlüssel werden abgelehnt.

**Grenze der Kette (wichtig):** Der im Image eingebaute Release-Schlüssel bleibt für diese Installationen **immer vertraut**. Die Kette hilft bei
*Verlust* des privaten Schlüssels – **nicht** bei *Diebstahl* oder Kompromittierung: Wer das Secret `RELEASE_SIGNING_KEY` gestohlen hat, kann weiter
gültige Manifeste signieren, eine Beglaubigung für einen neuen Schlüssel entzieht dem alten nichts. Dagegen bräuchte es eine Widerrufsliste oder einen
**neuen Wurzelschlüssel samt neuem Image**, das jede Installation einmal von Hand zieht.

* **Ausgangslage:** `ROOT_PUBLIC_KEY` ist noch `= RELEASE_PUBLIC_KEY` – dann schützt die Kette nicht. **`scripts/make-release.mjs` bricht beim
  Tag-Build deshalb ab** (kein stilles Zurückfallen auf den Release-Schlüssel; getestet in `src/lib/updates/make-release.test.ts`), bis der Besitzer
  einen eigenen Wurzelschlüssel erzeugt (Befehle oben, andere Dateinamen), den öffentlichen Teil als `ROOT_PUBLIC_KEY` einträgt (vor der
  Veröffentlichung, die Wurzel steht im Image) und den privaten Teil offline verwahrt.
* **Release-Schlüssel tauschen:** neues Paar erzeugen, Secret `RELEASE_SIGNING_KEY` ersetzen, offline beglaubigen:
  `ROOT_SIGNING_KEY_FILE=wurzel-privat.pem node scripts/endorse-release-key.mjs --public release-public-key.pem --valid-until 2031-12-31`,
  `release-keys.json` committen, Release veröffentlichen – Installationen nehmen den neuen Schlüssel über die Beglaubigung an.
  `scripts/make-release.mjs` prüft die Signatur gegen die Kette und legt `release-keys.json` bei.
* **Wurzelschlüssel tauschen** (Verlust/Kompromittierung) und **Widerruf eines gestohlenen Release-Schlüssels** gehen nur über ein neues Image.
* Private Schlüssel gehören **nie** ins Repository.

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
signiert sind, nicht mehr an (die Update-Seite meldet „Signatur ungültig“) – **es sei denn, der neue Release-Schlüssel ist vom
Wurzelschlüssel beglaubigt** (siehe Schlüsselkette). Ohne Beglaubigung muss **jede Installation einmal ein neues Image ziehen**;
danach laufen Web-Updates wieder. Bei *Diebstahl* des privaten Schlüssels reicht Rotieren nicht (der alte bleibt in bestehenden Images vertraut): neuen
Wurzelschlüssel und neues Image veröffentlichen. Den Schlüssel nur bei Verlust oder Kompromittierung
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

In **Portainer** genügt es, den Inhalt von `docker-compose.yml` als Stack einzufügen. Das Einrichtungs-Token
aus `docker compose logs app` (bzw. dem Log des Stacks in Portainer) bereithalten, dann im Browser `http://<server>:3000` öffnen:
Die **Ersteinrichtung** legt Werkstattname, Zeitzone und den ersten Administrator an. Alles Weitere erledigt die Weboberfläche (Verwaltung →
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
/data/setup-token                     Einrichtungs-Token (nur bis zur Ersteinrichtung, Modus 0600, nicht in Backups)
```

### Notfall ohne Weboberfläche

Startet die Anwendung gar nicht, liegen die Backups trotzdem im Volume. Von Hand: Container stoppen, aus
`/data/backups/<name>/database.db.gz` die Datenbank entpacken (`gunzip`) und als `/data/schrauberos.db` ablegen (alte
`schrauberos.db-wal`/`-shm` löschen), den Ordner `files/` des Backups nach `/data/files` kopieren, Container starten. Logs:
`docker compose logs app` (Starter, Launcher und Anwendung schreiben nach stdout).

### Weiteres

* **HTTPS/Reverse Proxy:** Hinter einem Proxy mit HTTPS erkennt die App das am Header `x-forwarded-proto` und setzt das
  Cookie-Flag „Secure“ selbst (Cookie dann `__Host-so_session`; erzwingen: `SESSION_COOKIE_SECURE=true|false`). Zusätzlich unter **Einstellungen →
  Sicherheit** „Hinter Reverse-Proxy“ einschalten, damit die Anmeldung die Client-Adresse auswertet (Proxy muss sie als letzten `X-Forwarded-For`-Eintrag anhängen). Erscheint beim Speichern „Invalid Server Actions
  request“, leitet der Proxy den öffentlichen Host nicht per `x-forwarded-host` weiter – dann die Domain in `next.config.ts` unter
  `experimental.serverActions.allowedOrigins` eintragen.
* **Sicherheits-Header:** `next.config.ts` setzt auf allen Antworten `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` und eine
  CSP, die vorerst nur `frame-ancestors 'self'` enthält (Test `src/next-config.test.ts`); die vollständige CSP folgt später.
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

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite) · eigene Sitzungs-Authentifizierung (scrypt,
serverseitige Sitzungen) · eigene schlanke i18n · Zod · react-markdown + remark-gfm · node-tar · esbuild. Design-Tokens in
`src/app/tokens.css`.
