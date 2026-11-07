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
4. [Datenhaltung](#datenhaltung) · 5. [Container, Starter und Updates](#container-starter-und-updates) (mit Backups, [Job-Runner](#job-runner-srcserverjobs), [Uploads und Archive](#uploads-und-archive)) ·
6. [Neue Funktion anlegen](#eine-neue-funktion-anlegen) · 7. [Konventionen](#konventionen) · 8. [Tests](#tests) ·
9. [Browser-CI](#browser-ci-playwright) · [Release und Signaturschlüssel](#release-und-signaturschlüssel) · 10. [Betrieb](#betrieb) · 11. [Grenzen](#bekannte-grenzen)

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
    registry.ts           sammelt Dashboard-Bausteine, Einstellungs-Reiter und Suchanbieter (`<funktion>/search.ts`) der Funktionen ein; `quickActionsFor` (Neu-Menü) liest die `quickActions` der `feature.ts`
    jobs.ts               sammelt die geplanten Jobs und Outbox-Abnehmer der Funktionen (`<funktion>/jobs.ts`) ein
    api.ts                sammelt die API-Endpunkte der Funktionen (`<funktion>/api.ts`) ein; api-exceptions.ts: UI-Aktionen ohne API-Pendant
    default-roles.ts      mitgelieferte Rollen
    workshop/ office/ it/ admin/      je Modul: module.ts + ein Ordner je Funktion
      <funktion>/feature.ts, public.ts, operations.ts, actions.ts, api.ts, queries.ts, domain.ts, forms.tsx, widgets.tsx, settings-tab.tsx …
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
  „Trotzdem anlegen/speichern“). Dasselbe für **Firmenfahrzeuge** (`fleet.save`, Vergleich über `normalizePlate` im Speicher – der Fuhrpark ist klein, keine neue Spalte; Kundenfahrzeuge zählen dort nicht als Dublette). **Verhaltensänderung** gegenüber früher (gesperrt): in der Hilfe vermerkt. Eine Funktion „Altfahrzeug archivieren“ gibt es noch nicht (kommt mit P4b-2).
  `normalizePlate`: Unicode wird zusammengesetzt (NFC, sonst wäre ein „Ü“ vom Mac ein anderes Kennzeichen), Umlaute bleiben Umlaute, „ß“ wird zu „SS“; Tests mit Ä/Ö/Ü, ß, A und CH in `lib/plate.test.ts`.
* **Liste, Druckliste, Baustein:** Filter `?inspection=soon|none` und `?month=JJJJ-MM` (`vehicleListWhere` in `vehicles/queries.ts`, gemeinsam für Liste und Druckliste), Sortierung `inspection`. `/vehicles/print` (Art `print` in `pages.ts`) druckt dieselben Filter als Tabelle (höchstens 1000, Telefon nur mit `customers.view`); `window.print()` über `PrintButton`,
  die Bildschirmteile sind `print:hidden`. Dashboard-Baustein `inspection-due` (`widgets.tsx`) mit „Termin planen“ → `/appointments?new=1&vehicle=<id>` (weich: nur mit aktiver Terminfunktion und `appointments.create`). **CSV/Excel-Export** der gefilterten Liste kommt in Block 8. API: neue Felder, Filter `inspectionDue`, `allowDuplicate` (`openapi-structure.txt` ist der Schnappschuss).
* **Demo-Seed** (`seed/demo.ts`): Fristen relativ zu heute (überfällig, laufender Monat, +1, +2 samt Gasprüfung, +8, +14), damit Baustein, Filter und Druckliste Beispiele haben.

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

## Datenhaltung

* **SQLite**, eine Datei (WAL-Modus, `synchronous=FULL`), im Container unter `/data`. Reicht für eine Werkstatt mit einigen
  Dutzend Nutzern über viele Jahre; Schreibvorgänge laufen nacheinander und dauern Millisekunden. Voraussetzung: **lokale Platte**
  (keine SMB-/NFS-Freigabe). Grenzen: keine mehreren App-Instanzen, keine Hochverfügbarkeit.
* Schema nur in `prisma/schema.prisma`. **Keine Enums und keine Json-Felder** – Zustände sind Strings mit festen Werten im Code
  (hält einen späteren Datenbankwechsel offen). Textsuche immer über `contains()` aus `src/server/search.ts` (Prisma maskiert `%`/`_` unter SQLite nicht: `contains()` entfernt `%`, ein Suchtext nur aus Platzhaltern findet nichts) (SQLite unterscheidet
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
* **Integrität:** Ausgangsrechnungsnummern sind eindeutig (Prüfung in der Transaktion **und** Unique-Schlüssel `Invoice.outgoingKey` = normalisierte Nummer, nur bei `outgoing`, bei Eingang NULL;
  `src/lib/invoice-number.ts`). Kunden mit Fahrzeugen, Halter-Historie oder Rechnungen sind nicht löschbar (Code **und** `onDelete: Restrict` an `Vehicle.customer`, `VehicleOwnership.customer`,
  `Invoice.customer`; Termine bleiben `SetNull`). Indizes auf den Fremdschlüsseln von Termin, Rechnung und Doku-Seite.
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
dann Anlegen in einer Transaktion; **erst danach** wird die Zeitzone angewendet (`applyTimezone`, vorher `isValidTimezone`) und das
Token gelöscht. Dasselbe gilt für die Einstellungen (Zeitzone erst nach dem Speichern). Das Token ist die bewusste Ausnahme vom Grundsatz
„alles über die Weboberfläche“: **einmalige Installationshandlung, kein laufender Betrieb**.

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
* **Audit:** `audit: "<aktion>"` (Aktion in `src/lib/audit-actions.ts` + Beschriftungen `audit.actions.*`) oder `audit: false` mit `auditReason` (Begründung Pflicht). Fehlschläge außerhalb der
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
  (`config.matcher`, getestet): Statik, `manifest.webmanifest`, `sw.js`, Icons, `/api/health` und der **Upload von Sicherungen** `/api/backups/upload`. `/api/v1/*` (Bearer-Token) und `/api/ical/*`
  (Token in der URL) laufen durch den Proxy (wegen „Neuinstallation nötig“), brauchen aber kein Sitzungs-Cookie; übrige `/api/*` ohne Cookie antworten mit 401.
  **Warum der Upload nicht durch den Proxy läuft:** Next puffert den Request-Body für den Proxy im Speicher und **schneidet ihn bei `experimental.proxyClientMaxBodySize` (Standard 10 MiB) stumm ab** – eine größere Sicherung käme verstümmelt an (und ein Gigabyte läge im Speicher).
  `/api/backups/upload` ist deshalb aus dem Matcher genommen und prüft Sitzung, Recht, Herkunft und den Zustand „Neuinstallation nötig“ (503) selbst; sie streamt den Body auf die Platte (Tests: `files.test.ts` mit 11 MiB, `proxy.test.ts`, `next-config.test.ts`). Für die Server Actions
  (Belege bis 10 MiB plus Formular, `serverActions.bodySizeLimit` 12 MB) steht `proxyClientMaxBodySize` auf 13 MB – bewusst nicht global hoch (der Puffer liegt je Anfrage im Speicher). Doku-Bilder (`/api/docs/images`, höchstens 2 MiB) liegen darunter. Neue Upload-Wege über 10 MiB gehören ebenfalls aus dem Matcher.
  Der Titel einer Detailseite (`generateMetadata`) wird nur mit dem Recht der Seite aus der Datenbank gelesen (`sessionIfAllowed`, `src/server/auth/session.ts`; er steht sonst
  schon im gestreamten HTML, bevor die Seite prüft – Test `app/metadata.test.ts`, Architekturregel).
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
| **Launcher** (`src/launcher/main.ts` verdrahtet Prozess/Netz/Zeit, der Ablauf steht in `src/launcher/launcher.ts` und ist mit Fake-Prozess getestet; mit esbuild zu `launcher.mjs`) | Paket | mit jedem Update |
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
  Basisdaten, Zeitzone, Job-Runner. `/api/health` meldet erst danach „ok“; scheitert etwas, beendet sich der Prozess.
  **Der Start läuft im Hintergrund** (`register()` wartet nicht darauf, `src/server/startup-launch.ts`). Grund (Next-16-Quellen: `next-server.js` `prepareImpl` → `runInstrumentationHookIfAvailable`,
  `start-server.js` `requestListener` wartet auf `handlersPromise`): Wartete `register()` auf die Migration, nähme der Server Verbindungen an, beantwortete aber **keine** Anfrage – auch `/api/health` nicht, der Launcher sähe nur
  Zeitüberschreitungen. So antwortet `/api/health` schon während der Migration mit `503 { "status": "starting" }`, und `proxy.ts` beantwortet **jede andere Anfrage** (Seiten, Server Actions, Route Handler, `/api/v1`) mit
  `503` (`Retry-After`, Browser: kurze Seite mit Neuladen), bis der Zustand `ready` ist – **keine Anfrage erreicht eine noch nicht migrierte Datenbank**. Außerhalb des Proxys liegen nur Statik (fasst keine Datenbank an) und
  `/api/backups/upload` (prüft den Zustand selbst). Die Migration selbst (`better-sqlite3`) arbeitet **synchron**: Während eines einzelnen langen Schritts antwortet auch der Health-Endpoint nicht (siehe Update-Ablauf, Launcher).
  Der Job-Runner startet erst nach erfolgreichem Start und nie bei „Neuinstallation nötig“.
* **Keine Fremdprogramme:** Archive bearbeitet die npm-Bibliothek `tar` – es gibt kein System-`tar`.
* **Die eingebaute App ist `root:root` und für den Betriebsbenutzer (1000) nicht schreibbar** (`COPY` ohne `--chown`): Geschrieben wird nur nach `/data`
  (Datenbank, Dateien, Backups, installierte Versionen) und `/tmp`. Wer die laufende Anwendung kompromittiert, kann den eingebauten Code nicht
  ändern. Der Smoke-Test der Pipeline prüft Besitzer und Start (`scripts/smoke-image.sh`).
* **Zustand:** `<DATA_DIR>/app/state.json` (+ Zeiger `active`); reine, getestete Logik in `src/lib/updates` (`state.ts`, `store.ts`,
  `restore.ts`). `writeState` schreibt immer auch den Zeiger.
* `docker/BASE_VERSION` nur erhöhen, wenn sich der Vertrag des Starters ändert (Zeiger-Format, Exit-Codes, Aufruf der Laufzeit)
  oder die Architektur wechselt – solche Releases bieten kein Web-Update, sondern verlangen ein neues Image.

### Update-Ablauf (Funktion `admin.updates`)

1. Backup anlegen („Vor Update“; scheitert es, wird abgebrochen).
2. Neuestes GitHub-Release holen, **Ed25519-Signatur** des `manifest.json` prüfen (gegen den eingebauten öffentlichen Schlüssel),
   Paket laden und **SHA-256/Größe** gegen das Manifest prüfen.
3. Nach `<DATA_DIR>/app/versions/<version>` entpacken, `state.json`/`active` schreiben, Neustart (Exit-Code 42).
4. Starter → Launcher der neuen Version → Gesundheitsprüfung oder Rückfall. Die Frist ist 90 s (`LAUNCHER_HEALTH_TIMEOUT_MS`) und **verlängert sich jedes Mal um ihre volle Länge**, wenn die App lebt und migriert:
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
* **Upload** (`/api/backups/upload`): Länge vorab gegen freien Platz (2 × Länge + 512 MiB Reserve → 507) und Obergrenze (100 GiB → 413); während des Empfangs werden die Bytes gezählt (Obergrenze auch ohne Längenangabe)
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
  speist den Systemstatus („Zeitgeber zuletzt aktiv“). `runNow(jobId)` führt einen Job sofort aus (Aktivierung der Funktion gilt, `ctx.manual = true`, `shouldRun` wird umgangen); verdrahtet ist es bisher nur für `backup.auto` („Jetzt erneut versuchen“).
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

* **Inhalt statt Behauptung** (`src/lib/upload-sniff.ts`): Rechnungsbelege (PDF, PNG, JPEG, WebP, XML/XRechnung), Doku-Bilder (PNG, JPEG, WebP, GIF) und das Logo (zusätzlich SVG) werden an den ersten Bytes erkannt;
  der gemeldete Typ muss passen, **gespeichert wird der erkannte Typ**. HTML als `.png` wird abgelehnt. **XML nur als elektronische Rechnung:** `<?xml`-Deklaration, Wurzel aus der Positivliste (UBL `Invoice`/`CreditNote`, CII `CrossIndustryInvoice`, `XML_INVOICE_ROOTS`), kein `<!DOCTYPE`, `<!ENTITY`, `<?xml-stylesheet`.
  **Pflicht für den späteren XRechnung-Import:** Der Parser schaltet DTDs und externe Entitäten aus (kein XXE, kein Entity-Expansion) und löst nie Adressen aus der Datei auf.
* **Fotos verkleinern vor dem Hochladen** (`FileInput variant="photo"`, Logik in `src/lib/image-resize.ts`, getestet in `image-resize.test.ts` und `photo-input.test.ts`): Handyfotos (4–8 MB) werden im Browser auf höchstens 1600 px (längste Kante) und als JPEG mit Qualität 0,8
  neu kodiert (`createImageBitmap(file, { imageOrientation: "from-image" })` wendet die EXIF-Drehung an, das Ergebnis trägt kein EXIF). **`maxBytes` gilt für das verkleinerte Ergebnis** (ein 6-MB-Foto passt in das 2-MB-Feld der Doku-Bilder). Entscheidungen: PDF/XML/SVG unverändert (nicht einmal dekodiert);
  Bild bis 1600 px und innerhalb `maxBytes` bleibt das Original; die neue Fassung ersetzt es nur, wenn sie kleiner ist; PNG/WebP **mit Alpha** nie zu JPEG (zu große als PNG); GIF und animiertes WebP unverändert; erkannt wird am Inhalt (Magic Bytes), der Browser-Typ ist unter Android oft leer.
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

## Eine neue Funktion anlegen

Beispiel: Funktion `warranty` im Modul `workshop`.

1. Ordner `src/modules/workshop/warranty/` anlegen.
2. **`feature.ts`** mit `defineFeature({...})`: ID, Modul, Name/Beschreibung (Übersetzungsschlüssel), Reihenfolge, Abhängigkeiten
   (`requires` / `uses`), Rechte-Gruppe mit Schlüsseln (`warranty.view` …), Navigation, Routen-Präfixe.
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
6a. Hintergrundarbeit (Aufräumen, regelmäßige Prüfungen, Zustellung von Ereignissen): `jobs.ts` (`export const jobs: JobDef[]`, `feature` ist die eigene Funktion; Abnehmer für Outbox-Ereignisse als `OutboxHandlerDef`),
    eingetragen in `src/modules/jobs.ts` – siehe „Job-Runner“. Der Job muss wiederholbar sein; ein Beschriftungsschlüssel `system.names.<bereich>.<name>` zeigt ihn im Systemstatus.
7. Soll eine andere Funktion etwas nutzen, exportiert `public.ts` genau das – und die andere deklariert `requires`/`uses`.
8. Neue Rechte in `default-roles.ts` den passenden Rollen zuordnen (Administratoren haben sie sofort).
9. Server Actions **immer** über den Aktions-Rahmen (`defineOperation` + `defineAction`, siehe „Aktionen und Operationen“): Bearbeiten-Formulare tragen `version` mit, `run` nutzt `claimRow(tx.modell, id, version)`;
   Dateien nur über `files.ts`; jede Operation nennt `audit: "<aktion>"` (Aktion in `src/lib/audit-actions.ts` + Texte `audit.actions.*`) oder begründet den Verzicht. Neue Funktionen standardmäßig mit `defaultEnabled: false`.
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
  `SearchCombobox`, `StatusPage`, `Skeleton`, `LinkPending`/`NavProgress`. Wer ein Element braucht, nimmt den Baustein; fehlt eine Variante, wird sie **dort** ergänzt, damit
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
SQLite-Dateien), Dateispeicher, optimistische Sperre und gleichzeitige Buchungen gegen eine echte Datenbank, Update-Zustand und Rückfälle.
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
iPhone-Größe (vier Detailseiten) soll vor dem Release leer sein; axe-Verstöße bleiben bis zum Kontrast-/Beschriftungspaket (P2a-7) erlaubt.
**Die Listen dürfen nur schrumpfen – das wird beim Neuschreiben erzwungen** (`e2e/support/baseline-merge.ts`, Test `src/e2e-baseline.test.ts`): Wächst eine Liste oder ein JS-Budget, bricht das Neuschreiben ab,
außer `E2E_ALLOW_BASELINE_GROWTH="<Begründung>"` (mindestens 10 Zeichen) ist gesetzt – die Begründung wird ausgegeben und in `e2e/baselines/growth.log` festgehalten. Ein Teillauf schreibt nur die geprüften Seiten neu.

**Snapshots:** Baseline-Screenshots (`e2e/snapshots/<projekt>/`) gelten nur auf Linux. Aktualisieren ausschließlich in einem eigenen Commit „snapshots“: den Workflow „Build & publish“ von
Hand mit `update_snapshots` starten (oder unter Linux/Docker `E2E_UPDATE_SNAPSHOTS=1 npm run e2e`), das Artefakt `snapshots` einchecken. Solange keine Baselines eingecheckt sind (oder auf Windows/macOS),
werden die Screenshot-Tests übersprungen.

**Pipeline:** Der Job `e2e` läuft **nicht** bei jedem Push auf `main` (Action-Minuten), sondern bei Versions-Tags (dort blockiert er Image und Release), Pull Requests und von Hand.

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
3. Die GitHub-Action (`.github/workflows/docker-publish.yml`) prüft bei einem Tag zuerst, dass der **getaggte Commit auf `main` liegt** (Job *guard*: Vorfahre von `origin/main`), dann
   Typen/Lint/Tests, den Produktions-Build (`npm run build`) und die Laufzeit-Abhängigkeiten (`npm audit --omit=dev --audit-level=high`: nur hohe und kritische Funde brechen ab, damit ein
   gemeldeter Fund niedriger Schwere keinen Hotfix blockiert). Das Image wird **einmal gebaut**, genau dieses Image **startet vor dem Veröffentlichen** (`scripts/smoke-image.sh`,
   siehe unten) und wird erst danach unverändert nach `ghcr.io` gepusht (`0.2.0`, `0.2`, `latest`) – kein zweiter Build, der vom getesteten abweichen könnte. Das Paket (`--target bundle`)
   entsteht im selben Job aus demselben Build-Cache; eine Gegenprobe vergleicht `version.json`, `launcher.mjs` und `server.js` byte-genau mit dem getesteten Image. Danach – Job *Release*, hängt am
   erfolgreichen Veröffentlichen – erzeugt sie `manifest.json` samt Signatur (`scripts/make-release.mjs`) und legt das GitHub-Release mit Paket, Manifest und Signatur an (Änderungen aus den Commits).
   Tags mit `-` (`v0.2.0-rc1`) sind **Vorabversionen**: kein `latest`-Image, keine Signatur (installierbar sind nur `x.y.z`), das Release wird als `--prerelease --latest=false` markiert (Web-Updates fragen `releases/latest`).
   **Auch ein `-rc`-Tag läuft durch `db:release-check` und erzwingt damit das Einfrieren der Migrationen** (`npm run db:freeze`) – wer nur testen will, baut über `main` (`edge`) oder startet den Workflow von Hand.

**Einstellungen auf GitHub, die der Betreiber selbst vornehmen muss** (im Repository nicht abbildbar, die Pipeline setzt sie voraus):

* **Tag-Schutz für `v*`** (Settings → Rules → Rulesets → Tag: Muster `v*`, Erstellen/Ändern/Löschen nur für wenige Personen): sonst kann jede Person mit Schreibrecht einen Versions-Tag setzen und damit Image und Release anstoßen. Die Prüfung `guard` fängt Tags auf fremden Commits ab, ersetzt den Tag-Schutz aber nicht.
* **Umgebung `release`** (Settings → Environments → New environment): mit **Pflicht-Reviewer** (Required reviewers) einrichten und das Secret `RELEASE_SIGNING_KEY` dorthin verschieben (als *Environment secret*, nicht mehr als Repository-Secret). Der Job *Release* läuft in dieser Umgebung; ohne Freigabe kommt der Signaturschlüssel nicht in einen Lauf, auch nicht bei einem gepushten Tag. Auch das Veröffentlichen des Images (`latest`) läuft vor dieser Freigabe – der Schutz dafür ist der Tag-Schutz.

Die Pipeline bricht ab, wenn Tag und `package.json` nicht übereinstimmen. Nur Versionen der Form `x.y.z` sind installierbar.
**Ein Push auf `main` veröffentlicht nur `edge` (und `sha-…`), nie `latest`** – `latest` und die Versions-Tags gibt es erst mit dem Tag (Vorabversionen wie `v0.2.0-rc1`
bekommen kein `latest`). Der Inhalt von `main` heißt `x.y.z-dev.<sha>` und wird von Web-Updates nie angeboten.

**Lieferkette:** Alle Actions in der Pipeline sind auf einen Commit-SHA festgelegt (Version im Kommentar, per `gh api` gegen den Tag aufgelöst); das Basisimage im
`Dockerfile` ist per Digest festgelegt. Dependabot (`.github/dependabot.yml`: npm, Actions, Docker, Compose) schlägt Updates als Pull Requests vor – nichts wird
von selbst eingespielt, jede Änderung läuft durch dieselbe Pipeline. Digest von Hand erneuern: den Digest des Index von `node:24-slim` aus dem Docker-Hub-Register
lesen und im `Dockerfile` ersetzen.

**Smoke-Test des Images** (`bash scripts/smoke-image.sh <lokales-image>`, lokal mit Docker ebenso): prüft den Besitzer im Image (`/app` root, `/data` 1000), startet
es mit `docker-compose.yml` **und** mit `docker-compose.hardened.yml` und verlangt je: gesund, `/api/health` ok, `/login` mit erzwungener CSP, Weiterleitung ohne Anmeldung,
Einrichtungs-Token im Log (die App hat in `/data` geschrieben). Schlägt er fehl, wird nichts veröffentlicht.

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
* Backups sind unverschlüsselt.
* **Für die Browser-CI / Block 13 vorgemerkt (CSP und Dateirouten, ZP3-S-F9):** Zusammenspiel im Browser prüfen: PDF-Beleg im `<iframe>` unter `frame-ancestors 'self'` (Chrome-Betrachter, WebKit), Bilder der Dateirouten mit `sandbox` inline; Doku-Bild-Upload mit `Content-Length` über die gebaute App und einen üblichen Reverse-Proxy (nginx/Traefik; fehlt die Länge, antwortet die Route 411).
* Der Job-Runner setzt genau einen Prozess voraus (ein Container, eine SQLite-Datei): Nach einem Neustart gelten laufende Läufe als unterbrochen. Jobs sind deshalb wiederholbar auszulegen.
* **Tests mit Symlinks** (`archive.test.ts`: Prüfung auf dem Dateisystem, Verzeichnis-Symlink) laufen nur unter Linux/macOS (unter Windows ohne Entwicklermodus fehlt das Recht, sie werden übersprungen) – die Linux-Pipeline muss sie ausführen; `safe-fetch.test.ts` bindet `127.0.0.2` (sonst Ausweichen auf `127.0.0.1`).
* API: noch ohne Oberfläche zur Token-Verwaltung, ohne Webhooks, ohne Datei-Upload (Rechnungsbelege) und ohne Doku-Seite der Ressourcen (F11); Tokens entstehen bis dahin nur über die Server-Funktion `createApiTokenOperation`. Rate-Limit und Drosselung liegen im Speicher des Prozesses (ein Prozess, eine Datenbank).
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
