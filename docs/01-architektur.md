# Architektur

SchrauberOS ist ein **modularer Monolith**: eine Next.js-Anwendung, in der fachliche Bereiche als **Module** mit
einzeln schaltbaren **Funktionen** organisiert sind. Dieses Kapitel erklärt die Begriffe und die Regeln, die den
Code sauber getrennt halten.

## Begriffe

| Begriff | Bedeutung | Beispiel |
| --- | --- | --- |
| **Plattform** | Alles, was immer läuft und keine Fachlogik kennt: Login, Rechte-Engine, Layout, Datenbank, Übersetzung, UI-Bausteine. | `src/server`, `src/components`, `src/i18n`, `src/lib` |
| **Modul** | Fachlicher Bereich, als Ganzes ein- und ausschaltbar. | Werkstatt, Büro, IT, Verwaltung |
| **Funktion** | Abgegrenzter Teil eines Moduls mit eigenen Seiten, Rechten, Texten und ggf. Einstellungen. Einzeln schaltbar. | Termine, Reifenlager, Rechnungsarchiv |
| **Querschnittsfunktion** | Baustein, den mehrere Funktionen nutzen. Liegt in `src/capabilities`. | Dokumentation (Markdown-Seiten für Werkstatt, Büro und IT) |
| **Adapter** | Anbindung an ein Fremdsystem. Geplant: Werbas, Active Directory. | `src/server/integrations` |

Nicht gebaut (und nicht nötig, solange alles in einem Repository entsteht): **Plugins**, die zur Laufzeit von Dritten
nachgeladen werden. Die Struktur ist so gewählt, dass sich das später nachrüsten ließe.

## Aufbau des Codes

```text
src/
  modules/
    catalog.ts            Katalog aller Module und Funktionen (Quelle der Wahrheit)
    define.ts             Typen und defineModule()/defineFeature()
    features.ts           Aktivierung: Schalter lesen/schreiben (Datenbank)
    registry.ts           sammelt Dashboard-Bausteine und Einstellungs-Reiter der Funktionen ein
    workshop/             Modul Werkstatt
      module.ts
      appointments/       Funktion Termine
        feature.ts        Beschreibung: ID, Rechte, Navigation, Abhängigkeiten
        public.ts         die einzige Schnittstelle für andere Funktionen
        actions.ts, queries.ts, domain.ts, forms.tsx, widgets.tsx, settings-tab.tsx …
      tires/ customers/ vehicles/ docs/
    office/               invoices, employees, fleet, docs
    it/                   network, docs
    admin/                users, roles, settings, modules, handbook
  capabilities/docs/      Querschnittsfunktion Dokumentation
  app/                    Next.js-Routen (dünn: laden Daten, setzen Bausteine zusammen)
  server/ components/ i18n/ lib/   Plattform
```

Die Routen unter `src/app/(app)` liegen in Routengruppen, die den Modulen entsprechen (`(workshop)`, `(office)`,
`(it)`, `(admin)`). Die Gruppen sind reine Ordnung und ändern keine URL.

## Der Katalog

Jede Funktion beschreibt sich in einer `feature.ts` (siehe `defineFeature`). `catalog.ts` führt alle zusammen und
leitet daraus **alles Weitere** ab:

* die Typen `Permission` und `FeatureId` (ein Tippfehler bei einem Recht ist ein Typfehler),
* die Rechte-Gruppen der Rollenverwaltung,
* die Navigation, die Dashboard-Bausteine und die Einstellungs-Reiter,
* die Admin-Seite **Module & Funktionen**,
* die Seite **Katalog** in diesem Handbuch.

Eine neue Funktion wird also an *einer* Stelle beschrieben, und alle Sichten folgen automatisch.

## Module und Funktionen ein-/ausschalten

Administratoren schalten unter **Verwaltung → Module & Funktionen** ganze Module oder einzelne Funktionen ein und aus.

* Gespeichert werden nur **Abweichungen** vom Standard „an“ (Tabelle `FeatureSetting`). Neue Funktionen sind damit
  nach einem Update automatisch aktiv.
* **Wirksam** ist eine Funktion, wenn ihr Modul an ist, sie selbst an ist **und** alle ihre harten Abhängigkeiten
  (`requires`) wirksam sind. Wer „Fahrzeuge“ ausschaltet, schaltet damit „Reifenlager“ und „Termine“ mit aus, die
  Fahrzeuge brauchen. Die Admin-Seite zeigt solche Abhängigkeiten an.
* **Pflichtbestandteile** (`required`) lassen sich nicht ausschalten: das Modul Verwaltung sowie Benutzer, Rollen,
  Einstellungen und Module & Funktionen – sonst würde man sich aussperren.
* **Daten bleiben beim Ausschalten erhalten.** Es wird nur der Zugriff gesperrt. Beim Wiedereinschalten ist alles da.

Wie das durchgesetzt wird, ohne dass jede Seite daran denken muss: Die Sitzung (`getSession`) filtert die Rechte einer
Person nach den **wirksamen** Funktionen. Ausgeschaltete Funktionen haben deshalb schlicht keine Rechte mehr:

* `requirePermission()` liefert für eine ausgeschaltete Funktion **404**, bei fehlendem Recht `/forbidden`,
* Navigation, Dashboard-Bausteine und Einstellungs-Reiter erscheinen nicht,
* Server Actions und API-Routen scheitern an derselben Rechteprüfung.

## Regeln für sauber getrennten Code

Diese Regeln prüft der Test `src/architecture.test.ts`; Verstöße lassen `npm test` fehlschlagen.

1. **Plattform kennt keine Fachlogik.** `src/server`, `src/components`, `src/i18n` und `src/lib` importieren nichts aus
   `src/modules/<modul>/<funktion>`. Ausnahmen sind nur `catalog`, `define`, `features`, `registry` und `types`.
2. **Funktionen sprechen nur über `public.ts` miteinander** – und nur, wenn die Abhängigkeit in der `feature.ts`
   deklariert ist: `requires` (zwingend; ohne die andere Funktion ist diese unbrauchbar) oder `uses` (optional; es
   geht auch ohne).
3. **Weiche Abhängigkeiten werden zur Laufzeit geprüft**, z. B. zeigt das Rechnungsformular die Kundenauswahl nur,
   wenn die Funktion Kunden aktiv ist (`session.features.has("workshop.customers")`).
4. **Jede Seite und jede Server Action prüft selbst** (`requirePermission` / `requireSession`). Navigation und
   `proxy.ts` sind Komfort, kein Schutz.
5. **Einstellungen gehören der Funktion.** Das Werkstatt-Profil (Name, Branding, Öffnungszeiten) ist Plattform;
   Kalender-Raster, Arbeitsplätze und Terminarten gehören zu *Termine*, die Reifen-Grenzwerte zu *Reifenlager*. Jede
   Funktion liefert ihren Reiter als `SettingsTabDef`.
6. **Texte gehören der Funktion** (`src/i18n/messages/modules/<funktion>.de.ts` / `.en.ts`). Globale Texte (`common`,
   `nav`, `enums`, Rechte-Beschriftungen) bleiben in `de.ts` / `en.ts`.
7. **Globale UI-Bausteine** (Buttons, Eingabefelder, Karten) liegen in `src/components/ui` und kennen keine
   Fachlogik.

## Container, Start und Updates

Ein Container, ein Volume (`/data`). Das Image ist **leer bis auf zwei Dinge**: den Starter und die eingebaute App-Version für
den ersten Start. Es enthält kein Betriebssystem, keine Shell, keinen Paketmanager – also nichts, was veralten könnte.
**Alles andere kommt mit den Web-Updates**, denn jede App-Version ist ein selbständiges, signiertes Paket:

| Bestandteil | Wo | Aktualisierung |
| --- | --- | --- |
| **Starter** (`docker/bootstrap.c`, statisch, ~150 Zeilen) | Image | praktisch nie (nur wenn sich sein Vertrag ändert: `docker/BASE_VERSION`) |
| **Launcher** (`src/launcher/main.ts`) | Paket | mit jedem Update |
| **Node** und **Systembibliotheken** (glibc, libstdc++, Namensauflösung, Lader) | Paket (`runtime/`) | mit jedem Update |
| **Anwendung** samt Abhängigkeiten, Migrationen, Handbuch | Paket | mit jedem Update |

Vom Host kommt nur der Kernel. Die Laufzeit wird über den mitgelieferten Lader gestartet
(`runtime/<lader> --library-path runtime/lib runtime/node …`).

* **Starter:** wählt das Verzeichnis der aktiven Version (Zeiger `<DATA_DIR>/app/active`, sonst die eingebaute Version unter
  `/app`) und startet dessen Launcher. Endet der Launcher mit Code 42, wählt er neu; stürzt der Launcher einer installierten
  Version zweimal kurz hintereinander ab, nimmt er für diesen Lauf die eingebaute Version und vermerkt das. Außerdem beantwortet
  er den Docker-Healthcheck (`/bootstrap --healthcheck`).
* **Launcher:** startet nur die App seiner eigenen Version, wendet vorgemerkte Datenbank-Wiederherstellungen an und macht
  Rückfälle: Startet eine frisch installierte Version nicht gesund, setzt er den Zeiger auf die Vorversion zurück und meldet
  Code 42; startet eine wiederhergestellte Datenbank nicht gesund, spielt er die vorherige zurück. Eine installierte Version
  verwirft sich selbst, wenn die eingebaute neuer ist (neues Image gezogen). Er kennt weder Datenbank-Schema noch Prisma.
* **Die App migriert sich selbst:** `src/instrumentation.ts` ruft beim Start `startApp()` auf: Sicherung vor Migrationen,
  Migrationen (`src/server/migrate.ts`, gleiche Tabelle `_prisma_migrations` wie die Prisma-CLI), Basisdaten, Zeitzone,
  Zeitplan der Backups. `/api/health` meldet erst „ok“, wenn das durch ist. Scheitert etwas, beendet sich der Prozess – der
  Launcher nimmt dann die frische Version bzw. Datenbank zurück.
* **Keine Fremdprogramme:** Archive (Backups, Pakete) bearbeitet die Node-Bibliothek `tar`; es gibt kein System-`tar`, keine
  Shell und keine Prisma-CLI im Container.
* Logik zu Versionswahl, Rückfall und Wiederherstellung: reine, getestete Funktionen in `src/lib/updates`; Backups in
  `src/server/backup`; die Oberflächen sind die Funktionen `admin.updates` und `admin.backup`.

## Datenhaltung

* **Eine Datenbank: SQLite** (WAL-Modus, `synchronous=FULL`, eine Datei unter `/data`). Reicht für eine Werkstatt mit einigen
  Dutzend Nutzern und viele Jahre Daten; Schreibvorgänge laufen nacheinander und dauern Millisekunden. Voraussetzung: lokale
  Platte. Grenzen: keine mehreren App-Instanzen, keine Hochverfügbarkeit.
* Keine Enums und keine Json-Felder – Zustände sind Strings mit festen Werten im Code (hält einen späteren Wechsel der
  Datenbank offen). Textsuche immer über `contains()` aus `src/server/search.ts` (SQLite unterscheidet bei Umlauten Groß- und
  Kleinschreibung: „MÜLLER“ findet „Müller“ nicht, „müller“ schon).
* **Geld** als ganze Cent (`Int`). **Dateien** (Rechnungsbelege, Doku-Bilder) liegen als normale Dateien unter
  `/data/files` (`src/server/files.ts`) mit lesbaren Pfaden, z. B. `rechnungen/2026/eingang/2026-03-14_Lieferant_RE-1234.pdf`;
  die Datenbank kennt nur den relativen Pfad (`InvoiceFile.path`, `DocImage.path`). Dateien werden nie überschrieben oder
  verändert (bei gleichem Namen kommt ein Zähler dazu, Umbenennen läuft über Hardlink) – deshalb genügen Hardlinks für Backups.
  Ausgeliefert werden sie nur über Route Handler mit Rechteprüfung.
* **Gleichzeitiges Bearbeiten:** Bearbeiten-Formulare tragen die Version der Zeile (`updatedAt`) mit; die Aktion „belegt“ die
  Zeile nur, wenn sie unverändert ist (`src/lib/concurrency.ts`), sonst meldet sie einen Konflikt statt still zu überschreiben.
  Prüfung und Speichern, die zusammengehören (z. B. Doppelbelegung eines Arbeitsplatzes), laufen in einer Transaktion.
* Sensible Mitarbeiterdaten (Notfallkontakt, Krankheit) nur mit dem Recht `employees.sensitive`.
* Einstellungen zur Laufzeit liegen in der Tabelle `AppSetting`; Geheimnisse verschlüsselt (Schlüsseldatei `/data/secret.key`,
  nicht Teil von Backups).

## Sicherheit in Kürze

* Anmeldung lokal mit gehashten Passwörtern, Sitzungstoken nur als Hash in der Datenbank, Sperre nach Fehlversuchen.
* Rechte sind fein granular und werden in Rollen gebündelt; Administrator-Rollen haben immer alle Rechte.
* Markdown wird ohne rohes HTML gerendert; Bilder und Belege werden nur über geschützte Route Handler ausgeliefert.
