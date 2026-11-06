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

## Datenhaltung

* **Ein Schema, zwei Datenbanken:** SQLite lokal, PostgreSQL in Docker. Nur `prisma/schema.prisma` wird von Hand
  geändert; das Postgres-Schema ist abgeleitet (`npm run db:sync-pg`).
* Keine Enums und keine Json-Felder – Zustände sind Strings mit festen Werten im Code. Textsuche immer über
  `contains()` aus `src/server/search.ts`.
* **Geld** als ganze Cent (`Int`), **Dateien** (Rechnungsbelege, Doku-Bilder) als `Bytes` in eigenen Modellen, damit
  Listen sie nie mitladen.
* Sensible Mitarbeiterdaten (Notfallkontakt, Krankheit) nur mit dem Recht `employees.sensitive`.

## Sicherheit in Kürze

* Anmeldung lokal mit gehashten Passwörtern, Sitzungstoken nur als Hash in der Datenbank, Sperre nach Fehlversuchen.
* Rechte sind fein granular und werden in Rollen gebündelt; Administrator-Rollen haben immer alle Rechte.
* Markdown wird ohne rohes HTML gerendert; Bilder und Belege werden nur über geschützte Route Handler ausgeliefert.
