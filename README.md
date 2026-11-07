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
| **Verwaltung** *(Plattform, nicht abschaltbar)* | Benutzer · Rollen & Rechte · Einstellungen · Module & Funktionen · Backups · Updates · Audit-Log · Systemstatus |

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
4. [Datenhaltung](#datenhaltung) · 5. [Container, Starter und Updates](#container-starter-und-updates) (mit [Starter-Vertrauensanker](#starter-vertrauensanker-p1b-6), Backups, [Job-Runner](#job-runner-srcserverjobs), [Uploads und Archive](#uploads-und-archive), [PDF-Erzeugung](#pdf-erzeugung-srcserverpdf-f-pdf), [E-Mail-Versand](#e-mail-versand-srcservermail-funktion-adminmail-f1), [Datenaustausch (CSV)](#datenaustausch-csv-export-und--import-p4a-2)) ·
6. [Installierbare App (PWA)](#installierbare-app-pwa-p3-5) · [Neue Funktion anlegen](#eine-neue-funktion-anlegen) · 7. [Konventionen](#konventionen) · 8. [Tests](#tests) ·
9. [Browser-CI](#browser-ci-playwright) · [Realgeräte-Checkliste](#realgeräte-checkliste-vor-jedem-release) · [Release und Signaturschlüssel](#release-und-signaturschlüssel) · 10. [Betrieb](#betrieb) · 11. [Grenzen](#bekannte-grenzen)

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
| `npm test` | Unit-, Architektur- und Katalog-Tests (`src/**/*.test.ts` und die reinen Logik-Tests der Browser-CI unter `e2e/support/*.test.ts`) |
| `npm run build` | Produktions-Build |
| `npm run db:baseline` | **bis zur Veröffentlichung:** aus `schema.prisma` die eine Baseline-Migration neu erzeugen (ersetzt alle Migrationsordner) |
| `npm run db:migrate -- <name>` | **ab der Veröffentlichung:** neue Migration anlegen, lokal anwenden, Client neu erzeugen |
| `npm run db:check` | Drift-Check: stimmt `schema.prisma` mit den Migrationen überein? (läuft auch in der Pipeline) |
| `npm run db:freeze` | **beim Veröffentlichen:** Baseline auf `frozen sha256:…` setzen und alle Migrationen mit Prüfsumme in `prisma/published-migrations.json` eintragen |
| `npm run db:release-check` | Pipeline bei einem Versions-Tag: alles eingefroren? Seit dem letzten eingefrorenen Release nur Neues hinzugekommen? |
| `npm run db:fresh` | lokale Datenbank löschen, neu anlegen und seeden |
| `npm run db:studio` | Datenbank im Browser ansehen |
| `npm run e2e` | Browser-Tests (Playwright) gegen die gebaute App – vorher `npm run build`; siehe [Browser-CI](#browser-ci-playwright) |

Vor jedem Abschluss: `npm run typecheck && npm run lint && npm test` – bei größeren Änderungen zusätzlich `npm run build`.

## Architektur

### Begriffe

| Begriff | Bedeutung | Beispiel |
| --- | --- | --- |
| **Plattform** | Immer an, kennt keine Fachlogik: Login, Rechte-Engine, Layout, Datenbank, i18n, UI-Kit, **Hilfe**, **Verwaltung** (Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit-Log, Systemstatus) | `src/server`, `src/components`, `src/i18n`, `src/lib`, `src/platform`, `src/modules/admin` |
| **Modul** | Fachlicher Bereich, als Ganzes ein-/ausschaltbar | Werkstatt, Büro, IT |
| **Funktion** | Abgegrenzter Teil eines Moduls mit eigenen Seiten, Rechten, Texten, Einstellungen; einzeln schaltbar | Termine, Reifenlager, Rechnungsarchiv |
| **Querschnittsfunktion** | Baustein, den mehrere Funktionen nutzen (`src/capabilities`) | Dokumentation (Markdown-Seiten mit Kapiteln und Rollen-Sichtbarkeit; genutzt von `handbook.manual` und `it.docs`) |
| **Adapter** | Anbindung an ein Fremdsystem (bisher keiner; geplant: Active Directory über `AuthProvider`) | `src/server/integrations/<system>` (bei Bedarf) |

Das Modul `admin` ist ein **Pflichtmodul** (`required: true`) und seine Funktionen sind ebenfalls Pflicht: Sie sind Plattform und
lassen sich nicht ausschalten (sonst sperrt man sich aus). Die Seite „Module & Funktionen“ zeigt nur die fachlichen Module.

### Aufbau des Codes

```text
src/
  modules/
    catalog.ts            Katalog aller Module und Funktionen (Quelle der Wahrheit)
    define.ts             Typen und defineModule()/defineFeature()
    features.ts           Aktivierung: Schalter lesen/schreiben (Datenbank)
    seed.ts               sammelt die Start- und Demo-Daten der Funktionen (`<funktion>/seed.ts`, `SeedDef`) ein; `src/server/seed` führt sie nur der Reihe nach aus
    registry.ts           sammelt Dashboard-Bausteine, Einstellungs-Reiter, Abschnitte für Seiten anderer Funktionen (`<funktion>/sections.tsx`, `sectionsFor`) und Suchanbieter (`<funktion>/search.ts`) der Funktionen ein; `quickActionsFor` (Neu-Menü) liest die `quickActions` der `feature.ts`
    jobs.ts               sammelt die geplanten Jobs und Outbox-Abnehmer der Funktionen (`<funktion>/jobs.ts`) ein
    api.ts                sammelt die API-Endpunkte der Funktionen (`<funktion>/api.ts`) ein; api-exceptions.ts: UI-Aktionen ohne API-Pendant
    default-roles.ts      mitgelieferte Rollen
    workshop/ office/ it/ admin/      je Modul: module.ts + ein Ordner je Funktion
      <funktion>/feature.ts (inkl. `auditActions`, `routes` auch unter `api/`), public.ts, operations.ts, actions.ts, api.ts, queries.ts (Lesezugriffe), seed.ts, domain.ts, forms.tsx, widgets.tsx, settings-tab.tsx …
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

* Gespeichert werden nur **Abweichungen** vom Standard (Tabelle `FeatureSetting`). Der Standard ist je Modul/Funktion `defaultEnabled`
  (`define.ts`, Vorgabe **true**): Der Bestand (Termine, Kunden, Fahrzeuge, Reifen, Rechnungsarchiv, Mitarbeiter, Handbuch) ist ohne Eintrag
  an; **neue Funktionen setzen `defaultEnabled: false`** und werden erst über die Seite „Module & Funktionen“ (später Presets bei der Einrichtung)
  eingeschaltet. Pflichtmodule/-funktionen sind immer an. Logik und Tests: `catalog-logic.ts` / `catalog-logic.test.ts`.
* **Wirksam** ist eine Funktion, wenn ihr Modul an ist, sie selbst an ist **und** alle harten Abhängigkeiten (`requires`) wirksam sind.
* Die Sitzung filtert die Rechte einer Person nach den **wirksamen** Funktionen. Ausgeschaltete Funktionen haben deshalb schlicht
  keine Rechte: `requirePermission()` liefert **404**, Navigation, Widgets und Einstellungs-Reiter erscheinen nicht, Server
  Actions und API-Routen scheitern an derselben Prüfung. **Daten bleiben beim Ausschalten erhalten.**

### Navigation, Schnellsuche und „Neu“

Der Anwendungsrahmen (`src/app/app-shell.tsx`, `src/components/shell/sidebar.tsx`) baut die Navigation aus dem Katalog: Modulgruppen mit Titel (auch bei einem Eintrag), Einträge eingerückt, **Übersicht** oben, **Hilfe** am Ende, Reihenfolge nach
`nav.order` (Verwaltung: Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit-Log, Systemstatus). Aktiv ist der **längste** passende Eintrag (`src/lib/nav-active.ts`); die aktive Gruppe ist nicht einklappbar. Eingeklappte Gruppen
merkt das Cookie `so_nav` (`src/lib/nav-state.ts`, vom Server mitgelesen, Einstellung ohne Geheimnis). Unter 1024 px liegt die Navigation im `Drawer` (natives modales `<dialog>`: Escape, Fokusfalle und -rückgabe, `dvh`, Safe-Area, schließt bei
Navigation und wenn das Fenster 1024 px erreicht), die Kopfzeile trägt Suche, „Neu“ und Konto; `viewport-fit=cover` macht die Safe-Area nutzbar. Die Symbole kommen **je Gruppe** (`nav-icons`) und werden auf dem Server zu Elementen.

**Schnellsuche** (`QuickSearch`, `/api/search`) und **„Neu“-Menü** (`NewMenu`) kennen keine Funktion: Die Funktionen liefern `searchProviders` (`<funktion>/search.ts`) und `quickActions` (`feature.ts`), `registry.ts` filtert nach Aktivierung und
Recht (wie Widgets) und aggregiert (`searchFor`, `quickActionsFor`; ein fehlerhafter oder langsamer Anbieter – Zeitlimit 3 s je Anbieter, `withTimeout` – nimmt die Treffer der anderen nicht mit). Die Route verlangt Sitzung und mindestens einen passenden Anbieter (sonst 403) und begrenzt auf 40 Anfragen je 10 s und Benutzer (`RateLimiter`, im Arbeitsspeicher; danach 429 mit `Retry-After`). Lange Textfelder (Inhalt der Dokumentation, Termin-Notizen) werden erst ab `FULLTEXT_MIN_LENGTH` (3) Zeichen durchsucht. Architektur- und Verhaltenstest:
`src/modules/search.test.ts` (Vertrag, Trennung, Rechte-/Aktivierungsfilter, Kapitelsichtbarkeit der Dokumentation).

### Formulare, Rückfragen und Meldungen (UI-Rahmen)

* **`Field`** erzeugt die Id (`useId`) und gibt sie über einen Kontext an `Input`/`Select`/`Textarea`/`SearchCombobox`/`FileInput` weiter (`aria-describedby` für Fehler und Hinweis – beide bleiben sichtbar –, `aria-invalid`, `aria-required`);
  `group` macht ein `fieldset` mit `legend` (Kontrollkästchen, Farbwahl). `name="…"` holt den Fehler des Feldes von selbst aus dem umgebenden `Form`.
* **`Form`/`FormCard`** führen die Server Action selbst aus (`useActionState`) und liefern: **Fehlerzusammenfassung** (`role="alert"`, Fokus, Einträge springen ins Feld), **Eingabe bleibt bei Fehlern** (React setzt Formulare nach jeder Aktion
  zurück; der Rahmen stellt die abgesendeten Werte nach dem Zurücksetzen wieder her – nie Passwort- und Dateifelder; was während der Aktion getippt wurde, bleibt), **Netzwerkfehler** als Zustand (offline oder ein `TypeError` mit der fetch-Meldung der Browser → „Keine Verbindung“,
  Eingabe bleibt; ein anderer `TypeError` ist ein Fehler im Code und scheitert sichtbar), **Entwurf** in `sessionStorage` (`draftKey`; nie Passwörter, Dateien, Felder mit `data-no-draft`; Schlüssel `so_draft:<Benutzer-ID>:<draftKey>` – die Benutzer-ID kommt über
  `DraftScope` aus `AppShell`, fremde Entwürfe werden beim Öffnen eines Formulars verworfen; gelöscht **erst nach erfolgreichem Speichern** (auch wenn das Formular dabei durch eine Weiterleitung verschwindet), bei „Verwerfen“ (auch das von `UrlModal`), beim Abmelden über `clearFormDrafts` und beim Öffnen der Anmeldeseite (`ClearDrafts`);
  stellt nur wieder her, wenn `version` **und** Fingerabdruck der Ausgangswerte (Vorbelegung aus der Adresse) passen), `warnOnLeave` (`beforeunload` und Rückfrage „Änderungen verwerfen?“ bei Klicks auf Links der Anwendung; die Zurück-Taste lässt sich nicht abfangen), Erfolgsmeldung als Toast und `noValidate` (die Prüfung macht der Server mit übersetzten Meldungen). **Wiederherstellung** (`src/components/ui/form-draft.ts`, getestet in `form-draft.test.ts`): läuft in Durchläufen je Mikroaufgabe, jeder Wert über den nativen Setter und ein `input`-Ereignis – so verarbeitet React ihn vollständig (auch von React **gesteuerte**, voneinander abhängige Felder wie Netto/MwSt./Brutto, nachrückende Felder wie das Reserverad); Bausteine mit eigenem Zustand
  (`SearchCombobox`) melden ihn über ein unsichtbares Feld `data-draft-state` und nehmen ihn über das Ereignis `so-draft-state` zurück. Eigene Formulare mit gesteuerten Feldern müssen nichts tun; Rückrufe sollten trotzdem aus dem aktuellen Zustand rechnen (`useReducer`/Funktionsupdate, Beispiel `invoices/amounts.ts`).
  Die Fehlertexte kommen aus `fieldErrors()` (`src/lib/field-errors.ts`: Zod-Fehler → Schlüssel `validation.*` mit Grenzen; eigene Schlüssel
  per `.regex(re, { error: "validation.vin" })` bzw. `ctx.addIssue({ code: "custom", message: "<Schlüssel>", params })`). **Formulare in Zeilen/Tabellen** ohne `Field`: `Input name="…"` zeigt den Fehler über `FormFieldError name="…"`.
* **`FormActions`** (sticky in der Dokumentfolge, nie `fixed`; auf Touch rückt sie bei geöffneter Tastatur in den Fluss; hebt den Toast über sich) mit Abbrechen, Hauptaktion und optional **„Speichern und weiter“** (`secondaryLabel`, sendet `_next=1`; ein unsichtbarer Standard-Absender steht davor, damit **Enter** die Hauptaktion auslöst;
  die Aktion entscheidet über `redirectNext` in `defineAction` – `redirect`, `redirectNext` und `message` bekommen als dritten Parameter die angemeldete Person: Beispiel Kunde anlegen → `/vehicles/new?customer=<id>` nur mit `vehicles.edit`, sonst die Kundenseite; `_next` kommt nie in die Eingabe der Operation). Die Leiste misst ihre Höhe (`ResizeObserver`) und hebt den Toast um sie (`--toast-lift`).
* **`ConfirmDialog`/`ConfirmSubmitButton`** ersetzen `window.confirm` (natives `<dialog>`, Titel = Aktion mit Fragezeichen, Bestätigung trägt die Aktionsbeschriftung, `typeToConfirm` für folgenreiche Aktionen wie die Backup-Wiederherstellung, `label` für
  Symbolknöpfe: unter `md` sichtbarer Text, am Desktop `sr-only` plus `title`; `target` benennt das Ziel in Listen – Name „Löschen: Meier, 3.–7. Mai“, Pflicht bei wiederholten Knöpfen; jedes Öffnen beginnt frisch, der Fokus geht beim Schließen an den Auslöser zurück, ein Klick auf den Hintergrund zählt nur, wenn das Drücken dort begann); `SubmitSwitch` ist der Ein-/Aus-Schalter mit Rückfrage beim Ausschalten (Module & Funktionen). `UrlModal` fragt bei ungespeicherten Eingaben „Änderungen verwerfen?“ (löscht mit „Verwerfen“ die Entwürfe seiner Formulare, gibt den Fokus an den Auslöser zurück).
* **Einzelne Knöpfe** (Schnellstatus in Karten, Listen und Übersicht, Umbuchen) sind keine Formulare mit Feldern: `useInlineAction(action)` (`src/components/ui/inline-action.ts`) liefert `[state, dispatch, pending]` für `<form action={dispatch}>` mit
  versteckten Feldern und Absende-Knöpfen (`name`/`value` des Knopfes gelten) und bringt mit, was `Form` tut: Netzwerkfehler als Meldung statt Fehlerseite, Erfolg und Fehler als Toast (jede Antwort einmal), Wartezustand. Zusatzfelder der Antwort kommen aus `state` der Aktion.
* **Listen und Seitenkopf:** `FilterBar` trägt mit `keep={sortFields(list, DEFAULT)}` die gewählte Sortierung durch das Filtern (`action`/`submitLabel` für Suchen auf Unterseiten); `ScrollArea`/`Table` machen den Scroll-Rahmen **nur bei Überlauf** zur Region mit Tab-Stopp; `PageHeader help="…"` zeigt den Hilfe-Knopf nur, wenn `helpTopicVisible` (`src/modules/help.ts`) für die Anmeldung stimmt;
  `SegmentedControl` ist eine Optionsgruppe mit Roving-Tabindex und Pfeiltasten. Der Zeilenlink der `DataTable` (`after:absolute` an der Hauptzelle, Bezug `tr.relative`) ist in Chromium und WebKit (Playwright) geprüft: Klick in jede Zeile trifft ihr Ziel. `globals.css`: `scroll-padding` (Kopfzeile, Aktionsleiste), `scrollbar-gutter: stable`, `.btn` bricht unter 640 px um.
* **`Menu`** ist ein Popover im Offenlegungsmuster (kein `role="menu"`; Escape gibt den Fokus an den Knopf zurück); **`SearchCombobox`** ist die Combobox mit `aria-activedescendant`, Option-Ids, Trefferansage, Ladefehler und „neu anlegen“ bei keinem Treffer
  (`VehiclePicker` der Fahrzeuge baut darauf auf).

### Bausteine für Aufträge, Rechnungen, Zeiterfassung und Berichte (F0)

Alle in `src/components/ui`, Texte unter `ui.*` (`src/i18n/messages/modules/ui.de.ts`/`.en.ts`), je mit Komponententest im echten Renderer (`<baustein>.test.ts`). Die Rechen- und Logikkerne liegen in `src/lib` und sind ohne DOM getestet;
Hilfsfunktionen der Tests in `src/test/ui.ts` (`mountI18n`, `type`, `click`). Regel 5 des Plans gilt: Touch-Tokens, DE/EN, `ui-kit.test.ts`-konform; **ab dieser Stufe keine neue Allowlist-Einträge**.

| Baustein | Logik | Zweck und wichtige Entscheidungen |
| --- | --- | --- |
| `MoneyInput` | `lib/money.ts` | Textfeld mit `inputMode="decimal"`, liest mit `parseMoneyToCents` (wie der Server), schreibt nach dem Verlassen in der Schreibweise der Oberfläche; Unlesbares bleibt stehen und ist ungültig markiert. Gesteuert (`value`/`onValueChange`) oder ungesteuert (`defaultValue` in Cent). |
| `LineItemEditor` | `lib/line-items.ts` | Positionen (Beschreibung, Menge, Einheit, Netto-Einzelpreis, Steuersatz, Rabatt) mit Summenblock. **Rechenregel (eine für Browser und Server):** alle Preise netto in ganzen Cent, Menge in Tausendsteln, Sätze in Basispunkten; Position = Menge × Preis (kaufmännisch gerundet, exakt mit `BigInt`) − Rabatt; **Steuer je Satz auf der Summe gerundet**; `exempt` = Kleinunternehmer § 19 UStG (keine Steuer). **Überlaufschutz:** jeder Betrag (Position vor Rabatt, Summen, Steuer, Brutto) bleibt unter `MAX_MONEY_CENTS` (`lib/money.ts`, 21.474.836,47 € = Grenze der `Int`-Spalten); `lineItemsInput` meldet `validation.tooLarge` an der Position bzw. an der Liste, der Editor markiert Menge/Preis der Zeile bzw. zeigt „Gesamtbetrag zu groß“, `Totals.exceedsLimit` sagt es dem Aufrufer (F3 prüft vor dem Speichern); `moneyCents` (Formulare, Rechnungen) hat dieselbe Grenze. Absendefeld `name` (versteckt) = JSON mit Zahlen (`serializeSubmit`), der Server liest es mit `lineItemsInput()` und rechnet mit `computeTotals` **neu** – Summen aus dem Browser werden nie geglaubt. Zustand per `useReducer` (jede Änderung rechnet aus dem aktuellen Zustand; Entwurf über `data-draft-state`, Zeilen werden wiederhergestellt). Layout nach Breite des Editors (Container-Abfrage): Karte je Position, bei viel Platz eine Tabellenzeile; unter `md` klebt eine Summenleiste über der Aktionsleiste (`--toast-lift`). Eingabe springt zum nächsten Feld. Fehler des Servers (`items.2.unitCents`) erscheinen an Zeile und Feld (`mapLineItemErrors`). Bruttopreise gibt es bewusst nicht (EN 16931 rechnet netto). |
| `Timeline`, `Stepper` | – | Verlauf (was geschah, mit Zeit) und Stufenanzeige (wo steht der Auftrag); Zustand auch als Text, `aria-current="step"`. |
| `ChecklistItem` | – | Punkt mit Zeile ≥ 44 px, speichert einzeln (`onSave`), bei Fehler bleibt der Haken sichtbar „Nicht gespeichert“ mit „Erneut versuchen“. |
| `StampButton` | `newIdempotencyKey` | Großer Stempel-Knopf: synchron gegen Doppeltippen gesperrt, Cooldown nach Erfolg, **derselbe `Idempotency-Key` bei Wiederholung nach einem Fehler**, neuer nach Erfolg (`onStamp(key)` reicht ihn als Kopfzeile an die API weiter). **Pflicht `actionId`** (was gebucht wird, bei Aufträgen samt Auftrag, z. B. `order-start:<id>`): Der Schlüssel ist an die Aktion gebunden und wird bei anderer `actionId` verworfen – sonst würde der Server nach einem Wechsel „Kommen“ → „Gehen“ die gespeicherte Antwort der ersten Buchung liefern. |
| `SecretField` | `copy.ts` | Verborgen/Anzeigen/Kopieren; **Klartext nur im Zustand** (verborgen steht ein fester Platzhalter im Feld), `data-no-draft`, kein `name`; `once` = einmalige Anzeige mit Hinweis, „Ausblenden“ und Frist (`onDismiss`: der Aufrufer löscht seine Kopie). Kopieren mit Rückfall ohne HTTPS (`execCommand`). |
| `CodeBlock` | `copy.ts` | Text unverändert (nie als HTML) mit „Kopieren“, waagerecht scrollbar und per Tastatur erreichbar; Beispiele zeigen Platzhalter, nie Geheimnisse. |
| `Chart` | `lib/chart.ts` | Balken und Linien als Inline-SVG mit den Tokens `--chart-1…6` (Hell/Dunkel in den Tokens), Werte am Balken ohne Hover (bis 12 Balken), Marken-Formen je Linienreihe, Legende, **Tabellen-Alternative** („Als Tabelle“), leerer Zustand. Teilung der Achsen mit „runden“ Schritten. Keine Bibliothek. |
| `DateRange` | `lib/date-range.ts` | Von/Bis (Datumsfelder des Geräts, `min`/`max` begrenzen sich gegenseitig), Schnellauswahl (heute … dieses Jahr) aus dem vom Server gelieferten „heute“ (`todayInput()`, Zone der Werkstatt), Meldungen bei vertauschtem, unvollständigem oder zu langem Zeitraum. |
| `PrintLayout`, `PrintButton`, `PrintPageBreak`, `PrintKeep` | `globals.css` | `.no-print`, benannte A4-Seite (`@page a4`, 15 mm), Umbruch, Zusammenhalten, im Druck immer hell. Etiketten brauchen eine eigene benannte Seite (F8). |
| `Signature` | `lib/signature.ts` | Zeichenfeld mit **Pointer Events** und `touch-action: none` (kein Scrollen beim Unterschreiben), Fensterkoordinaten → feste Fläche 600 × 200, Rückgängig/Löschen, ein Antippen zählt nicht als Unterschrift. Die Zeichenfläche steckt hinter `SignatureSurface` (Canvas im Browser, Attrappe im Test); Export als PNG **mit Größengrenze** (48 KB; zu groß → in kleinerem Maßstab neu gezeichnet, sonst „zu groß“). **Barrierefreie Alternative:** „Namen tippen“ + Bestätigung. Ergebnis im versteckten Feld: PNG-Data-URL oder `typed:<Name>`; **der Server liest es mit `parseSignatureValue`** (Größe, `checkUpload`, Struktur und Maße über `lib/png.ts` `inspectPng`: IHDR, Teilekette mit CRC bis IEND, keine Anhängsel, höchstens 2400 × 800 Punkte – Magic Bytes allein genügen nicht) und legt die PNG-Bytes als Datei ab (`files.ts`), nie die Data-URL in die Datenbank. Nie im Entwurf. |
| `PhotoGallery` | `lib/upload-queue.ts` | Mehrfach-Upload auf Basis von `FileInput variant="photo"` (verkleinert vor dem Hochladen, Kamera bei Touch): Warteschlange (zwei gleichzeitig), Fortschritt je Foto, Wiederholen/Abbrechen/Entfernen je Foto, `xhrUploader` (XMLHttpRequest wegen des Fortschritts, mit `X-Requested-With`), Fehlercodes statt Servertexte. **`FileInput` mit `multiple`** sortiert Einzelnes (HEIC, zu groß) aus, statt die ganze Auswahl abzulehnen. **Keine Dubletten:** jede Datei trägt einen Idempotenzschlüssel (gleich bei jedem Wiederholen), `xhrUploader` sendet ihn als `Idempotency-Key` – **die Upload-Route muss eine Datei mit bekanntem Schlüssel wie beim ersten Mal beantworten, statt sie noch einmal abzulegen** (Pflicht für die Foto-Routen in F2/F7; ging die Antwort verloren, weiß nur der Server, ob das Foto angekommen ist); dieselbe Datei (Name, Größe, Änderungszeit) wird nicht zweimal eingereiht; fertige Uploads zählen für `maxFiles` nicht mit (sie stehen nach `onUploaded` → `router.refresh()` schon in `photos`). |
| `PdfPreview` | – | siehe „PDF-Erzeugung“. |

Offen für die Browser-CI (kommt mit den ersten Seiten, die die Bausteine nutzen, F2/F7): Unterschreiben, Positionen-Editor und Foto-Galerie auf iPhone/WebKit 390 × 844 und Tablet; die Komponententests ersetzen das nicht (kein echtes Canvas, kein Touch).

### Aufträge und Lager (F2/F4)

Zwei neue Funktionen, beide `defaultEnabled: false` (Preset „Mit Aufträgen und Lager“, sonst unter „Module & Funktionen“): **`workshop.orders`** (Werkstattaufträge/Arbeitskarten) und **`workshop.parts`** (Teile & Lager).
`orders` ist der Kern und kennt weder Lager noch Zeiten noch Rechnungen; die hängen sich an. Kommunikation nur über `public.ts`, Hooks und Erweiterungspunkte.

* **Kette:** Termin → Auftrag (Knopf „Auftrag aus Termin“ im Termin, Auftrag legt Fahrzeug/Anliegen vor) → später Rechnung (F3). Status (`constants.ts`, API-Vertrag): `accepted` → `in_progress` → `ready` → `picked_up` (+ `cancelled`).
  Schritte (`domain.ts`, `STATUS_STEPS`): vor, einen zurück, stornieren, ein stornierter lässt sich wieder aufnehmen. **`picked_up` entsteht nur durch `orders.close`**, verlassen wird es nur durch `orders.reopen`; Aufträge werden nie gelöscht
  (Fahrzeug/Kunde `Restrict`). Jeder Wechsel steht in `OrderEvent` (Verlauf mit `Timeline`); `Stepper` zeigt den Stand. Der Kunde kommt aus dem Halter des Fahrzeugs (ohne Halter: Auftrag ohne Kunde, `customerDisplayName`/Null-Prüfung); ein archivierter Halter hindert die Annahme nicht (maßgeblich ist, dass das Fahrzeug nicht archiviert ist; nur ein direkt gewählter Kunde muss aktiv sein);
  archivierte Fahrzeuge und Kunden mit eingeschränkter Verarbeitung (Art. 18) nehmen keinen neuen Auftrag an (`createOrderRun`); bestehende Aufträge bleiben in der **Oberfläche** bearbeitbar (wie bei Termin, Halterwechsel, Rechnung: „neue Verknüpfungen gesperrt, bestehende bleiben“), für die **API** sind sie überall 404.
  Ein Termin lässt sich nur mit `appointments.view` verknüpfen (weiche Abhängigkeit, `principal.can`); die Wiederaufnahme eines stornierten Auftrags prüft, dass der Termin nicht inzwischen einen anderen aktiven Auftrag hat. Fahrzeug und Kunde mit Aufträgen sind nicht löschbar (`vehicleDeletable`/`customerHasLinks` zählen `orders`, `ArchivePanel`).
  **Andere Funktionen legen Aufträge an** über `public.ts`: `createOrderOperation` (eigene Transaktion) oder `createOrderInTx({ principal, tx, emit }, input)` **in der Transaktion des Aufrufers** (Angebot → Auftrag, F3: beides oder nichts; prüft `orders.create`, schreibt Audit `orders.create`, lässt die Hooks laufen, rollt mit dem Aufrufer zurück).
* **Nummer = Zählertabelle:** `Counter { key, year }` + `nextCounterValue(tx, key, year)` (`src/server/counters.ts`): ein atomarer `upsert … increment` **in der Transaktion, die die Nummer verbraucht** – scheitert sie, rollt der Zähler mit zurück (lückenlos,
  gleichzeitig getestet). Auftragsnummer `A-JJJJ-NNNN` (Jahr in der Werkstatt-Zone; festes Muster, das Muster des Werkstattprofils gilt den Rechnungen). F3 nimmt dieselbe Tabelle mit einem eigenen Schlüssel.
* **Kilometerstand bei Annahme** (`mileageDecision`): höher als im Fahrzeug (oder dort leer) → wird **in derselben Transaktion** ins Fahrzeug geschrieben; niedriger → Fahrzeug bleibt, Hinweis statt Fehler (`orders.notices.mileageKept`).
* **Positionen** (`OrderItem`): Art (`labor|part|other`), Menge in Tausendsteln, Netto-Einzelpreis in Cent, Steuersatz/Rabatt in Basispunkten, optional `refType`/`refId` (Verweis einer anderen Funktion; der Auftrag deutet ihn nicht). `orders.saveItems` ersetzt alle Positionen
  (Formular wie API: `lineItemsInput()` → Server). **Preise** (Einzelpreis, Steuersatz, Rabatt, Summen, Beträge der Freigaben) liest und schreibt nur, wer `orders.prices` hat (`queries.ts`: die Spalten werden ohne das Recht nicht aus der Datenbank gelesen, am SQL getestet);
  Mechaniker haben es standardmäßig nicht und sehen Positionen ohne Preise. Der `LineItemEditor` bekam dafür **optionale** Zusätze: `kinds` (Auswahl „Art“ je Position, Absendefeld `kind`), `refType`/`refId` je Zeile und das Fensterereignis
  `LINE_ITEM_ADD_EVENT` (`lib/line-items.ts`), mit dem eine andere Funktion eine Position einfügt, ohne dass der Editor sie kennt. Ohne diese Zusätze bleibt das Absendefeld unverändert.
* **Kundenfreigabe bei Mehrarbeit** (`OrderApproval`, unveränderlich: nur anlegen, es gibt keine Änderungs-/Löschoperation): Betrag (brutto, Cent), Begründung, freigebende Person, Art (`signature` = gezeichnet, `typed` = getippter Name mit Bestätigung, `phone`), erfassende Person;
  Unterschrift als PNG-Datei unter `/data/files/auftraege/freigaben` (`parseSignatureValue` prüft Struktur, `storeFile` in `prepare`, Datei wird in `finish` entfernt, wenn die Transaktion scheitert), ausgeliefert nur über `/api/orders/approvals/[id]/signature` (Route in `ROUTE_OWNED_PATHS`,
  Recht `orders.view` + `orders.prices`). Über die API nur telefonisch/getippt. **Eine Unterschrift gilt für genau eine Freigabe:** `signatureHash` (SHA-256 des Bildes) – dasselbe Bild nochmals ist `orders.errors.signatureReused`; das Formular hängt die Unterschrift nach dem Erfolg neu ein
  (`ResettingSignature`, bei Fehler bleibt sie). **Getippt:** Der Name im Unterschrift-Feld muss normalisiert (NFKC, Leerraum, Groß/Klein: `sameName`) dem `approverName` entsprechen (`approvalNameMismatch`), er steht in `signedName`. Das Audit nennt nur die Auftragsnummer; die Anonymisierung leert `approverName` und `signedName`
  (`reason` und Positionsbeschreibungen bleiben als Beleg, Fristen für Aufträge: Entscheid 7 offen).
* **Abschluss atomar – Hooks:** `orders.close`, `orders.reopen` und `orders.setStatus` liefern als **Ergebnis** einen `OrderChange` (Nummer, Status, Termin, Positionen **ohne Preise**); Abonnenten (`hooks.ts` ihrer Funktion, `operation-hooks.ts`) laufen **in derselben Transaktion** und lesen nur dieses Ergebnis, keine Tabelle des Auftrags.
  Wirft einer, bleibt der Auftrag offen, nichts ist gebucht (Test: `orders.test.ts`, `parts.test.ts`). Aktuelle Abonnenten: **Termine** (Terminstatus folgt: In Arbeit → Termin „In Arbeit“, Abschluss → „Erledigt“, Wiederöffnen → wieder „In Arbeit“, Stornieren sagt den Termin nie ab; `appointments/order-sync.ts`),
  **Teile & Lager** (`parts/hooks.ts`, maßgeblich ist die **Bilanz der Bewegungen dieses Auftrags** je Artikel, `domain.ts`: `orders.close` bucht Verbrauch minus Bilanz – normal der Verbrauch, nach einem Wiederöffnen ohne Rückbuchung nur den Unterschied –, `orders.reopen` und das Stornieren bringen die Bilanz in **beide** Richtungen auf 0
  (auch negative Mengen/Gutschriften), nie doppelt, unabhängig davon, ob die Funktion zwischendurch aus war; `orders.saveItems` prüft Artikelverweise) und die Anonymisierung (`customers.anonymize`). Bestandsbewegungen lassen `Article.updatedAt` (die Version der Stammdaten) stehen (`bookMovement`); die API nimmt den Bestand deshalb in den ETag zum Lesen auf (`etagExtra`), `If-Match` zählt nur die Version.
  F5 (Zeiten als Positionen) und F3 (Rechnung) hängen sich genauso an. **Hooks importieren zur Laufzeit nichts, was `@/server/operations` lädt** (die Hooks werden vom Rahmen geladen → Importzirkel): `bookMovement` liegt deshalb in `parts/stock.ts`, Fehler kommen aus `@/server/operations/errors`.
  Bewusst nicht über Hooks: das Audit (steht beim Auftrag), Ereignisse (`order.created|status|closed|reopened|approved` in der Outbox, ohne Preise).
* **Wieder öffnen** (`orders.reopen`, gekennzeichnet `sensitive`, in keiner Standardrolle, **nie API**): setzt auf `ready`, Audit, die Abonnenten buchen zurück. Nur so ändert sich ein abgeschlossener Auftrag. Eine Stornorechnung bucht den Bestand nicht zurück (Hilfe sagt das).
* **Erweiterungspunkte der Registry** (`SectionDef`, `sections.tsx` der Funktion → `registry.ts`, `sectionsFor(session, host)`, gerendert von `PageSections` in je eigener Fehlergrenze): `orders/detail` (Karte auf der Auftragsseite: Teile & Lager „Verbrauchte Teile“), `orders/items` (Werkzeug über dem Editor: „Artikel einfügen“),
  `appointments/detail` (Aufträge: „Auftrag aus Termin“). Der Gastgeber kennt seine Gäste nicht; Funktion aktiv + Recht + weiche Abhängigkeiten werden geprüft. Neue Hosts: in `SectionHost` eintragen.
* **Teile & Lager:** `Article` (Nummer normalisiert/eindeutig, Bestand und Mindestbestand in Tausendsteln, `archivedAt`), `StockMovement` (unveränderlich: `receipt|order|correction|reversal`, mit Stand danach, Auftrag ohne Fremdschlüssel, Lieferschein/Rechnungsnummer als Text). **Der Bestand ändert sich nur über `bookMovement`**
  (atomarer Zuwachs). Negativer Bestand ist erlaubt (Warnung in Artikelliste/-seite, Übersicht, Auftrag), nie ein harter Fehler. Inventur = Differenz zum Stand **in der Transaktion** als Korrektur. Preise nur mit `parts.prices` (nicht gekennzeichnet: Standardrollen Geschäftsführung, Serviceberater, Lager haben es, Mechaniker nicht);
  Preise im Artikelformular nur mit dem Recht, `pricesShown` unterscheidet „leer = löschen“ von „Feld gab es nicht“. Kundenreifen sind keine Handelsware und haben keine Verbindung.
* **Rechte:** `orders.view|create|edit|close|reopen*|prices`, `parts.view|edit|stock|prices` (* gekennzeichnet). Standardrollen in `default-roles.ts`. Export/Import (CSV) für Artikel gibt es noch nicht.
* **API:** `/orders` (ohne Preise; `status`, `close`, `items` – ersetzen, `orders.prices` –, `findings`), `/order-items` und `/order-approvals` (`orders.prices`; Freigaben nur lesen/anlegen), `/articles` (ohne Preise; Preise im Körper nur mit `parts.prices`), `/article-prices`, `/stock-movements` (lesen; anlegen = Wareneingang).
  `POST /orders/{id}/items` hat **dieselbe Form wie `GET /order-items`** (Lesen → ändern → zurückschicken erhält `refType`/`refId`, die Nur-Lese-Felder `id`/`orderId`/`position` werden ignoriert): Ohne den Verweis bucht der Abschluss nichts ab.
  Nicht über die API (`api-exceptions.ts`): `orders.reopen`, `orders.removeFinding`, `parts.count`. Aufträge eingeschränkter Kunden sind 404 – auch für das Anlegen einer Freigabe (`create.parentVisible` in `defineResource`: Vorbedingung vor dem Anlegen, wenn das Elternobjekt im Körper steht). Die Matrix-Tests schalten Funktionen mit `defaultEnabled: false` selbst ein (`enableDefaultOff`).
* **Tests:** `orders/orders.test.ts`, `orders/api.test.ts`, `orders/pages.test.ts` (Seiten wirklich gerendert über `src/test/server-tree.ts`: löst async Server-Komponenten auf), `orders/forms.test.ts`, `orders/domain.test.ts`, `parts/parts.test.ts`, `parts/api.test.ts`, `parts/pages.test.ts`, `parts/stock-forms.test.ts`, `parts/domain.test.ts`, `server/counters.test.ts`.
  Die Inventur-Seite zeigt höchstens 500 Artikel je Seite (`?from=<letzte Nummer>`), die Liste ist unter `md` gestapelt (Name volle Zeile).

### Zeiterfassung (F5, `office.time`)

Neue Funktion, `defaultEnabled: false` (Preset „Werkstattalltag“). `requires: office.employees` (wer stempelt, steht über `Employee.userId` fest; Arbeitstage und Abwesenheit liefert `employees/public.ts`: `employeeForUser`, `staffSchedules` – Abwesenheit nur als Tage, nie Art/Anmerkung), `uses: workshop.orders` (weich: Abschnitt „Zeiten“, Stempeln auf Aufträge, Übernahme als Positionen).

* **Daten:** `TimeEntry` (Beginn/Ende als Zeitpunkte, `breakMinutes`, Tätigkeit, Notiz, `source` = `stamp|manual`, `voidedAt`, `transferredAt/transferredItemId`), `TimeCorrection` (Stand **vor** der Änderung samt Begründung, nie geändert), `TimeSettings` (Sollzeit je Arbeitstag, Standard 480 min). Mitarbeiter und Aufträge sind `Restrict`: ein **Mitarbeiter mit Zeiteinträgen ist nicht löschbar** (`inUse`), Zeiten werden nie gelöscht, nur storniert.
* **Atomar ein laufender Eintrag je Mitarbeiter:** `TimeEntry.runningKey` (= Mitarbeiter-ID, solange der Eintrag läuft, danach `null`) ist `@unique` – zwei gleichzeitige Starts: einer scheitert an `P2002` (→ `duplicate`). Kein Teil-Unique-Index nötig (Prisma kennt keinen).
* **Idempotenz der Buchung:** `startKey`/`stopKey` (unique) tragen den Schlüssel des Stempel-Knopfes (`StampButton actionId`) bzw. den `Idempotency-Key` der API; derselbe Schlüssel liefert denselben Eintrag, ein Schlüssel einer anderen Person ist `invalid`. Die Oberfläche ruft `startTime`/`stopTime` direkt aus der Client-Komponente (`stamp-panel.tsx`) und wirft bei jeder Fehlerantwort, damit der Knopf den Schlüssel für die Wiederholung behält.
* **Rechnen** (`domain.ts`, rein, getestet in der Werkstatt-Zone): Dauer, Aufteilung an Mitternacht, Pausen (erfasste + Lücken), Hinweise (`HINT_RULES` in `constants.ts`: >6 h ohne 30 min, >9 h ohne 45 min, >10 h/Tag, <11 h Ruhezeit, >16 h laufend), Woche Ist/Soll/Saldo (Soll = `TimeSettings.dailyTargetMinutes` an Arbeitstagen, 0 an Feiertagen/bei Abwesenheit). **Hinweise, keine Sperren, keine Rechtsberatung** (Hilfe sagt es).
* **Korrektur nur mit Begründung:** `time.correct` (ändern; auch ein vergessener laufender Eintrag lässt sich so beenden), `time.void`, `time.addManual` – Pflicht-Begründung (≥ 5 Zeichen), Verlauf in `TimeCorrection`, Audit, `claimRow` auf die Version, keine Überschneidung, nichts in der Zukunft. Übernommene (`transferredAt`) und stornierte Einträge sind gesperrt. Eigene Zeiten mit `time.correct`, fremde zusätzlich mit `time.correctAll`.
* **Wer sieht was:** `time.view` = nur eigene Zeiten (fremde Zeilen werden gar nicht gelesen), `time.viewAll`/`time.correctAll` sind `sensitive` und in keiner Standardrolle (Regel 9). Die Auftragssumme im Abschnitt zählt alle Mitarbeiter (nur Zahlen), die Zeilen nur die sichtbaren.
* **Zeiten als Positionen übernehmen** (`time.transfer`, Recht `time.view` + in `prepare`/`run` `orders.edit` **und** `orders.prices`): markiert die Einträge zuerst mit einem bedingten Update (die Sperre gegen Doppelübernahme, auch gleichzeitig), hängt dann über `appendOrderItems` (`orders/public.ts`, in der Transaktion des Aufrufers, hebt die Auftragsversion) je Eintrag eine Arbeitsposition an (`refType: "time"`, `refId` = Eintrag; Stunden zum Stundensatz oder Arbeitswerte zum Satz je AW aus `getWorkshop()`). Ohne Stundensatz im Profil `invalid`. Die Positionen nennen nie den Mitarbeiter. Kein Abschluss-Hook: Die Übernahme ist eine bewusste Handlung (Preise) und läuft nicht automatisch beim Abschluss.
* **Oberfläche:** `/time` (Stempeln, heute, Woche, Hinweise), `/time/entries` (+ `/new`, `/[id]` mit Korrekturformular und Verlauf), `/time/team` (`time.viewAll`); Baustein „Stempeln“ (Priorität 11) auf der Übersicht; Abschnitt am Auftrag (`orders/detail`); Einstellungsreiter „Zeiterfassung“ (`settings.manage`).
* **API:** `/time-entries` (lesen: eigene, mit `time.viewAll` alle; `POST /time-entries/start`, `/stop`, `POST /time-entries` = Nachtrag); der `Idempotency-Key` geht zusätzlich als Buchungsschlüssel an die Operation. Korrigieren/Stornieren/Übernehmen stehen in `api-exceptions.ts`. Ein Token ohne Mitarbeiterprofil bekommt 422 (`time.errors.noEmployee`), nicht 403.
* **Tests:** `time/time.test.ts` (Operationen, Rennen, Idempotenz, Rechte, Übernahme), `time/api.test.ts`, `time/pages.test.ts` (Seiten, Stempel-Knopf mit echter Aktion, Abschnitt), `time/domain.test.ts`.

### Dokumente & Fotos (F6, `workshop.files`)

Neue Funktion, `defaultEnabled: false` (Preset „Werkstattalltag“). `requires: workshop.vehicles`, `uses: workshop.orders, workshop.customers` (Art. 18 über `customers/public.ts` `unrestrictedCustomerWhere`). Rechte `files.view|upload|delete`.

* **Modell:** `FileAttachment` mit **zwei Fremdschlüsseln** `vehicleId`/`orderId` (genau einer, von der Operation erzwungen), beide `Restrict` (kein stilles Cascade auf Historie; ein Fahrzeug mit Dateien ist nicht löschbar, nur archivierbar – `vehicleDeletable(files)`, `ArchivePanel` nennt sie). Entfernt wird per `archivedAt`, die Datei unter `/data/files` wird nie verändert oder gelöscht (Backups per Hardlink). Pfade lesbar: `fahrzeuge/<KENNZEICHEN>/foto-<Zeit>.jpg`, `auftraege/A-2026-0001/…`; der hochgeladene Name steht nur in `name` (Anzeige/Download), nie im Pfad.
* **Rechte je Entität** (`access.ts`, **eine** Stelle für Seiten, Auslieferung, API und Operationen): Fahrzeug-Dateien `files.view` + `vehicles.view`, Auftrags-Dateien `files.view` + `orders.view` (jeweils Funktion aktiv); Fahrzeuge/Aufträge von Kunden mit eingeschränkter Verarbeitung (Art. 18) und entfernte Dateien gibt es nicht (404, kein Existenzhinweis); neu anhängen geht nicht an archivierten Fahrzeugen, nicht an eingeschränkten Kunden und nur an **offenen** Aufträgen (abgeschlossene ändern sich nur über „Wieder öffnen“). Entfernen: Leitung (`files.delete`) oder die hochladende Person (mit `files.upload`); `files.update`/`files.archive` haben `files.view` als Operationsrecht und entscheiden in `run`.
* **Upload** (`files.upload`, **eine** Operation für Oberfläche `POST /api/files` und API `POST /api/v1/files`): Inhalt statt gemeldetem Typ (`checkUpload`; erlaubt JPEG, PNG, PDF – HEIC/SVG/GIF/WebP werden **nicht** angenommen), Größe ≤ **10 MB** (bewusst unter `proxyClientMaxBodySize` 13 MB: der Proxy kappt größere Bodies stumm), **Bildpunkte aus dem Dateikopf** vor jedem Dekodieren (`lib/image-sanitize.ts`: ≤ 50 Megapixel, ≤ 20 000 px je Kante → `files.errors.pixels`), **Exif/GPS, XMP, IPTC, MPF, Kommentare, Vorschaubild im JFIF und alles hinter EOI werden serverseitig entfernt** (JPEG: Segmentarbeit; PNG: tEXt/zTXt/iTXt/eXIf/tIME/APNG-Teile), das Bild wird **nicht neu kodiert**; die **Ausrichtung bleibt** als minimaler Exif-Block (JPEG APP1 / PNG eXIf). PDFs werden unverändert abgelegt (ihre Dokumenteigenschaften bleiben – in der Hilfe genannt). Die Datei entsteht in `prepare`, `finish` entfernt sie bei Rollback; die Route verlangt `Content-Length` (411/413), `isSameOriginUpload` und `X-Requested-With`.
* **`Idempotency-Key` serverseitig:** `uploadKey` + `uploadedById` sind eindeutig; derselbe Schlüssel liefert den vorhandenen Eintrag (Route: 200 `replayed: true`, API: gespeicherte Antwort), legt keine zweite Datei ab (`prepare` prüft vor dem Speichern, ein gleichzeitiger Zweiter scheitert an `P2002` und räumt seine Datei in `afterCommit` weg); derselbe Schlüssel mit anderem Inhalt (SHA-256 des Originals) → `files.errors.keyReuse`. Die Galerie (`PhotoGallery` → `xhrUploader`) sendet den Schlüssel je Datei bei jedem Versuch.
* **Auslieferung** nur über `GET /api/files/[id]` (Sitzung, Rechte, Route in `ROUTE_OWNED_PATHS`, `deliveryHeaders`: `nosniff`, `sandbox`-CSP, `Content-Disposition`; `?download=1` erzwingt Download; Vorschaubilder = dieselbe Route, der Browser hat die Fotos vor dem Hochladen auf 1600 px verkleinert).
* **API** (`files/api.ts`): `GET /files`, `/files/{id}`, **`/files/{id}/content`** (Binärantwort: neue Endpunkt-Art `download` im Router, `ApiResult.file` als Datenstrom mit den Schutz-Kopfzeilen), **`POST /files` als `multipart/form-data`** (neue Endpunkt-Art `upload`: der Router liest den Körper **begrenzt** – Content-Length vorab, Datenstrom beim Lesen –, zerlegt das Formular, validiert die Textfelder strikt und bildet den Idempotenz-Fingerabdruck aus Feldern und SHA-256 der Datei, nicht aus der zufälligen Formulargrenze), `PATCH` (Beschriftung/Art, `If-Match`), `DELETE` (= Archivieren). OpenAPI beschreibt Multipart und Binärantwort; `matrix.test.ts` sendet an Upload-Endpunkte ein leeres Formular.
* **Oberfläche:** Abschnitt „Dokumente & Fotos“ am Auftrag (`orders/detail`) und am Fahrzeug – dafür gibt es den neuen Gastgeber **`vehicles/detail`** (`SectionHost`, `PageSections` in der Fahrzeugseite) –, Übersicht `/files` (Suche, Filter); `PhotoGallery` bekam abwärtskompatibel `accept`, `acceptFile`, `variant`, `addLabel`, `hideEmpty`, `readOnly` (PDF-Upload auf demselben Weg, Ansicht ohne Upload).
* **Datenschutz:** Auskunft listet die Dateien an den Fahrzeugen/Aufträgen des Kunden (Liste, nicht Inhalt); Hook `customers.anonymize` leert Beschriftungen und Dateinamen, **die Dateien bleiben** (Hilfe sagt es). Die Reihenfolge der Hooks hält `files` vor `vehicles` (der Halter wird dort gelöst).
* **Tests:** `files/files.test.ts` (Rechte, Art. 18, Prüfungen, Bereinigung an den gespeicherten Bytes, Idempotenz auch gleichzeitig, Rollback-Aufräumen, Entfernen, Routen), `files/api.test.ts` (Multipart, Binärantwort, Begrenzung des Datenstroms), `files/pages.test.ts`, `lib/image-sanitize.test.ts` (Testbilder in `src/test/images.ts`).

### Werkstatt-Alltag: Schnellstatus und Reifenwechsel-Kreis

* **Schnellstatus** (`appointments.setStatus`, Recht `appointments.edit`, Audit `appointment.status`): „Starten“/„Fertig“ ohne das Terminformular. Erlaubte Schritte stehen in `quickStatusOptions` (`domain.ts`: Geplant/Bestätigt → In Arbeit oder Erledigt, In Arbeit → Erledigt;
  erledigt/storniert/nicht erschienen nichts), `version` ist Pflicht (`claimRow`: veraltet oder derselbe Schritt schon getan → `conflict`), es ändert sich nur `status` (keine Doppelbelegungsprüfung, die Zeit bleibt). Die Oberfläche ist `QuickStatus` (Client, `useInlineAction`)
  mit dem Server-Teil `AppointmentQuickStatus` (`appointment-quick-status.tsx`, Rechte und Vorschlag), eingebaut in den Karten des Kalenders (Liste, Handy-Ansicht von Woche und Tag), im Zeitraster (Woche/Tag: Knöpfe erscheinen beim Überfahren bzw. Fokussieren eines Blocks, `invisible` → `group-hover:visible`), im Übersichtsbaustein „Heutige Termine“ und in der Terminliste eines Reifensatzes. `AppointmentQuickStatus` bleibt auch für einen erledigten Termin mit buchbarem Satz eingehängt (nur dann): Nach „Fertig“ lädt die Seite neu, und der Vorschlag lebt im Zustand der Karte. API: `POST /appointments/{id}/status` (`If-Match`).
* **Reifensatz ein-/ausbuchen** (`tires.setStatus`, eigenes Recht `tires.stock`, Audit `tires.stock`): Lager (`stored`) ↔ ausgelagert, beim Kunden montiert (`mounted`; der Wert ist API-Vertrag und bleibt, „Ausgelagert (beim Kunden montiert)“ ist seine eindeutige Benennung). `tires.stock` steht ausdrücklich
  in den Standardrollen Mechaniker, Serviceberater und Lager (Kommentar in `default-roles.ts`; kein sensibles Recht nach Regel 9) und erlaubt **nicht** Bearbeiten/Entsorgen/Löschen. Pflichtfeld `version`; ein entsorgter Satz oder dieselbe Buchung nochmals ist ein Fehler. Entsorgen ist `tires.dispose`
  (Recht `tires.edit`). API: `POST /tire-sets/{id}/status` (`stored`/`mounted`) und `/dispose`, beide mit `If-Match` (`ifMatch: true` an der Aktion der `defineResource`-Konfiguration).
* **Vorschlag nach „Fertig“:** Die Terminfunktion kennt keine Reifen-Oberfläche; die **Seite** setzt beides zusammen: `AppointmentQuickStatus` baut aus `tires/public.ts` den Dialog `TireStockPrompt` (nur mit `tires.stock` und einem buchbaren verknüpften Satz, `suggestedStockStatus`) und reicht ihn
  `QuickStatus` als `prompt`, das ihn erst nach erfolgreichem „Fertig“ zeigt (Antwort der Aktion: `status`). Gebucht wird erst auf die Bestätigung (**kein Auto-Buchen**), mit der Version vom Anzeigen. Der Satz selbst mahnt 30 Tage lang, wenn der Wechsel erledigt, der Satz danach aber nicht angefasst wurde (`pendingStockBooking`).
* **Saisonfenster:** `TireSettings.winterStartMonth`/`winterEndMonth` (Standard 10/3 wie bisher; Monate 1–12, über den Jahreswechsel erlaubt, nie das ganze Jahr: `isValidSeasonWindow`); `wantedSeason(now, window)` ist die einzige Stelle. `TireSetRow.wrongSeason` (`isWrongSeason`: montiert, Sommer/Winter, falsche Jahreszeit; Ganzjahr nie)
  speist Listenfilter `?wrong=1`, die Marke in der Liste und den Übersichtsbaustein `tire-wrong-season`.

### Fahrzeuge: Prüffristen, Kennzeichen-Dubletten, Druckliste (P4a-1)

* **Felder** (`Vehicle`, nur additiv, alle optional): `mileageKm`, `fuel` (`FUEL_TYPES` in `vehicles/domain.ts`), `hsn` (4)/`tsn` (3), `firstRegistration`, **`inspectionDue`** (Text „JJJJ-MM“, neutral benannt: HU/„Pickerl“/MFK; Zeichenfolgen sind sortier- und vergleichbar, Index `inspectionDue`) und die **weitere Prüfung**
  `extraInspectionKind` (`sp`/`gas`/`other`) + `extraInspectionDue` (Datum; beides oder keines). Kein `auDue`. Monatshelfer: `lib/month.ts` (`parseMonthInput` versteht `11/2026`, `11.2026`, `2026-11`; Browser ohne Monatsfeld zeigen ein Textfeld), Fristlogik rein in `vehicles/domain.ts`
  (`inspectionState`: überfällig / laufender Monat / „bald“ = die nächsten `INSPECTION_SOON_MONTHS` (2) Monate / in Ordnung). Das Intervall (24/36 Monate) wird bewusst **nicht** abgeleitet oder gespeichert: Es hängt von der Fahrzeugart ab; die Frist ist, was der Meister einträgt.
* **Kennzeichen-Dublette = Warnung mit Bestätigung, kein Unique** (weder in der Datenbank noch in der Operation): `saveVehicleOperation` wirft bei gleichem `plateNorm` (anderes Fahrzeug) `failFields({ plate }, data)` mit **Zusatzangaben** (`OperationFailure.data` → `state.data` der Server Action; nur Text: `duplicateId`, `duplicatePlate`,
  `duplicateOwner`); mit `allowDuplicate` (Knopf `name="allowDuplicate" value="1"` bzw. API-Feld `allowDuplicate: true`) wird gespeichert, das Audit trägt „Dublette bestätigt“. Die Oberfläche ist der Baustein `DuplicateNotice` (`components/ui`, liest `state.data` aus dem Formularkontext: „Vorhandenes Fahrzeug öffnen“ in neuem Tab,
  „Trotzdem anlegen/speichern“). Dasselbe für **Firmenfahrzeuge** (`fleet.save`, Vergleich über `normalizePlate` im Speicher – der Fuhrpark ist klein, keine neue Spalte; Kundenfahrzeuge zählen dort nicht als Dublette). **Verhaltensänderung** gegenüber früher (gesperrt): in der Hilfe vermerkt. Der dritte Weg „Altfahrzeug archivieren“ (`archiveDuplicate`) archiviert das vorhandene Fahrzeug und speichert das neue in derselben Transaktion (zwei Audit-Einträge); archivierte Fahrzeuge zählen nicht als Dublette (P4b-2).
  `normalizePlate`: Unicode wird zusammengesetzt (NFC, sonst wäre ein „Ü“ vom Mac ein anderes Kennzeichen), Umlaute bleiben Umlaute, „ß“ wird zu „SS“; Tests mit Ä/Ö/Ü, ß, A und CH in `lib/plate.test.ts`.
* **Liste, Druckliste, Baustein:** Filter `?inspection=soon|none` und `?month=JJJJ-MM` (`vehicleListWhere` in `vehicles/queries.ts`, gemeinsam für Liste und Druckliste), Sortierung `inspection`. `/vehicles/print` (Art `print` in `pages.ts`) druckt dieselben Filter als Tabelle (höchstens 1000, Telefon nur mit `customers.view`); `window.print()` über `PrintButton`,
  die Bildschirmteile sind `print:hidden`. Dashboard-Baustein `inspection-due` (`widgets.tsx`) mit „Termin planen“ → `/appointments?new=1&vehicle=<id>` (weich: nur mit aktiver Terminfunktion und `appointments.create`). **CSV-Export** der gefilterten Liste: Abschnitt „Datenaustausch (CSV)“. API: neue Felder, Filter `inspectionDue`, `allowDuplicate` (`openapi-structure.txt` ist der Schnappschuss).
* **Demo-Seed** (`vehicles/seed.ts`): Fristen relativ zu heute (überfällig, laufender Monat, +1, +2 samt Gasprüfung, +8, +14), damit Baustein, Filter und Druckliste Beispiele haben.

### Termine: Kunde, Hinweise, Mitternacht (P4b-1)

* **Kunde im Termin:** `Appointment.customerId` ist wählbar (auch ohne Fahrzeug). Hat das Fahrzeug einen Halter, **gilt der Halter** (ein anderer Kunde → Feldfehler `customerId`); ein Fahrzeug ohne Halter lässt den gewählten Kunden gelten. Archivierte Kunden/Fahrzeuge sind für **neue** Verknüpfungen nicht wählbar, ein bestehender Termin behält sie. API: `customerId` im Körper (Beim `PATCH` mit Fahrzeug wird der Kunde aus dem Halter abgeleitet).
* **Halterwechsel zieht Termine nach:** `vehicles.transfer` ruft (weiche Abhängigkeit, `session.features.has("workshop.appointments")`) `followVehicleOwner` aus `appointments/public.ts` in **derselben Transaktion**: offene Termine (Geplant/Bestätigt/In Arbeit) mit `endsAt > max(jetzt, Beginn des Wechseltags)` bekommen den neuen Halter (null = Fahrzeug ohne Halter). Anzahl im Audit-Zusatz. Bewusst **kein** Operations-Hook: der Audit-Zusatz mit der Anzahl gehört in den Eintrag der Operation.
* **Hinweise statt Sperren:** `appointments/hints.ts` (rein: `buildAppointmentHints`, `touchedDays`) liefert Feiertag (`getHolidays()`), Ruhetag/außerhalb der Öffnungszeiten (je berührtem Tag), Termin über Mitternacht, Abwesenheit des Zuständigen, dessen anderen Termin und ein Fahrzeug mit Termin am selben Tag; `appointmentHintsFor` (queries.ts) lädt, `GET /api/appointments/hints` liefert, `appointment-hints.tsx` zeigt die Liste ohne eigene Bestätigung. **Abwesenheit kommt nur als ja/nein** (`userAbsentBetween` in `employees/queries.ts` liest nie Art oder Anmerkung) – Krankheit wird auch Personen mit `employees.sensitive` nicht genannt. Hart bleibt allein `findBayClash`. Die Zeiten der Hinweise sind schon in der Werkstatt-Zone formatiert (der Client kennt die Zone nicht).
* **Termine über Mitternacht:** `appointmentWindow` rechnet Beginn plus Dauer in echten Minuten (Sommerzeit-sicher), `findBayClash` kennt keine Tagesgrenze. Das Raster (`calendar-layout.ts`: `overlapsDay`, `eventSpanOnDay`) zeigt den Termin an beiden Tagen (Wanduhr-Minuten je Tag, am Starttag bis 24:00, am Folgetag ab 0:00); `appointmentsBetween(from, to, { overlapping: true })` lädt auch Termine, die davor begonnen haben (Liste: nur Starttag). Tests: `calendar-layout.test.ts`, `hints.test.ts` (Berlin/Zürich/UTC/Auckland, Umstellungsnächte).

### Feiertage und Region (Plattform, P4b-0)

* **Regeln statt Listen:** `src/lib/holidays.ts` (rein, über `zone.ts`) berechnet die gesetzlichen Feiertage aus Regeln (fester Tag, Abstand zu Ostern, Sonderregeln wie Buß- und Bettag, Genfer Bettag, Näfelser Fahrt) für **DE (16 Länder), AT (9 Bundesländer, Landesfeiertage nur als einschaltbare Vorschläge) und CH (26 Kantone)**. Ostern: Meeus/Jones/Butcher (produktiv) und Gauß (Gegenprobe im Test, 1583–2600). Die Daten sind ein **Vorschlag nach den üblichen Zusammenstellungen** (Kantons-/Gemeindefeste unterscheiden sich im Detail, z. B. halbe Tage, Bayern: Mariä Himmelfahrt nur in Teilen markiert `partial`) und deshalb pflegbar – vor einem Einsatz in der Schweiz gegen kantonale Quellen prüfen.
* **Pflege:** Tabellen `HolidaySettings` (Region) und `HolidayDay` (`kind` `rule`: Streichen/halber Tag/Einschalten je Regel-Kennung `DE.corpusChristi`; `custom`: eigene Tage einmalig oder jährlich, ganz oder halb). Ein Regionswechsel verwirft die Regeländerungen (eigene Tage bleiben). Oberfläche: Verwaltung → Einstellungen → **Feiertage** (`holiday-tab.tsx`, `holiday-operations.ts`, Audit `settings.holidays`, Recht `settings.manage`).
* **Lesen für Funktionen:** `getHolidays()` (`src/server/holidays.ts`, je Anfrage gecacht) liefert den `HolidayCalendar` (`on(JJJJ-MM-TT)`, `between`); `HolidayLookup` ist der kleine Typ für reine Funktionen. Verbraucher: Arbeitstage der Abwesenheiten (`workdaysBetweenKeys(start, end, holidays)`: Feiertag 0, halber 0,5), Hinweise im Terminformular. Spätere Verbraucher (P4b-4 Teilzeit/Anspruch, F5 Sollzeit) lesen nur darüber. Ohne Region gibt es keine Feiertage (Verhalten wie vorher).

### Werkstattprofil für Rechnungen (P4b-7)

`Workshop` trägt zusätzlich Steuernummer, USt-IdNr., `smallBusiness` (§ 19 UStG), Bank/IBAN/BIC, `paymentTermDays` (14), Geschäftsführer, Registergericht/-nummer, `hourlyRateCents`, `workUnitMinutes` (5) und `invoiceNumberFormat` (`{YYYY}-{NNNN}`). Prüfungen in `src/lib/bank-tax.ts` (IBAN mod 97 und Länge für DE/AT/CH/LI, BIC, USt-IdNr. DE `DE`+9, AT `ATU`+8, CH `CHE-…`; andere EU nachsichtig; Steuernummer nachsichtig) und `src/lib/invoice-number-format.ts` (Platzhalter `{YYYY} {YY} {MM} {N…}`, genau ein Zähler, `{MM}` nur mit Jahr; `counterKey` nennt die Zählreihe: nie/Jahr/Monat; `previewInvoiceNumbers`). Gepflegt in Einstellungen → Werkstatt (`saveWorkshop`); das Audit nennt die geänderten **Feldnamen**, nie Werte. F3 liest alles über `getWorkshop()`; die Nummernvergabe selbst (Zählertabelle, Festschreiben) kommt mit F3. Die Einrichtungs-Checkliste „Werkstattprofil“ verlangt Anschrift, Kontaktweg, Steuernummer/USt-IdNr. und IBAN.

### Archiv und Löschschutz (P4b-2)

* **Archivstatus:** `Customer.archivedAt`, `Vehicle.archivedAt` (additiv); bei **Arbeitsplätzen und Terminarten** bedeutet `active = false` „archiviert“ (kein neues Feld; die Einstellungen zeigen Zähler, „Archivieren“/„Wieder aktivieren“ und löschen nur ohne Termine). Operationen `customers.archive/unarchive` (`customers.edit`), `vehicles.archive/unarchive` (`vehicles.edit`), `appointments.archiveBay/archiveType`; Audit `customer.archive`, `vehicle.archive` …; API-Aktionen `POST /customers|vehicles/{id}/archive|unarchive`, Listenfilter `archived=false|true|all`, Feld `archivedAt`.
* **Ausgeblendet** (`archivedAt: null`): Auswahl-Suchen (`/api/customers/search`, `/api/vehicles/search`), Schnellsuche, Termin-Formular (nur für neue Verknüpfungen), Baustein „Prüffrist“, Dublettenwarnung; **auffindbar** über den Listenfilter „Anzeigen“ (`?archived=1|all`, gemeinsame Helfer `src/lib/archive-filter.ts`), in Druckliste und CSV-Export (`archived`-Parameter, Standard nur aktive).
* **Löschschutz:** `ArchivePanel` (`components/archive`) zeigt vor dem Löschen/Archivieren die Abhängigkeitszählung. Kunden: wie bisher nur ohne Fahrzeuge/Halterschaften/Rechnungen (Meldung mit getrennten Zahlen: Fahrzeuge, **frühere Halterschaften**, Rechnungen). Fahrzeuge: **Löschen nur ohne Geschichte** (keine Termine, Reifensätze, Halterwechsel; der erste Halter-Eintrag fällt mit dem Fahrzeug weg); `VehicleOwnership.vehicle` ist `Restrict` (die Historie hängt nie still am Löschen). Keine Anonymisierung (P4b-5).

### Rechnungen: Festschreiben, Storno, E-Rechnung (P4b-3)

* **Zustand** (additiv an `Invoice`): `finalizedAt`/`finalizedByName` (festgeschrieben, nur Ausgangsrechnungen) und `cancelsInvoiceId` (**Gegenbeleg**, `@unique`: je Rechnung höchstens einer, `Restrict`; `cancelledBy` ist die Gegenseite). Reine Regeln in `invoices/domain.ts` (`finalizeBlock`, `cancelBlock`, `counterAmounts`).
* **Regeln:** Eine **festgeschriebene** Ausgangsrechnung ist unveränderlich (`invoices.save` lehnt ab: `inUse` mit `invoices.errors.finalized`, API 409) und nie löschbar (auch kein Gegenbeleg); nur der Zahlstatus (`markPaid`/`reopen`, Audit) bleibt änderbar – außer im stornierten Paar. **Nicht festgeschriebene** Ausgangsrechnungen und alle **Eingangsrechnungen** bleiben frei änderbar/löschbar (D4; Audit `invoice.update/delete` wie immer).
* **Operationen:** `invoices.finalize` (Recht `invoices.finalize`, `version` Pflicht, Audit `invoice.finalize`) und `invoices.cancel` (Recht `invoices.edit`, Audit `invoice.cancel`): legt in einer Transaktion eine festgeschriebene Rechnung mit der **eingegebenen** Nummer (`outgoingKey` bleibt die Eindeutigkeit; **keine** Zählertabelle – die Nummernvergabe gehört zu F3, Block 12), negierten Beträgen, Status `cancelled` und `cancelsInvoiceId` an; das Original wird `cancelled`. API: `POST /invoices/{id}/finalize|cancel` mit `If-Match`; Felder `finalizedAt`, `cancelsInvoiceId`, `cancelledByInvoiceId`. CSV-Export (Archiv und Steuerberater): Spalten *Festgeschrieben am* und *Storno zu Rechnung* (nie im Import).
* **Recht `invoices.finalize` (Produktentscheid):** eigenes Recht, **nicht** `adminOnly`, aber unter `permissions.marked` als `sensitive` gekennzeichnet (Regel 9): in keiner Standardrolle, auch nicht in der Geschäftsführung; Administratoren haben es immer, sonst vergibt es ein Administrator bewusst. Ein API-Token darf es tragen (`isApiForbidden` sperrt nur Verwaltung, Export/Import).
* **E-Rechnung als Eingangsbeleg:** `src/lib/einvoice/` – `xml.ts` (Tokenizer: eine Vorwärtsschleife mit `indexOf`, Obergrenzen `XML_LIMITS` für Größe/Tiefe/Elemente/Attribute/Namen/Text, `<!DOCTYPE`/`<!ENTITY`/Verarbeitungsanweisungen und jede Entität außer den fünf vordefinierten und Zeichenverweisen sind Fehler, Namensräume werden aufgelöst) und `extract.ts` (`readEInvoice`: UBL `Invoice`/`CreditNote` und CII `CrossIndustryInvoice` an Wurzel **und** Namensraum, Nummer/Datum/Fälligkeit/Verkäufer/Käufer/Netto/MwSt./Brutto, Gutschrift negativ, Warnungen `currency`/`sum`/`missing`). Die Route `POST /api/invoices/e-invoice` (`invoices.edit`, gleiche Herkunft wie die Upload-Routen, vorher `checkUpload`) liefert nur den **Vorschlag**; `einvoice-reader.tsx` zeigt die Vorschau im Eingangsrechnungs-Formular, übernommen wird erst auf Knopfdruck. Das Original wird beim Speichern unverändert als Beleg abgelegt. ZUGFeRD-PDF (eingebettetes XML) wird nicht ausgelesen. Tests: `extract.test.ts` (selbst erzeugte Beispiele, XXE/Billion-Laughs, Obergrenzen, Laufzeit linear), `route.test.ts`.
* **Hilfe** bewirbt das Festschreiben nicht als „GoBD-konform“; sie weist auf den Steuerberater und auf das Zurückspielen älterer Backups hin.

### Mitarbeiter: Teilzeit, Urlaubsstand, Bearbeiten (P4b-4)

* **Daten** (additiv): `Employee.workWeekdays` (Text `"1,2,3,4,5"`, 0 = Sonntag … 6 = Samstag; keine Json-Spalte), `vacationCarryYear`/`vacationCarryDays` (von Hand erfasster Resturlaub zu Jahresbeginn), `Absence.updatedAt` und `Qualification.updatedAt` (Version für `claimRow`), Singleton `EmployeeSettings` (Verfall-Stichtag, Standard 31.03.; Reiter *Mitarbeiter* in den Einstellungen, `settings.manage`, Audit `settings.employees`).
* **Reine Logik:** `work-pattern.ts` (Muster lesen/schreiben, Standard Mo–Fr), `domain.ts` (`workdaysBetweenKeys(…, holidays, pattern)`: nur Tage des Musters, Feiertage und halbe Feiertage wie gehabt), `vacation.ts` (`yearEntitlement`: 1/12 je **vollem** Monat im Ein-/Austrittsjahr, Rundung wie § 5 Abs. 2 BUrlG ganzzahlig in Zwölfteln; `vacationBalance`: Anspruch, Übertrag, bis zum Stichtag zuerst vom Übertrag, Verfall, Rest, Übertrag ins Folgejahr; Urlaubseinträge werden vereinigt, damit kein Tag doppelt zählt). Der Übertrag wird nur ab dem Jahr der Anlage (`createdAt`) gerechnet – davor kennt die Anwendung die genommenen Tage nicht und würde sonst den ganzen Anspruch übertragen; höchstens 6 Jahre zurück. Tests: `vacation.test.ts`.
* **Lesen:** `getVacationBalance(viewer, id, year)` (`queries.ts`; nur Urlaub, nie sensibel), `staffWorkPatterns`, `getAbsenceForEdit` (Krankheit nur mit `employees.sensitive`), `getQualificationForEdit`. Anzeige `vacation-summary.tsx`. Das Monatsraster färbt freie Tage der Person wie das Wochenende, die Tageszählung der Liste nutzt das Muster der Person.
* **Bearbeiten:** `employees.saveAbsence`/`employees.saveQualification` nehmen `id` + `version` (`claimRow`), Audit `employee.absenceUpdate`/`qualificationUpdate`; die Person lässt sich nicht wechseln; eine Krankheitszeile umzuschreiben oder zu Krankheit zu machen braucht `employees.sensitive`; die Dublettenprüfung nimmt die Zeile selbst aus; die Hinweisliste (`absence-hints`) nimmt beim Bearbeiten `exclude`. API: `PATCH /employee-absences|employee-qualifications/{id}` (If-Match), Felder `workWeekdays`, `vacationCarryYear`, `vacationCarryDays` am Mitarbeiter – weiterhin ohne Notfallkontakt und Krankheit.

### Datenschutz bei Kunden (P4b-5)

* **Rechte** (beide gekennzeichnet, nie in Standardrollen, Regel 9): `customers.disclose` (Auskunft; Kennzeichnung `export`, also nie in einem Token) und `customers.privacy` (Einschränken, Anonymisieren; Kennzeichnung `sensitive`). Nicht `adminOnly`. Die Fristen und ihre Bestätigung verlangen `settings.manage` (nur Administratoren).
* **Daten** (additiv): `Customer.processingRestrictedAt`/`restrictionNote`/`anonymizedAt`, Singleton `PrivacySettings` (Fristen in Jahren, `retentionConfirmedAt`/`ByName`). Reine Logik in `src/lib/privacy.ts` (Fristende `retentionEndKey`, `anonymizeBlock`, Auskunft als flache Tabelle `disclosureRows`; Test `privacy.test.ts` mit Jahresgrenzen und Zeitzonen).
* **Aufbewahrungsfrist:** beginnt mit dem Ablauf des Kalenderjahres der Rechnung (Zeitzone der Werkstatt), N Jahre; die Anonymisierung ist ab dem Tag nach `JJJJ+N-12-31` frei. Zwei einstellbare Werte als **Platzhalter** (Standard 8: Rechnungen und Stornorechnungen; 10: festgeschriebene Rechnungen als Teil der Bücher – eine Zuordnung des Entwicklers, die der Steuerberater bestätigen muss). Solange `retentionConfirmedAt` leer ist (Standard) und nach jeder Änderung der Jahre ist `customers.anonymize` gesperrt.
* **Anbieter statt Querzugriffe:** Jede Funktion mit Kundendaten bringt eine `privacy.ts` (`PrivacyProviderDef`: `collect` für die Auskunft, `retention` für Belege) mit; `src/modules/privacy.ts` (Kompositionswurzel) sammelt sie, `collectDisclosure`/`collectRetention` filtern nach aktiven Funktionen. Die Auskunft liefert bewusst alles zum Kunden unabhängig von den Leserechten (das Sonderrecht ist die Prüfung). Heute: Kunden, Fahrzeuge (samt Halterhistorie), Termine, Reifen, Rechnungen, Fundstellen in Handbuch und IT-Dokumentation (nur Titel/Datum; `capabilities/docs/privacy.ts`). **Neue Funktion mit Kundendaten:** `privacy.ts` anlegen, eintragen, bei Freitext/Verknüpfungen einen Hook für `customers.anonymize` ergänzen.
* **Auskunft:** CSV über `/api/exchange/customer-disclosure?customer=<id>` (flache Tabelle *Bereich · Nr. · Feld · Wert*, Formel-Schutz des CSV-Schreibers) und JSON über `GET /api/customers/{id}/disclosure` (`attachment`, `nosniff`, `no-store`); Audit `customer.disclose` mit der Kennung.
* **Einschränken:** `searchableCustomerWhere` (`customers/queries.ts`: nicht archiviert **und** `processingRestrictedAt: null`) ist **die eine Bedingung** für Auswahl (`/api/customers/search`), Schnellsuche und Standardliste; die API-Ressource filtert per `scope` (`unrestrictedCustomerWhere`, eingeschränkte Kunden sind dort 404), Exporte schließen sie aus, die Eigentümer-Suche der Fahrzeuge ebenso. Neue Verknüpfungen (Termin-Kunde, Halterwechsel, Fahrzeug-Halter, Rechnungs-Kunde) lehnen sie ab, bestehende bleiben. **Webhooks (F11) und der iCal-Feed erben die Bedingung aus `queries.ts`.** Im Detail bleibt der Kunde mit Hinweis sichtbar; Listenfilter *Eingeschränkt*.
* **Anonymisieren:** `customers.anonymize` (Typ-zur-Bestätigung) leert den Stammsatz (Name „Anonymisiert“, Archiv, `anonymizedAt`), die Rechnungsverknüpfung bleibt (`partyName` bleibt). Fahrzeuge, Termine und Reifen bereinigen **transaktionale Hooks** (`workshop/{tires,appointments,vehicles}/hooks.ts`, Reihenfolge in `operation-hooks.ts` zählt: Reifen vor Fahrzeugen); sie laufen nur für aktive Funktionen. Belege mit Aufbewahrungsfrist werden in `prepare` gelesen (innerhalb der Transaktion gibt es nur `tx`). Dokumentation wird nicht umgeschrieben (nur Fundstellen). Backups enthalten die Daten weiter.
* **Kundennummern:** Dublettenwarnung mit Bestätigung (`allowDuplicate`, `DuplicateNotice`, Vergleich über `numberKey`); kein Unique.

### IT und Fuhrpark (P4b-6)

* **Kein erfundener Status:** `monitoring.ts` kennt nur noch den Anbieter `noMonitoring` (jedes Gerät `unknown`, keine Latenz); die Demo-Werte (`hash01`, `demoState`, `demoProvider`) und der Dashboard-Baustein „Netzwerk-Status“ sind entfernt, die Übersicht zeigt nur den Hinweis `network.monitoringNotice`. Die Zustände `online`/`degraded`/`offline` bleiben im Typ für **F12 (Monitoring)**: ein weiterer `StatusProvider` in `getStatusProvider()`, Baustein und Übersichtskarte kommen dann mit echten Werten zurück. Der Demo-Seed merkt keine Überwachung mehr vor.
* **Subnetze:** `parseCidr` versteht `/16`–`/32` (`/31`: beide Adressen nutzbar, `/32`: eine), `cidrsOverlap`/`overlappingSubnets` (`domain.ts`, getestet inkl. Randfälle). `network.saveSubnet`: Überschneidung im **selben VLAN** (auch ohne VLAN) ist ein Feldfehler (`subnetOverlap`/`subnetExists`), in einem **anderen VLAN** eine Warnung mit Bestätigung (`allowOverlap`, `DuplicateNotice`, API-Feld `allowOverlap`); wer nur andere Felder eines bestehenden Netzes ändert (Netz und VLAN gleich), wird nicht erneut gewarnt. `NetSubnet.cidr` ist nicht mehr global eindeutig.
* **IP-Eindeutigkeit je Netz:** `NetIp` hat `@@unique([subnetId, address])` statt des globalen `address @unique` (Operation prüft je Subnetz, der Index fängt Wettläufe → `ipTaken`); dieselbe Adresse in einem anderen Netz ist erlaubt. IPv6 ist nicht Teil.
* **Fuhrpark:** `costPeriod`/`costPerKm(costs, period)` (`fleet/domain.ts`): Kosten pro Kilometer nur über den **Kostenzeitraum** (Tag des ersten bis Tag des letzten Kilometerstands nach Datum; beide Randtage), Kosten im Zeitraum / gefahrene km im Zeitraum – Kosten davor/danach zählen nicht; kein Zeitraum bei < 2 Ständen, gleichem Tag oder 0 km. Die Detailseite zeigt den Zeitraum neben dem Wert; die Gesamtkosten bleiben die Summe aller Einträge.

### Kalender (`src/modules/workshop/appointments/calendar.tsx`)

* **Zwei Darstellungen per CSS** (beide im Markup, eine `display: none`): ab `md` das **Zeitraster** (`TimeGrid`: Woche = Spalte je Tag, Tag = Spalte je Arbeitsplatz), darunter der **Wochenstreifen** (`WeekStrip`, sieben Tage, Anzahl je Tag in der Wochenansicht) mit den Terminen des gewählten Tages als **Karten** (`AppointmentCard`); die Liste zeigt immer Karten, je Tag ein klebender Kopf. Keine Tabelle mehr.
* **Zeit rechnet in CSS:** `--min-px` (Pixel je Minute) am Raster = `max(--tap-row / Rasterschritt, 56/60 px)` – bei Touch ist ein Rasterschritt (und damit jedes Zeitfenster und jeder Termin) mindestens 44 px hoch, am Desktop 56 px je Stunde. Lage und Höhe sind `calc(var(--min-px) * Minuten)`.
  Jeder Termin belegt **mindestens einen Rasterschritt** (`eventSpan`, mindestens 15 Minuten): Kurze Termine hintereinander überdecken sich nicht, die Spuren (`assignLanes`) rechnen mit derselben Spanne.
* **Kleben (`sticky`):** Tageskopf, Wochenstreifen und Listenköpfe kleben unter der Kopfzeile (`top-(--sticky-top)`; Token in `tokens.css` = 56 px plus `env(safe-area-inset-top)`; dasselbe Token ist `scroll-padding-top` und die Mindesthöhe der Mobil-Kopfzeile). **Kein Vorfahr darf `overflow` setzen** (sonst wird er zum Bezugspunkt): Das Raster liegt ohne Überlauf-Hülle in der Seite
  (`html`/`body` haben nur `overflow-x: clip`), `isolate` am Raster hält die Ebenen der Termine unter dem Tageskopf; der Wrapper der Mobil-Kopfzeile ist `contents` (sonst wäre er nur so hoch wie die Kopfzeile, und die klebte nirgends). Einzige Ausnahme: mehr als sechs Spalten (Tagesansicht mit vielen Arbeitsplätzen) scrollen seitlich, dann klebt der Kopf nur am Raster.
  `calendar.test.ts` prüft, dass über den klebenden Elementen kein `overflow` steht.
* **Tastatur:** Zeitfenster sind Links (`data-slot`) mit **einem** Tab-Stopp (`SlotGrid`, Roving-Tabindex; `moveSlot` in `calendar-layout.ts`): Pfeiltasten bewegen im Raster, Bild auf/ab vier Fenster, Pos1/Ende an den Rand der Spalte; der Stopp liegt zuerst am jetzigen Zeitfenster. Termine bleiben Links in Tab-Reihenfolge (nach Zeit, Tag für Tag), ihr Name nennt Zeit, Arbeitsplatz, Status und Notizen.
* **Lesen ohne `appointments.edit`:** Termine führen mit dem Recht ins Formular (`?edit=`), sonst in die Leseansicht (`?show=`, `AppointmentDetail`: Zeit, Status, Art, Fahrzeug, Kunde nur als Anzeigename, Arbeitsplatz, Zuständiger, Reifensatz, Notizen im Volltext); Schnellsuche und „Heutige Termine“ verlinken ebenso (`appointmentOpenParams`).
* **Farbe:** Die Terminfarbe ist frei wählbar; die Blockfläche mischt sie mit `EVENT_TINT_PERCENT` (12 %) in die Kartenfläche (`eventSurface`) – mehr ließe gedämpften Text auf Schwarz unter 4,5 : 1 fallen (`calendar-contrast.test.ts`, rechnet aus `tokens.css`).

### Datenzugriff (`queries.ts`)

Seiten, Dashboard-Bausteine, Suche, API und Austausch lesen Daten mit sensiblen Spalten nicht mit rohen `db.<modell>.find…`-Aufrufen und nicht mit `include: { … : true }`, sondern über die **`queries.ts` ihrer Funktion**:

* **Explizites `select`** (keine Voll-Relationen auf Kunden oder Mitarbeiter: `customerNameSelect` aus `customers/public.ts` für den Anzeigenamen, `customerContacts(viewer, ids)` für Telefon/Ort).
* **Betrachter-Parameter** (`Viewer` = `Pick<AppSession, "can">`, also die Sitzung oder das Prinzipal einer Operation): Die Abfrage liest sensible Spalten **nur**, wenn der Betrachter das Recht hat – sie werden gar nicht aus der Datenbank geholt, statt
  nachträglich maskiert zu werden. `visibleAbsenceType` in der Oberfläche bleibt als zweite Linie. Abfragen prüfen das Leserecht zusätzlich (`requireView`, wirft sonst).
* **Mitarbeiter** (`office/employees/queries.ts`): `listEmployees`/`getEmployeeDetail`/`getEmployeeForEdit` (Notfallkontakt als `emergency`, sonst `null`; eigene Abfrage nur mit `employees.sensitive`), Abwesenheiten (`absencesOverlapping`/`absencesAround`: Krankheitszeilen ohne
  Recht werden **ohne Art und Anmerkung** gelesen und als `masked` geliefert), `expiringQualifications`, `searchEmployees`, `staffWithAccount`, `activeEmployees` (nur Name; für andere Funktionen über `public.ts`), `linkableAccounts`. Die API liest per `select: employeeBaseSelect` nie
  den Notfallkontakt und per `scope` nie Krankheitszeilen (`defineResource`-Optionen `select`/`scope`). Die Operation liest den bisherigen Notfallkontakt nur mit dem Recht und gibt nach dem Speichern nur Id und Namen zurück.
* **Kunden** (`workshop/customers/queries.ts`): Liste/Detail/Bearbeiten; Fahrzeuge, Reifensätze und Termine am Kunden nur mit `vehicles.view`/`tires.view`/`appointments.view`. Telefon des Halters auf Fahrzeug-, Reifen- und Druckseite, Ort im Rechnungsformular: nur mit `customers.view` (Richtlinie D7;
  vorher stand das Telefon auch ohne das Recht auf diesen Seiten). Fahrzeuge: `getVehicleDetail(viewer, id)`. Fuhrpark: Fahrer nur als Name, `listDrivers` mit Auswahl.
* **Test:** `employees/queries.test.ts` schreibt das SQL mit (zweiter Client mit `log: query` unter `globalThis.__db`) und prüft, dass ohne `employees.sensitive` keine Anweisung `emergency*` auswählt und Krankheitszeilen weder `type` noch `note` liefern; mit dem Recht sind sie da.
  `architecture.test.ts` („Datenzugriff“): keine `db.employee/absence/qualification` in Seiten und Bausteinen, kein `.emergencyName` & Co. dort (und in Suche und API), kein `db.customer` in Seiten, kein `include: { customer|employee|driver: true }`, die API-Ressource der Mitarbeiter hat `select`/`scope`.
* **Neue Funktion mit sensiblen Daten:** `queries.ts` anlegen (Spaltenmengen als Konstanten, Funktion mit Betrachter, sensible Spalten in eigener Abfrage oder bedingtem `select`), Seiten/Bausteine/Suche/API darauf umstellen, Test mit SQL-Protokoll nach dem Muster oben, Modell in die Liste des Architekturtests aufnehmen.
  Noch nicht umgestellt (kein sensibles Feld, nur `include`s mit Fachdaten): Listen und Details von Rechnungen, Reifen, Termin-Modal; sie bekommen ihr `queries.ts` mit dem nächsten Eingriff.

### Übersicht, Einrichtungs-Checkliste und Presets (P2b-4)

* **Bausteine** (`WidgetDef`): zusätzlich `titleKey` (Überschrift für Rollenvorschau), `priority` (**kleiner = wichtiger**) und optional `uses` (Funktionen, ohne die der Baustein entfällt). `src/lib/dashboard.ts` (rein, getestet): `pickWidgets` zeigt die **4 wichtigsten** (`DASHBOARD_VISIBLE`, Anzeige nach `order`) offen,
  den Rest zugeklappt („Weitere Bausteine“, `Disclosure`; die Bausteine darin rendern trotzdem, nur ausgeblendet). Was in Frage kommt, bestimmen Funktion + Recht + `uses` (`widgetsFor`) – daher hat jede Rolle ihre eigene Auswahl (Test `dashboard-widgets.test.ts`: Mechaniker, Büro).
  „Heute und morgen“ ist der Baustein `today-appointments` (Schnellstatus nur für heute). Neue Funktion: `priority` vergeben (Termine 10, Prüfungen 20, Reifen 22–35, Rechnungen 25, Mitarbeiter 40 …).
* **Schnellaktionen der Übersicht** (`shortcutsFor`, 3 je Person): erst die Anlegen-Aktionen (`quickActions`, nach `order`), dann Ansichten (`kind: "open"` in der `feature.ts`: Kalender heute, Reifen ein-/ausbuchen, Fahrzeuge), die das „Neu“-Menü (`quickActionsFor`) nicht zeigt.
* **Einrichtungs-Checkliste:** Beitragsart `setupChecks` (`SetupCheckDef` in `types.ts`; Datei `<funktion>/setup-checks.ts`, eingesammelt in `registry.ts`, `setupChecksFor`): `feature`, `permission` (Recht zum Erledigen = Recht zum Sehen), `labelKey`/`hintKey`, `href`, `recommended`, `done(context)` – **gerechnet aus dem Datenstand**
  (kein Abhaken von Hand). Die Plattform (`platform/dashboard/setup-checklist.tsx`) aggregiert nur und zeigt sie Administratoren, offene zuerst; nur aktive Funktionen werden abgefragt, ein scheiternder Punkt fehlt (protokolliert). Heute: Profil, Öffnungszeiten, HTTPS, 2FA (`admin.settings`); Wiederherstellungs-Code, weitere Benutzer (`admin.users`);
  Backup, Wiederherstellungsschlüssel (`recoveryKeyConfirmed`), Off-Site (`admin.backup`); Arbeitsplätze/Terminarten (Termine); erster Mitarbeiter (Mitarbeiter). Ausblenden/Einblenden: Einstellung `dashboard.setupChecklistHidden` (AppSetting, ganze Werkstatt), Operation `dashboard.setSetupChecklist` (`settings.manage` – Plattform, deshalb nicht in `API_EXCEPTIONS`),
  Audit `setup.checklistHide`/`setup.checklistShow`.
* **Presets der Einrichtung** (`src/modules/presets.ts`, getestet): Ein Preset ist eine Liste von Funktions-IDs (`enable`), die zusätzlich zu den `defaultEnabled`-Standards eingeschaltet werden (samt harten Abhängigkeiten und ausgeschaltetem Modul); unbekannte oder nicht schaltbare IDs werden übersprungen und gemeldet (`planPreset`: `skipped`).
  `applyPreset` (`features.ts`) schreibt die Schalter in der Transaktion der Einrichtung (`src/app/setup/actions.ts`, Feld `preset`). Ausgeliefert: `basic` (Standard) und `orders` („mit Aufträgen und Rechnungen“, **leer bis Block 12**: dort nur Einträge in `enable` ergänzen). `presetChoices` bietet die Auswahl nur an, wenn ein Preset wirklich etwas
  einschaltet – solange nicht, fragt die Einrichtung nicht. Leertext: `dashboard.askAdmin` („Bitte bei der Administration nachfragen …“).

### Rollenmaske und Module-Seite (P2b-3)

* **Rollenmaske** (`admin/roles`): `forms.tsx` (Name/Beschreibung, `RoleForm`) und `role-mask.tsx` (`RoleMask`: Auswahl, Suche, Vorlagen, Vorschau; Test `role-mask.test.ts`). Die reine Logik steht in `src/lib/role-mask.ts` (`togglePermission`, `filterMask`, `rolePreview`).
  **Alle Kontrollkästchen bleiben im Dokument** (zugeklappt oder weggefiltert wird mit `hidden` ausgeblendet): Sonst ginge beim Speichern verloren, was gerade nicht sichtbar ist. `sections.ts` liefert Gruppen mit Name, **Kurzbeschreibung**
  (`permissionHints.<gruppe>.<aktion>`, `i18n/messages/modules/permission-hints.*.ts`; `catalog.test.ts` verlangt eine je Recht in beiden Sprachen) und Kennzeichnung (`adminOnly`/`permissions.marked`), dazu die Daten der Vorschau (`rolePreviewData`: Navigation aus
  den `feature.ts`, Bausteine aus `widgetCatalog()`, Schnellaktionen aus `quickActionCatalog()` – **ohne Seiten zu rendern**). **Vorlagen** (`src/modules/role-templates.ts`) leiten sich aus `default-roles.ts` ab und lassen alles nach Regel 9 weg (`isRuleNinePermission`:
  `adminOnly`, `marked`, `employees.sensitive`); Test `role-templates.test.ts`. Rechte-Hierarchie unverändert (Rohrechte, `lockedPermissions`): Eine Vorlage übernimmt nie ein gesperrtes Recht und lässt vorhandene gesperrte unberührt.
* **Neue Rechte** brauchen also: Namen (`permissions.*`), Kurzbeschreibung (`permissionHints.*`), bei Regel 9 die Kennzeichnung in der `feature.ts`.
* **Module & Funktionen:** Je Modul eine einklappbare Karte (`Disclosure variant="card"`, neu im UI-Kit: `description`, `actions`, `headingLevel`), Abhängigkeiten als Marken (`deps`), ausgeschaltete Module starten zugeklappt.

### Abwesenheit: Überschneidungswarnung (P2b-2)

`office/employees/absence-overlap.ts` (rein, getestet): aus dem geplanten Zeitraum und den Abwesenheiten **derselben Person** folgen `overlaps` (Hinweise) und `duplicate` (gleiche Art, gleicher Zeitraum). Nur die Dublette blockiert – die Operation `employees.saveAbsence`
lehnt sie mit `employees.errors.absenceDuplicate` ab; Überschneidungen zeigt das Formular als ruhige Liste (`AbsenceHintList`, holt `GET /api/employees/absence-hints` mit `employees.edit`, auch beim Öffnen aus einer Rasterzelle). Die Abfrage (`absenceHintsFor` in `queries.ts`) liest Krankheit ohne
`employees.sensitive` maskiert (Zeitraum ohne Art und Anmerkung); die Route fragt Krankheit für Personen ohne das Recht gar nicht erst ab.

### Zeitzone

Die **Werkstatt-Zone** (Einstellung `Workshop.timezone`, IANA-Name) bestimmt, was „heute“, „Montag“, „Oktober“ und „10:30 Uhr“ heißen – **nicht** `process.env.TZ`. Alles läuft durch `src/lib/zone.ts` (rein, auf `Intl`):

* `workshopZone()`/`setWorkshopZone()` (Zustand in `globalThis`): gesetzt beim Start aus der Datenbank (`startApp` → `applyTimezone`), nach der Einrichtung, beim Speichern der Einstellungen und – als Sicherung – bei jedem Lesen des Werkstatt-Profils (`getWorkshop`). Ohne gesetzte Zone (Tests, vor der
  Einrichtung) gilt als Rückfall die Prozess-Zone. `applyTimezone` setzt zusätzlich `process.env.TZ` (Kompatibilität für Bibliotheken; die Datumslogik hängt nicht daran und `architecture.test.ts` erlaubt `process.env.TZ` nur in `zone.ts` und `startup.ts`).
* Funktionen heißen wie die von `date-fns` und haben die Zone als letzten Parameter (Standard Werkstatt-Zone): `startOfDay`, `endOfDay`, `addDays`, `addMonths`, `startOfWeek`, `startOfMonth`, `endOfMonth`, `eachDayOfInterval`, `isSameDay`, `differenceInCalendarDays`, `getDay`/`getHours`/`getMinutes`/`getDate`/`getMonth`/`getFullYear`,
  `minutesOfDay`, `getISOWeek`; dazu `wallOf` (Wandzeit eines Zeitpunkts), `instantOf` (Zeitpunkt einer Wandzeit), `dayKey`/`timeKey`/`monthKeyOf` (Texte `JJJJ-MM-TT`, `HH:MM`, `JJJJ-MM`), Kalender auf Texten ohne Zone (`addDaysToKey`, `weekdayOfKey`, `daysBetweenKeys`) und `parseZoned`.
  `lib/dates.ts` bleibt die Fassade der Formulare (`toDateInput`, `toTimeInput`, `parseLocalDateTime`, `parseDateParam`, `todayInput`, `currentYear`, `parseMonthParam`, `noon`, `startOfDayIn`, `endOfDayIn`).
* **Kalendertage** (Rechnungsdatum, Fälligkeit, Abwesenheit, Prüfdatum …) werden als **12:00 Uhr der Werkstatt-Zone** gespeichert (`noon(day)`) und mit `toDateInput`/`dayKey` in dieser Zone gelesen; „von … bis …“-Filter nutzen `startOfDayIn`/`endOfDayIn`. Es gibt keine kopierten `noon`-Hilfen mehr.
* **Sommerzeit:** `parseZoned`/`parseLocalDateTime` lehnen eine Wandzeit ab, die es nicht gibt (02:30 am Umstellungstag), die doppelte gilt einmal (die erste); Berechnungen (`instantOf`, `addDays`) rücken in der Lücke auf den Zeitpunkt danach und behalten die Uhrzeit über die Umstellung. Ein Tag hat 23 oder 25 Stunden
  (`startOfDay`/`endOfDay`); Abstände in Tagen zählen Kalendertage (`differenceInCalendarDays`). Die Jobs (Cron) nutzen dieselben Primitive (`lib/jobs/schedule.ts` importiert sie aus `zone.ts`).
* **Anzeige:** `getI18n()` übergibt `workshopZone()` an den Übersetzer, `date()` und `{name|time}` zeigen Zeitpunkte in der Werkstatt-Zone (`createTranslator(locale, messages, timeZone?)`).
* **Regeln (Architekturtest „Zeitzone“):** kein `date-fns` im Produktivcode, keine Ortszeit-Getter/-Setter von `Date` (`getHours`, `setDate` …), keine Ortszeit-Konstruktoren (`new Date(2026, 0, 1)`, `new Date("…T12:00:00")`). Die Abhängigkeit `date-fns` wird im Produktivcode nicht mehr gebraucht.
* **Tests** sind unabhängig von der Prozess-Zone: `withWorkshopZone(zone, fn, decoy?)` (`src/test/zone.ts`) setzt die Werkstatt-Zone und lässt den Prozess in einer anderen laufen (Standard Pacific/Auckland). `lib/zone.test.ts`: Berlin, Zürich, UTC, Auckland, Umstellungstage (letzter Sonntag im März/Oktober), `noon`,
  Mitternachtsfenster, ISO-Woche, Invarianz über verschiedene Prozess-Zonen; `modules/zone-domain.test.ts`: Termine, Abwesenheiten, Rechnungen, Reifen-Saison, Monate. Die Testläufe sind zusätzlich unter `TZ=America/Los_Angeles` und `TZ=Pacific/Auckland` grün.

### Regeln für sauber getrennten Code

Diese Regeln prüfen `src/architecture.test.ts` und `src/modules/catalog.test.ts`.

1. **Plattform kennt keine einzelne Funktion.** `src/server`, `src/components`, `src/i18n`, `src/lib`, `src/platform` und
   `src/capabilities` importieren nichts aus `src/modules/<modul>/<funktion>` (Ausnahmen: `catalog`, `define`, `features`,
   `registry`, `types`, `default-roles`, `jobs`, `operation-hooks`, `api`).
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
8. **Beiträge statt zentraler Listen (Modulautonomie).** Was eine Funktion betrifft, steht bei ihr: Rechte, Navigation und **Audit-Aktionen** in der `feature.ts` (`auditActions`; die Plattform behält nur ihre eigenen in `PLATFORM_AUDIT_ACTIONS`,
   `src/lib/audit-actions.ts`), **Start- und Demo-Daten** in `seed.ts`, Seiten in `pages.ts`, Jobs in `jobs.ts` … Die Composition Roots in `src/modules/` sammeln sie ein; die Plattform kennt keine Funktion. Jede Datei einer Funktion gehört zu ihr
   (Ordner `modules/<modul>/<funktion>/`, Seiten und Route Handler über `routes` der `feature.ts`, auch `api/<name>`); Funktions-IDs dürfen Ziffern und Bindestriche enthalten (`time-tracking`), ein Ordner ohne Katalogeintrag und ein Route Handler ohne Funktion
   (außer begründet in `PLATFORM_API_ROUTES`) brechen `architecture.test.ts`. `audit-actions.test.ts`: jede Aktion gehört genau einer Stelle, wird verwendet, hat Beschriftungen; `seed.test.ts`: jede `seed.ts` ist eingetragen, der Demo-Seed deckt jeden Seed-Verweis der
   Routen-Inventur ab (`pages.ts`), ein zweiter Lauf legt nichts doppelt an. Seeds finden Daten anderer Funktionen über natürliche Schlüssel (Kennzeichen, Nachname), nie über Ids oder Imports; sie importieren nichts mit `server-only` (das Seed-Skript lädt sie; der Architekturtest prüft die Importkette).
9. **Datenzugriff über `queries.ts`** – siehe „Datenzugriff (`queries.ts`)“.
10. **Zeit in der Werkstatt-Zone** – siehe „Zeitzone“.

## Datenhaltung

* **SQLite**, eine Datei (WAL-Modus, `synchronous=FULL`), im Container unter `/data`. Reicht für eine Werkstatt mit einigen
  Dutzend Nutzern über viele Jahre; Schreibvorgänge laufen nacheinander und dauern Millisekunden. Voraussetzung: **lokale Platte**
  (keine SMB-/NFS-Freigabe). Grenzen: keine mehreren App-Instanzen, keine Hochverfügbarkeit.
* Schema nur in `prisma/schema.prisma`. **Keine Enums und keine Json-Felder** – Zustände sind Strings mit festen Werten im Code
  (hält einen späteren Datenbankwechsel offen). Textsuche immer über `contains()` aus `src/server/search.ts` (Prisma maskiert `%`/`_` unter SQLite nicht: `contains()` entfernt `%`, ein Suchtext nur aus Platzhaltern findet nichts) (SQLite unterscheidet
  bei Umlauten Groß-/Kleinschreibung). **Normalisierte Suchspalten (P2b-1):** Namen, Orte, Telefonnummern, Marke/Modell/FIN und Rechnungspartner suchen über Spalten, die die Operationen beim Schreiben mitpflegen
  (`Customer.nameKey/cityKey/phoneKey`, `Vehicle.searchKey`, `Invoice.partyKey`; reine Funktionen in `src/lib/search-key.ts`: klein, ohne Akzente, ä/ö/ü in beiden Schreibungen „ae“ und „a“, ß → ss, Trenner als Leerzeichen, Telefon nur
  Ziffern mit +49/+43/+41 → 0; Kennzeichen wie bisher über `plateNorm`). Die Suche geht über `keyContains`/`phoneContains` (`src/server/search.ts`: jedes Wort muss vorkommen, Reihenfolge egal; Telefon erst ab 3 Ziffern ohne Buchstaben); die
  Bedingungen stehen je Funktion in `queries.ts` (`customerSearchFields`, `vehicleTextWhere`, `invoiceTextWhere`) und gelten für Liste, Schnellsuche, Auswahlfelder und API gleich. **Wer eine Zeile dieser Tabellen schreibt (Operation, Import, Seed), setzt die Spalten mit**
  (`customerRecord`/`vehicleRecord`/`invoiceRecord`); Tests, die Zeilen direkt anlegen und dann suchen, tragen sie selbst ein. **Live-Filter:** `FilterBar` enthält `LiveFilter` (`components/ui/live-filter.tsx`): Es hört auf das GET-Formular und ruft nach
  350 ms Tipppause (Auswahlfelder sofort) `router.replace` mit derselben Adresse wie das Absenden auf – keine zweite Filterlogik im Browser, Wartezustand per `useTransition`; `ResetFilterButton` leert die Felder sofort (Text, Kontrollkästchen, Auswahl auf den neutralen Eintrag) und lädt die ungefilterte Liste – `form.reset()` wäre zu früh bzw. stellte Auswahlfelder auf den Stand des ersten Aufrufs.
* **Geld** als ganze Cent (`Int`), Eingabe über `parseMoneyToCents`.
* **Dateien** (Rechnungsbelege, Doku-Bilder) liegen als normale Dateien unter `/data/files` (`src/server/files.ts`) mit lesbaren
  ASCII-Pfaden, z. B. `rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1234.pdf`; die Datenbank hält nur den relativen `path`
  (`InvoiceFile`, `DocImage`). Dateien werden **nie überschrieben oder verändert** (bei gleichem Namen kommt ein Zähler dazu,
  Umbenennen läuft über Hardlink) – deshalb genügen Hardlinks für Backups. Ausgeliefert nur über Route Handler mit Rechteprüfung.
  **Doku-Bilder** (`src/capabilities/docs/images.ts`) per Rückwärtssuche: sichtbar, wenn eine für den Betrachter sichtbare Seite (aktueller
  Inhalt, nicht `DocVersion`) die Adresse `/api/docs/images/<id>` enthält; Bilder ohne Seite sehen nur Bearbeiter. Kapitel mit Seiten sind
  nicht löschbar (sonst würde eine Beschränkung aufgehoben).
* **Fahrzeuge** (`Vehicle.customerId`) sind optional – nie `vehicle.customer.x` ohne Prüfung; Anzeigenamen über `customerDisplayName()`.
* **Integrität:** Ausgangsrechnungsnummern sind eindeutig (Prüfung in der Transaktion **und** Unique-Schlüssel `Invoice.outgoingKey` = normalisierte Nummer, nur bei `outgoing`, bei Eingang NULL;
  `src/lib/invoice-number.ts`). Kunden mit Fahrzeugen, Halter-Historie oder Rechnungen sind nicht löschbar (Code **und** `onDelete: Restrict` an `Vehicle.customer`, `VehicleOwnership.customer`,
  `Invoice.customer`; Termine bleiben `SetNull`). Indizes auf den Fremdschlüsseln von Termin, Rechnung und Doku-Seite.
* **Sensible Mitarbeiterdaten** (Notfallkontakt, Krankheit) nur mit `employees.sensitive`.
* **Einstellungen zur Laufzeit** liegen in `AppSetting`; Geheimnisse (Update-Token) verschlüsselt über `setSecret/getSecret`
  (`src/server/settings.ts`), Schlüsseldatei `/data/secret.key` – bewusst nicht Teil der Backups.

### Ein Schema oder eins je Funktion? (geprüft, verworfen)

Geprüft (P1c-1): ein Mehrdatei-Schema `prisma/schema/*.prisma` je Funktion. Technisch geht es – in einer Kopie mit 13 Dateien lieferten `prisma migrate diff --to-schema prisma/schema` und `prisma validate` dasselbe Ergebnis, `prisma.config.ts` bräuchte nur
`schema: "prisma/schema"`. Es bringt für die Modulautonomie aber nichts Wesentliches: Prisma verlangt die **Gegenfelder jeder Relation in beiden Modellen** (`Customer.appointments`, `Customer.invoices` neben `Appointment.customer`); eine Funktionsdatei müsste also die Modelle
anderer Funktionen mitführen bzw. deren Datei ändern – genau die Kopplung, die vermieden werden soll – und die Tabellen aller Funktionen liegen ohnehin in einer Datenbank (ausgeschaltete Funktionen behalten ihre Daten). Dagegen stehen Eingriffe in `db:baseline`/`db:check`/`db:fresh`,
`pages.test.ts` (liest `schema.prisma`), die Reihenfolge der Tabellen in der Baseline (nach Dateinamen) und die Regel „Schema nur in `prisma/schema.prisma`“. Es bleibt bei **einer** Datei; die Abschnittsüberschriften gliedern sie nach Funktionen.

### Migrationen

Es gibt immer **eine Baseline** (`prisma/migrations/00000000000000_baseline`). Ihre erste Zeile ist der Marker `-- schrauberos:baseline unreleased`
(bzw. `frozen`); den Marker kennen Wächter und Skripte.

* **Solange nichts veröffentlicht ist (`unreleased`, der Stand von v0.2.0):** keine einzelnen Migrationen. Nach **jeder** Schema-Änderung
  `npm run db:baseline` – das Skript erzeugt die Baseline aus `schema.prisma` neu und ersetzt dabei alle anderen Migrationsordner; danach
  `npm run db:fresh`. So laufen Migrations-, Backup-/Concurrency-Tests, Harness und Drift-Check immer gegen den aktuellen Stand. Es gibt
  **keine Rückwärtskompatibilität zu 0.1.0**: Beim Start erkennt die App eine fremde Migrationshistorie (Baseline mit anderer Prüfsumme,
  fremde Namen, Tabellen ohne Historie) und startet **nicht** (siehe unten). Unbekannte *neuere* Migrationen in der Datenbank bleiben erlaubt
  (Rückfall auf eine ältere Version nach der Veröffentlichung).
* **Mit der Veröffentlichung** (Release-Block): `npm run db:freeze` setzt den Marker auf `-- schrauberos:baseline frozen sha256:<Prüfsumme des Rumpfes>` und trägt
  jede weitere Migration mit Prüfsumme in `prisma/published-migrations.json` ein (committen, dann Tag setzen). Ab dann werden die Baseline und alle
  veröffentlichten Migrationen **nie verändert** – erzwungen an drei Stellen: `npm test` vergleicht die Prüfsummen (`src/lib/migration-freeze.ts`), die App
  verweigert veränderte angewendete Migrationen, und die Pipeline lässt bei einem Versions-Tag `npm run db:release-check` laufen (alles eingefroren, und gegenüber dem
  letzten Release-Tag mit eingefrorener Baseline ist nur Neues hinzugekommen: `git diff --name-status`, nur `A` erlaubt – das fängt auch ein „nachgezogenes“ Prüfsummen-Feld).
  `db:baseline` verweigert die Arbeit bei `frozen` und bei einer Baseline ohne Marker. Schema-Änderungen gehen so:

```bash
npm run db:migrate -- add_warranty    # legt die Migration an, wendet sie lokal an, erzeugt den Client neu
```

* **Wächter** (`src/lib/migration-guard.ts`, Test `migration-guard.test.ts`): Jede Migration nach der Baseline darf kein `DROP`/`RENAME`, keine neue
  Spalte `NOT NULL` ohne `DEFAULT`, keinen neuen `UNIQUE`-Index auf einer Bestandstabelle (Ausnahme: neue nullable Spalte), kein
  `DELETE`/`UPDATE`/`REPLACE` (auch nicht über `WITH` oder `ON CONFLICT … DO UPDATE`), keinen `CREATE TRIGGER` und kein `PRAGMA`/`ATTACH`/`DETACH`/`VACUUM` enthalten.
  Er prüft auf dem SQL ohne Zeilen- und Blockkommentare und ohne den Inhalt von Zeichenketten und Bezeichnern, unabhängig von Groß-/Kleinschreibung und Schema-Präfix
  (`main."T"`), mit und ohne `COLUMN`. Eine **begründete Ausnahme** steht als Kommentarzeile in der Migration:
  `-- guard:allow <regel>: <Begründung>` (Regeln `drop`, `rename`, `not-null`, `unique`, `data-change`, `trigger`, `pragma`; Begründung Pflicht, fällt im Review auf).
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
eine Neustart-Schleife über Starter/Docker), die Datenbank bleibt unangetastet – auch die Prüfung selbst liest nur (kein WAL-Modus, keine neue Tabelle, keine Nebendateien). `/api/health`
antwortet 503 `{"status":"reinstall"}`; **jeder andere Pfad** (Seiten, Server Actions, Route Handler, `/api/v1`, `/api/ical`) beantwortet der Proxy (`src/proxy.ts`) mit 503 (Browser: kurze
zweisprachige Seite, sonst JSON), das Root-Layout zeigt als zweite Sicherung nur den Hinweis (`src/app/reinstall-notice.tsx`, zweisprachig), und der Launcher wertet das (`src/lib/updates/health.ts`) als endgültig: Bei einem Update oder
einer Wiederherstellung fällt er sofort zurück statt 90 s zu warten, sonst läuft der Container ungesund weiter, ohne zu starten und ohne Schleife.
Test: `src/server/startup.test.ts` (präpariertes altes Volume), `migrate.test.ts`.

### Ersteinrichtung und Einrichtungs-Token

Beim App-Start (`src/server/startup.ts`) erzeugt `ensureSetupToken` (`src/server/setup-token.ts`), solange es **keinen Benutzer** gibt, ein
zufälliges Token (160 Bit), schreibt es als `<DATA_DIR>/setup-token` (Modus 0600, nicht Teil der Backups) und ins Container-Log. Die
Ersteinrichtung (`src/app/setup/actions.ts`) prüft in dieser Reihenfolge: gibt es schon einen Benutzer (→ `/login`, nichts anderes
wird angefasst), Token (Vergleich über SHA-256 in konstanter Zeit, global gedrosselt: 5 freie Versuche, dann 5 s … 60 s), Eingaben,
dann Anlegen in einer Transaktion; **erst danach** wird die Zeitzone als Werkstatt-Zone gesetzt (`applyTimezone`, vorher `isValidTimezone`; siehe „Zeitzone“) und das
Token gelöscht. Dasselbe gilt für die Einstellungen (Zeitzone erst nach dem Speichern). Das Token ist die bewusste Ausnahme vom Grundsatz
„alles über die Weboberfläche“: **einmalige Installationshandlung, kein laufender Betrieb**.

**Wiederherstellung in der Einrichtung** (frisches Volume, vorhandenes Backup): Unter dem Formular steht „Aus einem Backup wiederherstellen“ (`src/app/setup/setup-restore.tsx`). Die Datei geht gestreamt an `POST /api/setup/restore`
(`src/app/api/setup/restore/route.ts`; läuft wie der Backup-Upload **nicht** durch den Proxy, Body-Grenze). Reihenfolge: Startzustand → gibt es schon einen Benutzer (409) → Herkunft (`x-requested-with`) → **Einrichtungs-Token** im Kopf `x-setup-token`
(`checkSetupToken`, dieselbe globale Drosselung wie die Ersteinrichtung; **vor** dem Lesen des Bodys) → Datei übernehmen (`importBackupFile`, auch verschlüsselte `.sobk` mit `x-recovery-key`) → `stageRestore(name, { recoveryKey })` → Audit `setup.restore` → Neustart.
Ohne das Token wäre der Schutz der Ersteinrichtung über ein importiertes Backup (mit eigenen Administratoren) zu umgehen. Test: `src/server/backup/recovery-key.test.ts` (ohne/falsches Token, Drosselung, 409 nach der Einrichtung, mit/ohne Schlüssel). Der Audit-Eintrag steht in der
frischen Datenbank, die danach ersetzt wird (er bleibt im Sicherungsstand „vor Wiederherstellung“).

### Gleichzeitiges Bearbeiten

Bearbeiten-Formulare tragen die Version der Zeile (`updatedAt`) als Feld `version` mit (`versionOf(row)` aus
`src/lib/concurrency.ts`). Die Server Action belegt die Zeile mit `claimed(...)` und meldet sonst `common.conflict`, statt still
zu überschreiben. Prüfung und Schreiben, die zusammengehören (z. B. Doppelbelegung eines Arbeitsplatzes), laufen in
`db.$transaction`. Neue Bearbeiten-Formulare müssen das übernehmen (nur Tabellen mit `updatedAt`).

### Aktionen und Operationen (Aktions-Rahmen)

Jede schreibende Server Action läuft über den Rahmen in `src/server/operations` (Architekturtest: `architecture.test.ts`). Kern ist
`defineOperation({ name, permission, input, audit, run })`; zwei Adapter machen daraus eine Aktion oder einen API-Aufruf (siehe „Programmierschnittstelle“). Die Operationen liegen in `operations.ts` (ohne `"use server"`, damit auch `api.ts` sie benutzen kann), die Aktionen in `actions.ts` (nur `defineAction`, Rückmeldung/Weiterleitung):

```ts
const saveThingOperation = defineOperation({
  name: "things.save",
  permission: "things.edit",            // Pflicht, kein Standard; "authenticated" = jede angemeldete Person (ausgeschrieben)
  input: schema,                        // Zod; Fehlermeldungen als Meldungsschlüssel (custom: message = Schlüssel, params = Platzhalter)
  audit: (input) => (input.id ? "thing.update" : "thing.create"), // oder audit: false + auditReason: "Begründung"
  prepare: async ({ input }) => …,      // optional: Aufwendiges vor der Transaktion (Passwort-Hash, Datei ablegen)
  run: async ({ input, principal, prepared, tx, audit, emit, afterCommit }) => {
    if (!(await claimRow(tx.thing, input.id, input.version))) fail("conflict");
    audit({ target: "…", entityId: "…" });
    return { id };
  },
});
export const saveThing = defineAction(saveThingOperation, { form: …, revalidate: […], redirect: ({ id }) => …, message: "common.saved" });
```

* **Der Kern ist transportneutral:** `run` kennt weder `redirect` noch Flash noch Übersetzung noch `next/*` (Architekturtest). Fachfehler: `fail(code, schlüssel)` /
  `failField(feld, schlüssel)` (`OperationError`, Codes `invalid`, `forbidden`, `notFound`, `conflict`, `duplicate`, `inUse`, `busy`, `failed`). Datenbankfehler werden zu Fachfehlern: P2002 → `duplicate`, P2025 → `notFound`, P2003 → `inUse` **beim Löschen** (Operationsname enthält `delete`/`remove`), sonst `invalid`
  (ein Verweis ist ungültig geworden), P2028 (Transaktion kam nicht zustande) → `busy` (API: 503 mit `Retry-After`, Formular: „Datenbank ausgelastet“). Unerwartete Fehler gelangen bis zum Adapter, der nur Art und Code protokolliert (`src/lib/log-safe.ts`: keine Meldung, kein Stack,
  Steuerzeichen entfernt – auch in Audit-Bezeichnungen).
* **Ablauf:** Recht → Eingabe (Zod, `fieldErrors()`: Code → Schlüssel) → `prepare` → **eine Transaktion** um `run`, synchrone Hooks und den Audit-Eintrag (keine Änderung ohne
  Eintrag, kein Eintrag ohne Änderung) → `afterCommit`-Aufgaben. Nicht in der Transaktion (`transaction: false`): lange Vorgänge wie Backup und Update; dann kein Hook.
  **Innerhalb von `run` nie `db` benutzen, sondern `ctx.tx`** (SQLite hat einen Schreiber – ein zweiter Zugriff über `db` wartet auf die eigene Transaktion). Helfer, die schreiben,
  nehmen deshalb einen optionalen Client (`setSetting(key, value, tx)`, `setFeatureOverride(…, tx)`). Bearbeiten-Formulare: `claimRow(tx.modell, id, version)` in der Transaktion.
* **Adapter Server Action** (`defineAction`): versteht `useActionState` (`(prev, formData)` → `ActionState`) **und** `<form action>` (`(formData)`). Ohne Formularzustand (Löschen,
  Statuswechsel, Schalter) kommt die Rückmeldung als **Flash** (UX-06): Cookie `so_flash` (unter HTTPS `__Host-so_flash`) mit **nur einem Meldungsschlüssel** und einfachen Platzhaltern;
  `FlashNotice` im Anwendungsrahmen übersetzt ihn und übergibt ihn einmal an den **Toast** (`FlashMessage` löscht das Cookie; `components/ui/toast.tsx`: Erfolg mindestens 5 s, Fehler bleiben stehen,
  zwei immer vorhandene Live-Regionen, unten über Safe-Area und `FormActions`). Dieselbe Quelle nutzt `Form` für `state.message`. Es gibt kein `?saved=`/`?error=` mehr in Adressen. `redirect()`/`notFound()` werden nie verschluckt (`unstable_rethrow`, Test). Anmeldung/Recht prüft der Adapter wie bisher mit `requireSession`/`requirePermission`
  (ohne Sitzung `/login`, `mustChangePassword` → `/account`, falsches Recht `/forbidden`, ausgeschaltete Funktion 404); der Kern prüft das Recht zusätzlich.
* **Adapter API** (`runApiOperation` in `src/server/operations/api.ts`): übersetzt Ergebnis und Fehler einer Operation in HTTP-Semantik (Problem-Format, Statuscodes). Pipeline und Ressourcen: Abschnitt „Programmierschnittstelle“. Formular- und API-Eingabeschemas bleiben getrennt (Formular: Text-Schemas wie `moneyCents`, `dateText` aus `src/lib/zod-fields.ts`; API: JSON-Typen, Geld als Cent); geteilt wird die Domänenebene (Prüfung, Audit).
* **Audit:** `audit: "<aktion>"` (Aktion in `auditActions` der `feature.ts` der Funktion bzw. in `PLATFORM_AUDIT_ACTIONS` + Beschriftungen `audit.actions.*`) oder `audit: false` mit `auditReason` (Begründung Pflicht). Fehlschläge außerhalb der
  Transaktion (z. B. `system.updateFailed`, `backup.restoreFailed`) schreibt `onFailure`. Bei `transaction: false` (Wiederherstellung, Update, Backup) ist die Wirkung beim Protokollieren schon eingetreten: Ein Fehler im Audit-Eintrag wird **protokolliert, bricht die Operation aber nicht ab**
  (sonst bliebe z. B. der vorgemerkte Neustart aus); innerhalb der Transaktion gilt weiter „keine Änderung ohne Eintrag“. Das Audit-Log wird nach der eingestellten Frist (Standard 730 Tage, **mindestens 30 Tage** oder 0 = unbegrenzt; Einstellungen → Sicherheit, die Änderung steht mit altem und neuem Wert im Log;
  `src/server/audit-retention.ts`) vom Job-Runner (Job `audit.retention`, täglich nachts) bereinigt; scheitert ein Lauf, wiederholt der Runner mit Wartezeit.
* **Outbox** (`OutboxEvent`, `src/server/outbox.ts`): `ctx.emit(type, payload, entityId)` schreibt ein Ereignis **in derselben Transaktion** – nach einem Rollback gibt es keines, nach dem
  Commit genau eines. Der Job-Runner stellt zu (Abschnitt „Job-Runner“); angemeldete Abnehmer gibt es noch keine – Ereignisse ohne Abnehmer gelten als erledigt und werden nach 14 Tagen aufgeräumt.
* **Transaktionale Hooks:** Eine Funktion meldet sich in ihrer `hooks.ts` für eine Operation einer anderen an (`OperationHookDef`), eingesammelt in `src/modules/operation-hooks.ts`
  (nur von `src/server/operations/hooks.ts` importiert). Der Hook läuft **synchron in derselben Transaktion** (nur wenn seine Funktion aktiv ist) und kann mit einem Fehler die Operation verhindern; die
  auslösende Funktion kennt ihre Abonnenten nicht. Asynchrone Wirkungen (Webhooks, Mail) gehören in die Outbox.
* **Berechtigungs-Matrix** (`src/server/operations/matrix.test.ts`, generiert aus dem Quelltext): jede Action und jeder Route Handler wird ohne Sitzung, mit `mustChangePassword`, mit falschem Recht
  (alle Rechte außer dem erforderlichen) und mit ausgeschalteter Funktion aufgerufen und muss ablehnen, ohne etwas zu verändern. Neue Aktionen/Routen sind automatisch dabei; öffentliche Routen
  (`/api/health`) stehen in einer Ausnahmeliste im Test; `/api/v1` ist nur per Token erreichbar (eine Cookie-Sitzung ergibt 401) und hat eine eigene generierte Matrix (`src/server/api/matrix.test.ts`).
* **Eingabeabhängiges Recht** (`permissionFor`): Hängt das Recht von der Eingabe ab (Dokumentationsbereich: `<gruppe>.edit`), wählt `permissionFor(raw)` es aus dem rohen Formular;
  `permission` bleibt der Standard und die Vertretung für Matrix und Funktions-Zuordnung. Die Aktion prüft das gewählte Recht, bevor etwas gelesen oder geschrieben wird.
* **Konto-Operationen** (`permission: "authenticated"`, `allowPasswordChange: true`): Nur Profil, Passwort ändern, Notzugangs-Hinweise/-Code bestätigen und die Anzeigeeinstellungen (Sprache, Design)
  sind auch mit ausstehendem Passwortwechsel (`mustChangePassword`) erreichbar; für alle anderen Aktionen führt dieser Zustand zum Konto. Aufwendiges (scrypt) liegt in `prepare`, nie in `run`.
* **Transport-Nacharbeit der Aktion** (`ActionOptions`): `state(data, input, i18n)` ergänzt den Formularzustand nach Erfolg (der einmalig angezeigte Wiederherstellungs-Code; nie in URL, Log oder Audit),
  `onSuccess(data, input)` erledigt Transportsachen wie Cookies (`src/server/preference-cookies.ts`). `run` bleibt davon frei (Architekturtest: kein `next/headers` in Operationsdateien).
* **Dynamische Werte aus Client-Code:** Aktionen nehmen `FormData`; wer einen einzelnen Wert schickt (Sprach-/Design-Umschalter), baut ein `FormData` mit einem Feld.
* **Nicht umgestellt** (Liste `LEGACY_ACTION_FILES` in `architecture.test.ts`, darf nur schrumpfen): Anmeldung/Abmeldung, Notzugang einlösen und Ersteinrichtung – sie laufen vor der Sitzung auf eigenen
  Pfaden (Anmeldedrosselung, Einrichtungs-Token) und haben kein Recht, das der Rahmen prüfen könnte.

### Programmierschnittstelle (API-Kern, `/api/v1`)

Andere Systeme können Daten über `/api/v1` lesen und schreiben. **Nur über HTTPS betreiben** (oder im vertrauenswürdigen LAN): Das Token steht bei jeder Anfrage im Header und ist ein Klartext-Geheimnis. Der **API-Kern** (Tokens, Authentifizierung, Rate-Limit, Idempotenz, Fehlerformat, OpenAPI) steht in `src/server/api`
und `src/lib/api`; **jede fachliche Funktion bringt ihre Ressourcen in einer `api.ts` mit**. Noch nicht vorhanden (Block F11 „API & Webhooks“): Oberfläche zur Token-Verwaltung,
Webhooks, Datei-Upload (Belege) per Multipart und die Doku-Seite der Ressourcen – bis dahin gibt es dafür weder Hilfe-Kapitel noch Bedienung in der App.

* **Ein Eintrittspunkt:** `src/app/api/v1/[...path]/route.ts` → `handleApiRequest` (`src/server/api/router.ts`). Die Funktionen tragen ihre Endpunkte in `src/modules/api.ts` ein (Composition Root,
  nur vom Router importiert – nicht über `registry.ts`, das in jeden Seiten-Bundle gelangt und sonst alle `api.ts` mitzöge). Reihenfolge der Pipeline: Token → Rate-Limit → Route → **Funktion aktiv (sonst 404)** → Methode (405) → **Recht (403)** → Filter/Körper prüfen
  (1 MiB, `application/json`, strenge Schemas) → Idempotenz → Endpunkt. Ohne gültiges Token ist **alles** 401, auch unbekannte Pfade.
* **Tokens** (`ApiToken`, `ApiTokenScope`): `sos_` + 32 Zufallsbytes; gespeichert wird **nur der SHA-256-Hash** (hochentropisch, ein langsamer Hash wäre sinnlos). Das Klartext-Token steht
  einmalig im Ergebnis von `createApiTokenOperation` (`src/server/api/tokens.ts`), nie in Log, Audit, URL oder Datenbank. Besitzer, Ablauf (Pflicht, höchstens 365 Tage), `lastUsedAt`
  (höchstens alle 10 Minuten, atomar, ohne `updatedAt`), Widerruf (`revokedAt`), Anfragen je Minute am Token. Besitzer gelöscht → Token weg (Cascade); Besitzer gesperrt oder mit
  ausstehendem Passwortwechsel → Token ungültig. **Erzeugen/Widerrufen nur per Sitzung** mit dem Verwaltungsrecht `settings.manage` (F11 ersetzt es durch `api.manage` und verlangt die erneute
  Passwortabfrage in `prepare`); ein Token kann nie ein Token verwalten. Beide Vorgänge stehen im Audit-Log (`apiToken.create/revoke`, Ziel = Name und Anfang des Tokens).
* **Wirksame Rechte = Scope ∩ aktuelle Rechte des Besitzers**, bei **jeder** Anfrage neu berechnet (`src/lib/api/scope.ts`). Nie in einem Token: `adminOnly`-Rechte, alle Rechte der
  Plattform-/Verwaltungsfunktionen (Pflichtfunktionen) und `API_NEVER` (`employees.sensitive`) – auch nicht, wenn ein Administrator das Token erzeugt. Der Scope darf beim Erzeugen höchstens
  die Rohrechte des Erzeugers enthalten (Rechte-Hierarchie, `checkTokenScope`). Der API-Principal ist nie Administrator und trägt keine Rollen.
* **Cookie und Token bleiben getrennt:** Die API liest nie das Sitzungs-Cookie (eine Cookie-Sitzung allein ist 401); Seiten und Server Actions lesen nie den `Authorization`-Header
  (`src/modules/api.test.ts` erzwingt beides im Quelltext, `src/server/api/api.test.ts` und `matrix.test.ts` im Verhalten).
* **Drosselung nur im Fehlerpfad:** Zuerst der Hash-Lookup; **nur ungültige** Tokens (und Anfragen ohne Token) laufen in die Drosselung (`auth.ts`, `state.ts`): 120 Fehlversuche pro Minute
  insgesamt, 30 je Adresse – je Adresse nur mit der Proxy-Einstellung (`src/lib/client-ip.ts`, sonst wäre der Header fälschbar) – dann 429 mit `Retry-After`. Kein scrypt, nur ein Zähler im Speicher.
  Gültige Tokens werden davon nie berührt. Zusätzlich je Token ein Fenster pro Minute (Standard 120, am Token einstellbar): 429, `Retry-After`, Header `RateLimit-Limit/-Remaining/-Reset`.
* **Idempotenz** (`Idempotency-Key`, bei POST/PATCH/DELETE): je Token, `<Methode> <Pfad>` und Schlüssel (1–128 Zeichen `A-Za-z0-9._:~-`) eine Zeile (`ApiIdempotencyKey`, Unique); Fingerabdruck der Anfrage = Körper **und** `If-Match`. Gleicher
  Schlüssel + anderer Fingerabdruck → 422 `idempotency_key_reuse`; Wiederholung → gespeicherte Antwort mit `Idempotent-Replayed: true`; parallele Doppelanfrage → 409 `idempotency_in_progress` (die Unique-Zeile
  entscheidet, wer läuft); eine Zeile ohne Antwort, die älter als 60 s ist, gilt als verwaist und wird übernommen. **Gespeichert werden nur Erfolge (2xx)**; jede andere Antwort (404, 409, 412, 428, 422, 5xx, 429 …)
  gibt den Schlüssel frei – die Operation hat dort nichts verändert, und eine Wiederholung nach einer Korrektur soll neu entscheiden dürfen. **Antworten liegen 24 Stunden in der Datenbank** (Körper des Ergebnisses, also
  fachliche Daten wie Kundenname oder Adresse; sie fallen unter dieselbe Aufbewahrung wie die Daten selbst und gehören zum Backup); je Token höchstens 10 000 Schlüssel, darüber 429 bis zum Ablauf der ältesten.
  Scheitert der Endpunkt **nach dem Commit** der Operation (Nachlesen der Zeile …), liefert die Pipeline eine **Mindestantwort** (`id`, bei 201 `Location`; `ApiCall.committed`) und hält sie fest – die Wiederholung legt nichts
  doppelt an. Aufräumen im Scheduler (`runApiCleanup`). Bekannte Grenze: Stürzt der Prozess zwischen Commit der Operation und dem Speichern der Antwort ab, kann die Wiederholung nach 60 s die Operation erneut ausführen.
* **Fehlerformat** (`application/problem+json`, angelehnt an RFC 9457): `{ type, title, status, code, detail, fields?, reason?, params? }`; `code` ist maschinenlesbar (`src/lib/api/problem.ts`),
  `fields` nennt je Eingabefeld einen Meldungsschlüssel (`code`, Pfad mit Punkten, z. B. `tires.FL.dot`). Fachliche Fehler der Operation: 422 (Eingabe), 404, 409 (Eindeutigkeit/„wird noch verwendet“),
  **412** (Version veraltet). Keine Stacks, Pfade oder SQL.
* **Lesen:** `GET /x` mit `page`/`limit` (Standard 50, höchstens 200), `sort` (`-name,city`, nur Whitelist der Ressource, höchstens 3 Schlüssel), Filter je Ressource (unbekannte Parameter → 422). Antwort
  `{ data: [...], page: { number, limit, total, pages } }`; Element `{ data: {...} }` mit `ETag` und `version`; `If-None-Match` → 304 (exakter ETag, schwacher `W/"…"`, Liste, `*`).
* **Schreiben:** `POST` (201, `Location`), `PATCH` (Teil-Update; **`If-Match` ist Pflicht** → 428 ohne, 412 bei veralteter Version; `null` löscht ein Feld), `DELETE` (204), Aktionen als `POST /x/{id}/<aktion>`
  (Aktionen, die die Zeile ändern – Schnellstatus, Ein-/Ausbuchen –, setzen `ifMatch: true` und verlangen wie PATCH den ETag).
  Alles läuft über **dieselben Operationen** wie die Oberfläche (Recht, Prüfung der Sache, Konfliktprüfung, Transaktion, Hooks, **Audit** – der Handelnde heißt `<Name> [API: <Tokenname> · sos_ab12…]` – Name **und** Tokenanfang, denn Namen sind nicht eindeutig; nie das ganze Token).
  Geld sind ganze Cent, Kalendertage `JJJJ-MM-TT` (**echte Kalendertage**: `2026-02-30` und `2026-13-45` sind 422, Formulare und API prüfen gleich über `isCalendarDay`/`dateText`), Zeitpunkte ISO 8601.
  Eine Ortszeit, die es nicht gibt (Lücke der Sommerzeitumstellung), ist ein Feldfehler. **Pfade** sind flach, mit dem Namen der Funktion als Präfix (`/employee-absences`, `/fleet-costs`, `/network-devices`, `/appointment-bays`).
  `permission: "authenticated"` (Konto-Operationen) gilt nur für Sitzungen – ein Token wird vom Kern zentral abgelehnt.
* **OpenAPI 3.1:** `GET /api/v1/openapi.json` (gültiges Token nötig), erzeugt aus den Zod-Schemas der Endpunkte (`z.toJSONSchema`), deterministisch, nur aktive Funktionen, ohne Daten und Interna. Sie nennt alle Statuscodes (400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429, 503, 304 am Element), die Header (`ETag`, `Location`, `RateLimit-*`, `Retry-After`, `Allow`) und
  `If-None-Match`; `src/server/api/contract.test.ts` prüft das Dokument gegen **echte Antworten** (Schema aus dem Dokument neu aufgebaut, streng; beobachtete Statuscodes und Header müssen dokumentiert sein).
  `src/server/api/openapi-structure.txt` ist die Struktur-Momentaufnahme (Endpunkte, Rechte, Filter, Sortierungen, Körperfelder); Änderungen der API fallen im Review auf
  (`UPDATE_API_SNAPSHOT=1 npx tsx --test src/server/api/openapi.test.ts`).
* **Nie API-Ressourcen:** Benutzer, Rollen, Einstellungen, Module, Backups, Updates, Audit-Log und die API selbst (Plattform/Verwaltung); Architekturtest `src/modules/api.test.ts`. **Vertragstest:** Jede
  schreibende UI-Aktion hat ein API-Pendant (`ApiEndpoint.operations`) oder steht mit Begründung in `src/modules/api-exceptions.ts` (Konfiguration, Dokumentationsseiten …); Aktionen der Plattform
  und des Kontos (`authenticated`) sind automatisch ausgenommen. Die Ausnahmeliste darf nur schrumpfen. Vergisst man bei einer neuen Funktion (Blöcke 5–11) die `api.ts`, schlägt der Test fehl.
* **Besonderheiten:** Mitarbeiter ohne sensible Daten – kein Notfallkontakt, keine Benutzerverknüpfung, Krankheit gibt es in der API nicht (nicht lesbar, anlegbar, löschbar); der Kundenlöschstopp,
  Ausgangsnummern, Doppelbelegung des Arbeitsplatzes (`findBayClash`) und die DOT-Prüfung gelten unverändert. Nach einer Wiederherstellung sind **alle Tokens widerrufen**: Beim ersten Start danach (solange der Launcher die Wiederherstellung noch nicht bestätigt hat, `restore/applied.json`)
  widerruft `revokeApiTokensAfterRestore` (`src/server/startup.ts`) jedes gültige Token und vermerkt das im Audit-Log (`apiToken.restoreRevoked`) – die Sicherung kennt keine Widerrufe, die seitdem geschehen sind,
  und ein gestohlenes Token würde sonst wieder gültig. Ebenso widerrufen Passwortwechsel, Deaktivierung und Notzugang die Tokens des Kontos (`revokeAccess`, in derselben Transaktion).
* **Tests:** `src/server/api/api.test.ts` (Authentifizierung, Drosselung, Rate-Limit, Idempotenz, Lesen/Schreiben, Fehler), `matrix.test.ts` (generierte Berechtigungs-Matrix über alle Endpunkte: ohne/ungültiges/abgelaufenes/
  widerrufenes Token, Besitzer gesperrt, Cookie allein, Scope fehlt, Besitzer ohne Recht, Funktion aus), `tokens.test.ts`, `resources.test.ts` (Eigenheiten je Ressource), `calendar-days.test.ts` (Kalendertage in Körper, Filter und Operationen, Sommerzeit), `contract.test.ts`, `openapi.test.ts`, `src/lib/api/api-lib.test.ts`.

#### Neue API-Ressource anlegen (Rezept)

1. Die Operationen der Funktion liegen in `operations.ts` (exportiert); `actions.ts` enthält nur `defineAction`. Die API ruft **dieselben** Operationen.
2. `src/modules/<modul>/<funktion>/api.ts`: `export const endpoints = defineResource({ feature, tag, name, singular, path, read, model, item, toItem, version, list, create, update, remove, actions })`
   (`@/server/api/resource`). `item` und die Körper sind Zod-Schemas (`z.strictObject`, JSON-Typen; Geld als Cent, `dateOnly` für Tage); `toInput` bringt den API-Körper in die rohe Eingabe der Operation,
   `current` gibt den Stand einer Zeile in der Form des Körpers zurück (PATCH legt den Teil darüber), `rename` ordnet Feldnamen der Operation denen der API zu. Was die API nicht zeigen darf, filtert `visible`.
3. In `src/modules/api.ts` eintragen. Rechte: nur Rechte der eigenen Funktion, nie `adminOnly`/sensible (`isApiForbidden`); Funktion mit `requires`/`uses` greift auf andere nur über `public.ts` zu.
4. Schreibende UI-Aktionen ohne Endpunkt in `api-exceptions.ts` begründen. `UPDATE_API_SNAPSHOT=1 npx tsx --test src/server/api/openapi.test.ts`, dann Tests in `resources.test.ts` (Eigenheiten) – `matrix.test.ts` deckt die neuen Endpunkte automatisch ab.

### Anmeldung, Sitzung und Rechte-Hierarchie

* **Sitzung:** serverseitig (Tabelle `Session`, nur der Hash des Tokens), Cookie `so_session` im HTTP-LAN, **`__Host-so_session`** (Secure)
  über HTTPS. **Gelesen wird nur der Name, der zum Übertragungsweg passt** (unter HTTPS ausschließlich `__Host-…`, ein untergeschobenes
  Klartext-Cookie zählt nicht – Cookie Tossing; `src/lib/session-cookie.ts`, gilt auch im Proxy). Abmelden löscht den `__Host-`-Cookie mit
  `Secure`, Pfad `/` und `Max-Age=0` (`cookies().delete()` täte das nicht, der Browser verwürfe es). Der Proxy (`src/proxy.ts`) prüft nur, ob ein Cookie da ist, und leitet
  **nie von `/login` weg** – die Anmeldeseite prüft die Sitzung selbst (totes Cookie → Formular statt Schleife). Ausgenommen vom Proxy
  (`config.matcher`, getestet): Statik, `manifest.webmanifest`, `sw.js`, Icons, `/api/health` und der **Upload von Sicherungen** `/api/backups/upload`. Ohne Sitzungs-Cookie erreichbar (`OPEN_PAGES`) sind außerdem die Anmeldeseiten, `/setup`, die Offline-Seite `/offline` und das Logo `/api/logo` (Abschnitt „Installierbare App (PWA)“). `/api/v1/*` (Bearer-Token) und `/api/ical/*`
  (Token in der URL) laufen durch den Proxy (wegen „Neuinstallation nötig“), brauchen aber kein Sitzungs-Cookie; übrige `/api/*` ohne Cookie antworten mit 401.
  **Warum der Upload nicht durch den Proxy läuft:** Next puffert den Request-Body für den Proxy im Speicher und **schneidet ihn bei `experimental.proxyClientMaxBodySize` (Standard 10 MiB) stumm ab** – eine größere Sicherung käme verstümmelt an (und ein Gigabyte läge im Speicher).
  `/api/backups/upload` ist deshalb aus dem Matcher genommen und prüft Sitzung, Recht, Herkunft und den Zustand „Neuinstallation nötig“ (503) selbst; sie streamt den Body auf die Platte (Tests: `files.test.ts` mit 11 MiB, `proxy.test.ts`, `next-config.test.ts`). Für die Server Actions
  (Belege bis 10 MiB plus Formular, `serverActions.bodySizeLimit` 12 MB) steht `proxyClientMaxBodySize` auf 13 MB – bewusst nicht global hoch (der Puffer liegt je Anfrage im Speicher). Doku-Bilder (`/api/docs/images`, höchstens 2 MiB) liegen darunter. Neue Upload-Wege über 10 MiB gehören ebenfalls aus dem Matcher.
  Der Titel einer Detailseite (`generateMetadata`) wird nur mit dem Recht der Seite aus der Datenbank gelesen (`sessionIfAllowed`, `src/server/auth/session.ts`; er steht sonst
  schon im gestreamten HTML, bevor die Seite prüft – Test `app/metadata.test.ts`, Architekturregel).
* **Passwörter:** scrypt aus `node:crypto` (`src/server/auth/scrypt.ts`, N=2^15, r=8, p=1, Kosten stehen im Hash). Anmeldungen: höchstens **2** Berechnungen
  gleichzeitig (`hashSemaphore`, teilt sich den libuv-Thread-Pool), Warteschlange begrenzt (voll → „bitte kurz warten“). Alles, was nicht hinter einer Flut
  fremder Anmeldungen warten darf – Passwort setzen, Passwortabfrage im Konto, das Hashen des neuen Passworts beim Notzugang und die Anmeldung von einem
  bekannten Gerät –, läuft auf dem **Eigentümer-Pfad** `ownerLane` (`FairLane`, `src/lib/semaphore.ts`): 1 gleichzeitig (zusammen bleibt ein Thread des Pools frei),
  **je Konto/Vorgang höchstens eine laufende und eine wartende** Berechnung (`accountOwner(userId)`, "setup", "recovery"), insgesamt höchstens 32 Wartende, die Warteschlange
  wird **reihum** über die Schlüssel abgearbeitet; darüber `QueueFullError` (Anmeldung: „busy“, Operationen: `busy`, Einrichtung: „bitte gleich noch einmal“). Eine Flut mit
  einem gestohlenen Geräte-Cookie oder wiederholten Passwortabfragen belegt so nur die eigenen Plätze (R2-SEC-01). **Unbekannte Namen rechnen
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
  gewinnt jedes frei werdende Zeitfenster der Konto-Wartezeit und sperrte so den Besitzer praktisch aus – setzt die App **auf Wunsch** („Dieses Gerät merken“ bei der
  Anmeldung, **Opt-in**, nie automatisch) nach der erfolgreichen Anmeldung ein zufälliges 256-Bit-Cookie (`so_device`, unter HTTPS `__Host-so_device`; HttpOnly, SameSite=Lax, 180 Tage, gleitend), in der Datenbank nur der SHA-256-Hash,
  gebunden an das Konto (höchstens 10 je Konto; ein bekanntes Gerät wird bei jeder Anmeldung aufgefrischt, `useCount` zählt mit). Eine Anmeldung **mit gültigem Cookie dieses Kontos** unterliegt nicht der Konto-Wartezeit (und nicht der
  Datenbank-Sperre), sondern einer eigenen Drosselung je Gerät (`loginThrottle.devices`: 5 freie Versuche, dann 2 s … 90 s) und dem globalen Budget; ihre
  Fehlversuche zählen nicht gegen das Konto. **Die Fehlversuche vom Gerät stehen auch in der Datenbank** (`KnownDevice.failedLogins/lockedUntil`, R2-SEC-03): Ein Neustart
  (leerer Speicher) hebt die Wartezeit eines Geräts nicht auf; `lockedUntil` ist der Zeitpunkt des letzten Fehlversuchs plus Wartezeit (daran erkennt die Zählung nach 15 Minuten
  Ruhe, dass sie veraltet ist). **Ein Erfolg setzt die Zählung nicht zurück** (`devices.forgive`, `recordDeviceSuccess`: nur ein Fehlversuch weniger): Wer das Cookie gestohlen hat,
  bekommt durch die Anmeldungen der Besitzerin keine neuen freien Versuche (Cookie-Dieb mit zwei Spuren). Ohne Cookie (neues Gerät, Angreifer) bleibt die Konto-Wartezeit, Ausweg: abwarten (≤ 90 s) oder der
  Wiederherstellungs-Code. **Das Cookie ersetzt nie das Passwort und nie den zweiten Faktor** (R2-SEC-05, getestet): Hat das Konto eine Zwei-Faktor-Anmeldung, verlangt sie die Anmeldung
  mit bekanntem Gerät trotzdem. Geräte werden vergessen bei Passwortänderung/Deaktivierung durch die Administration, beim Passwortwechsel im Konto (andere Geräte), beim Notzugang,
  beim Abmelden auf Wunsch („Abmelden und Gerät vergessen“) und über die Geräteliste im Konto (einzeln widerrufen, grober Browser-/Zeit-/Adressteil, das eigene Gerät markiert).
  **Platz:** Ein neues Gerät verdrängt nur ein Gerät, das nie wieder benutzt wurde (`useCount` 1, das älteste); sind alle 10 Plätze mit benutzten Geräten belegt, wird das neue
  nicht gemerkt – private Sitzungen schieben ein echtes Gerät nicht per LRU hinaus (R2-SEC-02). `rememberDevice` läuft in **einer** Transaktion (`updateMany` statt `update`: ein
  gleichzeitiges `revokeDevices` ist kein Fehler, R2-SEC-04) und ein Fehler darin macht eine geglückte Anmeldung nie zum Fehler (`rememberDeviceSafely`). **Restrisiko:** Wer das Geräte-Cookie *und* ein Ratefenster am selben Gerät hat, ist durch das
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

**Einlösen** (`/login/recover`, `src/server/auth/recovery.ts`): eigener Pfad, **nicht** über die scrypt-Semaphore der Anmeldungen (das Hashen des neuen Passworts läuft auf dem Eigentümer-Pfad `ownerLane`, nie hinter einer Flut von Anmeldungen). SHA-256, Vergleich in
konstanter Zeit über alle gespeicherten Hashes; Drosselung **ausschließlich global** (`loginThrottle.recovery`: Budget verlangsamt ab 10
Versuchen/min um je 200 ms bis 5 s, weist nie ab) und je Adresse nur mit der Proxy-Einstellung – **nie pro Konto**. Alle Fehler (kein
Code, falsch, Prüfsumme, benutzt, Konto inaktiv/kein Administrator) liefern dieselbe Meldung und werden per Timer auf eine feste Dauer
(1,2–1,5 s) aufgefüllt, ebenso der Erfolg. Bei Erfolg in **einer Transaktion**: Code verbrauchen (Löschen der Zeile entscheidet bei
Gleichzeitigkeit), neues Passwort, alle Sitzungen des Kontos löschen, **zweiten Faktor zurücksetzen** (`resetSecondFactor(tx, id, "recovery")`: der Notzugang umgeht ihn, also
wird er konservativ zurückgesetzt – die Antwort und das Konto zeigen das, siehe unten), Hinweis anlegen, bekannte Geräte vergessen, **neuer Code** (der alte ist ungültig). Kein automatisches Anmelden. Der Hinweis „Notzugang wurde verwendet“ (`RecoveryNotice`;
überlebt das Löschen des Kontos, der Name steht in `userName`) erscheint als Banner (`RecoveryBanner` im Layout) beim Konto und bei allen Administratoren, bis sie ihn bestätigen; Audit
`auth.recoveryCreated/Used/Failed` (Fehlversuche gedrosselt, ohne Code-Material). Der Code gehört zu den Daten: Nach einer
Backup-Wiederherstellung kann ein gedruckter Code veraltet sein (Hinweis in Hilfe und Wiederherstellungs-Rückfrage).

### Geheimnisse, Wiederherstellungsschlüssel und Restore (P1b-4a)

**Abbruch an jeder Stelle (ZP5-8):** `restore/applied.json` ist das **Journal** des Tauschs (`src/lib/updates/restore.ts`): es entsteht *vor* dem ersten Verschieben (`applying`, `had` = was es vorher gab), `pending.json` fällt erst am Ende weg, jeder Schritt (Datenbank, Dateien, Schlüssel) ist wiederholbar und prüft, was schon verschoben ist. Wird der Prozess irgendwo unterbrochen, **vollendet der nächste Start** den Tausch – nie neue Datenbank mit altem Schlüssel. Der Rückfall ist ebenso journalisiert (`rollback`) und wird zu Ende geführt. `restore.test.ts` bricht jeden Schritt einzeln ab (Haken `RestoreHooks.after`) und prüft den Endzustand (mit bisherigen Daten und auf frischem Volume).

**Ein Mechanismus für alle Geheimnisse:** `setSecret/getSecret` (`src/server/settings.ts`) verschlüsseln mit AES-256-GCM und `<DATA_DIR>/secret.key` (`src/server/secrets.ts`; **nicht im Backup**). TOTP-Geheimnisse (`TwoFactor.secret`), das Update-Token,
die Off-Site-Zugangsdaten, das Mail-Passwort (`mail.password`) und künftig Webhook-Secrets und Tresor-Schlüssel gehen alle durch ihn. Zwei Dinge machen ihn nach einem Volume-Verlust brauchbar:

* **Wiederherstellungsschlüssel** (`src/server/recovery-key.ts`, Format `src/lib/recovery-key.ts`): 256 Bit Zufall, 52 Zeichen im Crockford-Alphabet in 13 Gruppen mit Prüfzeichen (anders als der Notzugangs-Code mit 8 Gruppen). Erzeugen/Neu-Erzeugen: Operation
  `admin.backup.createRecoveryKey` (Recht `backup.keys`, `adminOnly`, **nur `isAdmin`**, erneute Passwortabfrage über `confirmOwnPassword`, Audit `secrets.keyCreated` ohne Schlüssel). Der Klartext steht nur in der Antwort der Aktion (`state`), die Ansicht ist
  `RecoveryCodeView` mit eigenen Texten (Druckansicht, Pflicht-Bestätigung → `confirmRecoveryKey`, Audit `secrets.keyConfirmed`). Gespeichert werden in `AppSetting` (also in der Datenbank und in jedem Backup): `secrets.wrapped` = `secret.key` per HKDF-SHA256 +
  AES-256-GCM mit dem Schlüssel umhüllt (`src/lib/secret-wrap.ts`, Salz und Nonce zufällig), `secrets.keyCheck` = HMAC-Kennwert von `secret.key` (erkennt eine veraltete Hülle), `secrets.keyCreatedAt`/`secrets.keyConfirmedAt` und der aus dem Schlüssel
  abgeleitete **Off-Site-Hauptschlüssel** (`secrets.offsiteMaster`, selbst ein mit `secret.key` verschlüsseltes Geheimnis – der Server kann so unbeaufsichtigt sichern, jeder mit dem Schlüssel kann die Off-Site-Dateien auch ohne Server öffnen).
  **Statusfunktion für die Einrichtungs-Checkliste (P2b-4):** `recoveryKeyConfirmed()` / `recoveryKeyStatus()` (`exists`, `confirmed`, `stale`). Eine **Passphrase-Variante gibt es bewusst nicht** (Mindestlänge, Stärkeprüfung, scrypt mit eigenen Kosten und Pfad wären ein zweiter Mechanismus; ein
  zufälliger 256-Bit-Schlüssel ist sicherer und billiger zu prüfen).
* **Restore mit Schlüssel** (`stageRestore(name, { recoveryKey })`, Verwaltung und Einrichtung): Das Backup wird entpackt und geprüft, **dann vor allem anderen** die Hülle aus `pending.db` gelesen und mit der Eingabe geöffnet (`openWrappedSecretKey`); erst danach entsteht der Stand „vor Wiederherstellung“.
  Der entschlüsselte Schlüssel liegt als `restore/pending-secret.key` (0600) bereit; **der Launcher setzt ihn im selben Schritt wie die Datenbank ein** (`applyPendingRestore`: `secret.key` → `restore/replaced-secret.key`; die Bestätigung **hebt sie als `restore/previous-secret-<Zeit>.key` auf** (0600, nicht in Backups, höchstens 10), damit der Stand „Vor Wiederherstellung“ lesbar bleibt – `stageRestore` setzt einen passenden aufgehobenen Schlüssel (Kennwert der Hülle bzw. Entschlüsselung eines Geheimnisses) beim Wiederherstellen eines solchen Backups selbst wieder ein –, Rückfall stellt sie wieder her; `PendingRestore.secretKey` wird nur gesetzt,
  wenn die Datei da ist). Passt der Schlüssel des Backups ohnehin zum laufenden, passiert nichts. Fehler: `keyFormat` (Länge/Zeichen/Prüfzeichen), `wrongKey`, `noWrappedKey` (Backup ohne Hülle), `keyRequired` (.sobk ohne Schlüssel). **Drosselung `loginThrottle.recoveryKey`:** global (nie pro Konto),
  ein `FailureBudget`, das ab dem siebten Versuch pro Minute um je 500 ms (höchstens 8 s) **verlangsamt, aber nie abweist**; eigener Pfad ohne scrypt-Semaphoren (`recovery-key-input.ts`, in `restore.ts` erst bei Bedarf geladen, weil es `server-only` ist). Ein Erfolg gibt seinen Versuch zurück.
* **Zustandsmodell von `secret.key` (ZP5-2, Fehlerklasse „Datenverlust“):** `readSecretKey()` (`src/server/secrets.ts`) unterscheidet **lesbar** (64 Hex-Zeichen), **fehlt** (ENOENT) und **nicht lesbar** (Verzeichnis, Rechte, E/A-Fehler, abgeschnittener Inhalt).
  `encryptSecret`/`decryptSecret`/`secretKeyHex` **werfen** `SecretKeyUnavailableError`, wenn der Schlüssel fehlt oder nicht lesbar ist – `decryptSecret` liefert `null` nur bei lesbarem Schlüssel und fehlschlagender GCM-Prüfung („gehört nicht zu mir“). Eine nicht lesbare Datei wird nie überschrieben.
  Ein neuer Schlüssel entsteht **nur bei frischer Datenbank** (`databaseHoldsSecrets()`: kein `TwoFactor.secret`, kein verschlüsselter Wert, keine Hülle in `AppSetting`; `ensureSecretKey()` beim Start und bei Bedarf, atomar per Nebendatei + harter Verknüpfung). Fehlt die Datei bei vorhandenen Geheimnissen, legt nichts still einen an.
  `secretKeyIssue()` (`secret-key-issue.ts`) benennt die Störung: `missing`, `unreadable`, `mismatch` (lesbarer Schlüssel gehört nicht zur Hülle in der Datenbank, fremdes Volume) und ob sie `recoverable` ist (Hülle vorhanden). Bei einer Störung: **Anmeldung bleibt zu** (`secondFactorRequired` ist
  fail-closed; nur ein Sicherungscode geht, er braucht den Schlüssel nicht), `getSecret` liefert `null` (Lesen ist folgenlos), Schreiben scheitert laut; die Anmeldeseite verlinkt **`/login/key`** (öffentlich, nur im Störungsfall wirksam, `loginThrottle.recoveryKey`), Administratoren sehen ein Banner und in
  Verwaltung → Backups → Schlüssel die Maske „Schlüssel wiederherstellen“ (`reconstructSecretKey()`, `secret-key-recovery.ts`: öffnet die Hülle, prüft `secrets.keyCheck`, legt `secret.key` an; eine falsche Datei wandert nach `secret.key.replaced-<Zeit>`, Audit `secrets.keyReconstructed`). Letzter Ausweg
  `admin.backup.resetSecrets` (Administrator, Passwort, Audit `secrets.resetForced`): legt – nur bei fehlender Datei – einen neuen Schlüssel an und setzt alles Unlesbare zurück.
* **Zurücksetzen nur unter Bedingungen (`resetUnreadableSecrets`):** (1) nur bei **lesbarem** Schlüssel; (2) bei `mismatch` (Wiederherstellung mit dem Wiederherstellungsschlüssel wäre möglich) nur nach einer ausdrücklichen Wiederherstellung (`restore/applied.json`, „ohne Schlüssel“ gewählt) oder per `force`; (3) **vorher** werden die betroffenen
  Zeilen (nur bereits verschlüsselte Blobs, kein Klartext; `AppSetting`, `TwoFactor`, Sicherungscode-Hashes, ggf. die Hülle) als `<DATA_DIR>/secret-reset/<Zeit>-<Zufall>.json` (0600, nie überschrieben, nicht im Backup) gesichert – scheitert das, geschieht nichts. Das Zurücksetzen gehört nie in den Anmeldepfad.
* **Restore ohne Schlüssel:** Beim Start (`startup.ts`) läuft `resetUnreadableSecrets()` (`src/server/secret-reset.ts`) über das **Register der Geheimnis-Verbraucher** (`SecretConsumerDef` in `src/server/secret-consumers.ts`; Plattform: `auth.totp`; Funktionen melden sich in einer `secrets.ts` und tragen
  sich in `src/modules/secrets.ts` ein – `architecture.test.ts` verlangt beides, auch für jede Funktion, die `setSecret` benutzt). Jeder Verbraucher setzt zurück, was er nicht entschlüsseln kann (`resetUnreadableSettingSecrets` für `AppSetting`-Geheimnisse). Gibt es etwas: ein Audit-Eintrag `secrets.reset` (Verbraucher und Anzahl, nie Inhalt),
  der Hinweis `secrets.resetNotice` für **Administratoren** (`SecretsBanner` im Layout, bestätigen mit `account.acknowledgeSecretsReset`), und eine veraltete Hülle (`secrets.keyCheck` passt nicht) wird entfernt – ein neuer Schlüssel ist nötig. Off-Site wird dabei ausgeschaltet.
  **Neues Geheimnis anlegen = Verbraucher anmelden**, sonst bliebe es nach einem Restore unlesbar liegen. Der zweite Faktor setzt seine Konten zusätzlich selbst zurück (`resetUnreadableSecondFactors`, eigener Audit `auth.twoFactorReset`).
* **Nicht im Klartext:** Weder der Wiederherstellungsschlüssel noch `secret.key` noch Zugangsdaten stehen in Datenbank, Audit, Log oder URL (Tests suchen die Zeichenfolgen in allen Tabellen und im mitgeschriebenen Log).

### Konto-Sicherheit: Zwei-Faktor-Anmeldung, Sitzungen, Geräte

**Zwei-Faktor-Anmeldung (TOTP, optional)** – RFC 6238 mit SHA-1, 6 Stellen, 30 s (die Vorgabe der Authenticator-Apps; `src/lib/totp.ts`, mit den RFC-Testvektoren getestet), ±1 Zeitschritt
Toleranz, Vergleich in konstanter Zeit über alle Kandidaten. Tabellen `TwoFactor` (je Konto eine Zeile) und `TwoFactorBackupCode`.
* **Geheimnis:** Base32, **verschlüsselt** mit dem Mechanismus der Geheimnisse (`encryptSecret`: AES-256-GCM, Schlüssel `secret.key` außerhalb der Backups) – nie im Klartext in
  Datenbank, Log oder Audit; der Klartext steht nur in der Antwort der Einrichtung (QR-Code und Textschlüssel). Einrichtung: Passwortabfrage → QR-Code (serverseitig als Matrix aus
  `qrcode-generator` (MIT, ohne Abhängigkeiten, kein externer Dienst), im Browser als SVG gezeichnet – die CSP bleibt unberührt) + 10 **Sicherungscodes** → **Aktivieren** verlangt einen
  Code der App **und** das Häkchen „Sicherungscodes gesichert“ (serverseitig erzwungen). Die Code-Eingabe dabei hat ein eigenes Limit (`loginThrottle.totpSetup`).
* **Sicherungscodes:** 10 Einmalcodes zu 16 Zeichen (80 Bit, `src/lib/backup-codes.ts`), nur als SHA-256 gespeichert (an das Konto gebunden), Verbrauch per bedingtem Update. **Sie sind
  nicht der Wiederherstellungs-Code des Notzugangs** (anderes Format, ersetzen nur den zweiten Faktor, nie das Passwort).
* **Zeitschritt nicht wiederverwendbar:** `TwoFactor.lastStep`; das Setzen ist ein bedingtes Update (`lastStep < step`) – zwei gleichzeitige Eingaben desselben Codes: genau eine gewinnt.
* **Anmeldung in zwei Schritten** (`login` → `verifySecondFactor`, `src/server/auth/session.ts`): Nach dem richtigen Passwort entsteht **keine Sitzung und kein Sitzungs-Cookie**; der
  Zwischenzustand liegt **nur im Speicher des Servers** (`src/server/auth/pending.ts`, 5 Minuten, höchstens 5 falsche Codes, begrenzte Größe, höchstens 5 je Konto), **an das Passwort gebunden** (`credentialVersion`: ändert sich der Passwort-Hash zwischen den Schritten, ist er ungültig; `revokeAccess` löscht alle Zustände des Kontos; ZP5-7) und der Browser bekommt nur eine zufällige Kennung
  (`so_2fa`, unter HTTPS `__Host-so_2fa`, HttpOnly). Es gibt kein Benutzerorakel: Den zweiten Schritt erreicht nur, wer das richtige Passwort kannte (unbekannter Name, falsches
  Passwort und Konto mit/ohne zweiten Faktor antworten vorher gleich). Hier – und nur hier – entsteht die Sitzung (`completeLogin`). `/login/verify` ist eine öffentliche Seite
  (Proxy `OPEN_PAGES`, Routen-Inventur), ohne Zwischenzustand zeigt sie einen Hinweis.
* **Drosselung (eigenes Limit nach der Regel „jede Eingabe, die ein Geheimnis prüft“):** `loginThrottle.totp` je Konto (5 freie Versuche, dann 2 s … 90 s) **und dauerhaft**
  (`TwoFactor.failedAttempts/lockedUntil`, übersteht einen Neustart), dazu das globale Fehlversuchs-Budget. Die Prüfung ist billig (HMAC/SHA-256) und läuft **nie** über die scrypt-Pfade.
  Ein Erfolg gleicht nur den eigenen Versuch aus. Falsche Codes gehen gedrosselt ins Audit (`auth.secondFactorFailed`), ein Sicherungscode eigens (`auth.backupCodeUsed`).
  **Restrisiko:** Wer das Passwort kennt, kann den zweiten Schritt eines Kontos bis zu 90 s je Versuch blockieren (wie beim Passwort); der Ausweg sind Sicherungscodes nach der Wartezeit, die
  Administration (Zurücksetzen) oder der Notzugang.
* **Das Geräte-Cookie ersetzt nie den zweiten Faktor** (R2-SEC-05): Der Passwort-Schritt mit bekanntem Gerät führt bei eingerichtetem zweiten Faktor ebenfalls zum Code (Test). Das Gerät
  befreit ausschließlich von der Konto-Wartezeit des Passwort-Schritts. „Dieses Gerät merken“ gilt erst nach dem Abschluss.
* **Zurücksetzen:** (a) **Notzugang** (`redeemRecoveryCode`): setzt ihn zurück, die Antwort sagt es, das Konto sieht ein Banner (`SecurityBanner`) bis zur Bestätigung; (b) **Administration**
  (`admin.users.resetTwoFactor`, Recht `users.manage`): Rechte-Hierarchie wie beim Ändern des Kontos, **Passwortabfrage der handelnden Person**, Audit `auth.twoFactorReset`, beendet Sitzungen,
  Geräte und API-Tokens des Kontos, nie das eigene Konto; (c) **Restore ohne passenden `secret.key`**: ein Geheimnis, das sich nicht entschlüsseln lässt, setzt **alle** unlesbaren zweiten
  Faktoren zurück (`resetUnreadableSecondFactors`, **nur beim Start** über `resetUnreadableSecrets`, nie beim Anmelden; ein Audit-Eintrag), die Konten melden sich dann nur mit dem Passwort an und sehen den Hinweis. Bis dahin (und bei fehlendem/nicht lesbarem Schlüssel) bleibt die Anmeldung für Konten mit zweitem Faktor zu.
* **Pflicht für Administratoren** (Einstellungen → Sicherheit, Standard **aus**, `auth.require2faAdmins`): Administrator-Konten ohne zweiten Faktor erreichen nur `/account` (wie bei einem
  ausstehenden Passwortwechsel: `mustSetupTwoFactor`, `requireSession`), können ihn nicht ausschalten; nach einem Reset (Restore, Notzugang, Administration) müssen sie sofort neu einrichten. Die Einrichtung (`account.startTwoFactor`/`account.enableTwoFactor`) ist dafür mit `allowPasswordChange` erreichbar (ZP5-1; die Berechtigungs-Matrix prüft den Zustand); die Pflicht lässt sich nur einschalten, wenn die handelnde Administration selbst einen zweiten Faktor hat (Schutz vor Selbstaussperrung). **API-Tokens** von Administrator-Konten ohne zweiten Faktor werden bei eingeschalteter Pflicht abgelehnt (`server/api/auth.ts`, ZP5-5; nicht widerrufen, sie gelten nach der Einrichtung wieder).

**Sitzungen und Geräte** (Konto): `listSessions`/`listDevices` zeigen Browser und System aus dem User-Agent (`src/lib/user-agent.ts`, grob), Zeiten und einen **datensparsamen Adressteil**
(`Session.ipHint`/`KnownDevice.ipHint`: IPv4 ohne letztes Byte, IPv6 nur 48 Bit – nur hinter dem Reverse-Proxy bekannt); die eigene Sitzung ist markiert und nicht beendbar. „Überall
abmelden“ (`account.logoutEverywhere`) beendet **Sitzungen, Geräte und API-Tokens** des Kontos über `revokeAccess` und räumt die Cookies. Alle diese Operationen sind **Konto-Operationen**
(`permission: "authenticated"`, nie über die API, automatisch aus der API-Ausnahmeliste); Schutzsenkungen (einrichten, ausschalten, Sicherungscodes erneuern) verlangen die Passwortabfrage
(`confirmOwnPassword`, Limit `loginThrottle.passwordChange`).

**Leerlauf-Abmeldung** (Einstellungen → Sicherheit, Standard **aus**, 1–720 Stunden, `auth.idleTimeoutHours`): `getSession` beendet (löscht) eine Sitzung, deren letzte Nutzung länger zurückliegt;
mit eingeschalteter Frist wird die letzte Nutzung minütlich festgehalten. **Nach Ablauf zurück zur selben Seite:** der Proxy reicht den Pfad als `x-so-path` an die Seite (vom Absender
mitgeschickte Werte werden überschrieben), `requireSession` leitet auf `/login?expired=1&next=…` (`safeNext`). **Entwürfe:** Die Anmeldeseite löscht keine Entwürfe mehr (`ClearDrafts` entfällt);
`DraftScope` verwirft beim Öffnen des Rahmens nur Entwürfe **anderer** Benutzer-IDs, das ausdrückliche Abmelden (`clearFormDrafts` im Benutzermenü) löscht alle – derselbe Benutzer
findet nach der erneuten Anmeldung im selben Tab seinen Entwurf wieder.

## Container, Starter und Updates

Ein Container, ein Volume (`/data`). Das Image ist **`FROM scratch`** und enthält nur den **Starter** und die eingebaute App-Version
für den ersten Start – kein Betriebssystem, keine Shell, keinen Paketmanager. Jede App-Version ist ein **selbständiges, signiertes
Paket** und bringt alles andere mit:

| Bestandteil | Wo | Aktualisierung |
| --- | --- | --- |
| **Starter** (`docker/bootstrap.c`, statisch; ab P1b-6 mit Prüfer für Siegel und Dateiliste, siehe „Starter-Vertrauensanker“) | Image | praktisch nie (nur bei geändertem Vertrag: `docker/BASE_VERSION`) |
| **Launcher** (`src/launcher/main.ts` verdrahtet Prozess/Netz/Zeit, der Ablauf steht in `src/launcher/launcher.ts` und ist mit Fake-Prozess getestet; mit esbuild zu `launcher.mjs`) | Paket | mit jedem Update |
| **Node** und **Systembibliotheken** (glibc, libstdc++, nss, Lader) | Paket (`runtime/`) | mit jedem Update |
| **Anwendung** samt `node_modules`, Migrationen, Hilfe | Paket | mit jedem Update |

Vom Host kommt nur der Kernel. Gestartet wird über den mitgelieferten Lader
(`runtime/<lader> --library-path runtime/lib runtime/node …`).

* **Starter:** wählt das Verzeichnis der aktiven Version (Zeiger `<DATA_DIR>/app/active`, sonst `/app`), **prüft eine installierte Version vollständig** (Siegel + Dateiliste, Mengengleichheit; Abschnitt „Starter-Vertrauensanker“; die
  eingebaute Version ist die Vertrauensbasis und wird nicht geprüft) und startet dessen Launcher. Exit-Code 42 des Launchers = neu prüfen und auswählen — **jeder** Neustart der App geht über den Starter; stürzt der Launcher einer installierten
  Version zweimal kurz hintereinander ab, nimmt er die eingebaute Version und vermerkt das in `<DATA_DIR>/app/launcher-crash`. Besteht eine Version die Prüfung nicht, schreibt er einen Marker (`verify-failed`/`inconclusive`) und startet die eingebaute
  Version. Er beantwortet auch den Docker-Healthcheck (`/bootstrap --healthcheck`).
  *Stand:* Beide Teile des Pakets P1b-6 sind umgesetzt: die TypeScript-Seite (Formate, Referenzprüfer, Launcher, Installer, Pipeline) und der C-Prüfer im Starter (`docker/verify.c`, `docker/bootstrap.c`, vendortes Monocypher) samt `BASE_VERSION` 4 und den nativen Tests (`docker/test`, `npm run native:test`).
* **Launcher:** startet nur die App seiner eigenen Version — **genau einmal je Aufruf** —, spielt vorgemerkte Datenbank-Wiederherstellungen ein und macht
  Rückfälle (frische Version nicht gesund → Zeiger auf die Vorversion + Code 42; wiederhergestellte Datenbank nicht gesund →
  vorherige zurück + Code 42). Eine installierte Version verwirft sich selbst, wenn die eingebaute neuer ist (neues Image gezogen). Der Launcher der eingebauten Version wertet die Marker des Starters aus und
  hat die Kompatibilitätsschranke (siehe „Starter-Vertrauensanker“).
* **Die App migriert sich selbst:** `src/instrumentation.ts` → `src/server/startup.ts`: Sicherung vor Migrationen, Migrationen,
  Basisdaten, Zeitzone, Job-Runner. `/api/health` meldet erst danach „ok“; scheitert etwas, beendet sich der Prozess.
  **Der Start läuft im Hintergrund** (`register()` wartet nicht darauf, `src/server/startup-launch.ts`). Grund (Next-16-Quellen: `next-server.js` `prepareImpl` → `runInstrumentationHookIfAvailable`,
  `start-server.js` `requestListener` wartet auf `handlersPromise`): Wartete `register()` auf die Migration, nähme der Server Verbindungen an, beantwortete aber **keine** Anfrage – auch `/api/health` nicht, der Launcher sähe nur
  Zeitüberschreitungen. So antwortet `/api/health` schon während der Migration mit `503 { "status": "starting" }`, und `proxy.ts` beantwortet **jede andere Anfrage** (Seiten, Server Actions, Route Handler, `/api/v1`) mit
  `503` (`Retry-After`, Browser: kurze Seite mit Neuladen), bis der Zustand `ready` ist – **keine Anfrage erreicht eine noch nicht migrierte Datenbank**. Außerhalb des Proxys liegen nur Statik (fasst keine Datenbank an) und
  `/api/backups/upload` (prüft den Zustand selbst). Die Migration selbst (`better-sqlite3`) arbeitet **synchron**: Während eines einzelnen langen Schritts antwortet auch der Health-Endpoint nicht (siehe Update-Ablauf, Launcher).
  Der Job-Runner startet erst nach erfolgreichem Start und nie bei „Neuinstallation nötig“.
* **Keine Fremdprogramme:** Archive bearbeitet die npm-Bibliothek `tar` – es gibt kein System-`tar`.
* **Die eingebaute App ist `root:root` und für den Betriebsbenutzer (1000) nicht schreibbar** (`COPY` ohne `--chown`): Geschrieben wird nur nach `/data`
  (Datenbank, Dateien, Backups, installierte Versionen) und `/tmp` — **nie in ein Paketverzeichnis** (`process.cwd()`): Installierte Versionen sind nach der Prüfung schreibgeschützt und werden bei jedem Start gegen ihre Dateiliste geprüft.
  Wer die laufende Anwendung kompromittiert, kann den eingebauten Code nicht ändern. Der Smoke-Test der Pipeline prüft Besitzer, Modus-Bits, Dateiliste und Start (`scripts/smoke-image.sh`).
* **Zustand:** `<DATA_DIR>/app/state.json` (+ Zeiger `active`); reine, getestete Logik in `src/lib/updates` (`state.ts`, `store.ts`,
  `restore.ts`). `writeState` schreibt immer auch den Zeiger.
* `docker/BASE_VERSION` (aktuell **4**: neue Pflichtdateien im Paket, jeder Neustart geht über den Starter) nur erhöhen, wenn sich der Vertrag des Starters ändert (Zeiger-Format, Exit-Codes, Aufruf der Laufzeit)
  oder die Architektur wechselt – solche Releases bieten kein Web-Update, sondern verlangen ein neues Image.

### Update-Ablauf (Funktion `admin.updates`)

1. Backup anlegen („Vor Update“; scheitert es, wird abgebrochen).
2. Neuestes GitHub-Release holen, **Ed25519-Signatur** des `manifest.json` prüfen (gegen den eingebauten öffentlichen Schlüssel bzw. die Schlüsselkette), das **Siegel** (`SOS-SEAL`) prüfen und mit dem Manifest abgleichen,
   dann Paket laden und **SHA-256/Größe** gegen das Manifest prüfen.
3. Nach `<DATA_DIR>/app/.partial-…` entpacken, Siegel ablegen, **dieselbe Prüfung wie der Starter** (Siegel, Dateiliste, Mengengleichheit, Vorfahrenregel, Untergrenze), `fsync`, schreibschützen, nach `<DATA_DIR>/app/versions/<version>`
   verschieben, `state.json`/`active` schreiben, Neustart (Exit-Code 42). Scheitert die Prüfung, wird nichts aktiviert.
4. Starter (prüft die Version erneut) → Launcher der neuen Version → Gesundheitsprüfung oder Rückfall. Die Frist ist 90 s (`LAUNCHER_HEALTH_TIMEOUT_MS`) und **verlängert sich jedes Mal um ihre volle Länge**, wenn die App lebt und migriert:
   entweder `/api/health` antwortet mit `503 { "status": "starting" }` (das tut es dank Start im Hintergrund auch während der Sicherung vor der Migration), **oder die Verbindung wird angenommen, aber es kommt innerhalb von 2 s
   keine HTTP-Antwort** (Event-Loop in einem synchronen Migrationsschritt blockiert – das erkennt der Kernel-Backlog, nicht die App; `probeHealth` in `src/lib/updates/health.ts`). Obergrenze: **harte** 15 Minuten ab Start
   (`LAUNCHER_HEALTH_MAX_MS`). Wer die Verbindung verweigert oder 503 `error` meldet, hält die Grundfrist ein. Ein hängender Prozess, der den Port offen hält, wird so erst nach der Obergrenze verworfen (bewusster Kompromiss).
   Beide Variablen werden validiert (leer, keine Zahl, ≤ 0 → Standardwert; ein `NaN` setzte die Frist sonst auf 0).

**Sicherheit des Downloads** (`src/lib/updates/safe-fetch.ts`, Test mit echten lokalen Servern): Das Update-Token (`Authorization`) geht **nur an die API-Herkunft** (Schema, Host und Port von `UPDATE_API_URL`,
Standard `https://api.github.com`); eine Asset-Adresse auf anderem Host wird gar nicht angefragt. GitHub antwortet auf den Asset-Abruf mit einer Weiterleitung auf einen Content-Server
(`release-assets.githubusercontent.com`; die Liste `GITHUB_ASSET_HOSTS` enthält zusätzlich `objects.githubusercontent.com`, `objects-origin.githubusercontent.com`, `github-releases.githubusercontent.com` –
geprüft gegen die Antwort der API und `GET /meta`, `domains.actions`). Weiterleitungen werden **von Hand** verfolgt (höchstens 5), nur auf HTTPS und nur auf diese Hosts, und tragen **nie** ein `Authorization`
(Ausnahme: Metadaten-Abfragen der API selbst behalten es bei einem Ziel auf derselben Herkunft). `UPDATE_API_URL` und `UPDATE_REDIRECT_HOSTS` (Hosts, kommagetrennt) sind nur für Spiegel und Tests gedacht,
keine Betriebseinstellung. Das Paket wird mit `lib/archive.ts` entpackt (Abschnitt „Uploads und Archive“).

### Starter-Vertrauensanker (P1b-6)

Der Starter (`/bootstrap`, PID 1, im Image, `root`-eigen, nicht per Web-Update erneuerbar) startet eine **installierte** Version nur, wenn sie genau dem entspricht, was der Release-Schlüssel signiert hat.
Code, den die App (uid 1000) nach `/data/app/versions/…` schreibt, überlebt damit **keinen Neustart** des Containers und keinen Neustart der App. **Dieser Abschnitt ist die Spezifikation** für Prüfer und
Starter in C (`docker/verify.c`, `docker/bootstrap.c`): Der TypeScript-Referenzprüfer (`src/lib/updates/seal.ts`, `tree.ts`) und der **Goldkorpus** (`src/lib/updates/testdata/anchor/cases.json`) legen Format und Urteile fest; der C-Prüfer urteilt auf allen Fällen des Korpus und auf zehntausenden mutierten Eingaben gleich (Exit-Code, Grund, Pfad; `docker/test`).

#### Vertrauenskette und Grenzen

```text
 IM IMAGE (root:root, /bootstrap statisch)                                   IN /data (für uid 1000 beschreibbar = NICHT vertraut)
 ROOT_KEY     Wurzelschlüssel (privat OFFLINE)  ──beglaubigt──┐
 RELEASE_KEY  Release-Schlüssel (privat = Secret)             ▼
 FLOOR        = eingebaute Version                    Beglaubigung (118 Bytes, Wurzel-signiert; steckt IM Siegel)
 BASE, ARCH                                                   │
        akzeptiert Signaturschlüssel K ∈ {RELEASE_KEY} ∪ {K mit gültiger Beglaubigung}
                                              ▼
        SOS-SEAL  (versions/<v>/SOS-SEAL, signiert mit K)   { version, base, arch, tree-sha512, tree-size, tree-entries, tree-bytes }
                                              ▼ SHA-512
        SOS-TREE  (versions/<v>/SOS-TREE, im Paket)          je Pfad: Typ, Ausführbit, Größe, SHA-512 | Symlink-Ziel
                                              ▼ Mengengleichheit
        Dateien, Ordner, Links des Verzeichnisses /data/app/versions/<x.y.z>/
```

* **Schützt vor:** Code-Ausführung in der App, die sich über Neustarts festsetzen will (Hintertür im Paketcode, Austausch von Launcher/Node/Bibliothek/`.next/static`), Manipulation des Volumes von außen ohne Schlüssel,
  untergeschobenen Paketen (zusätzliche Tiefe zu Manifest-Signatur und SHA-256).
* **Schützt NICHT vor:** Laufzeit-Manipulation (wer als uid 1000 läuft, kann bis zum nächsten Neustart alles); Persistenz auf Datenebene (Datenbank, `files`, Backups, `secret.key`, Einstellungen);
  Diebstahl des Release-Schlüssels (Gegenmittel: neues Image mit neuem Wurzel-/Release-Schlüssel); kompromittierter Build-/Release-Pipeline; dem **Wiedereinspielen einer echten, alten, signierten Version
  oberhalb der Untergrenze** (die Untergrenze ist nur die eingebaute Version; ein Dieb mit Schreibzugriff kann eine ältere, bekannt verwundbare Version oberhalb davon wieder einspielen — Gegenmittel ist ein neues
  Image); Host-root/`docker`-Gruppe; Container-Ausbruch; einem **gleichzeitig laufenden** Angreifer, der Dateien zwischen Prüfung und Start tauscht (Ruhezustand, siehe unten – ohne Rechtetrennung gibt es keine
  echte Unveränderlichkeit). Verwerfen ist die sichere Richtung: A1/A2 können einen Rückfall auf die eingebaute Version erzwingen (Verfügbarkeit), nie das Laden fremden Codes.
* **Der Baum ist der gesamte Code, den Node lädt.** Darum gilt: **kein `node_modules` in einem Vorfahrenordner** der Version (`versions/`, `app/`, `DATA_DIR`): Node löst `require()` aufwärts auf (Next lädt
  optionale Pakete wie `@opentelemetry/api` mit `try { require(…) }`), und alles dort wäre ungeprüfter Code. Der Prüfer lehnt das mit Code 18 ab (Datei, Ordner oder Link). Next-Konfigs und `.env*` im Arbeitsverzeichnis
  liegen im Baum. Nichts wird aus `/tmp` geladen; `enableCompileCache` gibt es in Next nicht.

#### Formate (alle zeilenbasiert, UTF-8, nur `\n`, kleine Hexziffern, ohne JSON)

**Kanonische Regeln für alle Formate:** keine Leerzeichen am Zeilenende, kein `\r`, kein BOM, keine Leerzeilen, keine Kommentare; Zahlen sind Dezimalzahlen ohne führende Nullen (`0` ist erlaubt) und ohne Vorzeichen;
Hex nur `[0-9a-f]`; unbekannte oder doppelte Zeilen sind Fehler; Reihenfolge der Zeilen ist fest. Jeder Parser prüft Länge **und** Inhalt vollständig, bevor er etwas weiterverwendet. Ganzzahlen werden überlaufgeprüft gelesen
(Grenzen unten).

**`SOS-TREE`** (Datei im Paket, Wurzel des Versionsordners; Grenze 48 MiB, ≤ 200 000 Einträge):

```text
schrauberos-tree 1\n
hash sha512\n
<Typ>\t<Ausführbit>\t<Größe>\t<Hash|Ziel|->\t<Pfad>\n        (ein Eintrag je Zeile, genau fünf TAB-getrennte Felder, Pfad ist das letzte Feld)
```

* **Typ** `d` Ordner · `f` reguläre Datei · `l` Symlink (andere Arten gibt es nicht). **Ausführbit** `x` oder `-`; `x` nur bei Dateien, die ein Ausführbit tragen (`mode & 0111 != 0`), sonst `-` (auch bei `d` und `l`).
  Volle Modi sind **nicht** Teil der Aussage (`tar.x` entpackt sie mit der Umask). Setuid, Setgid und Sticky (`mode & 07000`) sind verboten (Generator, Prüfer).
* **Größe** Dezimalzahl, höchstens 13 Ziffern (≤ 2^40); bei `d` und `l` immer `0`. **Hash** (nur `f`) = SHA-512 des Inhalts, 128 Hexziffern; **Ziel** (nur `l`) = Linkinhalt; bei `d` steht `-`.
* **Pfad:** relativ zur Wurzel, `/`-getrennt, ohne führendes `/` oder `./`, ohne leere, `.`- oder `..`-Teile; keine Steuerzeichen (< 0x20, 0x7f), kein `\`, kein U+FFFD, gültiges UTF-8; ≤ 1024 Bytes, ≤ 48 Ebenen.
  `SOS-TREE` und `SOS-SEAL` im Wurzelverzeichnis stehen **nicht** in der Liste (der Prüfer verlangt sie als reguläre Dateien); in Unterordnern gibt es keine Sonderbehandlung.
* **Sortierung:** streng aufsteigend nach den **Bytes** des Pfads (`memcmp`, kürzer vor länger; kein `localeCompare`). Dadurch eindeutig und per Binärsuche prüfbar; `a`, `a.b`, `a.b/c`, `a/d` ist die richtige Reihenfolge (`.` < `/`).
  Jeder Elternordner steht als `d` in der Liste (er steht wegen der Reihenfolge davor); unter Dateien und Symlinks gibt es keine Einträge.
* **Symlink-Ziele:** relativ, kanonisch (`..` nur am Anfang, keine `.`-Teile, keine leeren Teile, mindestens ein Name), das Ziel bleibt im Baum, und der lexikalisch aufgelöste Weg führt nicht über einen weiteren Symlink
  (so ist die Auflösung im geprüften Baum eindeutig). Das Ziel muss nicht existieren.
* Der Generator (`scripts/gen-tree.mjs`) bricht laut ab bei Sonderdateien (Sockets, FIFOs, Geräte), Setid, unzulässigen Namen und Links aus dem Baum. Die Linux-Pakete von Next enthalten relative Symlinks (`.next/node_modules/<name>-<hash>`,
  erzeugt in `next/dist/build/utils.js` `createTracedSymlink`); die absoluten Ziele eines lokalen Windows-Builds sind ein Artefakt der Junction-Ersatzlösung und treten im Docker-Build nicht auf.

**`SOS-SEAL`** (Release-Asset **und** Datei im Versionsordner; ≤ 8 KiB):

```text
schrauberos-seal 1\n
version <x.y.z>\n  base <n>\n  arch <a>\n  tree-sha512 <128 Hex>\n  tree-size <n>\n  tree-entries <n>\n  tree-bytes <n>\n        ← Rumpf (7 Zeilen nach der Kopfzeile)
signing-key <64 Hex: roher Ed25519-Schlüssel>\n                                                                                    ← Schwanz, Form A (216 Bytes)
signature <128 Hex>\n
```

oder, wenn der Signaturschlüssel **nicht** der einkompilierte Release-Schlüssel ist, der Schwanz in Form B (610 Bytes):

```text
signing-key <64 Hex>\n  endorsement <236 Hex: die 118 Bytes der Beglaubigungs-Aussage>\n  endorsement-sig <128 Hex>\n  signature <128 Hex>\n
```

* `version`: `x.y.z` ohne führende Nullen, jede Zahl ≤ 9 Ziffern (keine Vorabversionen: nur Veröffentlichungen sind installierbar). `base` ≥ 1, ≤ 6 Ziffern. `arch`: `[a-z0-9_]{1,16}`. Zahlen der Felder `tree-*` ≤ 15 Ziffern,
  `tree-size` ≤ 48 MiB, `tree-entries` ≤ 200 000.
* **Signierte Bytes:** `"schrauberos-seal-v1\n"` + alle Bytes der Datei bis einschließlich des `\n` **vor** `signature ` (also Rumpf und Schwanz ohne die letzte Zeile).
* **Erst prüfen, dann lesen (authenticate-then-parse):** Der Schwanz hat feste Länge. Der Prüfer stellt die Form an festen Positionen vom Dateiende fest (Form B, wenn 610 Bytes vor dem Ende `signing-key ` und an der festen
  Stelle danach `endorsement ` stehen, sonst Form A), prüft Schwanz und Signatur und liest den Rumpf **erst danach**. Form A verlangt `signing-key == RELEASE_KEY` (Bytevergleich); Form B verlangt `signing-key != RELEASE_KEY`
  (sonst Code 11, `endorsement-for-release-key`), eine Aussage, die zu `signing-key` gehört, und eine gültige Wurzel-Signatur (Beglaubigung, nächster Abschnitt).
* Dateigröße ≤ 8192 und nichts nach der `signature`-Zeile außer ihrem `\n`; jede Abweichung der Form ist Code 10, ein Signatur-/Kettenfehler Code 11 (Gründe als Text in der JSON-Zeile: `bad-signature`, `unknown-key`,
  `endorsement-invalid`, `endorsement-expired`, `endorsement-other-key`, `endorsement-for-release-key`).

**Beglaubigung, Format 2** (118 Bytes, `src/lib/updates/keychain.ts`): `schrauberos-endorsement 2\n` `key <64 Hex>\n` `valid-until <JJJJ-MM-TT>\n`. Der Prüfer **parst nicht**, sondern baut die Bytes aus `signing-key` und dem
Datum (10 Bytes ab Offset 107 der Aussage; echtes Kalenderdatum im gregorianischen Kalender, Jahre 0000–9999, von Hand gerechnet wie in `isCalendarDate`) nach und vergleicht.
**Kodierung der Ed25519-Punkte:** `R` der Signatur und der Schlüssel müssen kanonisch kodiert sein (RFC 8032, 5.1.3: `y < 2^255 - 19`, und bei `x = 0` kein gesetztes Vorzeichenbit). Monocypher lässt nicht-kanonische Kodierungen von `R` und `A`
bewusst zu (Wycheproof tcId 151); `sos_ed25519_check` weist sie vorher ab, damit eine Signatur genau eine gültige Kodierung hat. Punkte kleiner Ordnung als Schlüssel sind ohne Bedeutung: die Schlüssel sind einkompiliert oder
vom Wurzelschlüssel beglaubigt, nie frei wählbar. Die Wurzel signiert `"schrauberos-release-key-endorsement-v2\n"` + Aussage. **Der Starter prüft den Ablauf nicht** (eine ordentlich
installierte Version würde nach dem Stichtag sonst still auf eine ältere zurückfallen, ohne Sicherheitsgewinn gegen Diebstahl); nur `--check-expiry JJJJ-MM-TT` prüft ihn (Installer/App/Echtprobe; gültig bis zum Ende des Tages UTC).
Das Manifest wird mit dem Kontext `"schrauberos-manifest-v1\n"` + Manifest signiert (Domänentrennung zu Siegel und Beglaubigung). PEM ↔ roh: Ed25519-SPKI mit dem Präfix `302a300506032b6570032100`.

**Ablaufregeln:** `scripts/endorse-release-key.mjs` verlangt `--valid-until` (≤ 5 Jahre); `scripts/make-seal.mjs` verweigert ein Siegel, wenn die eingebettete Beglaubigung in < 90 Tagen abläuft (Warnung < 180 Tage);
die Update-Seite warnt 90 Tage vor Ablauf. Widerruf eines beglaubigten Schlüssels gibt es nur über ein neues Image (eine Sperrliste im Image ist nicht Teil dieses Pakets).

#### Prüfablauf, Fehlercodes und Klassen

`/bootstrap --verify DIR [--expect-version V] [--no-floor] [--check-expiry JJJJ-MM-TT]` prüft in dieser Reihenfolge; der Referenzprüfer ist `verifyVersion` in `src/lib/updates/seal.ts`:

1. **Vorfahren:** in `DIR/..`, `DIR/../..` … bis einschließlich `$DATA_DIR` (nur wenn `DIR` darunter liegt) darf es keinen Eintrag `node_modules` geben (`fstatat`, jede Art) → **18**. `$DATA_DIR` ist die Umgebungsvariable (Standard `/data`); ein Pfad unterhalb davon mit `.`-, `..`- oder leeren Teilen ist ein Aufruffehler (2). Die Kette wird ab `$DATA_DIR` mit `openat(O_NOFOLLOW)` geöffnet: ein Link oder fehlender Ordner auf dem Weg ist Code 10 (`dir-not-directory`, `dir-missing`).
2. **Untergrenze:** der Ordnername bzw. `--expect-version` muss `x.y.z` sein – streng wie `version` im Siegel: keine führenden Nullen, höchstens 9 Ziffern je Zahl, keine Vorabversion (sonst 12, `folder-name`); `exceedsFloor(version, FLOOR)` – gleich oder darunter → **19** (`floor`). Mit `--no-floor` nur gemeldet. `FLOOR` = eingebaute Version
   (Tripel + Vorabflag aus `scripts/gen-trust-header.mjs`; `0.2.0` liegt über `0.2.0-dev.x`). Der Vergleich in C ist nur `exceedsFloor` in Zahlen — die SemVer-Logik bleibt einmal in TypeScript (`semver.ts`, Differentialtest).
3. **Siegel:** Der Versionsordner selbst, `SOS-SEAL` und `SOS-TREE` tragen kein Setuid/Setgid/Sticky (16, `setid`; die beiden Dateien stehen nicht in der Liste, der Ordner auch nicht). `SOS-SEAL` regulär (nicht Link, nicht FIFO), ≤ 8 KiB, → Form, Signatur, Kette (Code 10/11). Dann `version == Ordnername/--expect-version` (**12**), `base == SOS_BASE` und `arch == SOS_ARCH` (**19**, `base`/`arch`).
4. **Liste:** `SOS-TREE` regulär, `st_size == tree-size`, SHA-512 == `tree-sha512` (sonst **13**), erst dann parsen (Format, Sortierung, Eltern, Links; sonst 13), `tree-entries`/`tree-bytes` müssen stimmen (13).
5. **Baum (Mengengleichheit):** jeder Eintrag der Liste existiert mit gleichem Typ; Dateien: Größe, SHA-512 (über denselben geöffneten Dateideskriptor, gelesene Bytes == Größe), Ausführbit (nur `x`-markierte müssen `x` haben; zusätzliche
   Ausführbits sind gleichgültig — Bind-Mounts mit festen Modi), kein Setuid/Setgid/Sticky; Symlinks: `readlinkat` gleich Ziel. Jeder vorhandene Name (auch versteckte Dateien, leere Ordner, Sockets/FIFOs) steht in der Liste, sonst
   **15** (`extra`) mit Pfad; fehlende → **14**; Abweichungen → **16** (`type`, `size`, `hash`, `exec`, `setid`, `target`). **Kein Ignorierbereich** (auch `public/`, `.next/static/`, `docs/`, `prisma/migrations/`, `node_modules`).
   Bei mehreren Abweichungen ist nur gesichert, dass abgelehnt wird (der gemeldete Fund hängt von der Verzeichnisreihenfolge ab). Alle Öffnungen: `openat` mit `O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK` + `fstat`/`S_ISREG`; kein Pfad wird als Ganzes aufgelöst.
6. Ausgabe von `--verify`: **eine JSON-Zeile** auf stdout `{"ok":true,"version":"…","files":N,"bytes":M,"ms":T,"floor":"above|equal|below|none"}` bzw. `{"ok":false,"code":15,"reason":"extra","path":"…","ms":T}` (Pfade und Texte ohne
   Steuerzeichen); Text für Menschen auf stderr.

| Code | Bedeutung | Klasse |
| --- | --- | --- |
| 0 | geprüft | **ok** |
| 2 | Aufruf fehlerhaft | unklar |
| 10 | Siegel fehlt, ist kein Siegel oder formal fehlerhaft | **negativ** |
| 11 | Signatur, Kette oder Schlüssel ungültig (`--check-expiry`: Beglaubigung abgelaufen) | negativ |
| 12 | Version im Siegel ≠ Ordnername / `--expect-version` | negativ |
| 13 | `SOS-TREE` passt nicht zum Siegel (Hash, Größe, Format, Zähler) | negativ |
| 14 | Eintrag der Liste fehlt im Baum | negativ |
| 15 | zusätzliche Datei, Ordner, Link oder Sonderdatei im Baum | negativ |
| 16 | Eintrag weicht ab (Typ, Größe, Inhalt, Ausführbit, Setuid/Setgid/Sticky, Linkziel) | negativ |
| 17 | Ein-/Ausgabefehler | **unklar** |
| 18 | `node_modules` in einem Vorfahrenordner | negativ |
| 19 | veraltet oder unverträglich: Version ≤ Untergrenze, `base` oder `arch` passen nicht | **veraltet** (kein Alarm) |
| Signal, Zeitüberschreitung, jeder andere Code | Prüfung nicht abgeschlossen | unklar |

* **negativ** (10–16, 18): Integritätsbefund. Der Starter schreibt `<DATA_DIR>/app/verify-failed`, nimmt für diesen Durchlauf die eingebaute Version; der Launcher der eingebauten Version sperrt die Version (`state.failed`), trägt
  `last = { status: "rolled-back", reason: "integrity:<Code>", detail: <Pfad, bereinigt> }` ein und fällt **zuerst auf die Vorversion** zurück (Exit 42 ohne App-Start: der Starter prüft sie selbst), erst danach auf die eingebaute.
* **unklar** (alles andere, besonders Signal/Zeitüberschreitung/17): kein Befund über den Inhalt. Marker `inconclusive`, **kein** Eintrag in `failed`; für diesen Durchlauf die eingebaute Version, der nächste Start prüft erneut;
  Nur **Signal** und **Ein-/Ausgabefehler** zählen als Fehlversuch (`state.inconclusive.count`, `countsAsAttempt` in `state.ts`): nach 3 davon gilt die Version als negativ (`integrity:17`). **Nicht zählend** sind die Zeitüberschreitung (`alarm(900)`, also 15 Minuten –
  ein großes Paket auf einer langsamen Platte darf nicht eingebrannt werden), `other`, `fork` und `quiesce` (der Ruhezustand ließ sich nicht herstellen, siehe „Ruhezustand“): Die Version bleibt eingetragen, die eingebaute läuft, der nächste Start versucht es erneut.
  Die Update-Seite meldet `quiesce` als „Update installiert, aber nicht gestartet: Ruhezustand nicht erzwingbar“.
* **veraltet** (19): keine Marke, kein Alarm — der Starter nimmt die eingebaute Version und loggt nur. Der Launcher der eingebauten Version gleicht den Zustand ab (`chooseStart`): ist der Eintrag nicht mehr startbar (neues,
  neueres Image; anderer Starter-Vertrag), verfällt er; die Oberfläche bleibt sauber.

**Marker** unter `<DATA_DIR>/app/` (alle sind Daten: nur Version als `x.y.z`-Basisname, Codes aus fester Liste, Pfade ≤ 200 Zeichen ohne Steuerzeichen, `lib/updates/markers.ts`): `verify-failed` (`<Version>\n<Code>\n<Pfad>\n`),
`inconclusive` (`<Version>\n<signal|timeout|io|fork|other|quiesce>\n`), `verify-ok` (vom Starter nach Erfolg: `<Version>\n<Dateien>\n<Bytes>\n<ms>\n<Unix-Sekunden>\n`; die Update-Seite zeigt „zuletzt geprüft“), `launcher-crash` (unverändert),
`incompatible` (vom Launcher: `<Version>\n<Anzahl>\n`), `integrity-reported` (der App: Merker des einmaligen Audit-Eintrags `system.integrityFailed`). Lesen: nur reguläre Dateien, ≤ 4 KiB, nicht blockierend (`readSmallFile`).

#### Starter: Umsetzung (Teil 2)

Ein Binary, `/bootstrap`: Auswahl und Schleife (`docker/bootstrap.c`), Prüfer (`docker/verify.c`, derselbe Code läuft als `--verify` und im Prüfkind), vendortes Monocypher (`docker/vendor/monocypher`) und der generierte Header
`docker/trust-keys.h`. Gebaut im Dockerfile (Stufen `bootstrap-build` und `bootstrap-test-build` über dasselbe Skript `docker/build-bootstrap.sh`: Prüfsummen der vendorten Bibliothek per `sha256sum -c`, Produktionsflags, kein `INTERP`, keine `NEEDED`-Einträge, `BIND_NOW`/`GNU_RELRO`; Compiler und libc aus einem **festen Debian-Schnappschuss**,
`ARG DEBIAN_SNAPSHOT` – dasselbe Datum, aus dem das Basisimage stammt; erhöhen nur mit bewusstem Commit) statisch als `static-pie` mit `-O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 -Wl,-z,relro,-z,now -Wall -Wextra -Wformat=2 -Wconversion -Wshadow -Werror` für den eigenen Code
(die vendorte Bibliothek ohne `-Wconversion`), `-DSOS_PRODUCTION=1` verbietet die Test-Konstanten des Quelltexts (`SOS_BUILTIN_DIR`, `SOS_VERIFY_TIMEOUT_SECONDS`, `SOS_QUIESCE_MILLIS`, `SOS_CRASH_WINDOW_SECONDS`, `SOS_FUZZ_NO_SIGNATURE`).

* **Zeiger** `<DATA_DIR>/app/active` streng: exakt `<DATA_DIR ohne Schrägstrich am Ende>/app/versions/<x.y.z>` (Ziffern ohne führende Nullen, ≤ 9 Stellen je Teil), eine Zeile (ein einzelnes Zeilenende am Ende ist erlaubt), höchstens 4 KiB,
  keine Steuerzeichen; alles andere – auch eine leere Datei, ein Verzeichnis, ein Link, eine FIFO, eine nicht vorhandene Version – bedeutet eingebaute Version **ohne** Marker. Geöffnet wird mit `O_NONBLOCK|O_NOFOLLOW` + `S_ISREG` (kein `mkfifo`-Aussperren).
  Der Starter ändert den Zeiger nie (zustandslos); die Vorversion-Logik liegt im Launcher der eingebauten Version.
* **Prüfung im Kindprozess** (`fork`): Ein Speicherfehler im Prüfer darf den Start der eingebauten Version nie verhindern. Die Signale `TERM/INT/HUP/QUIT` sind um `fork` und die Zuweisung von `child` blockiert; im Kind zuerst `SIG_DFL` für
  `TERM/INT/HUP/QUIT/ALRM` und leere Signalmaske, dann `alarm(900)`, `PR_SET_PDEATHSIG` (mit Gegenprobe auf `getppid()`), `PR_SET_NO_NEW_PRIVS`, `RLIMIT_CORE=0`. Das Ergebnis kommt als Exit-Code und – nur zur Anzeige, der Starter schreibt alle
  Dateien selbst und bereinigt Texte erneut – als kleiner Bericht über ein `socketpair` (Unix-Socket). Klassen: 0 ok · 10–16/18 negativ · 19 veraltet · alles andere (Signal, `SIGALRM` = `timeout`, 17, Fremdcodes) unklar. Nach einem Stoppsignal (`terminating`) gibt es weder
  Befund noch Marker, und kein Launcher startet mehr; `docker stop` bricht eine Prüfung in < 1 s ab (getestet bis in den Container, `docker/test` Stufen `starter`, `pidns`, `l3`). `prctl(PR_SET_DUMPABLE, 0)` und `RLIMIT_CORE=0` schon im Starter.
* **Start aus dem geprüften Ordner (P6R-F4):** Der Prüfer öffnet den Versionsordner selbst (`openat`/`O_NOFOLLOW` entlang der Vorfahrenkette) und liefert bei Erfolg diesen Deskriptor an den Elternprozess (`sos_options.keep_dirfd`, über dieselbe
  Socket-Nachricht wie der Bericht, `SCM_RIGHTS`; fehlt er bei einem „ok“, gilt die Prüfung als unklar/`io`: fail closed). Der Starter startet den Launcher per `fchdir` in genau diesen Ordner und mit **relativen** Pfaden
  (`./runtime/<Lader> --library-path ./runtime/lib ./runtime/node ./launcher.mjs`); ein Ordner, der nach der Prüfung unter demselben Pfad ausgetauscht wurde, bleibt unbeachtet (Test „Tausch-Sonde“ in der Stufe `starter`). Das schließt den Austausch ganzer Ordner,
  **nicht** die Änderung einzelner Dateien zwischen Hash und Start – dafür gibt es den Ruhezustand (kein anderer Code der App läuft). Die eingebaute Version (root-eigen) startet per `chdir`. Der Vertrag zum Paket ändert sich dadurch nicht (der Launcher bekam schon immer das Paketverzeichnis als Arbeitsverzeichnis; `docker/BASE_VERSION` bleibt 4) – nur die Pfade in `argv` sind jetzt relativ.
* **Ruhezustand:** Geprüft wird nur, wenn kein anderer Code der App läuft. Der Starter ist Subreaper (`PR_SET_CHILD_SUBREAPER`) oder PID 1 und beendet vor **jeder** Prüfung seine Nachfahren: `/proc` nach `ppid == getpid()` durchsuchen, `SIGKILL`,
  `waitpid(-1, WNOHANG)` bis `ECHILD`, höchstens 10 s – **nie** `kill(-1)` (das träfe `docker exec` und den Healthcheck; getestet: ein fremder Prozess überlebt). Bleibt nach 10 s etwas übrig oder ist die Zusicherung gar nicht erzwingbar (weder PID 1 noch Subreaper, oder `/proc` nicht lesbar): Warnzeile „Ruhezustand nicht erzwingbar“ im Log, Marker `inconclusive` mit dem
  Grund `quiesce` und die eingebaute Version für diesen Durchlauf (fail closed; die Version wird nicht geprüft). Das ist eine Eigenschaft der Umgebung, kein Befund über die Version: `quiesce` zählt nie als Fehlversuch (Entscheid des Reviews P6R), die Update-Seite zeigt
  „Update installiert, aber nicht gestartet: Ruhezustand nicht erzwingbar“ und der nächste Start versucht es erneut. Test: Starter mit `-DSOS_TEST_NO_QUIESCE` (nur in Tests, im Produktions-Build verboten).
* **Absturzfenster:** Ein Launcher einer installierten Version, der kürzer als 30 s lebt und abstürzt (Exit ≠ 0, ≠ 42), zählt; der zweite solche Absturz derselben Version in Folge → Marker `launcher-crash`, eingebaute Version (`force_builtin`). Ein **langsamer** Absturz (Laufzeit ≥ 30 s) zählt nie und beendet eine begonnene Reihe (`crashes = 0`) – er ist nicht der „erste von zwei“. Maßgeblich ist
  die **Laufzeit des Launchers**, nicht die Prüfzeit. `force_builtin` endet, wenn der Launcher der eingebauten Version `RESTART_EXIT_CODE` (42) meldet: dann entscheidet der Zeiger wieder. Exit-Code 19 hat keinen Marker; Exit 78 (zu alter Rückfall) gibt der
  Starter der eingebauten Version weiter wie jeden anderen Exit-Code. **Pause bei wiederholtem sofortigem Neustartwunsch:** Meldet der Launcher mehrmals in Folge innerhalb des Fensters (30 s) `RESTART_EXIT_CODE`, wäre jede Runde eine volle Prüfung ohne Atempause; die ersten vier
  sind frei (Rückfall-Ketten Vorversion → eingebaute Version), ab dem fünften wartet der Starter 1, 2, 4 … höchstens 60 s (ein Stoppsignal bricht die Pause ab; Test mit `-DSOS_BACKOFF_STEP_MILLIS`).
* **Marker** (`<DATA_DIR>/app/`, vom Starter über `unlink` + `O_CREAT|O_EXCL|O_NOFOLLOW|O_NONBLOCK` geschrieben, nie über einen untergeschobenen Link oder eine FIFO): `verify-failed`, `inconclusive`, `verify-ok`, `launcher-crash` (Formate siehe oben).
  **Ein Hindernis unter dem Markernamen** (die App – uid 1000 – darf dort schreiben: ein, auch nicht leeres, Verzeichnis) sperrt den Start nie aus: `write_marker` versucht `unlink`, dann `rmdir`, dann das Beiseiteschieben (`<Name>.blocked-<ms>`) und schreibt, wenn auch das scheitert,
  eine Warnzeile. Spiegelbildlich ist **jede Operation des Launchers auf `<DATA_DIR>/app/*` robust** (`removeMarker` wirft nie, `writeState` ersetzt ein Verzeichnis unter `state.json`/`active`, Schreib- und Aufräumfehler stehen nur im Log): Ein Fehler bei Markern oder Zustand verhindert den Start der eingebauten App nie.
* **Untergrenze** `FLOOR` = eingebaute Version (`SOS_FLOOR_*`), `docker/MIN_VERSION` entfällt. Der Vergleich in C ist nur `exceedsFloor` in Zahlen (`semver.test.ts` hält ihn gegen `compareVersions`).
* **Krypto:** Monocypher **4.0.3** (BSD-2-Clause oder CC0), Quelle und Prüfsummen gegen Tarball **und** Git-Tag belegt (`docker/vendor/monocypher/SOURCE.md`, `SHA256SUMS`; `src/lib/updates/vendor-monocypher.test.ts` läuft in `npm test`; `-text` in `.gitattributes`).
  Getestet (`docker/test/crypto-test.c`): RFC 8032 (alle fünf Vektoren, dazu jede Ein-Bit-Änderung der Signatur), NIST CAVP SHA-512 (257 Kurz- und Langnachrichten, jeweils auch in ungleichen Stücken über die Blockgrenzen 111/112/113/127/128/129),
  eine Million „a“, **Wycheproof** (210 Fälle: alle gültigen akzeptiert, alle ungültigen abgelehnt – S ≥ L, Formbarkeit, nicht-kanonische Kodierung –, die 29 „acceptable“-Fälle mit Punkten kleiner/gemischter Ordnung als Schlüssel werden akzeptiert),
  und ein **Differentialtest gegen `node:crypto`** (6 000 deterministische Fälle: gültige Signaturen, Bitänderungen in Signatur, Nachricht und Schlüssel, S + L, gesetztes Bit 255). Ergebnis: ein Fund (Wycheproof tcId 151 – `R` mit `y = 1` und gesetztem
  Vorzeichenbit wurde akzeptiert, Monocypher erlaubt nicht-kanonische Kodierungen bewusst) → `sos_ed25519_check` weist nicht-kanonische `R`/`A` ab; danach 0 Abweichungen.
* **Parser:** überlaufgeprüfte Dezimalleser (längenbegrenzt, kein `sscanf`/`strtoul`); alle Obergrenzen kommen aus dem **signierten** Siegel und gelten vor jeder Allokation; je Ordner wird nichts gepuffert (jeder Name wird einzeln per Binärsuche gegen die Liste
  geprüft und in einer Bitliste abgehakt – höchstens „Listeneinträge + 1“ gelesene Namen, dann Abbruch beim ersten Fremdnamen); `st_dev` darf sich im Baum nicht ändern (16, `device`); Pfade in Logs und Markern sind von Steuerzeichen (C0, DEL, **C1** U+0080–U+009F), Bidi-Steuerzeichen (U+061C, U+200E/F, U+202A–E, U+2066–9), Zeilentrennern (U+2028/9), ungültigem UTF-8 und U+FFFD
  befreit (`?`) und auf 200 Bytes gekürzt (`sos_clean` in C, `cleanDetail` in `markers.ts`; Goldkorpus-Fall `extra-file-hostile-chars`). Die *Gültigkeit* von Pfaden im Format (`pathProblem`) ist davon unberührt.
* **Schnittstellen:** `--print-keys` (Zeilen `root <16 Hex>` / `release <16 Hex>` / `tag-build 0|1`: Fingerabdrücke aus dem Header und `SOS_TAG_BUILD`; ein Test vergleicht sie mit SHA-256 über die einkompilierten Schlüsselbytes), `--verify DIR …` wie oben (Aufruffehler → Code 2 mit JSON-Zeile),
  `--healthcheck` (unverändert). Header `docker/trust-keys.h` (Bau-Artefakt aus `scripts/gen-trust-header.mjs`): `SOS_BASE`, `SOS_ARCH`, `SOS_BUILTIN_VERSION`, `SOS_FLOOR_MAJOR/MINOR/PATCH/PRERELEASE`, `SOS_TAG_BUILD`, `SOS_ROOT_KEY[32]`, `SOS_RELEASE_KEY[32]`,
  Fingerabdrücke. Test-Binaries tragen die Testschlüssel (`docker/test/gen-test-header.mjs`; Dockerfile-Ziel `runner-test`); ein Tag-Build bricht ab, wenn ein Testschlüssel einkompiliert würde.
* **Tests (Stufe L2, `npm run native:test` = `node docker/test/run.mjs`; Linux oder WSL mit gcc/clang, Node ≥ 24):** `crypto` (oben) · `corpus` (alle Fälle von `cases.json` als echte Verzeichnisse: gleiches Urteil wie im Korpus **und** wie der Referenzprüfer auf demselben
  Verzeichnis – Exit-Code, Grund, Pfad) · `mutation` (jede Bitänderung und Kürzung des Siegels, ein Raster über die Liste, jede Datei und jeder Eintrag einzeln verändert/verlängert/gekürzt/ersetzt/entfernt/mit Setid versehen, Fremdeinträge in jedem Ordner,
  `node_modules` in jedem Vorfahren: nie „ok“, gleiches Urteil wie die Referenz) · `parser` (Differentialtest der Parser: gültig signierte, mutierte Siegel-Rümpfe und Listen) · `asan` (dieselben Läufe unter AddressSanitizer, UBSan und LeakSanitizer) · `starter` (Schleife mit einer
  Attrappe als Launcher: Zeiger, Klassen, Marker, Neustart über 42, Absturzfenster, Signale auch in der Prüfung, Ruhezustand, geerbte Signalmaske) · `pidns` (der Starter als PID 1 in `unshare -rpf`) · `fuzz` (libFuzzer: Siegel-Parser, Listen-Parser, Verzeichnislauf mit Orakel;
  `--fuzz-seconds N`) · `l3` (ein winziger `FROM scratch`-Container nur mit Starter und Attrappe: `docker stop`, `docker exec` überlebt, `--init`, gehärtete Optionen, Betriebsbenutzer 1000) · `measure` (Durchsatz und Prüfzeit). `npm test` führt `crypto` und `corpus` aus,
  wenn ein Compiler da ist (`src/lib/updates/native-starter.test.ts`; in der CI mit `REQUIRE_NATIVE=1` ein Fehler, wenn nicht). Die Stufe mit der echten App ist `scripts/smoke-anchor.sh` (Image mit Testschlüsseln, Ziel `runner-test`).

#### Launcher, Installer, Update-Seite

* **Der Launcher startet die App je Aufruf genau einmal** und gibt in **allen** Neustartpfaden `RESTART_EXIT_CODE` (42) zurück (Exit 42 der App, Rücknahme einer Wiederherstellung, Rückfall eines Updates): Jeder Neustart geht über den Starter,
  der prüft. Ein Neustart im Launcher ließe veränderten Code ungeprüft laufen. Tests: `src/launcher/launcher.test.ts` (ein Spawn je Aufruf, Rückfallschleifen enden).
* **Kompatibilitätsschranke** (`lib/updates/compat.ts`, im Launcher der eingebauten Version): Fällt der Starter von einer **bewährten** (nicht `pending`) Version zurück und kennt die Datenbank Migrationen, die der Code des Rückfallziels (Vorversion
  oder eingebaute App, gelesen aus `prisma/migrations`) nicht kennt, startet der Launcher die App **nicht**: Meldung im Container-Log (DE/EN, „Image aktualisieren“), Marker `incompatible`, Exit 78. Die Rücknahme eines frischen, unbestätigten
  Updates bleibt der vorgesehene Weg (Migrationen sind additiv zur Vorversion). Ist die Datenbank nicht lesbar, gibt es kein Urteil (kein Start wird verhindert, den die App selbst prüft).
* **Installer** (`modules/admin/updates/install.ts`): Release-Siegel wird schon beim Prüfen des Releases verifiziert (vor dem Paket-Download) und mit dem Manifest abgeglichen; nach dem Entpacken: Siegel ablegen, **Schreibschutz setzen und Setuid/Setgid/Sticky zurücksetzen** (`makeReadOnly`; Ordner erben Setgid
  von einem Elternordner mit „Gruppe vererben“, etwa auf NAS-Freigaben – der Prüfer des Starters bleibt streng und lehnte sie sonst mit 16 `setid` ab), dann **dieselbe Prüfung wie der Starter**
  (`verify.ts`: im Image ruft der Installer `/bootstrap --verify <Ordner> --expect-version V --check-expiry <heute>` auf – `lib/updates/starter-verify.ts` wertet Exit-Code und JSON-Zeile aus, alles Unlesbare ist 17 –, ohne `/bootstrap` (Entwicklung, Tests) prüft der Referenzprüfer; einspritzbar) → bei Befund wird nichts aktiviert (`badTree`, `sealExpired`; 19 → `notNewer`/`needsImage`); dann `fsync` über den Baum,
  erst danach `rename` und `writeState`. Löschen schreibgeschützter Bäume nur über `removeTreeSync` (`lib/updates/fs-tree.ts`). **Reparatur** = dieselbe Version erneut installieren.
* **Schlüssel nur aus dem Build** (`release-key.ts`): keine Umgebungsvariable überschreibt sie (weder App noch Starter); Forks tragen ihre Schlüssel dort ein. Tests ersetzen sie über `setTrustAnchorsForTest` (wirft bei `NODE_ENV=production`).
* **Das Paketverzeichnis ist zur Laufzeit schreibgeschützt:** Die App schreibt nur nach `/data` und `/tmp`. `next.config.ts`: `images.unoptimized` (sonst legt das unauthentifizierte `/_next/image` Dateien unter `.next/cache/images` ab und
  die nächste Prüfung scheitert) und `experimental.isrFlushToDisk: false`; `src/next-config.test.ts` hält das fest.

#### Pipeline

* **Schlüssel für Starter und App:** Der Starter bekommt seine Schlüssel aus einem Textmuster über `release-key.ts` (`scripts/lib/trust.mjs`, nur Zeilen `export const …` am Zeilenanfang), die App wertet dieselbe Datei als TypeScript aus. `readTrustAnchorsChecked` (alle Skripte und die Stufe `trust`) vergleicht beide Wege
  und bricht bei einer Abweichung ab (`src/lib/updates/trust-anchors.test.ts`).
* **Dockerfile:** `builder` stellt `/bundle` zusammen und ruft `scripts/gen-tree.mjs` (schlüsselfrei); Stufe `trust` erzeugt `trust-keys.h` und **bricht bei Tag-Builds ab** (Wurzel fehlt/gleich Release-Schlüssel/Testschlüssel), Stufe `bundle` kopiert `/bundle`.
* **Job `publish`** (Tags): Image nur als `sha-…` pushen, Paket per `docker cp /app` aus dem **getesteten** Image (kein zweiter Build, `BUILD_ID` bleibt gleich), Referenzprüfung des Baums (`scripts/verify-tree.mjs`), Digest als Ausgabe.
* **Job `release`** (Umgebung `release`): Paket auspacken → `make-seal.mjs` (prüft Baum ↔ Liste, signiert) → `make-release.mjs` → **Echtprobe** (`scripts/real-trial.sh`: Produktions-Image per Digest, `--print-keys` gegen die erwarteten
  Fingerabdrücke, Testschlüssel-Negativprobe, `--verify … --no-floor --check-expiry`, drei Manipulationen) → Release als **Entwurf** → `docker buildx imagetools create` für `X.Y.Z`, `X.Y`, `latest` (Vorabversionen nur den vollen Namen) → Entwurf veröffentlichen.
  Fehlt dem Image der Prüfer, scheitert die Echtprobe (fail closed); sie prüft auch, dass das Image ein **Tag-Build** ist (`tag-build 1`) und Wurzel- und Release-Schlüssel **im Binary** verschieden sind. **Generalprobe** (`workflow_dispatch` `rehearsal`): nur Testschlüssel, kein Secret (`scripts/rehearse-release.mjs`);
  `check_signing_key`: Schlüsselpaar-Konsistenz in der Umgebung `release`, **nur auf `main`** (ein anderer Zweig könnte das Skript ändern und den Schlüssel ausgeben lassen). Der Job `release` läuft in der `concurrency`-Gruppe `release` (ohne Abbruch laufender Läufe) und prüft **als Erstes**, dass der Tag der höchste Versions-Tag ist
  (`scripts/check-release-order.mjs`: ein Tag unterhalb eines vorhandenen höheren – etwa auf einem alten `main`-Commit mit passender `package.json` – würde `latest` zurückdrehen und bricht ab; Vorabversionen passieren; **kein Pfad für Rückportierungen**, ein Patch für eine ältere Linie bräuchte einen eigenen Ablauf).
* **Job `native`** (jeder Lauf, vor `publish`): alle nativen Stufen des C-Prüfers (`docker/test/run.mjs …`, auch der winzige Container und ein Fuzz-Kurzlauf), mit `REQUIRE_NATIVE=1`. **Dockerfile:** `trust` und `bootstrap-build` brauchen kein `npm ci` (nur Node bzw. gcc); das Ziel `runner-test` ist dasselbe Image mit dem Starter, der die **Testschlüssel** trägt (`trust-test`, `docker/test/gen-test-header.mjs`; bricht bei Tag-Builds ab). Bei Versions-Tags baut `publish` es aus dem Cache und führt `scripts/smoke-anchor.sh` aus (Gutfall, gehärtet, sieben Manipulationen, veraltete Version, Neustart nach Manipulation, Nachprüfung der laufenden Kopie auf Schreibzugriffe der App).
* **Smoke-Test** (`scripts/smoke-image.sh`): zusätzlich Modus-Bits unter `/app` (kein `g+w`/`o+w`, kein Setid/Sticky), `SOS-TREE` vorhanden und gegen den Baum geprüft, **`/` und `/bootstrap` gehören root und sind für Gruppe/Andere nicht schreibbar** (`docker cp <Container>:/ -`; `docker export` nennt `/` nicht).

#### Befunde der Bestandsaufnahme (WP1, statisch)

* Das Paket besteht aus `.next/standalone` (Server, `node_modules`, `.next` ohne `cache`), `.next/static`, `public`, `docs`, `prisma/migrations`, `version.json`, `launcher.mjs` und `runtime/` (Node, glibc, libstdc++, nss, Lader). Ein veralteter lokaler
  Standalone-Build hat 3 046 Dateien, 630 Ordner, 47 MB (ohne `runtime/`; darunter 74 `.map`-Dateien); Schätzung für das Paket: 200–300 MB, 4 000–10 000 Dateien. **Echte Zahlen am Image messen** (Messwerte des Prüfers siehe unten, „Messwerte“; das Paket selbst wird erst mit dem ersten Tag-Image messbar).
* `sharp` samt `@img` liegt im Standalone-`node_modules`, obwohl die Bildoptimierung aus ist (`images.unoptimized`): eine Baumdiät (Entfernen) ist ein möglicher Nebennutzen, kein Muss.
* **Laufzeit-Schreibpfade im Code:** `/data` (Datenbank, `files`, `backups`, `restore`, `app/`, `secret.key`, `setup-token`, `secret-reset`), `/tmp` (SQLite-Temp, Uploads). Im Paketverzeichnis schrieb nur Next selbst
  (`.next/cache/images` bei `/_next/image`, `.next/cache/fetch-cache`, ISR-Rückschreiben bei `isrFlushToDisk`) — die ersten beiden sind abgeschaltet (`images.unoptimized`, `isrFlushToDisk: false`), `fetch-cache` ist nicht gemessen. Weitere Kandidaten in Teil 2 am
  laufenden Container messen (`lockDistDir`, Coredumps mit relativem `core_pattern`, SQLite-Temp-Rückfall auf `.` bei unbeschreibbarem `/tmp`): Nachlaufprüfung gegen die **installierte** Kopie (uid 1000) nach der Routen-Inventur.
* `@opentelemetry/api` ist nicht im Bundle (Next lädt es optional per `require` in `try`): die Vorfahrenregel (Code 18) ist die Absicherung gegen das Nachladen aus `/data/app/versions/node_modules` & Co.

#### Messwerte und Fuzz-Ergebnis des Prüfers (2026-11-07)

Gemessen auf einem Ryzen 9 5900 (WSL2/Kali, gcc 15.2, ext4 auf virtueller Platte, `node docker/test/run.mjs measure`), also die schnelle Klasse A – für Mini-PC/NAS/Raspberry Pi gibt es **keine** Messung, nur die Schätzungen aus dem Entwurf:

* **SHA-512** (Monocypher 4.0.3, portables C, `-O2`, 256-KiB-Blöcke): **427 / 466 / 441 MB/s** in drei Läufen; OpenSSL über `node:crypto` zum Vergleich 1 033 MB/s. Der Starter nutzt das portable C (kein Assembler, keine Abhängigkeit); ein Wechsel des Hashes ist nach dem Entwurf erst
  bei verfehltem Budget sinnvoll (Reihenfolge: Baumdiät, parallele Leser, BLAKE2b).
* **Prüfzeit** an einem synthetischen Testbaum (9 361 Einträge, 250 MiB, Dateigrößen logarithmisch von 30 Byte bis ≈ 1,6 MB, wie ein Next-Standalone-Paket): **warm 0,66 s (≈ 395 MB/s)**, „kalt“ **2,3 s (≈ 110 MB/s)**. „Kalt“ heißt: die Seiten aller Dateien per
  `posix_fadvise(DONTNEED)` aus dem Seiten-Cache geworfen (ohne Root); ein Cache des Hypervisors/der virtuellen Platte darunter bleibt, echte kalte Magnetplatten oder SD-Karten sind deutlich langsamer. Ein echtes Paket wird erst mit dem ersten Tag-Image messbar.
* **Binary:** 953 KB (Debian-bookworm-gcc, `static-pie`, gestrippt, mit statischer glibc und Monocypher); `BIND_NOW` und `GNU_RELRO` gesetzt (das Dockerfile prüft es).
* **libFuzzer** (clang 21, AddressSanitizer + UBSan, je 90 s, deterministische Saaten aus dem Goldkorpus): Siegel-Parser (ohne Signaturprüfung, damit der Parser dahinter erreichbar ist) **20,0 Mio.** Ausführungen, Listen-Parser **8,9 Mio.**, Verzeichnislauf mit Orakel (strukturierte Bäume
  samt Mutation; erwartet 0 bzw. 14/15/16) **0,39 Mio.** – **keine Funde** im Prüfer. Der einzige Fund des ersten Laufs lag im Testharness (ein Eintrag namens `SOS-SEAL` im Wurzelordner kollidierte mit dem Siegel, das der Harness selbst anlegt) und ist behoben.
  Kurzläufe gehören in jede CI (`--fuzz-seconds 30`), lange Läufe (Stunden) vor der Veröffentlichung von 0.2.0.
* **Gefunden und behoben während der Umsetzung:** (1) Wycheproof tcId 151 (nicht-kanonisches `R` wurde von Monocypher akzeptiert) → `sos_ed25519_check`; (2) Setuid/Setgid/Sticky an `SOS-SEAL`, `SOS-TREE` und am Versionsordner selbst wurden weder vom Referenzprüfer noch von C erkannt (Mutationstest) → Code 16 `setid`
  in beiden, drei neue Fälle im Goldkorpus; (3) `extra-file-long-name` im Korpus (300 Zeichen) ließ sich unter Linux nicht anlegen (`NAME_MAX` 255) → 250 Zeichen; (4) `isCalendarDate` rechnete Jahre unter 100 falsch (`Date.UTC`) → von Hand gerechnet, in TypeScript und C gleich.

### Backups und Wiederherstellung (Funktion `admin.backup`)

Ein Backup ist ein **Ordner** `<DATA_DIR>/backups/schrauberos-<Zeitpunkt>-<Art>/` mit `database.db.gz` (konsistenter, geprüfter
Online-Schnappschuss), `files/` (**Hardlinks** auf `/data/files`) und `info.json`. Arten: `auto`, `manual`, `upload`,
`pre-update`, `pre-restore`, `pre-migration`. Download als gestreamtes `.tar`, Upload nimmt `.tar`, `.tar.gz` und reine SQLite-Dateien
(dann ohne Dateien) und prüft streng (nur Ordner/normale Dateien, gültige Datenbank, nicht von einer neueren Version).
Wiederherstellung: App prüft, legt `pre-restore` an, stellt `restore/pending.db` (+ `pending-files/`) bereit und beendet sich; der
Launcher tauscht Datenbank samt WAL und Dateien, bestätigt nach gesundem Start oder setzt alles zurück.

* **Zeitplan:** Job `backup.auto` (alle 10 Minuten geprüft: Uhrzeit erreicht, heute noch keins – `src/server/backup/auto.ts`; Einstellung in `AppSetting`). **Scheitert** das Anlegen, wirft der Job:
  Der Runner wiederholt nach 15 min, 30 min, 1 h … höchstens alle 4 h, der Fehlerstatus (`JobState.failures`, Meldung nur Art und Code) steht auf der Backup-Seite, im Dashboard-Baustein und im Systemstatus;
  im Audit-Log nur der erste Fehlschlag der Serie (`backup.createFailed`; `JobDef.onFailure`, **auch bei Zeitüberschreitung**). Reihenfolge im Lauf: Backup anlegen → Audit `backup.create` → Aufbewahrung; scheitert nur die Aufbewahrung,
  bleibt der Lauf ein Erfolg (Hinweis in der Meldung, `backup.retention` versucht es täglich erneut). Die Warnung (Backup-Seite, Dashboard) erscheint nur, solange **kein neueres Backup irgendeiner Art** existiert (`src/server/backup/status.ts`);
  `Jetzt erneut versuchen` führt `backup.auto` sofort aus (`runNow`, `ctx.manual`: Uhrzeit und „heute schon“ gelten nicht; Operation `admin.backup.runAuto`, Recht `backup.manage`, Audit `backup.runNow`).
* **Aufbewahrung je Art** (`src/server/backup/settings.ts`, `pruneBackups` in `core.ts`): Je Art `keep` (neueste N) und `days` (höchstens so alt), 0 = unbegrenzt; Standard `auto` 14, `pre-*` 5, `manual`/`upload` unbegrenzt.
  Das **neueste Backup überhaupt bleibt immer**. Angewendet nach jedem automatischen Backup und täglich (Job `backup.retention`, räumt auch liegengebliebene `.tmp-`/`.import-`/`.upload-`/`.trash-`-Einträge). Hilfe: DSGVO-Hinweis zur Speicherbegrenzung.
  Im Formular sind alle Felder Pflicht: ein **leeres Feld ist ein Fehler, nie „0 = unbegrenzt“** (`Number("")` ist 0).
* **Event-Loop bleibt frei:** `linkTree`/`countTree`/`assertPlainTree`, **Löschen** (`deleteBackup`: erst atomar nach `.trash-…` umbenennen, dann asynchron abbauen), `pruneBackups`, `listBackups` und `cleanupBackupTemp` sind asynchron
  (`fs/promises`, Stapel von 64, über alle Verzeichnisebenen zusammen höchstens 64 gleichzeitige Dateizugriffe – kein `EMFILE`). Tests messen, dass der Loop währenddessen läuft. `linkTree` überspringt Dateien, die zwischen Auflisten und Verlinken verschwinden
  (ENOENT), und wartet nach einem Fehler auf alle laufenden Aufgaben, bevor aufgeräumt wird (kein verwaistes `.tmp-…`). `removeTree` setzt vor dem Löschen `u+rwx` auf die Ordner (ein entpacktes Archiv kann wegen `noChmod` Modus 000 mitbringen). Ein Backup, das sich nicht
  löschen lässt, bricht die übrigen nicht ab (`PruneError`). Das Aufräumen von `.tmp-`/`.import-`-Ordnern fasst nie an, woran dieser Prozess gerade arbeitet (`markTempActive`), und nur Einträge, die mindestens 6 Stunden unverändert sind (die mtime eines
  Ordners ändert sich nur, wenn direkt darin etwas angelegt wird – ein langer Import schreibt tiefer).
* **Entpacken der Datenbank hat eine Obergrenze** (Gzip-Bombe, `gunzipDatabase` in `restore.ts`, `src/lib/limit-stream.ts`): zwischen Entkomprimierer und Schreibstrom zählt ein Strom mit `min(64 GiB, freier Platz − 512 MiB)`, der freie Platz wird alle 64 MiB nachgeprüft
  → `tooLarge`/`diskFull`, die halbe Datei wird gelöscht. Gilt für Wiederherstellung (`stageRestore`), Import und die Prüfung des Imports.
* **Off-Site-Backup (P1b-4)** – Reiter **Off-Site** (`/admin/backup/offsite`), Recht `backup.manage`:
  * **Format `.sobk`** (`src/lib/offsite/crypto.ts`): AES-256-GCM in Blöcken zu 1 MiB; Kopf (Version 2: 44 Byte Kennung, Version, Blockgröße, 32 Byte Salz, dazu Längenfeld und **Kontext = Name der Sicherung**) im AAD – `fetchOffsiteBackup` erwartet den Namen aus dem Dateinamen, eine ältere Datei unter neuerem Namen scheitert mit `fileMismatch` (ZP5-9); Schlüssel je Datei per HKDF aus dem **Off-Site-Hauptschlüssel**
    (`deriveOffsiteMasterKey` aus dem Wiederherstellungsschlüssel); Nonce = Blocknummer; ein **Endmarken-Byte im AAD** erkennt abgeschnittene Ströme, die Nonce vertauschte/doppelte/fehlende Blöcke. Streamend in beide Richtungen
    (`createEncryptStream`/`createDecryptStream`, nie komplett im Speicher; Klartext erst nach geprüftem Block). Falscher Schlüssel und Veränderung sind nicht zu unterscheiden (`wrongKey`).
  * **Ablauf** (`src/server/backup/offsite/service.ts`): Job `backup.offsite` (alle 10 min, `shouldRun`: lokal prüfbar nur bei Arbeit, sonst einmal täglich Abgleich mit dem Ziel; Wiederholung 15 min … 4 h; Audit nur beim ersten Fehlschlag `backup.offsiteFailed`).
    Hochgeladen werden die neuesten `keep` Backups der Arten `auto`/`manual`, die am Ziel fehlen (`planUploads`); das Archiv wie beim Download (`tar`), verschlüsselt, als `<name>.sobk.part`, danach umbenannt; Prüfung, dass die Datei am Ziel liegt; **Aufbewahrung** löscht nur Dateien
    mit dem eigenen Namensmuster `OFFSITE_NAME` jenseits der neuesten `keep` (und unfertige `.part` nach einem Tag) – nie fremde Dateien (`planDeletions`). Der Merker `offsite.uploaded` spart das Auflisten bei jedem Takt.
  * **Ziele hinter der Schnittstelle `OffsiteTransport`** (`transport.ts`; Tests setzen `setTransportFactoryForTest`): **WebDAV** (`webdav.ts`, nur `fetch`: PROPFIND/MKCOL/PUT gestreamt mit `duplex: "half"`/MOVE/GET/DELETE, **nur HTTPS** (Klartext-HTTP nur in Tests), keine Zugangsdaten in der Adresse, der Multistatus-Parser ist ein linearer `indexOf`-Durchlauf ohne Regulärausdrücke über den ganzen Text (ZP5-3; Antwort höchstens 2 MiB, 5000 Einträge, Test mit 16-MiB-Eingaben und Zeitlimit),
    **Weiterleitungen werden nie verfolgt** (`redirect: "manual"`), Zeitlimit je Anfrage und Wächter gegen hängende Übertragungen; der Server muss Chunked-PUT annehmen) und **SFTP** (`sftp.ts`, `ssh2` 1.17.0, MIT, `import()` erst bei Bedarf). `ssh2` hat optionale native Teile (`sshcrypto`, `cpu-features`): In `package.json` ist
    ihr Install-Skript über `allowScripts` verneint (`false`), es läuft die reine JavaScript-Variante; ein Test prüft, dass `ssh2` ohne `sshcrypto.node` lädt. **Der Hostschlüssel ist fest hinterlegt:** `hostVerifier` vergleicht den SHA-256-Fingerabdruck mit der Einstellung und bricht **vor der Anmeldung** ab
    (`OffsiteError("hostKey")`, getestet gegen einen `ssh2`-Server im Speicher: kein Anmeldeversuch); abgerufen und bestätigt wird er beim Einrichten (`admin.backup.fetchHostKey`: Verbindung bis zum Schlüsselaustausch, keine Anmeldedaten; speichern nur mit gesetztem Häkchen, wenn Server, Anschluss
    oder Fingerabdruck wechseln). Zugangsdaten (`offsite.credentials`) sind ein Geheimnis; **ändert sich das Ziel, müssen sie neu eingegeben werden** (kein Abfließen gespeicherter Zugangsdaten an einen neuen Host). **Adressrichtlinie (ZP5-6, `src/lib/offsite/host-policy.ts`):** verboten sind der eigene Rechner (Loopback, eigene Schnittstellenadressen), `0.0.0.0/8`/`::`, Verbindungs-lokal (`169.254.0.0/16`, `fe80::/10`), Multicast/Reserviertes und die Metadaten-Dienste (`169.254.169.254`, `fd00:ec2::/32`, `100.100.100.200`, `168.63.129.16`, `metadata.google.internal` …); **erlaubt sind private Netze** (RFC 1918, `fc00::/7`, `100.64.0.0/10`) – ein NAS im LAN ist der Normalfall. Jede Schreibweise zählt wie die kanonische Adresse (Dezimal `2852039166`, Hex, Oktal, `0`, IPv4-in-IPv6, NAT64, 6to4, Teredo; Normalisierung über die URL-Klasse). **Namen werden vor jeder Verbindung aufgelöst** (`server/backup/offsite/resolve.ts`, `resolvePinned`): jede Antwort muss erlaubt sein (sonst `forbiddenHost`, auch bei gemischten Antworten), verbunden wird nur mit der **geprüften Adresse** – SFTP über `host: <Adresse>` (der bestätigte Fingerabdruck des Hostschlüssels ersetzt den Namen), WebDAV über `pinnedFetch` (`node:https` mit festgelegtem `lookup`; SNI und Zertifikatsprüfung bleiben beim Namen). Das gilt für jeden Lauf, „Verbindung testen“ und die Hostschlüssel-Abfrage (kein DNS-Rebinding). Loopback gibt es nur in Tests: `allowLoopbackForTests()` (die Fake-Server rufen es auf; im Betrieb wirft es). **Restrisiko (Produktentscheid):** Wer `backup.manage` hat, kann über „Verbindung testen“/„Hostschlüssel abrufen“ erreichbare Anschlüsse im eigenen Netz erkennen (Fehlerdetail `ECONNREFUSED`/Zeitüberschreitung); private Netze sind bewusst erlaubt.
  * **Rückweg:** `fetchOffsiteBackup` (Operation `admin.backup.fetchOffsite`, Audit `backup.offsiteFetch`): holen → mit dem gespeicherten Hauptschlüssel entschlüsseln (`decryptToFile`, Obergrenze/Platzprüfung wie beim Entpacken) → `importBackupFile` → Backup der Art `upload`. Ist der Server weg, öffnet
    `importBackupFile` eine `.sobk` mit dem Wiederherstellungsschlüssel (Upload in der Verwaltung: Kopf `x-recovery-key`; Einrichtung: siehe oben).
  * **Tests ohne Netzwerk:** `src/test/fake-webdav.ts` (`node:http`) und `src/test/fake-sftp.ts` (Server-Teil von `ssh2`); `webdav.test.ts`, `sftp.test.ts`, `offsite.test.ts` (Dienst, Aktionen, Job, Rückweg, Aufbewahrung), `src/lib/offsite/crypto.test.ts` (Manipulationen).
* **Upload** (`/api/backups/upload`, `receive.ts` teilt sich Empfang und Platzprüfung mit der Einrichtung): Länge vorab gegen freien Platz (2 × Länge + 512 MiB Reserve → 507) und Obergrenze (100 GiB → 413); während des Empfangs werden die Bytes gezählt (Obergrenze auch ohne Längenangabe)
  und alle 64 MiB der freie Platz geprüft; beim Entpacken zusätzlich Grenze für Einträge/Größe und freier Platz (`diskFull`/`tooLarge`). Abbruch löscht die halbe Datei.

## Job-Runner (`src/server/jobs`)

Persistenter Zeitgeber für alles, was die App im Hintergrund erledigt. Zustand in der Datenbank (`JobState`: nächster Lauf, Fehlerserie, Sperre; `JobRun`: Ergebnis jedes Laufs), Definitionen im Code.

* **Anmelden:** Jede Funktion legt eine `jobs.ts` an (`export const jobs: JobDef[]` mit `id` `<bereich>.<name>`, `feature`, `schedule`, `run`; optional `retry`, `timeoutMs`, `shouldRun`, `onFailure`) und trägt sie in `src/modules/jobs.ts` ein;
  Abnehmer für die Outbox (`OutboxHandlerDef`) stehen im selben Wurzelmodul (`featureOutboxHandlers`). Jobs der Plattform: `src/server/jobs/platform.ts`. Die Plattform importiert keine Funktion (Architekturtest;
  `feature` in einer `jobs.ts` muss die eigene Funktion sein; `jobs.test.ts` prüft per Import, dass jeder Job und jeder Abnehmer eine `feature` nennt). Ein Job läuft **nur, solange seine Funktion aktiv ist** (kein Lauf, kein Eintrag; beim Wiedereinschalten wird nachgeholt).
* **Zeitplan** (`src/lib/jobs/schedule.ts`): `{ every: ms }` oder `{ cron: "m h dom mon dow" }` in der **Zeitzone der Werkstatt** (Prozess-`TZ`; ein Wechsel stellt die Cron-Termine um). Sommerzeit: eine ausgefallene Uhrzeit
  läuft direkt nach der Lücke, eine doppelte nur einmal – ein Tagesjob läuft jeden Kalendertag genau einmal (getestet über ein Jahr). Verpasste Läufe (App war aus) werden einmal nachgeholt.
  **Grenze:** Ein stündlicher oder unterstündlicher **Cron** (`0 * * * *`, `*/15 * * * *`) lässt beim Zurückstellen der Uhr die zweite Stunde aus (die Wandzeiten 02:xx gibt es zweimal, genommen wird das erste Mal; `schedule.test.ts` dokumentiert es).
  Wer in **jeder** Stunde laufen muss, nimmt `{ every: ms }`.
* **Fehler:** `failures` zählt in Folge; nächster Versuch nach `Basis · 2^(n−1)`, höchstens `maxDelayMs` (Standard 1 min … 1 h). Ein Job gibt nie still auf – der Fehler bleibt sichtbar, bis ein Lauf gelingt.
* **Sperre gegen Doppelläufe:** bedingtes Update von `JobState.lockedUntil` (Zeitlimit + 60 s) plus Merkliste im Prozess, bis die Funktion wirklich zurückkehrt (auch nach Zeitüberschreitung).
  **Neustart mitten im Lauf:** `recover()` beim Start hält jeden belegten Job als `interrupted` fest (ein `JobRun`), löst die Sperren und stellt die Jobs sofort fällig. Das gilt, weil es **einen Prozess** gibt (ein Container, eine SQLite-Datei);
  Jobs müssen daher **wiederholbar** sein. Scheitert das Belegen nach dem Update (Datenbankfehler), wird die Sperre sofort freigegeben (nur wenn sie dieser Prozess hält), sonst verfiele sie erst nach Zeitlimit + 1 min. Ein Job, der `ctx.signal` ignoriert und über sein Zeitlimit hinaus
  hängt, blockiert nur sich selbst: Jeder fällige Termin bekommt einen sichtbaren Vermerk (`lastMessage` „Hängt …“), die Fehlerserie wächst, der nächste Termin rückt nach der Wartezeit weiter. **`ctx.signal` sollten Jobs auswerten** (der Backup-Job prüft es vor der Aufbewahrung, die Outbox zwischen den Ereignissen).
* **Start mit Wiederholung, Herzschlag:** `start()` setzt die Timer **immer**; `recover()`/`sync()` laufen sofort und – scheitern sie (Datenbank kurz weg) – bei jedem Takt erneut, bis es gelingt; vorher läuft kein Job. `status()` (im Prozessspeicher: gestartet, vorbereitet, letzter Takt, letzter Fehler)
  speist den Systemstatus („Zeitgeber zuletzt aktiv“). `runNow(jobId)` führt einen Job sofort aus (Aktivierung der Funktion gilt, `ctx.manual = true`, `shouldRun` wird umgangen); verdrahtet ist es bisher für `backup.auto` („Jetzt erneut versuchen“) und `backup.offsite` („Jetzt übertragen“).
* **Nur Auffälliges wird festgehalten:** Ein Lauf ohne Fehler **und ohne Ergebnismeldung** schreibt keinen `JobRun` (nur `JobState`) – sonst Zehntausende Zeilen am Tag allein für den 15-Sekunden-Takt der Outbox. Jobs sollten bei „nichts zu tun“ `undefined` zurückgeben. `JobDef.shouldRun` ist eine billige Vorabprüfung
  **nur mit Lesezugriffen** vor Sperre und Lauf (Outbox: ein `count`); `false` → keinerlei Schreibzugriff, der Job bleibt fällig. Ein laufender Job hat keinen Lauf-Eintrag (sichtbar über `JobState.lockedUntil`).
* **Outbox-Zustellung** (`outbox.ts`, Job `platform.outbox` alle 15 s): mindestens einmal, je Abnehmer idempotent über `OutboxDelivery`; Wiederholung nach 30 s · 2^n (höchstens 1 h), nach `maxAttempts` (8) `failedAt`;
  zugestellte Ereignisse 14 Tage, aufgegebene 60 Tage aufbewahrt (`platform.outbox-prune`). Abnehmer bekommen `message.id` als Idempotenzschlüssel.
  **Zeitlimit je Abnehmer** (`OutboxHandlerDef.timeoutMs`, Standard 30 s, `ctx.signal` wird ausgelöst): Ein hängender Abnehmer gilt als gescheitert (Wiederholung mit Wartezeit) und blockiert weder die anderen Abnehmer noch den Job; kommt er später doch noch zum Ende, kann das Ereignis zugestellt, aber nicht vermerkt
  sein → Abnehmer müssen idempotent sein (Webhooks: `message.id` mitsenden). **Ausgeschaltete Abnehmer-Funktion (Entscheidung zu ZP3-A-11):** Das Ereignis bleibt für diesen Abnehmer **offen (geparkt**, Wartezeit 15 min, damit es neue Ereignisse nicht verdrängt), wird beim Einschalten nachgeholt und
  verfällt sonst mit der Aufbewahrung (14 Tage ab Anlage). Ein Ereignis ohne **irgendeinen** angemeldeten Abnehmer gilt weiter sofort als erledigt.
* **Ergebnisse:** 30 Tage bzw. 200 je Job (`platform.jobs-prune`, entfernt auch den Zustand nicht mehr bekannter Jobs). Ansicht für Administratoren: **Verwaltung → Systemstatus** (`admin.system`, Recht `system.view`, `adminOnly`). Die Meldung „alles in Ordnung“ kommt aus der reinen Funktion `evaluateSystem` (`src/server/jobs/health.ts`, getestet): Fehlerserie, überfällig (> 5 min), hängende Sperre, unterbrochen,
  aufgegebene Ereignisse, Zeitgeber ohne Takt (> 3 min) bzw. mit Fehler, **Plattenplatz** (unter 10 % frei = Hinweis `diskLow`, unter 5 % oder unter 512 MiB = Fehler `diskCritical`; `DISK_*`-Konstanten), **Backup älter als 7 Tage oder keines** (`backupOld`, Hinweis); Jobs ausgeschalteter Funktionen zählen nie.
  `problemTone` unterscheidet Hinweise (gelb: `interrupted`, `diskLow`, `backupOld`) von Fehlern (rot). **Systemstatus (P1b-7)**, zusätzlich zu den Jobs: Karte **Server** (`src/server/system-info.ts`: Version und **Commit** aus `version.json` – `scripts/write-version.mjs --commit` bzw. Build-Argument `APP_COMMIT`,
  im Workflow `github.sha` –, Node-Version des laufenden Prozesses, freier/gesamter Platz des Datenverzeichnisses über `diskSpace` (`statfs`), Größe der Datenbankdatei plus `-wal`, neuestes Backup mit Art) und **„Letzte Warnungen und Fehler“**: ein **Ringpuffer im Prozess** (`src/lib/log-buffer.ts`,
  200 Zeilen, angezeigt 50; `instrumentation.ts` hängt `console.warn/error` um, die Ausgabe bleibt unverändert). In den Puffer kommt nur Datensparsames: Steuerzeichen entfernt, gekürzt, Fehlerobjekte nur als Klasse und Code (`describeError`), andere Objekte nur als Typ, `Bearer …`/`token=…`/lange Schlüsselzeichenfolgen
  durch `[…]` ersetzt; nur im Speicher, nie in Datenbank oder Backup. Dazu **Hinweise zur Verbindung** (`connectionNotices`: HTTP statt HTTPS, „Hinter Reverse-Proxy“ ohne `X-Forwarded-Proto`; Information, nicht Teil von „alles in Ordnung“).
  **Update-Seite „Was ist neu“:** Die Notizen des neuen Releases stehen wie bisher bei der Prüfung; zusätzlich die der **installierten** Version (`fetchReleaseNotes`, `/releases/tags/v<version>`, eine Stunde im Speicher). **Offline:** Jede geholte Notiz wird als Kopie
  `<Daten>/app/notes/<version>.md` abgelegt (`lib/updates/store.ts`) und angezeigt, wenn GitHub nicht antwortet – das Paket selbst bringt keine Notizen mit (sie entstehen erst mit dem Release, nach dem Paketbau). Markdown läuft durch den sicheren Renderer (kein rohes HTML, externe Bilder nicht geladen).
* **Testbar:** `createJobRunner({ jobs, now, timeZone, activeFeatures })` mit Fake-Uhr; `tick()` führt Fälliges aus. Tests: `src/server/jobs/jobs.test.ts`, `src/lib/jobs/schedule.test.ts`.

## Uploads und Archive

* **Inhalt statt Behauptung** (`src/lib/upload-sniff.ts`): Rechnungsbelege (PDF, PNG, JPEG, WebP, XML/XRechnung), Doku-Bilder (PNG, JPEG, WebP, GIF) und das Logo (nur PNG, JPEG, WebP – **kein SVG**, Auslieferung über `/api/logo`, siehe „Installierbare App (PWA)“) werden an den ersten Bytes erkannt;
  der gemeldete Typ muss passen, **gespeichert wird der erkannte Typ**. HTML als `.png` wird abgelehnt. **XML nur als elektronische Rechnung:** `<?xml`-Deklaration, Wurzel aus der Positivliste (UBL `Invoice`/`CreditNote`, CII `CrossIndustryInvoice`, `XML_INVOICE_ROOTS`), kein `<!DOCTYPE`, `<!ENTITY`, `<?xml-stylesheet`.
  **Der Leser** (`src/lib/einvoice/xml.ts`, P4b-3) ist ein eigener schmaler Tokenizer ohne DTD und ohne Entitäten (kein XXE, kein Entity-Expansion, keine Verarbeitungsanweisungen außer der Deklaration, nur UTF-8) und löst nie Adressen aus der Datei auf; siehe „Rechnungen: Festschreiben, Storno, E-Rechnung“.
* **Fotos verkleinern vor dem Hochladen** (`FileInput variant="photo"`, Logik in `src/lib/image-resize.ts`, getestet in `image-resize.test.ts` und `photo-input.test.ts`): Handyfotos (4–8 MB) werden im Browser auf höchstens 1600 px (längste Kante) und als JPEG mit Qualität 0,8
  neu kodiert (`createImageBitmap(file, { imageOrientation: "from-image" })` wendet die EXIF-Drehung an, das Ergebnis trägt kein EXIF). **`maxBytes` gilt für das verkleinerte Ergebnis** (ein 6-MB-Foto passt in das 2-MB-Feld der Doku-Bilder). Entscheidungen: PDF/XML/SVG unverändert (nicht einmal dekodiert);
  Bild bis 1600 px und innerhalb `maxBytes` bleibt das Original; die neue Fassung ersetzt es nur, wenn sie kleiner ist; PNG/WebP **mit Alpha** nie zu JPEG (zu große als PNG); GIF und animiertes WebP unverändert; erkannt wird am Inhalt (Magic Bytes), der Browser-Typ ist unter Android oft leer. Über **100 Megapixel** (Maße aus dem Dateikopf, `PHOTO_MAX_PIXELS`) wird gar nicht erst dekodiert (ZP5-14).
  HEIC, das der Browser nicht dekodiert (Chrome/Android) → `ImageError("heic")`, das Feld wird geleert und eine Erklärung steht da (der Server nimmt kein HEIC an); Safari dekodiert es und liefert JPEG. Ein anderes undekodierbares Bild bleibt das Original (der Server prüft es ohnehin).
  Dekodieren/Kodieren stecken hinter `ImageEngine` (Fake-Engine in Tests, `browserImageEngine` mit Canvas/OffscreenCanvas im Browser; ein echter Browsertest steht noch aus). **Bei Server-Action-Formularen** schreibt der Baustein die verkleinerte Datei per `DataTransfer` ins Dateifeld zurück
  (`setInputFiles`), sonst sendet der Browser das Original; solange verkleinert wird, ist das Absenden des Formulars gesperrt. Bei Touch gibt es zusätzlich „Foto aufnehmen“ (zweites Feld mit `capture="environment"`; `camera={false}` lässt es weg). Eingebunden in Rechnungsbelege und Doku-Bilder (Knopf und Einfügen aus der Zwischenablage).
* **Auslieferung** (`src/lib/file-delivery.ts`): `X-Content-Type-Options: nosniff` immer; PDF inline (ohne `sandbox`, der PDF-Betrachter verträgt sie nicht); Bilder und alles andere mit
  `Content-Security-Policy: sandbox; default-src 'none'`; XML und unbekannte Typen nur als `attachment`; `Content-Disposition` mit ASCII-Name und UTF-8-Variante (kein Einschleusen von Kopfzeilen). Dateinamen werden nach **Zeichen** gekürzt (`truncateName`, wohlgeformt): `slice` schnitte ein Emoji durch, und `encodeURIComponent` wirft bei einem einzelnen Ersatzzeichen – der Beleg wäre dauerhaft nicht auslieferbar.
* **Herkunft** (`src/server/request-guard.ts`): Upload-Routen verlangen `X-Requested-With: schrauberos`, gleiche `Origin` und kein fremdes `Sec-Fetch-Site`. Server Actions (Belege) prüft Next selbst (Origin gegen Host);
  sie bleiben im 12-MB-Limit. Neue Upload-Wege gehören durch `checkUpload`, `deliveryHeaders` und `isSameOriginUpload`. Mit der Einstellung „Hinter Reverse-Proxy“ gilt für den Herkunftsvergleich `X-Forwarded-Host` (erster Eintrag) statt `Host` – der Proxy schreibt `Host` oft um, sonst wäre jeder Upload 403;
  der Proxy muss den öffentlichen Namen dort mitgeben. Das Doku-Bild verlangt **Content-Length** (411; `formData()` puffert alles) und prüft das Bearbeiten-Recht (mindestens ein Bereich) **vor** dem Lesen des Bodys.
* **Archive** (`src/lib/archive.ts`, `extractArchive`): nur Ordner und normale Dateien; Symlinks, Hardlinks, Geräte-Dateien, `..`, absolute Pfade, Laufwerke, Rückwärtsstriche, NUL werden abgelehnt;
  Grenzen für Einträge und Gesamtgröße (aus den Köpfen, bevor etwas geschrieben wird). Backups: höchstens 500 000 Einträge/200 GiB und der freie Platz. Update-Pakete: 200 000 Einträge/3 GiB; **relative Symlinks innerhalb
  des Pakets** sind dort erlaubt (`symlinks: "inside"`), falls Bibliotheken welche enthalten – dann nur mit `..` **am Anfang** des Ziels (ein `..` hinter einem Namen verändert seine Bedeutung, sobald ein Zwischenglied selbst ein Symlink ist) und mit einer **Prüfung auf dem Dateisystem
  nach dem Entpacken** (`assertSymlinksInside`: jeder Link muss per `realpath` im Ziel bleiben, Schleifen werden abgelehnt). Tests mit von Hand gebauten bösartigen Archiven (`src/test/tar.ts`).

## PDF-Erzeugung (`src/server/pdf`, F-PDF)

Voraussetzung für Rechnung/Angebot (F3) und Etiketten (F8). Läuft in der `FROM scratch`-Laufzeit: kein Chromium, keine Systemschriften, kein natives Addon.

* **Bibliothek (Entscheidung):** `pdfkit` **0.20.2** (MIT, reines JavaScript; Abhängigkeiten `fontkit` (MIT), `fflate`, `png-js`, `linebreak`, `@noble/hashes`/`@noble/ciphers`, alle ohne Installationsskript) – exakt gepinnt. Verworfen: `pdf-lib` (1.17.1, seit Jahren
  ohne Pflege, Text umbrechen und Tabellen müssten komplett selbst gebaut werden), HTML-zu-PDF über einen Browser (Chromium passt nicht in das Image). `next.config.ts`: `pdfkit`, `fontkit`, `nodemailer` stehen in `serverExternalPackages`
  (kein Bündeln; pdfkit liest Dateien neben seinem Code). Die eingebaute Standardschrift Helvetica wird **nie** geladen (die Schrift wird als Puffer übergeben), das Paket braucht also keine `data/*.afm` der Bibliothek.
* **Schrift:** Noto Sans 2.015 (Regular und Bold, hinted TrueType, SIL Open Font License 1.1) unter `assets/fonts/` mit `OFL.txt` und `SOURCE.txt` (Quelle: Commit im Repository `notofonts/notofonts.github.io`, SHA-256 je Datei);
  `fonts.test.ts` prüft die Prüfsummen, den Lizenztext und die Abdeckung von Umlauten, ß/ẞ, €, „ “ und Gedankenstrich. `.gitattributes` hält die Dateien byte-genau. Das **Dockerfile kopiert `assets/` ins Paket** (`cp -a assets /bundle/assets`);
  gelesen wird einmal je Prozess über `process.cwd()` (wie `docs/` und die Migrationen). Nichts wird zur Laufzeit aus dem Netz geladen. Jedes PDF bettet nur die benutzten Zeichen ein (Teilmenge): ein kurzes Dokument hat unter 100 KB.
* **Layout-API** (`createPdf({ title, … })` → `PdfBuilder`): `text`, `heading`, `keyValues`, `table` (Gewichte je Spalte, Zebra, **Kopfzeile auf jeder Folgeseite**, bricht nie mitten in einer Zeile um), `totals` (Summenblock, bleibt zusammen), `qr` (Vektorgrafik aus
  `lib/qr.ts`, kein Bild), `image` (PNG/JPEG, z. B. Logo), `rule`, `space`, `pageBreak`, `ensure`; **Fußzeile mit „Seite 2 von 3“** und optionaler Kopfzeile ab Seite 2 entstehen beim `finish()`. Grenzen: höchstens 200 Seiten und 25 MB (`PdfError`
  `tooManyPages`/`tooLarge`). Steuerzeichen, Umkehrzeichen (Bidi) und U+2028/U+2029 werden aus allen Texten entfernt. **Eingabegrenzen** (alle als `PdfError("tooLarge")`, nie stilles Kürzen): höchstens 20 000 Zeichen je Text/Zelle, 400 000 im Dokument, 3 000 Tabellenzeilen, 24 Spalten, Bilder bis 2 MB, QR-Inhalt bis 2 331 Bytes. Wörter ohne Leerraum über 80 Zeichen werden vorab hart umbrochen – `pdfkit` bricht sonst in quadratischer Zeit um (40 000 Zeichen am Stück erschöpften den Speicher und beendeten den ganzen Prozess); Fuß-/Kopfzeile und Summenzeilen sind einzeilig und gekürzt. Der QR-Inhalt wird als **UTF-8** kodiert (EPC/Girocode). Ohne `creationDate` gilt „jetzt“; mit fester Zeit ist die Ausgabe byte-gleich wiederholbar (Test).
* **Auslieferung** (`pdfResponse(bytes, { name, download })`): `deliveryHeaders` (`nosniff`, `frame-ancestors 'self'`, `private, no-store`, sicherer Dateiname). **Die Rechteprüfung steht in der Route der Funktion** und läuft **vor** der Erzeugung
  (Beispiel `app/api/invoices/[id]/file/route.ts`); ein erzeugtes PDF wird nicht gespeichert, es entsteht bei jedem Abruf aus den Daten neu – außer ein festgeschriebener Beleg (F3), der dann über `files.ts` als unveränderliche Datei liegt.
* **Anzeige auf dem Handy:** nie inline per `<object>`/`<embed>` (die CSP verbietet beides); `PdfPreview` (`components/ui/pdf-preview.tsx`) bietet **Öffnen** (neuer Tab), **Teilen** (`navigator.share` mit der Datei, nur wo `navigator.canShare({ files })` es zusagt; „Abbrechen“ im
  Dialog ist keine Störung, sonst der Hinweis „Bitte herunterladen“) und **Herunterladen**; am Rechner zusätzlich die Vorschau im `<iframe>` nach Klick. **iOS-Standalone:** „Öffnen“ kann dort ohne Rückweg enden – die Hilfe (Kapitel „Auf dem Handy installieren“,
  „Mobil und Tablet“) empfiehlt Teilen/Herunterladen; auf einem echten Gerät zu prüfen (Realgeräte-Checkliste Zeile 14).
* **PDF/A-3 mit eingebettetem XML (ZUGFeRD/Factur-X): Machbarkeit geprüft, Entscheidung: nicht in v0.2.0.** Ein Spike mit `pdfkit` (`subset: 'PDF/A-3b'`, `doc.file(…, { relationship: 'Alternative' })`) erzeugt die Bausteine (XMP mit `pdfaid`, sRGB-Ausgabeintention,
  `/AF`, eingebettete Schrift-Teilmengen). **Gründe dagegen:** (1) Die Konformität lässt sich hier nicht nachweisen – die Prüfer (veraPDF, Mustang) brauchen Java, das in der Entwicklungsumgebung fehlt; ein „ZUGFeRD“, das der Empfänger ablehnt, ist schlechter als
  keines. (2) Bekannte Lücken in `pdfkit`: Die XMP-Metadaten werden ohne XML-Maskierung zusammengesetzt (ein `&` im Titel ergäbe ungültiges XMP), `xmp:ModifyDate`/`MetadataDate` fehlen, und das ZUGFeRD-Erweiterungsschema (`fx:`/`pdfaExtension`) fehlt ganz.
  (3) XRechnung (Behörden, B2B) braucht kein PDF. **Gelieferter Weg (F3):** Rechnung als normales PDF **und** das XML (XRechnung/CII) als getrennter Download bzw. getrennter Mail-Anhang. **Weg zurück:** Sobald eine Pipeline-Stufe veraPDF **und** Mustang laufen
  lässt, kommt die Option `pdfa` in `createPdf` (Maskierung der XMP-Felder, Erweiterungsschema, Anhang `factur-x.xml`) – die Entscheidung gehört dann in die fachliche Freigabe (Steuerberater, Block 13).
* **XRechnung-Prüfung in der Pipeline (Gerüst):** Job `xrechnung` in `.github/workflows/docker-publish.yml` (nur bei Pull Requests, Versions-Tags und von Hand): Tests `*.einvoice.test.ts` schreiben ihre XML-Beispiele mit `writeEinvoiceSample`
  (`src/test/einvoice-samples.ts`) nach `EINVOICE_SAMPLES_DIR`; `scripts/validate-xrechnung.sh` lädt den **KoSIT-Prüfer 1.6.3** (`validator-1.6.3-standalone.jar`) und die Prüfkonfiguration **xrechnung 3.0.2 (Stand 2026-08-31)** von GitHub, prüft **SHA-256** (die Werte
  stammen aus den Release-Angaben von GitHub; der Download selbst wurde hier nicht ausgeführt) und lässt jedes Beispiel prüfen (Exit-Wert ≠ 0 = abgelehnt, Berichte als Artefakt). **Ohne Beispiele endet der Job erfolgreich** – mit F3 wird `XRECHNUNG_REQUIRE_SAMPLES=1`
  gesetzt. Lokal: `scripts/validate-xrechnung.sh <Ordner> [Arbeitsordner]` (Java ab 11). Die Pins ändert man bewusst im Skript (`validator-scaffold.test.ts` prüft ihre Form und den Auslöser des Jobs).
* **Tests:** `src/server/pdf/pdf.test.ts` baut echte PDFs und liest sie mit einem kleinen Leser nur für Tests (`src/test/pdf-text.ts`: Seitenzahl, Text über die ToUnicode-Tabellen der eingebetteten Schrift, Schriftnamen) – Umlaute/€, Seitenumbruch (140 Zeilen, jede genau einmal,
  Kopf wiederholt, Summenblock beisammen), Fußzeile, QR, Grenzen, Größe, Wiederholbarkeit, Antwort-Kopfzeilen. **Nicht geprüft:** das gebaute Image (Ablaufverfolgung von `pdfkit`/`fontkit`, Schrift im Paket – Docker-Durchlauf in Block 13) und die Darstellung in PDF-Betrachtern (kein Renderer in der Entwicklungsumgebung).

## E-Mail-Versand (`src/server/mail`, Funktion `admin.mail`, F1)

Nur **Versand** (SMTP). Keine eingehende Post, keine Erinnerungen, kein Passwort-Reset per Mail (nicht Teil des Releases). Erster Verbraucher: Angebote/Rechnungen (F3); bis dahin gibt es die Plattform-API, die Einstellungen und die Verwaltung.

* **Aufbau:** Plattform `src/server/mail` (`settings.ts` Einstellungen und `mailConfigured()`, `transport.ts` Verbindung, `queue.ts` Vormerken, `deliver.ts` Zustellung/Test/Aufräumen) und die **Pflichtfunktion der Verwaltung** `admin.mail` (`src/modules/admin/mail`:
  Reiter **Einstellungen → E-Mail** mit Formular, Verbindungstest, Test-Mail und Sendeprotokoll; Operationen `admin.mail.*`; Outbox-Abnehmer `mail.send` und Job `mail.prune` in `jobs.ts`; Geheimnis-Verbraucher `mail.password` in `secrets.ts`; Einrichtungspunkt „E-Mail“ (empfohlen); Hilfekapitel
  `docs/admin/mail.md`). Bibliothek: **nodemailer 10.3.1** (MIT-0, exakt gepinnt, reines JavaScript).
* **Verbrauchen (Rezept für Fachfunktionen):** In der Operation, nachdem sie ihr **Fachrecht** geprüft hat (der Rahmen prüft `permission`), `await queueMail({ tx, emit, principal }, { to, subject, text, attachments?, purpose?, entityId? })` – innerhalb von `run`, mit dem Client der Transaktion
  (alle Lesezugriffe laufen über `tx`). `queueMail` verlangt zusätzlich **`mail.send`** der absendenden Person (Regel 9: gekennzeichnet „Versand“, in keiner Standardrolle), einen eingerichteten Versand, gültige Empfänger (höchstens 10), Betreff/Text in den Grenzen und die **Versandlimits**, legt die Zeile
  in `MailMessage` an, schreibt das Outbox-Ereignis `mail.send` (nur die ID) und den Audit-Eintrag `mail.send` mit **Empfängern und Betreff**. **Anhänge** sind relative Pfade unter `files/` (`storeFile` hat sie abgelegt, z. B. der festgeschriebene Beleg) – sie werden nie kopiert oder verändert; höchstens 5 und 15 MB zusammen.
  Die Oberfläche zeigt „Per E-Mail senden“ nur, wenn `mailConfigured()` (außerhalb einer Transaktion `await mailConfigured()`); ohne Adresse des Kunden bleiben Download und Druck.
* **Zustellung:** Outbox → Abnehmer `mail.send` (`deliverQueuedMail`): idempotent über den Status (eine schon gesendete oder aufgegebene Zeile wird übersprungen); **mindestens einmal** – stürzt der Prozess zwischen Senden und Vermerken ab, geht die Nachricht ein zweites Mal hinaus (stabile `Message-ID`
  `<id@Domain>`). Fehler werden **eingeordnet** (`classifyMailError`, nur Codes: `config`, `forbiddenHost`, `dns`, `connect`, `timeout`, `tls`, `auth`, `recipient`, `rejected`, `tooLarge`, `protocol`, `failed`): Netz, Zeit, Anmeldung, Zertifikat und vorübergehende 4xx werden mit Wartezeit
  wiederholt (Outbox: 30 s · 2ⁿ, höchstens 1 h, **10 Versuche ≈ 3 Stunden**), eine **endgültige** Absage (Empfänger 5xx, Nachricht zu groß) nicht. Aufgegeben = Zeile „failed“ + Audit `mail.sendFailed`; erschöpfte Versuche lassen auch das Ereignis aufgegeben stehen (Systemstatus). Auf der Einstellungsseite lässt sich eine aufgegebene
  Nachricht mit Inhalt **erneut senden** (`admin.mail.resend`). Nur Codes landen in Protokoll, Audit und Meldungen – **nie** die Antwort des Servers, Zugangsdaten oder Adressen aus Fehlertexten.
* **Abbruch und Doppelversand:** Der Abnehmer reicht das `signal` der Outbox (Zeitlimit 200 s, unter dem Zeitlimit des Outbox-Jobs von 5 min) bis in den Transport durch: `transport.ts` öffnet die TCP-Verbindung selbst (`getSocket`, zur geprüften Adresse) und **zerstört sie beim Abbruch** – nodemailer bricht ab, es läuft kein Versand im Hintergrund weiter, während die Wiederholung neu sendet (`MailError` `timeout`). Zusätzlich merkt sich `deliverQueuedMail` die Nachrichten, die in diesem Prozess gerade gesendet werden: ein zweiter Versuch derselben Nachricht wirft `timeout` und wird später wiederholt, statt daneben zu senden.
* **Teilweise Annahme:** Nimmt der Server nur einen Teil der Empfänger an, ist das kein Fehler des Ganzen: `sendMailNow` liefert `{ accepted, rejected[{ address, permanent }] }`, die Angenommenen stehen in `MailMessage.deliveredTo` (nur Adressen). Vorübergehende Absagen (4xx) bleiben „wartet“ und werden **nur an die offenen Empfänger** wiederholt; endgültige (5xx) oder erschöpfte Versuche ergeben „failed“ (Code `recipient` bzw. `rejected`, Audit mit `angenommen/gesamt`), und **Erneut senden** geht ebenfalls nur an die nicht Zugestellten. Das Protokoll zeigt „n von m Empfängern zugestellt“. Lehnt der Server **alle** ab, ist es wie bisher ein Fehler.
* **Anhänge:** Der Inhaltstyp wird beim Vormerken auf `typ/untertyp` normalisiert (Parameter wie `; charset=binary` entfallen); ein unbrauchbarer Typ wird abgelehnt (`mail.errors.attachmentInvalid`). Verwirft die Zustellung eine gespeicherte Anhangzeile dennoch (`countAttachmentLines` ≠ `parseAttachments`), scheitert die Nachricht endgültig – sie geht nie ohne Anhang als „gesendet“ hinaus. `pruneMail` leert den Inhalt wartender Nachrichten nicht.
* **Sendeprotokoll** (`MailMessage`, zugleich Warteschlange): Zeit, Absender-Benutzer (Name zum Zeitpunkt, keine Verknüpfung – das Protokoll überlebt das Löschen des Kontos), Empfänger, Betreff, Status (`queued`/`sent`/`failed`), Versuche, Fehlercode, Zweck/Bezug – **kein Inhalt**: `body`/`attachments` stehen nur bis zum Versand (danach `null`),
  bei Aufgegebenem 30 Tage; Zeilen werden nach 365 Tagen gelöscht (Job `mail.prune`, täglich 03:40). Die Outbox trägt nur `{ mailId }`.
* **Sicherheit:** (1) **Zielsperre** wie Off-Site (`lib/offsite/host-policy.ts`): Loopback, der eigene Rechner, Verbindungs-lokal (169.254.x), Metadaten-Dienste in jeder Schreibweise gesperrt; **private Netze** (`isPrivateAddress`: RFC 1918, 100.64/10, ULA) nur nach ausdrücklicher Freigabe `allowPrivate`; geprüft beim Speichern (Adresse) und bei **jeder** Verbindung.
  (2) **Auflösen und festlegen** (`resolveMailTarget`, wie `resolvePinned`): alle Antworten werden geprüft, nodemailer bekommt die **geprüfte IP**, den Namen nur als `servername` für SNI und Zertifikatsprüfung – kein DNS-Rebinding zwischen Prüfung und Verbindung. (3) **TLS als Standard:** `starttls` mit `requireTLS` (kein Rückfall auf
  Klartext, auch wenn der Server STARTTLS nicht anbietet) oder `smtps`; `rejectUnauthorized`, mindestens TLS 1.2, kein Weg, die Prüfung abzuschalten. **Klartext** (`none`) nur mit Freigabe `allowPrivate` **und** ausdrücklicher Bestätigung **und** nur zu einem Ziel, das tatsächlich privat ist – gegen eine öffentliche Adresse wird nie unverschlüsselt verbunden.
  (4) **CRLF-Schutz** (`lib/mail.ts`): Betreff, Absendername und Dateinamen werden von Steuerzeichen/Zeilenumbrüchen/Umkehrzeichen befreit; Adressen strikt geprüft (`domainToASCII` entfernt Zeilenumbrüche stillschweigend – deshalb wird **vorher** auf Leer- und Steuerzeichen geprüft), an nodemailer gehen Adressen nur als Objekte; bei teilweiser Annahme siehe „Teilweise Annahme“.
  (5) nodemailer läuft mit `disableFileAccess`/`disableUrlAccess`. (6) **Limits** (Standard 60/h und 300/Tag gesamt, 20/h und 100/Tag je Benutzer; 0 = aus; es zählt alles Angenommene, auch Fehlgeschlagenes). (7) **Passwort** nur über `setSecret` (`mail.password`, `secret.key`, nicht im Backup; ein Verbraucher in `secrets.ts` schaltet den
  Versand nach einem Restore ohne passenden Schlüssel **aus**); ein Passwort geht nie an ein geändertes Ziel (neu eingeben verlangt); Benutzername ohne Passwort wird nie ohne Passwort versucht. (8) Einstellungen nur mit `mail.manage` (`adminOnly`).
* **Verbindungstest** (`admin.mail.testConnection`): nur Handshake und Anmeldung mit den **gespeicherten** Einstellungen (`transporter.verify()`), gesendet wird nichts, kein Protokolleintrag, Audit `mail.test`. **Test-Mail** (`admin.mail.sendTest`): sofort (nicht über die Outbox), **nur an die eigene Adresse** des Kontos – die Operation hat kein Eingabefeld für eine Adresse –, mit Protokollzeile
  (Zweck `test`, ohne Inhalt) und Audit `mail.testSend`.
* **Tests:** `src/lib/mail.test.ts` (Adressen, CRLF, Fehlerarten, Limits), `src/lib/offsite/host-policy.test.ts` (`isPrivateAddress`), `src/server/mail/mail.test.ts` gegen einen **eigenen Fake-SMTP-Server** (`src/test/fake-smtp.ts`, `node:net`/`node:tls`, ohne Abhängigkeit; EHLO, STARTTLS, SMTPS, AUTH PLAIN/LOGIN, Ablehnungen): Einstellungsregeln, Zielsperre
  und Rebinding, TLS-Standard (selbst signiertes Zertifikat scheitert ohne ausdrücklich zugelassene Zertifizierungsstelle, kein Klartext-Rückfall, keine Anmeldedaten vor TLS), CRLF, Limits, Anhänge, Outbox-Lauf, Wiederholung/Aufgabe, endgültige Absage, teilweise Annahme und Wiederholung nur für Offene, Abbruch bei hängendem Server (`hangData`), Anhang-Typen, Parken bei ausgeschalteter Funktion, Erneut senden, Verbindungstest, Test-Mail, Aufräumen, Geheimnis-Reset.
  **Nicht geprüft:** ein echter Mailserver (Zustellbarkeit, SPF/DKIM der Absenderdomain sind Sache des Anbieters), die Oberfläche des Reiters im Browser (Komponenten sind getypt und durch die Architektur-/Katalogtests erfasst, aber nicht im Browser gesehen) und der gebaute Container.
* **API:** Die Operationen `admin.mail.*` gehören zur Verwaltung und sind nie API-Ressourcen (feste Ausnahme des Vertragstests `api.test.ts`: Operationen einer Pflichtfunktion der Verwaltung). Versenden aus Fachressourcen (Rechnung per Mail) liefert F3 als eigene Operation mit API-Pendant – `queueMail` ist der gemeinsame Kern.
* **Datenschutz:** Das Sendeprotokoll hält Empfängeradressen bis zu einem Jahr (Betreff kann Rechnungsnummern enthalten). Es wird von der Kunden-Anonymisierung (P4b-5) **nicht** angefasst. **Offener Punkt für F3 (Entscheidung beim Auftraggeber):** Sendeprotokoll (`toAddresses`, `subject`, `deliveredTo`, 365 Tage) **und** Audit-Log (`mail.send` mit Empfänger und Betreff, 730 Tage) enthalten Kundenadressen und Betreffzeilen (oft Rechnungsnummer oder Name). Der erste Verbraucher (F3) muss einen `privacy.ts`-Beitrag liefern (Auskunft Art. 15 listet die Zeilen über `purpose`/`entityId`) und festlegen, ob ein Hook auf `customers.anonymize` die Protokollzeilen anonymisiert; bis dahin ist das bewusst nicht gelöst.

## Datenaustausch (CSV-Export und -Import, P4a-2)

Kunden, Fahrzeuge, Rechnungsarchiv und Reifensätze lassen sich als CSV exportieren und importieren; dazu der **Steuerberater-Export** (Rechnungen eines Zeitraums). Nicht Teil: Mitarbeiter und alle sensiblen Daten, Belege (Dateien), Dokumentation. Es sind **keine API-Ressourcen** (`/api/v1`): Sie laufen nur mit Sitzung; `NOT_API_OPERATIONS` in `src/modules/api-exceptions.ts` begründet das, `api.test.ts` erzwingt es (kein Endpunkt, Export-/Importrechte nie in einem Token: `isApiForbidden`).

* **Rechte (Regel 9):** je Datenart `<funktion>.export` und `<funktion>.import`, im Katalog gekennzeichnet (`permissions.marked` der `feature.ts`, Typ `PermissionMark` in `define.ts`; `MARKED_PERMISSIONS` in `catalog.ts`), **in keiner Standardrolle** (`catalog.test.ts`: kein gekennzeichnetes Recht in `DEFAULT_ROLES`, jedes Recht auf `.export`/`.import` muss gekennzeichnet sein). Administratoren haben sie über „Alle Rechte“; sie sind bewusst **nicht** `adminOnly` (wer sie hat, darf sie nach der Rechte-Hierarchie weitergeben). **Export** verlangt zusätzlich das Leserecht der Datenart (`<funktion>.view`; Kundennummern in Fahrzeug-/Rechnungsdateien zusätzlich `customers.view`), **Import** nur das Importrecht; die Halter-/Kunden-Spalte (Kundennummer) gibt es nur mit `customers.view` (ohne das Recht wird die Spalte beim Import ignoriert).
* **Bausteine:** `src/server/csv/` – `reader.ts` (RFC 4180: Anführungszeichen, Umbrüche im Feld, CRLF/LF/CR, Trennzeichen-Erkennung, Grenzen als `CsvError`), `writer.ts` (Schreiber als Strom, `Raw` für vom Programm erzeugte Zahlen, Formelschutz), `decode.ts` (UTF-8 mit/ohne BOM, UTF-16 mit BOM, sonst Windows-1252; Binärdateien abgelehnt), `format.ts` (Formate), `table.ts` (Überschriften zuordnen, Zellen bereinigen), `import.ts` (Auswertung: **eine Rechnung für Vorschau und Anwenden**), `define-import.ts` (baut aus einer Beschreibung Vorschau und Operation im Aktions-Rahmen), `handlers.ts` (die Routen), `limits.ts`. Je Funktion `exchange-columns.ts` (Spalten) und `exchange.ts` (Export, Import), eingesammelt in `src/modules/exchange.ts` (Composition Root, im Architekturtest eingetragen). Die Prüfungen sind die der Operationen (`customerInput`, `vehicleInput`, `invoiceImportInput`, `tireSetInput` werden aus `operations.ts` exportiert, `customerRecord`/`vehicleRecord`/`invoiceRecord`/`tireSetRecord` bauen die Zeile – Formular und Import können nicht auseinanderlaufen).
* **Routen:** `GET /api/exchange/<art>` (Export; `art` = `customers`, `vehicles`, `tires`, `invoices`, `accountant`) und `POST /api/exchange/<art>/import` (`mode=preview|apply`). Schutz wie die übrigen Upload-Routen: Sitzung ohne offenen Passwortwechsel, `isSameOriginUpload` (Header `X-Requested-With`, Origin, `Sec-Fetch-Site` – **auch beim Export**, deshalb lädt die Oberfläche per `fetch`), Funktion aktiv (404), Recht (403), beim Import **Content-Length Pflicht (411)** und Größenlimit **vor** dem Lesen (413). Die Datei liegt nie auf der Platte; höchstens zwei Importe zugleich (`importLane`, sonst 429). Die Routen liegen unter `app/api` und werden von der generierten Berechtigungs-Matrix (`matrix.test.ts`) mitgeprüft.
* **Limits (`CSV_LIMITS`):** Import 5 MiB (der Proxy kappt Bodies bei 10 MiB), 5000 Datenzeilen, 80 Spalten, 10 000 Zeichen je Feld; Export höchstens 100 000 Zeilen (413, Filter einschränken). 5000 Zeilen dauern in einer Transaktion rund 3 s (Zeitgrenze der Transaktion: 20 s).
* **Import – Entscheidungen (konservativ):** Ein Import **legt nur neue Datensätze an**. Bestehende werden nie geändert (kein Überschreiben, deshalb keine Versionskonflikte/`claimRow` und keine Rechteausweitung über den Umweg). Dubletten werden **übersprungen**: Kunden nach Kundennummer, E-Mail + Name, Name + Anschrift; Fahrzeuge nach Kennzeichen (`plateNorm`); Rechnungen Ausgang nach `outgoingKey` (normalisierte Nummer, wie die Eindeutigkeit im Schema), Eingang nach Nummer + Geschäftspartner; Reifensätze nach Fahrzeug + Saison + Marke + Modell + Größe. Bei Fahrzeugen und Reifensätzen kann man Dubletten **bewusst trotzdem anlegen** (wie die Warnung mit Bestätigung in der Oberfläche); bei Kunden und Rechnungen nicht. **Alles oder nichts:** die neuen Zeilen in **einer** Transaktion, ein Fehler rollt alles zurück; Zeilenfehler verhindern den Import, solange „Fehlerhafte Zeilen überspringen“ nicht gewählt ist. Zweistufig: Die Vorschau (`mode=preview`, schreibt nichts) nennt Zeichensatz, Trennzeichen, Spaltenzuordnung, Meldungen je Zeile und Zusammenfassung; `mode=apply` verlangt die **Prüfsumme (SHA-256) der Datei der Vorschau** (409 bei anderer Datei) und rechnet die Auswertung in der Transaktion neu. Die Datei wird dazu in beiden Schritten hochgeladen (zustandslos, nichts zwischengespeichert). Audit: `<art>.import` mit „N neu, M übersprungen, K fehlerhaft“; Export `<art>.export` bzw. `invoice.accountantExport` mit der Zeilenzahl (vor der ersten Ausgabe).
* **Formate:** Export wahlweise `excel-de` (Semikolon, Komma) oder `international` (Komma, Punkt), UTF-8 mit BOM, CRLF; Datum `JJJJ-MM-TT`; Geld als Dezimalzahl in Euro ohne Tausendertrenner (intern ganze Cent, Import über `parseMoneyToCents`). Überschriften in der Sprache der Person; der Import erkennt Schlüssel, deutsche und englische Beschriftung und Aliase (`columnSpecs`). Auswahlwerte (Kraftstoff, Saison, Status …) stehen ausgeschrieben und werden als Kennung oder Beschriftung (beide Sprachen) gelesen (`enumParser`).
* **Formel-Injektion:** Export – Text, der mit `=`, `+`, `-`, `@`, Tabulator oder Wagenrücklauf beginnt, bekommt ein `'` davor (`neutralizeFormula`); vom Programm erzeugte Zahlen (`Raw`, z. B. `-12,50`) nicht. Import – nichts wird ausgeführt, Werte sind Text; ein davor gesetztes Schutz-`'` wird entfernt (`undoFormulaGuard`, damit der Rundlauf stimmt), die Vorschau zählt formelartige Zellen. Steuerzeichen werden entfernt, Zeilenumbrüche außer in Notizen zu Leerzeichen.
* **Oberfläche:** je Funktion `/<funktion>/export` und `/<funktion>/import` (in `pages.ts`, Recht = Export- bzw. Importrecht), Menü „Export / Import“ im Listenkopf nur mit Recht (`components/exchange/exchange-menu.tsx`); Felder `ExportPanel`/`ImportPanel`/`PeriodFields` in `src/components/exchange` (Komponententest `panels.test.ts`). Die Fahrzeugliste reicht ihre Filter an den Export durch. Hilfe: Abschnitt „Export und Import (CSV)“ im Kapitel der Funktion (mit Datenschutz-Hinweis).
* **Neue Datenart:** `exchange-columns.ts` + `exchange.ts` der Funktion (`ExportDef` bzw. `defineImport`), Eintrag in `src/modules/exchange.ts`, Rechte `…export`/`…import` mit `marked` in der `feature.ts` (+ Beschriftungen `permissions.*`), Audit-Aktionen (+ `audit.actions.*`), Texte `<funktion>.exchange.*`, Seiten in `pages.ts`, Eintrag in `NOT_API_OPERATIONS`, Hilfe; Tests in `src/server/csv/exchange.test.ts` (Rechte-Matrix, Dubletten, Rundlauf).
* **Tests:** `src/server/csv/csv.test.ts` (Leser/Schreiber, Randfälle, Formelschutz, Rundlauf, Zeichensätze, Auswertung), `src/server/csv/exchange.test.ts` (Routen gegen echte SQLite: Rechte je Datenart, Herkunft, Limits, Dubletten, Fehlerzeilen, Formeln, Transaktion, Audit, Rundläufe), `src/components/exchange/*.test.ts`.

## Installierbare App (PWA, P3-5)

Die Anwendung lässt sich auf Handy und Tablet wie eine App installieren (eigenes Fenster, Symbol, Farbe der Statusleiste) und zeigt ohne Verbindung eine eigene Seite statt der Browserfehlerseite.
**Es gibt keinen Offline-Betrieb**: Fachdaten werden nie auf dem Gerät gespeichert; der Service Worker kennt nur die Offline-Seite und gehashte Programmdateien. Anwenderdoku: Hilfe „Auf dem Handy installieren“
(`docs/platform/05-…`), „Mobil und Tablet“ (`06-…`).

* **Voraussetzung HTTPS.** Browser verlangen für Service Worker und Installation einen sicheren Kontext: `https://` oder `localhost`/`127.0.0.1`. Im Werkstattnetz über `http://192.168…` gibt es weder Service Worker
  noch Installation (die Anwendung selbst läuft dort unverändert). Die Registrierung prüft `window.isSecureContext` und tut sonst nichts; sie läuft **nur im Betrieb** (`NODE_ENV=production`), nie in der Entwicklung
  (dort sind die Dateinamen unter `_next/static` nicht gehasht, ein Zwischenspeicher lieferte veralteten Code). Reverse-Proxy mit Zertifikat: Abschnitt „Betrieb“.
* **Manifest** (`src/app/manifest.ts`, `/manifest.webmanifest`): `display: standalone`, `start_url`/`scope`/`id` `/`, Symbole 192 und 512 (`any`) und 512 `maskable`. **Statisch, ohne Datenbank** – das Manifest liegt
  außerhalb des Proxys (`PROXY_FREE_PATHS`/`config.matcher`) und wird auch beantwortet, solange die Datenbank migriert; der Werkstattname steht daher nicht darin (nur im Seitentitel und im Namen unter dem iOS-Symbol, `appleWebApp.title`).
  Name und Farben in `src/lib/pwa.ts`: die Farben sind **Werte der Design-Tokens** (`--surface` hell/dunkel für `theme-color`, `--bg` für den Startbildschirm) als Hex; `lib/pwa.test.ts` rechnet sie aus `tokens.css` nach.
  `theme-color` kommt als `viewport.themeColor` mit `prefers-color-scheme` (folgt dem Gerät, nicht der in der App gewählten Darstellung – bewusst, eine Metaangabe lässt sich nicht je Sitzung ändern).
* **Symbole** (`public/icons/`): `icon-192.png`, `icon-512.png` (abgerundet, durchsichtige Ecken), `icon-maskable-512.png` und `apple-touch-icon.png` (randlos – iOS füllt Durchsichtiges schwarz). Sie sind **kein Fremdbild**,
  sondern entstehen reproduzierbar aus einer Formel (`scripts/lib/pwa-icons.mjs`: derselbe Schraubenschlüssel in Weiß auf `#2459c9` wie die Standardmarke der Seitenleiste, 4 × 4 überabgetastet, eigener PNG-Schreiber);
  `node scripts/gen-pwa-icons.mjs` schreibt sie, `--check` vergleicht die Bildpunkte, `lib/pwa.test.ts` tut dasselbe im Test. Das Werkstatt-Logo ist nicht Teil der Symbole (statisches Manifest).
* **Registrierung** (`ServiceWorkerRegistrar` im Root-Layout innerhalb des `ToastProvider`, Logik in `src/lib/sw-client.ts`): Adresse `/sw.js?v=<Version>[+<Commit>]` (aus `version.json`, `src/server/app-version.ts`; Entwicklung `0.0.0-dev`),
  Geltungsbereich `/`, `updateViaCache: "none"`. Ein Web-Update ändert die Version, damit die Adresse, damit installiert der Browser einen neuen Service Worker.
* **Service Worker** (`public/sw.js`, klassische Skriptdatei **ohne Build-Stufe**, ausgeliefert wie eingecheckt; Besitzer der Header ist `next.config.ts`: `Cache-Control: no-cache` und `text/javascript`, die CSP ohne Nonce kommt über
  `PROXY_FREE_PATHS` – `/sw.js` läuft nicht durch den Proxy). Er fasst **nur** an:
  1. `mode === "navigate"` **und** `destination === "document"` (ein Seitenaufruf): übers Netz, bei Netzfehler (`fetch` verwirft – kein 4xx/5xx!) die zwischengespeicherte Offline-Seite. **Das ist die einzige, ausdrückliche Ausnahme
     von „keine Seiten zwischenspeichern“**: gespeichert wird nur `/offline` (öffentliche, statische Seite, ohne Cookie mit `credentials: "omit"` geladen), nie eine Antwort der Anwendung.
  2. `GET /_next/static/…` (gehashte Dateien): Zwischenspeicher zuerst, sonst Netz und speichern (nur `200`, `type: "basic"`; höchstens 300 Einträge).
  **Unberührt** bleiben: alles unter `/api` (PDF-Vorschau im `iframe`, Downloads, iCal, Dateien, Suche, Health, `/api/logo`), Anfragen mit `Range`, alles außer `GET` (Formulare, Server Actions), `destination` `iframe`/`frame`/`object`,
  fremde Herkünfte. **Wer eine Download- oder Dateiroute außerhalb von `/api` anlegt, muss `classify` in `public/sw.js` anpassen** (und `src/lib/sw.test.ts`) – sonst ersetzte bei Netzausfall die Offline-Seite den Download.
  Zwischenspeicher heißen `sos-static-<v>` und `sos-offline-<v>`; `activate` löscht die anderer Versionen. **Kein `skipWaiting` beim Installieren:** Ein neuer Service Worker wartet, bis der Hinweis „Neue Version verfügbar – Neu laden“ bestätigt wird
  (Nachricht `SKIP_WAITING`, danach `controllerchange` → einmal `location.reload()`); das erste Installieren meldet nichts. Nachrichten: `WARM` (Offline-Seite sicherstellen; die Seite sendet es nach jeder Registrierung), `CLEAR` (alle Zwischenspeicher aller Versionen).
  Der Hinweis ist ein Toast mit `action` (`components/ui/toast.tsx`, bleibt stehen).
* **Abmelden leert die Zwischenspeicher:** Das Abmelde-Formular (`components/shell/user-menu.tsx`) sendet `CLEAR` an den steuernden Service Worker und löscht die `sos-*`-Zwischenspeicher zusätzlich von der Seite aus (`clearOfflineCaches`);
  die Offline-Seite kommt beim nächsten Seitenaufruf (Anmeldeseite) per `WARM` wieder. Im Zwischenspeicher liegt weder Cookie noch Sitzungs- oder Fachinhalt – es ist Hygiene, kein Schutz.
* **Offline-Seite** `/offline` (`src/app/offline/route.ts`, Text und HTML in `src/lib/offline-text.ts`): ein Route Handler, kein `page.tsx` (eigenständiges HTML ohne Skript und ohne Nonce, Stile als `style`-Attribute, fest zweisprachig DE/EN, Weg zurück
  ist ein Link auf `/`). Ohne Anmeldung erreichbar (`OPEN_PAGES` im Proxy). Sie läuft durch den Proxy (Zustand „startet“/„Neuinstallation“ antwortet 503 – der Service Worker speichert sie dann nicht und versucht es bei `WARM` erneut) und steht deshalb
  **nicht** in `pages.ts` (die Inventur kennt nur `page.tsx`); geprüft in `lib/pwa.test.ts` und `e2e/tests/pwa.spec.ts`.
* **Logo** (`/api/logo`, `src/app/api/logo/route.ts`, `src/lib/logo.ts`): Das Logo liegt weiter als Daten-URL in `Workshop.logoDataUrl`, wird aber nicht mehr in jede Seite eingebettet, sondern als Bild ausgeliefert: **öffentlich lesbar** (Anmeldeseite; `OPEN_PAGES`,
  im Matrixtest `PUBLIC`), `ETag`, `Cache-Control: public, max-age=3600`, die Adresse trägt `?v=<updatedAt>`. **Kein SVG:** `LOGO_TYPES` sind PNG, JPEG, WebP; ein früher gespeichertes SVG wird nicht ausgeliefert (404) und nicht angezeigt (Standardmarke).
  Auslieferung über `deliveryHeaders` (`nosniff`, `sandbox; default-src 'none'`, Dateiroute in `ROUTE_OWNED_PATHS`); Magic-Bytes-Prüfung beim Hochladen bleibt (`upload-sniff.ts`).
* **Tests:** `src/lib/sw.test.ts` lädt **dieselbe Datei** `public/sw.js` in einen nachgebauten `ServiceWorkerGlobalScope` (Zwischenspeicher im Speicher): Entscheidungsmatrix, PDF-Vorschau und Download unberührt, Offline-Seite nur bei Netzfehler, nur `200`/`basic`,
  Begrenzung, `activate`, `CLEAR` leert alles (nach Abmelden leer), `WARM`. `sw-client.test.ts` (Registrierung nur sicher+Betrieb, Update-Hinweis, Neu laden, Abmelden), `service-worker-registrar.test.ts` (Toast mit „Neu laden“), `user-menu.test.ts` (Abmelden sendet `CLEAR`),
  `pwa.test.ts` (Manifest, Symbole = Formel, Farben = Tokens, Offline-Seite), `next-config.test.ts`/`csp.test.ts`/`proxy.test.ts` (Header, Zuständigkeit, offene Pfade), `e2e/tests/pwa.spec.ts` (Browser mit aktivem Service Worker; alle anderen
  Browser-Tests laufen mit `serviceWorkers: "block"`, damit kein Zwischenspeicher Messungen verfälscht).
* **Grenzen:** iOS im Standalone-Fenster: Ein PDF aus „Öffnen“ verlässt die App (Zurück über das System, steht in der Hilfe); `theme-color` folgt dem Gerät, nicht der in der App gewählten Darstellung; Push, Hintergrundsynchronisation und Offline-Eingabe gibt es nicht.

## Eine neue Funktion anlegen

Beispiel: Funktion `warranty` im Modul `workshop`.

1. Ordner `src/modules/workshop/warranty/` anlegen.
2. **`feature.ts`** mit `defineFeature({...})`: ID, Modul, Name/Beschreibung (Übersetzungsschlüssel), Reihenfolge, Abhängigkeiten
   (`requires` / `uses`), Rechte-Gruppe mit Schlüsseln (`warranty.view` …), Navigation, Routen-Präfixe (auch `api/<name>` für eigene Route Handler), **`auditActions`** (die Audit-Aktionen der Funktion).
3. In **`src/modules/catalog.ts`** eintragen (Import und `FEATURES`). Ab jetzt kennt das System Rechte, Aktivierung und Admin-Seite.
4. **Texte** in `src/i18n/messages/modules/warranty.de.ts` / `.en.ts` (englisch typisiert als `typeof warrantyDe`), in `de.ts` /
   `en.ts` einbinden; nötig sind `feature.name`, `feature.description`, Beschriftungen unter `permissionGroups.*` und `permissions.*`.
5. **Seiten** unter `src/app/(app)/(workshop)/warranty/`. **Jede Seite beginnt mit `await requirePermission("…")`, jede Server
   Action ebenfalls.** Dazu **`pages.ts`** (`definePages`: alle Seiten mit Recht und Seed-Verweisen) und eine Zeile in `src/modules/pages.ts` –
   der Test `pages.test.ts` und die Browser-CI verlangen sie; der Demo-Seed muss für die `[id]`-Seiten Beispieldaten anlegen.
6. Optional: `widgets.tsx` (`export const widgets: WidgetDef[]`) und `settings-tab.tsx` (`export const settingsTabs`), beides in
   `registry.ts` eintragen.
   **Hilfe:** `help.ts` (`export const help: HelpTopicDef[]` mit `id`, `feature`, `permission`, `doc`), Kapitel als Markdown unter
   `docs/workshop/warranty.md` (nur Bedienung in der App, kein Entwicklerthema), `help.ts` in **`src/modules/help.ts`** eintragen.
   Eine Funktion darf mehrere Kapitel beitragen (`id` dann mit Zusatz, z. B. `workshop.warranty.claims`).
6b. **Schnellsuche und Neu-Menü:** `search.ts` (`export const searchProviders: SearchProviderDef[]`: `feature`, `permission` aus der eigenen Rechte-Gruppe, `groupKey`, `search(query, { session, limit })`;
    Textsuche über `contains()`, Rechte und Sichtbarkeit des Treffers selbst beachten – Dokumentation über `searchDocPages`) und Eintrag in `ALL_SEARCH_PROVIDERS` in `registry.ts`; `quickActions` in der `feature.ts`
    (Anlegen-Aktionen, Recht aus der eigenen Gruppe). `src/modules/search.test.ts` verlangt für jede fachliche Funktion einen Anbieter (Definition of Done); ein Eintrag in der Navigation gehört nur Funktionen, die
    eine eigene Seite brauchen (Navigationskonzept: Aufträge, Angebote & Ausgangsrechnungen, Teile & Lager, Zeiterfassung, Berichte, API & Webhooks; E-Mail, Checklisten, Druck, iCal, „Dokumente & Fotos“ und der Tresor hängen
    am Fahrzeug, Auftrag bzw. der IT-Dokumentation). Das Symbol des Eintrags steht in `src/components/shell/nav-icons/<modul>.ts` (je Gruppe geladen, keine gemeinsame Tabelle).
6c. **Daten:** `queries.ts` für alle Lesezugriffe der Seiten, Bausteine, Suche und API (explizites `select`, Betrachter-Parameter, sensible Spalten nur mit Recht – siehe „Datenzugriff“); `seed.ts` (`export const seeds: SeedDef[]` mit `base` = Grunddaten einer frischen Installation
    und/oder `demo` = Beispieldaten, die jede `[id]`-Seite der `pages.ts` bedienen) und Eintrag in `src/modules/seed.ts`. Tage und Uhrzeiten nur über `lib/dates.ts`/`lib/zone.ts` (siehe „Zeitzone“).
6d. Beiträge zu Seiten **anderer** Funktionen (Abschnitt auf der Auftragsseite, Knopf im Termin): `sections.tsx` (`export const sections: SectionDef[]`, `host` aus `SectionHost`), eingetragen in `ALL_SECTIONS` der `registry.ts`; Reaktionen auf Operationen anderer Funktionen (Abbuchen beim Abschluss): `hooks.ts` – siehe „Aufträge und Lager (F2/F4)“.
6a. Hintergrundarbeit (Aufräumen, regelmäßige Prüfungen, Zustellung von Ereignissen): `jobs.ts` (`export const jobs: JobDef[]`, `feature` ist die eigene Funktion; Abnehmer für Outbox-Ereignisse als `OutboxHandlerDef`),
    eingetragen in `src/modules/jobs.ts` – siehe „Job-Runner“. Der Job muss wiederholbar sein; ein Beschriftungsschlüssel `system.names.<bereich>.<name>` zeigt ihn im Systemstatus.
7. Soll eine andere Funktion etwas nutzen, exportiert `public.ts` genau das – und die andere deklariert `requires`/`uses`.
8. Neue Rechte in `default-roles.ts` den passenden Rollen zuordnen (Administratoren haben sie sofort) – **ausgenommen gekennzeichnete Rechte** (Export, Import, sensible Daten …: `permissions.marked`, Regel 9), die nie automatisch in eine Standardrolle kommen.
9. Server Actions **immer** über den Aktions-Rahmen (`defineOperation` + `defineAction`, siehe „Aktionen und Operationen“): Bearbeiten-Formulare tragen `version` mit, `run` nutzt `claimRow(tx.modell, id, version)`;
   Dateien nur über `files.ts`; jede Operation nennt `audit: "<aktion>"` (Aktion in `auditActions` der `feature.ts` + Texte `audit.actions.*`) oder begründet den Verzicht. Neue Funktionen standardmäßig mit `defaultEnabled: false`.
10. **API:** Operationen nach `operations.ts`, `api.ts` mit `defineResource` und Eintrag in `src/modules/api.ts` (siehe „Programmierschnittstelle“); schreibende UI-Aktionen ohne Endpunkt mit Begründung in `src/modules/api-exceptions.ts` – der Vertragstest `src/modules/api.test.ts` verlangt eines von beidem.
11. `npm run typecheck && npm run lint && npm test` – der Architektur-Test meldet verbotene Importe und fehlende Deklarationen.

## Konventionen

* **Next.js 16**: `middleware` heißt `proxy.ts`; `params`, `searchParams`, `cookies()` sind Promises. Doku: `node_modules/next/dist/docs/`.
  `cacheComponents` ist bewusst aus (komplett eingeloggte, dynamische App).
* **Übersetzungen:** `de.ts` definiert die Struktur, `en.ts` muss identisch sein (sonst Typfehler). Dynamische Schlüssel über
  `td(key, fallback)`, Plural über `<key>_one` / `<key>_other` und `tp()`.
* **Design:** nur Tokens aus `src/app/tokens.css` bzw. Tailwind-Utilities (`bg-surface`, `text-ink-muted` …), keine Rohfarben;
  Hell/Dunkel über `light-dark()`.
  **Touch-Fundament:** Die Tokens `--tap` (36 px; 44 px bei `(pointer: coarse), (max-width: 1023px)`), `--tap-sm`, `--tap-chip`, `--tap-row` und `--input-font` (14 px; 16 px, damit iOS beim Fokus nicht zoomt) bestimmen Button, Eingabefeld, `NavLink`, Menü, Segmented und Chips. `Input` setzt für `type="number"` von selbst `inputMode` (numeric/decimal) und lässt `autoFocus` nur am Desktop wirken; Kennzeichen/FIN-Felder und Netzwerkfelder (IP/MAC) haben `autoCapitalize`/`autoCorrect`/`spellCheck`/`inputMode` passend gesetzt. Test: `src/components/ui/touch.test.ts`, am echten Layout die Browser-CI.
* **UI-Bausteine:** Die Oberfläche besteht aus den Bausteinen in `src/components/ui` – `Button`/`LinkButton`/`SubmitButton`/
  `ConfirmSubmitButton`, `Input`/`SearchInput`/`Select`/`Textarea`/`Checkbox`/`ColorInput`/`ColorPicker`/`FileInput`/`Field`,
  `Card`/`CardLink`/`StatCard`/`DangerZone`/`Table`/`Badge`/`StatusBadge`/`ChipLink`/`NavLink`/`TextLink`/`Alert`/`EmptyState`, `DataTable`/`Pagination`/`FilterBar`/`ScrollArea`,
  `PageHeader`/`TabNav`/`PageToc`, `Disclosure`, `Menu`, `SegmentedControl`/`SegmentedLinks`, `UrlModal`, `Drawer`, `SubmitSwitch`, `ConfirmDialog`/`ConfirmSubmitButton`, `ToastProvider`/`useToast`, `useInlineAction`, `Form`/`FormCard`/`FormActions`/`FormErrorSummary`/`FormFieldError`,
  `SearchCombobox`, `StatusPage`, `Skeleton`, `LinkPending`/`NavProgress`; für Aufträge, Rechnungen, Zeiterfassung und Berichte (F0, Abschnitt „Bausteine für Aufträge …“): `MoneyInput`, `LineItemEditor`, `Timeline`/`Stepper`, `ChecklistItem`, `StampButton`, `SecretField`, `CodeBlock`, `Chart`, `DateRange`, `PrintLayout`, `Signature`, `PhotoGallery`, `PdfPreview`. Wer ein Element braucht, nimmt den Baustein; fehlt eine Variante, wird sie **dort** ergänzt, damit
  eine Änderung am Aussehen überall wirkt. `src/components/ui/ui-kit.test.ts` erzwingt das: außerhalb von `components/ui` sind rohe
  `<button>`, `<input>` (außer `type="hidden"`), `<select>`, `<textarea>`, `<table>`, `<label>`, `<details>`, `<dialog>`,
  `window.confirm` und die Klassen der Bausteine (`btn`, `input`, `card`, `badge`, `table`, `plate`, `field-*`) verboten.
  **Ausnahme für Spezialfälle:** Eine Funktion (`src/modules`, `src/capabilities`) darf ein eigenes Element mitbringen, wenn das Kit
  es nicht abdeckt (z. B. die Editorfläche des Markdown-Editors); die Datei sagt das mit einem Kommentar `ui-kit-exception: <Grund>`.
  Solche Elemente bauen, wo möglich, trotzdem auf den Bausteinen auf. Dazu schließt der Test **nachgebaute Bausteine** aus (Hinweisflächen mit `bg-danger-bg` & Co. statt `Alert`/`StatusBadge`,
  `border-b-2`-Reiter statt `TabNav`, Links in Akzentfarbe statt `TextLink`, `<Table>` ohne `caption`); bestehende Treffer stehen in der `ALLOWLIST` des Tests – **sie darf nur schrumpfen** (ein erledigter Eintrag bricht den Test, bis er gestrichen ist), ab Block 12 soll sie leer sein.
* **Listen (eine API):** Jede Datenliste ist eine `DataTable` (`components/ui/data-table.tsx`) mit `columns` (`id`, `header`, `cell`, `priority` primary/normal/low, `sort`, `align`, `sub`, `hideHeader`), `rowHref` (ganze Zeile als gestreckter Link der Hauptspalte),
  `caption` (Pflicht), `summary`, `footer` (`Pagination`) und `empty`. Ab `md` Tabelle (Scroll-Rahmen per Tastatur erreichbar, Schatten und Hinweis bei verdeckten Spalten), darunter Karten (`low`-Spalten entfallen, Aktionsspalten werden zur Leiste). Sortierung und Seite
  kommen aus der Adresse (`src/lib/list-params.ts`: `parseListParams` prüft den Sortierschlüssel gegen eine Liste, `listLinks` baut `sortHref`/`pageHref`, Standardwerte stehen nie in der Adresse); die Gesamtzahl ist immer `count` mit demselben `where`, Summen laufen über `aggregate`
  (`office/invoices/queries.ts`), nie über eine geladene Seite. **Suche nach Berechtigung:** `searchWhere` (`src/server/search.ts`) baut das `OR` nur aus Feldern, die der Aufrufer sehen darf (`permission` am Feld; nichts erlaubt = unerfüllbar, nicht „alles“).
  `FilterBar` (Suchfeld bleibt sichtbar, Zusatzfilter klappen unter `sm` ein, „Zurücksetzen“). Reiter einer Seite: `TabNav` (Links, `aria-current`), Auswahl über die Adresse: `SegmentedLinks`.
* **Zustandsmarken:** `StatusBadge` kennt nur die Töne (grün = in Ordnung/erledigt, gelb = Aufmerksamkeit/bald fällig, rot = Fehler/überfällig/abgelaufen, blau = Information/in Arbeit, grau = neutral, Akzent = Kennzeichnung; außer grau/Akzent mit Symbol). Die Zuordnung **Zustand → Ton**
  gehört der Funktion (`<funktion>/status-tone.ts`, typisiert als `Record<Zustand, StatusTone>`); `src/modules/status-tone.test.ts` prüft sie gegen die Zustandslisten. `Badge` ist nur für Kennzeichnungen ohne Zustand (VLAN, Rolle).
* **Seitenkopf:** `PageHeader` (async, `components/ui/page-header.tsx`) mit `back` (unmittelbarer Vorfahre) oder `breadcrumbs` (Vorfahren von oben nach unten) – **Pflicht auf jeder Detail-, Bearbeiten- und Neu-Seite** (`modules/page-chrome.test.ts`) – und `help="<Kapitel-Id>"` (Id aus der `help.ts` der Funktion
  oder ein Allgemein-Kapitel; der Test prüft, dass es das Kapitel gibt; nur setzen, wenn jeder, der die Seite sehen darf, das Kapitel sehen darf). Löschen steht im `DangerZone` am Ende der Seite. Lange Seiten mit Inhaltsverzeichnis (Hilfe, Dokumentation) nutzen `PageToc` (Spalte ab `xl`, darunter einklappbar).
* **Kontrast und Tokens:** `src/app/tokens.test.ts` rechnet die Kontraste aus `tokens.css` selbst (`src/lib/color-contrast.ts`: OKLCH, `color-mix`, `light-dark`, WCAG): Text ≥ 4,5 : 1 in Hell und Dunkel für Standardakzent und alle Voreinstellungen, `--control-border` (Ränder von Eingabefeldern und
  Knöpfen) ≥ 3 : 1, die sechs kategorialen Diagrammfarben `--chart-1…6` (≥ 3 : 1 gegen die Fläche, unter Protanopie/Deuteranopie/Tritanopie unterscheidbar; bei mehr als sechs Reihen zusätzlich beschriften). Schriftgrößen (`--fs-*`, per `@theme` an `text-*` gebunden) und Symbolgrößen (`--icon-sm/--icon/--icon-lg`, nutzbar als
  `size-(--icon)`) sind Tokens. Frei gewählte Akzentfarben warnt die Einstellungsseite, wenn sie als Schrift zu blass sind (`accentTextContrast`).
* **Anrede:** Die Oberfläche spricht in der Nennform („Ersten Kunden anlegen“, „Bitte anmelden“), kein „du“, kein „Sie“; die Anwendungsdokumentation (`docs/`) ist in der Sie-Form (`src/i18n/tone.test.ts` fängt Rückfälle). Die Hilfe gibt es nur auf Deutsch – bei anderer Oberfläche weist die Hilfeseite darauf hin.
* **Fehler-, Lade- und Wartezustände:** `not-found.tsx`, `error.tsx`, `loading.tsx` liegen unter `src/app` (Wurzel: ohne Navigation bzw. mit Navigation für Angemeldete) und `src/app/(app)` (im Anwendungsrahmen, die Navigation bleibt); `global-error.tsx` ersetzt das Wurzel-Layout und ist fest zweisprachig. Der Anwendungsrahmen steht in `src/app/app-shell.tsx`. `error.tsx` erkennt „Server Action nicht gefunden“ (offener Tab nach einem Web-Update, `src/lib/stale-deployment.ts`) und lädt **einmal** neu (kein Neuladen in Schleife). Jeder Dashboard-Baustein läuft in einer eigenen Fehlergrenze (`WidgetBoundary`): ein werfendes Widget zerstört die Übersicht nicht. Jeder Link der Bausteine (`LinkButton`, `NavLink`, `CardLink`, `TextLink`, `ChipLink`, `MenuLink`) zeigt über `LinkPending` (`useLinkStatus`) nach 150 ms ein Lade-Symbol und meldet die Navigation an den dünnen Fortschrittsbalken `NavProgress` (Wurzel-Layout). Neue Link-Bausteine übernehmen `LinkPending` (der Link ist `relative`; das Symbol liegt immer im DOM, absolut und ohne Platz, und wechselt nur die Deckkraft – so verschiebt sich nichts); `NavProgress` trägt zusätzlich die **dauerhafte** Live-Region „Wird geladen“ für Screenreader. Bei „weniger Bewegung“ stehen Spinner und Balken still. `StatusPage` setzt Fokus und Seitentitel auf die Überschrift (`StatusHeading`), ist im Vollbild das `<main>` und bei Fehlern eine Live-Region; Anmeldung, Einrichtung und „Kein Zugriff“ haben eigene Ladeseiten. **Statuscode:** Seit `loading.tsx` die Ladeseite zuerst sendet, steht der HTTP-Status einer Seite mit `notFound()` (auch fehlendes Recht) schon auf 200; die Seite zeigt „nicht gefunden“ (`data-status="not-found"`, Next ergänzt `noindex`). Tests prüfen deshalb den Inhalt, nicht den Statuscode.
* **React:** kein `useEffect` mit synchronem `setState`; kein `Date.now()`/`new Date()` im Komponenten-Rumpf (Helfer aus `src/lib/dates.ts`).
* **Server-only Code** darf vom Seed-Skript nicht importiert werden; dafür gibt es `src/server/db-client.ts`.
* Commit-Nachrichten enden mit der `Co-Authored-By`-Zeile des verwendeten KI-Assistenten, falls einer beteiligt war.

## Tests

`node:test` über `tsx`. **Testharness** `src/test/harness.ts`: `createTestEnv()` legt eine echte temporäre SQLite an (alle Migrationen), macht sie zur
Datenbank der Anwendung und ersetzt nur den Rand von Next.js (`redirect()`/`notFound()` werfen abfangbare Signale, `cookies()`/`headers()` lesen einen
Fake-Browser, `server-only`/`next/cache` sind leer). Der zu testende Code wird **danach** mit `await import(...)` geladen; `env.role()`, `env.user()`,
`env.signIn()`, `form({...})` und `redirectOf(() => action(...))` bilden Formulare und Sitzungen nach (Beispiele: `src/modules/admin/users/actions.test.ts`,
`src/server/auth/login.test.ts`). Der **Aktions-Rahmen** hat einen generierten Berechtigungs-Matrixtest (`src/server/operations/matrix.test.ts`) und Architekturregeln (`architecture.test.ts`: jede Action benutzt `defineAction`, `run` bleibt transportneutral). Außerdem: Fachlogik (`*.test.ts` neben dem Code), Aktivierungslogik, Katalog (gültige Abhängigkeiten, eindeutige Rechte,
Übersetzungen vorhanden), Architekturregeln, Migrations-Läufer (inkl. Verträglichkeit mit der Prisma-CLI), Backups/Restore (echte
SQLite-Dateien), Dateispeicher, optimistische Sperre und gleichzeitige Buchungen gegen eine echte Datenbank, Update-Zustand und Rückfälle. **Starter-Vertrauensanker:** `src/lib/updates/{tree,seal,keychain,markers,compat,fs-tree}.test.ts`, der Goldkorpus (`anchor-corpus.test.ts` gegen `testdata/anchor/cases.json`, erzeugt mit `npm run anchor:corpus`, `npm run anchor:corpus:check` prüft die Aktualität; Mutationstests mit Bitflips und Abschneiden), die Pipeline-Skripte als Kindprozesse (`anchor-scripts.test.ts`, Generalprobe `npm run anchor:rehearse`), Launcher (`src/launcher/launcher.test.ts`) und Installer (`install.test.ts`). **Image-Kontext:** `src/docker-context.test.ts` prüft statisch, dass jede Quelldatei im Docker-Kontext (`.dockerignore`) nur Importe hat, deren Ziel ebenfalls im Kontext liegt – sonst scheitert `npm run build` in der Stufe `builder`, obwohl `npm run typecheck` lokal grün ist (Tests, die Code aus `e2e/` brauchen, liegen deshalb unter `e2e/`, nicht unter `src/`). Tests, die Ausführbit, Setuid oder Symlinks brauchen, laufen nur unter Linux (Windows: übersprungen); die Linux-Pipeline führt sie aus. **Der C-Prüfer** (`docker/verify.c`, `docker/bootstrap.c`): `npm run native:test` (= `node docker/test/run.mjs`, Stufen und Inhalt im Abschnitt „Starter: Umsetzung“; unter Windows spiegelt es das Repository nach WSL, braucht dort gcc/clang, Node ≥ 24, rsync) und `npm run native:test -- fuzz --fuzz-seconds 60`; im regulären `npm test` laufen davon die Stufen `crypto` und `corpus` (`native-starter.test.ts`, nur unter Linux mit Compiler), die CI-Stufe „native“ führt alle aus (mit `REQUIRE_NATIVE=1`: ein fehlender Compiler ist ein Fehler). Der Prüfaufruf des Installers (`starter-verify.test.ts`) und die vendorte Bibliothek (`vendor-monocypher.test.ts`) laufen überall.
**Komponententests** rendern wirklich (`src/test/dom.ts`: `components/ui/data-table.test.ts` für `DataTable`/`Pagination`/`FilterBar` – Server-Komponenten werden aufgerufen und ihr Ergebnis im DOM gerendert; happy-dom + `react-dom/client`; `installDom()`, `mount()`, `act()`; `src/test/router.ts` liefert `usePathname`/`useRouter` für Komponenten, die sie brauchen): Fokus und Referenzen der Eingabebausteine (`components/ui/form.test.ts`), Formular-Rahmen (`form-frame.test.ts`: Eingabe bleibt bei Fehlern, Fehlerzusammenfassung, Netzwerkfehler, Entwurf; `form-draft.test.ts`: Entwurf bei gesteuerten, abhängigen und nachrückenden Feldern und der Kundenauswahl, Lebensdauer (Fehler/Erfolg/Weiterleitung), Bindung an den Benutzer, Vorbelegung, Enter, Navigationsbremse, Toast-Hub), `ConfirmDialog`/`SubmitSwitch`, `SearchCombobox`, `Menu`, die Navigation und Schnellsuche (`components/shell/sidebar.test.ts`, `quick-search.test.ts`), die Fehlergrenze der
Dashboard-Bausteine (`components/shell/widget-boundary.test.ts`), Status- und Fehlerseiten (`components/ui/status.test.ts`, `components/shell/error-view.test.ts`). Quelltext-Muster-Tests gelten nur für echte Architekturregeln, nicht für Verhalten.

## Browser-CI (Playwright)

Die Testseiten `/e2e-state/error` und `/e2e-fault/error|reinstall` erzeugen absichtlich Fehlerzustände und gibt es nur mit `SCHRAUBEROS_E2E=1` (setzt `e2e/start-server.mjs`; sonst 404).
Playwright ist nur eine Entwicklungsabhängigkeit (nicht im Image). `npm run build`, dann `npm run e2e` (oder `npm run e2e:build`); Browser einmalig mit
`npx playwright install chromium webkit` (offizielle Quelle). Die Konfiguration `playwright.config.ts` startet die gebaute App frisch gegen `.e2e-data`
(`e2e/start-server.mjs`), richtet sie **wie ein Anwender** über die Ersteinrichtung im Browser ein (liest das Einrichtungs-Token aus `.e2e-data/setup-token`,
mit Beispieldaten; `e2e/global-setup.ts`), legt je Standardrolle ein Konto an und prüft in vier Projekten: **iPhone** (WebKit 390 × 844, Touch), **Tablet hoch**
820 × 1180 und **quer** 1180 × 820 (Touch) und **Desktop** 1440 × 900.

| Test | Prüft |
| --- | --- |
| `inventory.spec.ts` | jede Seite der **Routen-Inventur** (siehe unten) als Administrator: keine Überbreite (Elementrechte, nicht `scrollWidth`), bei Touch Ziele ≥ 44 px und Eingabeschrift ≥ 16 px, axe-core in Hell und Dunkel, **`securitypolicyviolation` = Fehler** (die CSP wird erzwungen; Selbsttest und Header-Prüfung in `states.spec.ts`), **Fehlerseite (`data-status="error"`) oder Browserfehler (`pageerror`, `console.error`) = Fehler** |
| `roles.spec.ts` | Zugriff je Standardrolle auf alle Seiten (sichtbar, oder Umleitung auf „Kein Zugriff“ `/forbidden`; eine Fehlerseite ist nie ein gültiges Ergebnis) und Umleitung ohne Anmeldung |
| `states.spec.ts` | Status- und Fehlerseiten (nicht gefunden, Fehler im Rahmen und im Vollbild, Neuinstallation, Kein Zugriff) durch axe/Touch/Überbreite, ihre Barrierefreiheit (Fokus, Titel, ein `<main>`, Live-Region) und **Selbsttests der Erkennung** (absichtliche Fehlerseite, CSP-Verstoß) |
| `https.spec.ts` | HTTPS hinter einem TLS-Proxy mit selbstsigniertem Zertifikat (`e2e/support/https-proxy.ts`): `__Host-so_session` mit `Secure`, untergeschobenes Klartext-Cookie wirkungslos, Abmelden entfernt das Cookie |
| `counter.spec.ts` | **Tresen-Durchlauf** Kunde → Fahrzeug → Termin → Reifen (iPhone und Desktop); später Termin → Auftrag → Rechnung → Mail/Druck |
| `pwa.spec.ts` | **Installierbare App** (nur Desktop-Projekt; als einziger Test mit aktivem Service Worker – sonst `serviceWorkers: "block"` in `playwright.config.ts`): Manifest, Symbole, `sw.js`-Header, Offline-Seite und Logo ohne Anmeldung; im Browser Offline-Seite statt Browserfehler, `/api` unberührt, Zwischenspeicher nur Offline-Seite und Programmdateien |
| `budget.spec.ts` | **JS-Budget** je Route (`e2e/baselines/js-budget.json`, Messung + 10 %, KB entpackt); Überschreitung bricht ab |
| `screenshots.spec.ts` | Baseline-Screenshots der Schlüsselseiten (`key: true`) × Anzeigegröße × Hell/Dunkel – nur Linux (siehe unten) |
| `pages-states.spec.ts` | 404-Seiten im Anwendungsrahmen, Wartezustand beim Navigieren |
| `shell.spec.ts` | Anwendungsrahmen und Formulare: Seitenfach (Handy), Sprunglink, Schnellsuche, Fehlerzusammenfassung mit erhaltener Eingabe, „Änderungen verwerfen?“, „Speichern und Fahrzeug anlegen“; `flash.spec.ts`: Rückfrage-Dialog und Toast nach dem Löschen |

**Routen-Inventur:** Jede Funktion bringt eine `pages.ts` mit (`definePages` aus `src/modules/types.ts`: Pfad wie im App-Verzeichnis, Art – Liste, Detail, neu, bearbeiten,
Dialog, Druckansicht –, Recht, Seed-Verweise für `[id]`-Platzhalter, `key: true` für Schlüsselseiten), eingesammelt in `src/modules/pages.ts` (dazu `PLATFORM_PAGES`).
`src/modules/pages.test.ts` schlägt fehl, wenn eine Funktion keine Seiten meldet, eine gemeldete Route nicht existiert, eine Seite unter `src/app` in keiner Liste steht,
ein Navigationseintrag fehlt oder das Recht der Liste vom `requirePermission` der Seite abweicht. Die Browser-Tests laden dieselbe Liste und ersetzen die Verweise durch IDs
aus dem Demo-Seed (fehlt eine Zeile, bricht die Inventur ab: der Demo-Seed muss jede Seite abdecken).

**Baseline-Listen bekannter Verstöße** (`e2e/baselines/known-violations.json`, je Projekt, Regel und Seite): ein Lauf schlägt bei **neuen** Verstößen fehl *und* bei Einträgen,
die es nicht mehr gibt (die Liste muss mit jedem Paket schrumpfen). Neu schreiben: `E2E_UPDATE_BASELINE=1 npm run e2e` (immer mit vollständigem Lauf je Projekt). Die Listen für
Eingabeschrift ist nach P1a-4 leer; bei Touch-Zielen standen zuletzt nur noch Einträge des Terminkalenders (mit dem Kalenderumbau, Block 6, entfallen – die Baseline-Datei wird erst mit dem ersten echten Lauf geleert); die Überbreiten-Liste der
iPhone-Größe (Detailseiten Fuhrpark, Gerät, IP-Netz) ist mit P3-1 im Code behoben (Spalten des Detail-Rasters mit `min-w-0`, Netzwerk-Unterlisten als Karten) – die Baseline-Datei wird erst mit dem ersten echten Lauf geleert (ein erledigter Eintrag bricht den Lauf, bis er gestrichen ist); axe-Verstöße bleiben bis zum Kontrast-/Beschriftungspaket (P2a-7) erlaubt.
**Die Listen dürfen nur schrumpfen – das wird beim Neuschreiben erzwungen** (`e2e/support/baseline-merge.ts`, Test `e2e/support/baseline-merge.test.ts`): Wächst eine Liste oder ein JS-Budget, bricht das Neuschreiben ab,
außer `E2E_ALLOW_BASELINE_GROWTH="<Begründung>"` (mindestens 10 Zeichen) ist gesetzt – die Begründung wird ausgegeben und in `e2e/baselines/growth.log` festgehalten. Ein Teillauf schreibt nur die geprüften Seiten neu.

**Snapshots:** Baseline-Screenshots (`e2e/snapshots/<projekt>/`) gelten nur auf Linux. Aktualisieren ausschließlich in einem eigenen Commit „snapshots“: den Workflow „Build & publish“ von
Hand mit `update_snapshots` starten (oder unter Linux/Docker `E2E_UPDATE_SNAPSHOTS=1 npm run e2e`), das Artefakt `snapshots` einchecken. Solange keine Baselines eingecheckt sind (oder auf Windows/macOS),
werden die Screenshot-Tests übersprungen.

**Pipeline:** Der Job `e2e` läuft **nicht** bei jedem Push auf `main` (Action-Minuten), sondern bei Versions-Tags (dort blockiert er Image und Release), Pull Requests und von Hand.

**Lighthouse (mobil, P3-6):** Der Job `lighthouse` (gleiche Auslöser wie `e2e`, blockiert nichts) startet die gebaute App wie die Browser-CI und misst mit `@lhci/cli` (`lighthouserc.json`, gepinnte Version, über `npx` – keine Abhängigkeit im Projekt) die Seiten ohne Anmeldung `/setup` und `/offline`: Leistung, Zugänglichkeit, Best Practices, LCP/CLS/TBT, Installierbarkeit. **Alle Schwellen sind Platzhalter** (nur Warnungen), bis es die erste Messung gibt: danach die gemessenen Werte mit Abstand eintragen und die Stufe auf `error` heben (Bericht: Artefakt `lighthouse-report`). Angemeldete Seiten (Cookie über das Playwright-Setup) kommen erst danach dazu. Das JS-Budget je Route (`budget.spec.ts`) bleibt unverändert maßgeblich.

## Realgeräte-Checkliste (vor jedem Release)

Die Browser-CI (Playwright) deckt Chromium und WebKit am Rechner ab, **nicht** das, was nur ein echtes Gerät zeigt: Bildschirmtastatur, Kamera, Safe-Area, Installation, Systemschrift, Druckdialog. Vor jedem Versions-Tag
(`vX.Y.Z`) geht eine Person die Liste mit dem **Release-Kandidaten** (Image `sha-…` aus dem Lauf, hinter HTTPS – sonst gibt es keine Installation) auf **drei Geräten** durch: **iPhone mit Safari**, **Android-Telefon mit Chrome**
und **iPad mit Safari** (hoch und quer). Ergebnis (Gerät, iOS/Android-Version, Browser, je Zeile ✔/✖ mit Notiz) in die Release-Notizen des Tags; eine ✖-Zeile blockiert den Tag, bis sie behoben oder bewusst akzeptiert ist (mit Begründung).

| # | Schritt | iPhone | Android | iPad | Worauf achten |
| --- | --- | :-: | :-: | :-: | --- |
| 1 | **Anmelden** (Passwortmanager, „Dieses Gerät merken“), Abmelden, erneut anmelden | ☐ | ☐ | ☐ | Eingabefeld zoomt nicht hinein (≥ 16 px), Autofill füllt, Tastatur verdeckt den Anmelden-Knopf nicht |
| 2 | **Termin anlegen**: Kalender → Neuer Termin → Fahrzeug suchen (Kennzeichen tippen), Zeit, Speichern | ☐ | ☐ | ☐ | Kennzeichen wird groß geschrieben ohne Autokorrektur, Auswahlfeld mit Suche bedienbar, Speichern-Leiste (siehe 9) |
| 3 | **Kalender**: Woche/Tag/Liste; Wochenstreifen antippen; Termin öffnen; Schnellstatus „Starten/Fertig“ auf der Karte | ☐ | ☐ | ☐ | Tageskopf/Wochenstreifen kleben unter der Kopfzeile (auch mit Notch), Raster ab Tablet (hoch und quer), Ziele mit dem Daumen treffbar |
| 4 | **Foto aufnehmen / Beleg**: Rechnung anlegen → „Foto aufnehmen“ (Kamera) und „Datei wählen“ (Galerie), ein 6-MB-Foto | ☐ | ☐ | ☐ | Kamera-Erlaubnis, Foto wird verkleinert und hochgeladen, HEIC (iPhone) funktioniert, Chrome/Android lehnt HEIC mit Hinweis ab |
| 5 | **Reifen ein-/ausbuchen**: Reifensatz öffnen → ein-/ausbuchen; aus einem erledigten Wechseltermin den Vorschlag bestätigen | ☐ | ☐ | ☐ | Positionen als Karten, Bestätigungsfenster als Blatt unten, Meldung (Toast) über Safe-Area und Speichern-Leiste |
| 6 | **PWA installieren** (nur über HTTPS): iPhone/iPad „Zum Home-Bildschirm“, Android „App installieren“; Symbol starten | ☐ | ☐ | ☐ | Symbol (Schraubenschlüssel auf Blau, Android: maskiert ohne Rand), Name, Statusleistenfarbe passt zu Hell/Dunkel, Start landet auf der Übersicht/Anmeldung |
| 7 | **Offline-Seite**: in der installierten App und im Browser Flugmodus an → Seite wechseln → „Keine Verbindung“ → Flugmodus aus → „Erneut versuchen“; **PDF-Beleg öffnen und herunterladen** (mit Netz) | ☐ | ☐ | ☐ | Offline-Seite statt Browserfehler; mit Netz laufen PDF-Öffnen und Download normal (iOS Standalone: Rückweg über das System); nach einem Update erscheint „Neue Version verfügbar“ |
| 8 | **Druck**: Fahrzeug-Druckliste (Druckmenü des Geräts), Rechnungsansicht | ☐ | ☐ | ☐ | Navigation und Knöpfe fehlen auf dem Ausdruck, Tabelle passt auf die Seite |
| 9 | **Tastatur-Verhalten Speichern-Leiste (`FormActions`)**: langes Formular (Kunde, Fahrzeug), Feld antippen, nach unten scrollen, Tastatur schließen | ☐ | ☐ | ☐ | Mit offener Tastatur verdeckt die Leiste kein Feld (rückt in den Fluss), danach klebt sie wieder am unteren Rand über dem Home-Balken |
| 10 | **Dunkelmodus**: Gerät auf Dunkel, App „System“; dann in der App Hell/Dunkel umschalten; Anmeldeseite, Kalender, ein Formular | ☐ | ☐ | ☐ | Kontrast lesbar, kein weißes Aufblitzen, Statusleiste folgt dem Gerät |
| 11 | **Schriftgröße 200 %** (iOS: Anzeige & Helligkeit → Textgröße / Bedienungshilfen → Größerer Text; Android: Schriftgröße und Anzeigegröße maximal) | ☐ | ☐ | ☐ | Nichts abgeschnitten, Knöpfe umbrechen statt zu sprengen, keine waagerechte Seitenverschiebung, Menü und Dialoge bedienbar |
| 12 | **Querformat und Aussparung** (iPhone/Android mit Notch): eine Liste und ein Formular quer | ☐ | ☐ | ☐ | Inhalt neben der Aussparung, Toast und Blatt nicht verdeckt |
| 13 | **Unterschrift** (sobald eine Seite sie nutzt: Annahme/Freigabe): mit Finger zeichnen, Rückgängig, Löschen; dann „Namen tippen“ | ☐ | ☐ | ☐ | Die Seite scrollt und zoomt beim Zeichnen nicht, der Strich ist glatt (auch Apple Pencil), das Ergebnis erscheint im Beleg |
| 14 | **PDF öffnen, teilen, herunterladen** (Beleg/Rechnung): in Safari und in der installierten App | ☐ | ☐ | ☐ | iOS Standalone: „Öffnen“ ohne Rückweg? (Hilfe empfiehlt Teilen), Teilen-Dialog mit der Datei, Android-Chrome teilt mit Datei, Download landet in „Dateien“ |
| 15 | **Mehrere Fotos hochladen** (Foto-Galerie): fünf Fotos aus der Galerie, bei laufendem Upload Flugmodus an, dann aus | ☐ | ☐ | ☐ | Fortschritt je Foto, „Fehlgeschlagen“ + „Erneut versuchen“ lädt nur dieses Foto, HEIC hält die übrigen nicht auf |
| 16 | **Positionen erfassen** (Angebot/Rechnung): fünf Positionen mit Komma-Beträgen, Steuersatz wechseln, Summenleiste beobachten | ☐ | ☐ | ☐ | Zehnerblock mit Komma, Summenleiste klebt über der Speichern-Leiste, Eingabetaste springt zum nächsten Feld |

Hinweise: Pro Release **mindestens einmal** je Gerätefamilie, auch wenn die Änderung „nur Backend“ war (Updates ändern die Programmdateien unter einer installierten App). Die Liste ist Teil des Release-Ablaufs (siehe „Eine Version veröffentlichen“);
Neues im Mobilverhalten (Kalender, Foto, neue Formulare) kommt als Zeile dazu. Für die Anwender gibt es dazu die Hilfekapitel „Mobil und Tablet“ und „Auf dem Handy installieren“.

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

Die Schlüssel kommen **nur aus dem Build** (`release-key.ts`); keine Umgebungsvariable überschreibt sie, weder in der App noch im Starter (`scripts/gen-trust-header.mjs` erzeugt den Header des Starters aus derselben Datei).
Forks tragen ihre Schlüssel in `release-key.ts` ein. Neben dem Manifest signiert derselbe Schlüssel das **Siegel** `SOS-SEAL` jeder Version (Abschnitt „Starter-Vertrauensanker“; das Manifest mit dem Kontext `schrauberos-manifest-v1`).

### Schlüsselkette: Wurzelschlüssel → Release-Schlüssel

Damit ein **verlorener** (oder planmäßig gewechselter) Release-Schlüssel ersetzt werden kann, ohne dass jede Installation ein neues Image
braucht, gibt es zwei Ebenen (`src/lib/updates/keychain.ts`, getestet):

| Schlüssel | Wo er liegt | Wofür |
| --- | --- | --- |
| **Wurzelschlüssel** (`ROOT_PUBLIC_KEY` in `release-key.ts`) | öffentlich im Code/Image; der **private Teil bleibt offline** (Passwortmanager/Datenträger, nie GitHub-Secret, nie Server) | beglaubigt Release-Schlüssel, signiert nie Pakete |
| **Release-Schlüssel** (`RELEASE_PUBLIC_KEY`, privat: Secret `RELEASE_SIGNING_KEY`) | siehe oben | signiert das Manifest jedes Releases |

Die App vertraut dem eingebauten Release-Schlüssel **und** jedem Schlüssel mit einer gültigen Beglaubigung des Wurzelschlüssels
(`release-keys.json`, wird dem Release beigelegt und unter `<DATA_DIR>/app/release-keys.json` gemerkt; bei jeder Verwendung erneut
gegen die Wurzel geprüft) und **die Beglaubigung steckt im Siegel jeder installierten Version** (Format 2, 118 Bytes), sodass der Starter sie ohne diese Datei prüfen kann. **Jede Beglaubigung trägt ein Ablaufdatum (`--valid-until`, Pflicht, höchstens 5 Jahre)**; eine unbefristete wird von der App abgelehnt und vom
Skript gar nicht erst erzeugt. Nicht beglaubigte Schlüssel werden abgelehnt. Der Ablauf wird nur von der App geprüft (Installieren), **nie vom Starter beim Start**; `make-seal.mjs` verweigert Siegel mit < 90 Tagen Restlaufzeit, die Update-Seite warnt 90 Tage vorher.

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

0. **Realgeräte-Checkliste** (Abschnitt „Realgeräte-Checkliste (vor jedem Release)“) mit dem Release-Kandidaten auf iPhone, Android und iPad durchgehen und das Ergebnis festhalten.
1. `version` in `package.json` auf die neue Nummer setzen (z. B. `0.2.0`), committen, pushen.
2. Tag setzen und pushen: `git tag v0.2.0 && git push origin v0.2.0`.
3. Die GitHub-Action (`.github/workflows/docker-publish.yml`) prüft bei einem Tag zuerst, dass der **getaggte Commit auf `main` liegt** (Job *guard*: Vorfahre von `origin/main`), dann
   Typen/Lint/Tests, den Produktions-Build (`npm run build`) und die Laufzeit-Abhängigkeiten (`npm audit --omit=dev --audit-level=high`: nur hohe und kritische Funde brechen ab, damit ein
   gemeldeter Fund niedriger Schwere keinen Hotfix blockiert). Der Image-Bau bricht ab, wenn der Wurzelschlüssel fehlt, gleich dem Release-Schlüssel ist oder ein Testschlüssel wäre (Stufe `trust`). Das Image wird **einmal gebaut**,
   genau dieses Image **startet vor dem Veröffentlichen** (`scripts/smoke-image.sh`, siehe unten) und wird erst danach unverändert nach `ghcr.io` gepusht — **bei Tags nur als `sha-…`**. Das Paket ist ein **Auszug des getesteten Images** (`docker cp /app`, kein
   zweiter Build). Danach – Job *release* in der Umgebung `release`, Freigabe des Reviewers – entstehen `SOS-SEAL` (`scripts/make-seal.mjs`) und `manifest.json` samt Signatur (`scripts/make-release.mjs`), dann die **Echtprobe** (`scripts/real-trial.sh`: Produktions-Image per Digest, echte
   Schlüssel, Manipulationen), das GitHub-Release als **Entwurf**, der **Retag** desselben Digests als `X.Y.Z`, `X.Y` und `latest` (`docker buildx imagetools create`) und zuletzt das Veröffentlichen des Entwurfs. Scheitert die Echtprobe, gibt es weder `latest` noch ein Release.
   Proben ohne Veröffentlichung: `workflow_dispatch` mit `rehearsal` (nur Testschlüssel, `scripts/rehearse-release.mjs`) und `check_signing_key` (Umgebung `release`, nur auf `main`).
   Der Job *release* läuft serialisiert (`concurrency: release`) und bricht als Erstes ab, wenn es einen **höheren** Versions-Tag gibt (`scripts/check-release-order.mjs`): `latest` und `X.Y` setzt immer nur der höchste Tag.
   Tags mit `-` (`v0.2.0-rc1`) sind **Vorabversionen**: kein `latest`-Image, keine Signatur (installierbar sind nur `x.y.z`), das Release wird als `--prerelease --latest=false` markiert (Web-Updates fragen `releases/latest`).
   **Auch ein `-rc`-Tag läuft durch `db:release-check` und erzwingt damit das Einfrieren der Migrationen** (`npm run db:freeze`) – wer nur testen will, baut über `main` (`edge`) oder startet den Workflow von Hand.

**Einstellungen auf GitHub, die der Betreiber selbst vornehmen muss** (im Repository nicht abbildbar, die Pipeline setzt sie voraus):

* **Tag-Schutz für `v*`** (Settings → Rules → Rulesets → Tag: Muster `v*`, Erstellen/Ändern/Löschen nur für wenige Personen): sonst kann jede Person mit Schreibrecht einen Versions-Tag setzen und damit Image und Release anstoßen. Die Prüfung `guard` fängt Tags auf fremden Commits ab, ersetzt den Tag-Schutz aber nicht.
* **Umgebung `release`** (Settings → Environments → New environment): mit **Pflicht-Reviewer** (Required reviewers) einrichten und das Secret `RELEASE_SIGNING_KEY` dorthin verschieben (als *Environment secret*, nicht mehr als Repository-Secret). Der Job *Release* läuft in dieser Umgebung; ohne Freigabe kommt der Signaturschlüssel nicht in einen Lauf, auch nicht bei einem gepushten Tag. `latest` und die Versions-Tags des Images entstehen erst im Job *release*, also erst nach dieser Freigabe und der Echtprobe.
* **Checkliste für die Umgebung `release`** (aus dem Repository nicht prüfbar – vor dem ersten Tag von Hand durchgehen): (1) **Deployment branches and tags** auf *Selected branches and tags* mit genau den Mustern `main` und `v*` – sonst kann jeder Zweig mit Schreibrecht per `workflow_dispatch` einen Lauf in dieser Umgebung anfordern und das Secret
  mit geändertem Skript auslesen (der Workflow beschränkt `key-check` zwar auf `main`, die Umgebung ist die eigentliche Schranke); (2) **Required reviewers** eingetragen, *Prevent self-review* an, wenn es mehr als eine Person gibt; (3) das Secret nur als *Environment secret*; (4) der Tag-Schutz `v*` oben aktiv. Ein Versions-Tag lässt sich nach dem Veröffentlichen nicht mehr
  ändern (Ruleset: Aktualisieren und Löschen verbieten).

Die Pipeline bricht ab, wenn Tag und `package.json` nicht übereinstimmen. Nur Versionen der Form `x.y.z` sind installierbar.
**Ein Push auf `main` veröffentlicht nur `edge` (und `sha-…`), nie `latest`** – `latest` und die Versions-Tags gibt es erst mit dem Tag (Vorabversionen wie `v0.2.0-rc1`
bekommen kein `latest`, nur ihren vollen Namen). Der Inhalt von `main` heißt `x.y.z-dev.<sha>` und wird von Web-Updates nie angeboten.

**Lieferkette:** Alle Actions in der Pipeline sind auf einen Commit-SHA festgelegt (Version im Kommentar, per `gh api` gegen den Tag aufgelöst); das Basisimage im
`Dockerfile` ist per Digest festgelegt, und der Übersetzer des Starters (Stufe `cc`) kommt aus einem festen Debian-Schnappschuss (`DEBIAN_SNAPSHOT`, dasselbe Datum wie das Basisimage): gleicher Quelltext, gleiche Schlüssel und gleiche Werkzeuge ergeben dasselbe Binary (ein Neubau liefert denselben SHA-256). Dependabot (`.github/dependabot.yml`: npm, Actions, Docker, Compose) schlägt Updates als Pull Requests vor – nichts wird
von selbst eingespielt, jede Änderung läuft durch dieselbe Pipeline. Digest von Hand erneuern: den Digest des Index von `node:24-slim` aus dem Docker-Hub-Register
lesen und im `Dockerfile` ersetzen.

**Smoke-Test des Images** (`bash scripts/smoke-image.sh <lokales-image>`, lokal mit Docker ebenso): prüft den Besitzer im Image (`/app` root, `/data` 1000), startet
es mit `docker-compose.yml` **und** mit `docker-compose.hardened.yml` und verlangt je: gesund, `/api/health` ok, `/login` mit erzwungener CSP, Weiterleitung ohne Anmeldung,
Einrichtungs-Token im Log (die App hat in `/data` geschrieben); außerdem Modus-Bits unter `/app` und die Dateiliste `SOS-TREE` gegen den Baum. Schlägt er fehl, wird nichts veröffentlicht.

Lokal ein Paket bauen und signieren (zum Testen):

```bash
docker build --target bundle --build-arg APP_VERSION=0.2.0 --output type=local,dest=pkg .     # enthält SOS-TREE
tar --sort=name --owner=0 --group=0 --numeric-owner -czf schrauberos-0.2.0.tar.gz -C pkg .
RELEASE_SIGNING_KEY="$(cat release-signing-key.pem)" node scripts/make-seal.mjs --bundle pkg --out .
RELEASE_SIGNING_KEY="$(cat release-signing-key.pem)" node scripts/make-release.mjs \
  --archive schrauberos-0.2.0.tar.gz --bundle pkg --out .
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
und `SCHRAUBEROS_VERSION` (Image-Version, Standard `latest`; `edge` = neuester Stand von `main`, nur zum Ausprobieren).

**Gehärtete Variante (optional):** `docker-compose.hardened.yml` über die Standard-Datei legen –
`docker compose -f docker-compose.yml -f docker-compose.hardened.yml up -d`. Sie setzt `read_only: true` (Wurzeldateisystem schreibgeschützt, beschrieben werden nur das Volume
und `tmpfs /tmp`), `cap_drop: [ALL]` und `security_opt: [no-new-privileges:true]`. Die Pipeline startet das Image vor jeder Veröffentlichung genau so; Web-Updates, Backups und
Wiederherstellung schreiben nur nach `/data` und funktionieren unverändert. In Portainer die drei Schlüssel in den Stack übernehmen.

### Was im Volume liegt

```text
/data/schrauberos.db (+ -wal, -shm)   Datenbank
/data/files/                          Belege und Bilder, lesbare Pfade (rechnungen/<Jahr>/<eingang|ausgang>/…, doku/<bereich>/…)
/data/backups/<name>/                 Backups (database.db.gz, files/ als Hardlinks, info.json); Aufbewahrung je Art einstellbar
/data/app/                            state.json, active, versions/<version>/ (installierte Pakete, schreibgeschützt, mit SOS-SEAL/SOS-TREE), Marker: launcher-crash, verify-failed, inconclusive, verify-ok, incompatible, integrity-reported
/data/restore/                        vorgemerkte/ersetzte Daten während einer Wiederherstellung (auch pending-secret.key/replaced-secret.key)
/data/secret.key                      Schlüssel für verschlüsselte Einstellungen (nicht in Backups; eine mit dem Wiederherstellungsschlüssel umhüllte Kopie steckt in der Datenbank)
/data/secret-reset/                   Sicherung der verschlüsselten Zeilen vor jedem Zurücksetzen nicht lesbarer Geheimnisse (0600, nicht in Backups)
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
  `experimental.serverActions.allowedOrigins` eintragen. **Ohne HTTPS gibt es keine installierbare App und keine Offline-Seite** (Browser erlauben Service Worker nur in sicheren Kontexten, siehe „Installierbare App (PWA)“); der Proxy darf `/sw.js` nicht zwischenspeichern.
* **Sicherheits-Header und Content-Security-Policy (P1b-1):** `next.config.ts` setzt auf **allen** Antworten `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN` und
  `Permissions-Policy` (`camera=(self)` für „Foto aufnehmen“, sonst Mikrofon, Standort, Zahlung, USB … gesperrt – kein pauschales `camera=()`). Die **CSP wird erzwungen** (kein Meldeendpunkt, kleinere
  Angriffsfläche; die Absicherung ist die Browser-CI) und kommt aus `src/lib/csp.ts` – **von genau einer Stelle je Antwort**:
  * **Seiten, Server Actions, JSON-Routen** (alles hinter `src/proxy.ts`): der **Proxy**, mit einem frischen **Nonce je Anfrage** (`createNonce`, 128 Bit). Er schreibt Richtlinie und `x-nonce` auch als Kopf der
    *Anfrage* (`NextResponse.next({ request })`) – **Next liest den Nonce aus dem Kopf der Anfrage** (`getScriptNonceFromHeaders`) und trägt ihn beim Rendern in alle eigenen Skripte und Stile ein; ein
    von außen mitgeschickter CSP-Kopf wird vorher entfernt. Skripte: `'self' 'nonce-…' 'strict-dynamic'` (`'self'` nur als Rückfall alter Browser), kein `'unsafe-inline'`, im Betrieb kein `'unsafe-eval'`.
    Stile: `style-src 'self' 'nonce-…'`; **`style-src-attr 'unsafe-inline'` ist bewusst erlaubt** (React schreibt `style="…"` ins HTML: Kalender, `--workshop-accent`; das ergibt keine Skriptausführung). Dazu `default-src 'self'`,
    `img-src 'self' data: blob:`, `connect-src`/`frame-src`/`worker-src`/`manifest-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'self'`; kein `upgrade-insecure-requests`
    (die App läuft im LAN auch über HTTP). In `next dev` kommen `'unsafe-eval'` und `ws:` hinzu. **Dynamisches Rendering:** Der Nonce gehört zur Anfrage, also rendert **jede** Seite je Anfrage – auch „Nicht gefunden“, „Kein Zugriff“ und
    Fehlerseiten (alle im Root-Layout, das `connection()` abwartet; die App liest ohnehin Cookies und Datenbank). `cacheComponents` bleibt aus (mit Nonce unverträglich). Eigene Inline-Skripte gibt es nicht (Theme und Sprache setzt der Server);
    käme eines hinzu, bekommt es `nonce` aus `(await headers()).get("x-nonce")`. Die 503-Seiten des Proxys (Start, Neuinstallation) tragen den Nonce an ihrem `<style>`.
  * **JSON-/Feed-Antworten** (`/api/v1`, `/api/ical`): `default-src 'none'; frame-ancestors 'none'` (nur dort, **nicht** für Dateirouten).
  * **Dateirouten** (Rechnungsbeleg, Doku-Bilder; `ROUTE_OWNED_PATHS`): die **Route selbst** (`lib/file-delivery.ts`) – Bilder und alles andere `sandbox; default-src 'none'`, **PDF nur `frame-ancestors 'self'`** (weder `sandbox` noch
    `object-src 'none'`: der PDF-Betrachter des Browsers würde nichts anzeigen). Der Proxy fasst diese Pfade nicht an. **Hintergrund (ZP3-S-F9, im Quelltext geprüft):** Next hängt die Kopfzeilen einer Route nur an, wenn der Server den Namen noch nicht
    gesetzt hat (`sendResponse`); eine globale CSP aus `next.config` oder dem Proxy hätte die `sandbox`-Richtlinie der Route still verdrängt (und zwei Köpfe verschärfen sich im Browser gegenseitig). Der Proxy überschreibt dagegen den Kopf aus
    `next.config` (Reihenfolge im Router: Konfigurations-Header, dann Proxy) – trotzdem setzt `next.config` die CSP nur für **Pfade außerhalb des Proxys** (`PROXY_FREE_PATHS`: Statik, Icons, Manifest, `sw.js`, Health, Backup-Upload; Richtlinie ohne Nonce, `script-src 'self'`).
    `src/lib/csp.test.ts` prüft, dass jeder Pfad genau eine Quelle hat (Proxy, Konfiguration **oder** Route), und dass jede Route mit `deliveryHeaders(` in `ROUTE_OWNED_PATHS` steht.
  * **PDF-Vorschau:** `components/ui/pdf-preview.tsx` – `<iframe>` (`frame-src 'self'`, kein `<object>`/`<embed>`), **nur ab `lg`** und erst **nach Klick** auf „Vorschau anzeigen“ (der Rahmen wird dann erst eingehängt, nicht per `hidden`). Eine Option „PDF nur als Download“ gibt es nicht (nicht nötig, solange der Betrachter unter `frame-ancestors`-only anzeigt; **Block 13: im Chrome prüfen**).
  * **Notschalter (Einstellungen → Sicherheit, Recht `settings.manage`, Audit `settings.csp`):** „nur melden“ – derselbe Inhalt unter `Content-Security-Policy-Report-Only` (Antwort und Anfrage; Next liest den Nonce auch daraus), nichts wird blockiert, Verstöße
    stehen nur in der Browser-Konsole. Der Proxy liest den Zustand **ohne Datenbankzugriff** aus dem Prozess (`lib/csp-mode.ts`, `globalThis.__cspMode` wie der Startzustand – Proxy und App sind getrennte Bundles im selben Node-Prozess, ein Modul-Singleton würde nicht
    geteilt, `globalThis` schon). `startApp` lädt den gespeicherten Wert (`security.cspMode`), die Aktion schreibt Datenbank **und** (nach dem Commit) Prozess. Ohne Wert gilt `enforce`. `X-Frame-Options` bleibt auch im Notbetrieb. Ein Prozess, eine Datenbank: kein Abgleich nötig.
  * **HSTS** (`max-age=15552000`, keine Unterdomänen, kein Preload) nur bei erkanntem HTTPS (`x-forwarded-proto` bzw. `SESSION_COOKIE_SECURE`, siehe `session-cookie.ts`). Ohne HTTPS zeigen Einstellungen → Sicherheit und der Systemstatus einen Hinweis (Information, kein Fehler: im LAN ist HTTP üblich), mit
    einem Zusatz, wenn „Hinter Reverse-Proxy“ an ist, die Anfrage aber als HTTP ankommt.
  * **Markdown:** Interne Links nur Pfade der eigenen Herkunft (`//host` ist extern, `lib/markdown-url.ts`); externe Bilder werden nicht geladen (statt des Bildes steht die Beschreibung).
  * **Tests:** `csp.test.ts`, `next-config.test.ts`, `proxy.test.ts` (Nonce je Anfrage, Notschalter, Header-Überschreiben, HSTS, 503-Seiten), `markdown-url.test.ts`, `file-delivery.test.ts`. Browser-CI: jeder `securitypolicyviolation` der Inventur ist ein Fehler; `states.spec.ts` prüft
    Nonce je Anfrage an allen `<script>`/`<style>` (Anmeldung, Startseite, 404), die Köpfe je Antwortart und die Selbsterkennung. **Offen für Block 13 (nur im Browser prüfbar):** Lauf der Inventur über alle Rollen/Dialoge/Druckansichten unter der CSP in Chromium und WebKit, axe unter CSP,
    Chrome-PDF-Viewer mit `frame-ancestors`-only, ob `strict-dynamic` auf allen Zielbrowsern greift, Notschalter im Betrieb.
* **Zeitzone:** Einstellungen → Werkstatt; wird bei jedem Start angewendet.
* **Image neu ziehen** ist nur nötig, wenn ein Release den Vertrag des Starters ändert (die Update-Seite sagt es) oder bei einem
  Schlüsselwechsel: `docker compose pull && docker compose up -d` (die Daten bleiben).

## Bekannte Grenzen

* Listen (Kunden, Reifen, Rechnungen) laden bis zu 100–300 bzw. alle Datensätze und filtern teils im Speicher – für typische
  Betriebsgrößen in Ordnung, bei Bedarf Pagination ergänzen.
* Dateien wachsen mit dem Archiv; Backups verweisen per Hardlink darauf (kaum Zusatzplatz), schützen aber nicht vor dem Ausfall des
  Datenträgers – Kopien außerhalb des Servers über „Herunterladen“.
* Lokale Backups und heruntergeladene Dateien sind unverschlüsselt; nur die Off-Site-Dateien (`.sobk`) sind es. Ändert sich der Wiederherstellungsschlüssel, bleiben bereits am Ziel liegende Dateien mit dem alten verschlüsselt. Der WebDAV-Server muss Chunked-PUT annehmen; selbst ausgestellte Zertifikate werden nicht akzeptiert (dafür SFTP).
* **Für die Browser-CI / Block 13 vorgemerkt (CSP und Dateirouten, ZP3-S-F9):** Zusammenspiel im Browser prüfen: PDF-Beleg im `<iframe>` unter `frame-ancestors 'self'` (Chrome-Betrachter, WebKit), Bilder der Dateirouten mit `sandbox` inline; Doku-Bild-Upload mit `Content-Length` über die gebaute App und einen üblichen Reverse-Proxy (nginx/Traefik; fehlt die Länge, antwortet die Route 411).
* Der Job-Runner setzt genau einen Prozess voraus (ein Container, eine SQLite-Datei): Nach einem Neustart gelten laufende Läufe als unterbrochen. Jobs sind deshalb wiederholbar auszulegen.
* **Tests mit Symlinks** (`archive.test.ts`: Prüfung auf dem Dateisystem, Verzeichnis-Symlink) laufen nur unter Linux/macOS (unter Windows ohne Entwicklermodus fehlt das Recht, sie werden übersprungen) – die Linux-Pipeline muss sie ausführen; `safe-fetch.test.ts` bindet `127.0.0.2` (sonst Ausweichen auf `127.0.0.1`).
* API: noch ohne Oberfläche zur Token-Verwaltung, ohne Webhooks, ohne Datei-Upload (Rechnungsbelege) und ohne Doku-Seite der Ressourcen (F11); Tokens entstehen bis dahin nur über die Server-Funktion `createApiTokenOperation`. Rate-Limit und Drosselung liegen im Speicher des Prozesses (ein Prozess, eine Datenbank).
* Die Suche unterscheidet bei Umlauten Groß-/Kleinschreibung (SQLite).
* Urlaubstage zählen Mo–Fr ohne Feiertage; kein Genehmigungs-Workflow.
* Nicht enthalten: E-Mail/SMS-Erinnerungen, Druck-Etiketten/QR-Codes für Lagerplätze, Ressourcen-Kalender pro Mitarbeiter, echte
  Netzwerk-Überwachung (derzeit Demo), Zwei-Faktor-Anmeldung. Anmeldung rein lokal; Active Directory ist über `AuthProvider` in
  `src/server/auth/providers.ts` vorgesehen.
* Eine Anbindung an Fremdsysteme (früher als Werbas-Platzhalter vorgesehen) gibt es nicht; der nie eingebundene Abgleichscode und die Spalten `externalSource`/`externalId`/`syncedAt` wurden entfernt. Kommt eine Anbindung, dann als Operation mit Audit in der betroffenen Funktion.
* Gebaut wird `linux/amd64` (das Siegel trägt `arch`; weitere Architekturen bräuchten ein Siegel je Architektur).
* **Starter-Vertrauensanker:** schützt vor dem Überleben fremden Codes über Neustarts, nicht vor Laufzeit-Manipulation, Daten-Persistenz, gestohlenem Release-Schlüssel oder dem Wiedereinspielen einer echten alten signierten Version oberhalb der eingebauten (Details im Abschnitt „Starter-Vertrauensanker“). Zusätzliche Dateien von NAS-Diensten im Versionsordner (`@eaDir`, `.DS_Store`, `Thumbs.db`) führen zur Ablehnung der Version (Meldung nennt den Pfad); der Installer setzt Setgid/Sticky zurück, die vom Elternordner geerbt wurden („Gruppe vererben“), der Starter lehnt es danach weiterhin an jeder Stelle ab;
  der `st_dev`-Vergleich im Baum (16 `device`) kann auf **Union-Dateisystemen** (unRAID/shfs, Overlay ohne `xino`) auch ohne Manipulation anschlagen – dort ist das Volume für die Web-Updates nicht geeignet (die Version wird abgelehnt, die eingebaute läuft); der Start aus dem geprüften Ordner schließt den Austausch ganzer Ordner nach der Prüfung, die Änderung einzelner Dateien zwischen Hash und Start
  verhindert nur der Ruhezustand (kein anderer Code der App läuft); „unhealthy“ während eines App-Neustarts ist kosmetisch.

## Technik

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Prisma 7 (SQLite) · eigene Sitzungs-Authentifizierung (scrypt,
serverseitige Sitzungen) · eigene schlanke i18n · Zod · react-markdown + remark-gfm · node-tar · ssh2 (SFTP, reine JavaScript-Variante) · esbuild. Design-Tokens in
`src/app/tokens.css`.
