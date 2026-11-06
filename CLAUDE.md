# SchrauberOS – Hinweise für Claude

Werkstatt-Dashboard (Next.js 16, App Router, Prisma 7, SQLite lokal / PostgreSQL in Docker). Sprache der UI und Doku: Deutsch (Standard) + Englisch.
Architektur, Befehle und das Rezept für neue Features stehen in `README.md` – bitte dort nachlesen statt hier zu duplizieren.

@AGENTS.md

## Regeln, die man nicht aus dem Code ablesen kann

* **Next.js ist hier nicht das, was du kennst** (siehe AGENTS.md): `middleware` heißt `proxy.ts`, `params`/`searchParams`/`cookies()` sind Promises. Doku liegt in `node_modules/next/dist/docs/`. `cacheComponents` ist bewusst **aus** (komplett eingeloggte, dynamische App).
* **Jede Seite und jede Server Action prüft selbst** (`requirePermission`/`requireSession`). `proxy.ts` und das Ausblenden in der Navigation sind nur Komfort, kein Schutz.
* **Ein Schema, zwei Datenbanken:** nur `prisma/schema.prisma` (SQLite) von Hand ändern; `prisma/postgres/schema.prisma` ist generiert (`npm run db:sync-pg`). Keine Enums/Json-Felder; Zustandswerte sind Strings aus `src/lib/domain/constants.ts`. Für Textsuche immer `contains()` aus `src/server/search.ts`.
* **Datenbank in der Entwicklungsphase:** nur Demodaten, deshalb keine Migrationshistorie, keine Backups, keine Rückwärtskompatibilität. Je DB genau eine Baseline-Migration: nach Schema-Änderung `npm run db:baseline`, lokal `npm run db:fresh`; Docker-Stack mit `docker compose down -v` neu anlegen. Erst mit echten Daten auf normale Migrationen umstellen.
* **Übersetzungen:** `src/i18n/messages/de.ts` definiert die Struktur, `en.ts` muss identisch sein (Typfehler sonst). Größere Module haben eigene Dateien `messages/modules/<modul>.de.ts` / `.en.ts` (`en` ist als `typeof de` typisiert), die in de.ts/en.ts eingebunden werden. Dynamische Schlüssel (Enum-Werte) über `td(key, fallback)`; Plural über `<key>_one` / `<key>_other` und `tp()`.
* **Module und Funktionen** (Details: `docs/01-architektur.md`, in der App unter Verwaltung → Handbuch): `src/modules/<modul>/<funktion>/` mit `feature.ts` (`defineFeature`), eingetragen in `src/modules/catalog.ts`. Der Katalog erzeugt Rechte-Typen, Navigation, Aktivierung (Admin-Seite „Module & Funktionen“), Rollen-Maske und Handbuch-Katalog. Ausgeschaltete Funktion = keine Rechte in der Session = 404/ausgeblendet; Daten bleiben.
* **Funktionen reden nur über `public.ts` miteinander** und nur mit deklariertem `requires` (hart) bzw. `uses` (weich, zur Laufzeit mit `session.features.has(...)` prüfen). Plattform (`server`, `components`, `i18n`, `lib`, `platform`, `capabilities`) importiert keine Funktion. `src/architecture.test.ts` und `src/modules/catalog.test.ts` erzwingen das.
* **Einstellungen und Texte gehören der Funktion** (`settings-tab.tsx` → `settingsTabs`, `widgets.tsx` → `widgets`, beides in `src/modules/registry.ts` eingesammelt; Texte in `src/i18n/messages/modules/<funktion>.de.ts/.en.ts`). Standardrollen: `src/modules/default-roles.ts`.
* **Audit-Log:** mutierende Admin-/Lösch-Aktionen rufen `await audit("<aktion>", { target })` (`@/server/audit`); Aktionen stehen in `src/lib/audit-actions.ts` und brauchen Beschriftungen `audit.actions.*`.
* **Geld** immer als ganze Cent (`Int`), Eingabe über `parseMoneyToCents`. **Dateien/Bilder** (Rechnungsbelege, Doku-Bilder) liegen als `Bytes` in der DB; Binärdaten gehören in eigene Modelle (`InvoiceFile`, `DocImage`), damit Listen sie nie mitladen, und werden nur über Route Handler mit Rechteprüfung ausgeliefert.
* **Sensible Mitarbeiterdaten** (Notfallkontakt, Krankheit) nur mit `employees.sensitive` anzeigen/ändern; Krankheit wird sonst maskiert (`visibleAbsenceType`).
* **Fahrzeuge** (`Vehicle.customerId`) sind optional – Code darf nie `vehicle.customer.x` ohne Null-Prüfung nutzen; Anzeigenamen über `customerDisplayName()` (liefert „–“ bei null).
* **Design:** nur Tokens aus `src/app/tokens.css` / Tailwind-Utilities (`bg-surface`, `text-ink-muted`, …), keine Rohfarben in Komponenten. Hell/Dunkel über `light-dark()`.
* **Server-only Code** (`server-only`-Import) darf nicht vom Seed-Skript (`prisma/seed.ts`) importiert werden – dafür gibt es `src/server/db-client.ts`.
* Kein `useEffect` mit synchronem `setState` (ESLint `react-hooks/set-state-in-effect`), keine `Date.now()`/`new Date()` direkt im Komponenten-Body (`react-hooks/purity`) – in Helfer auslagern.

## Prüfen vor dem Abschluss

`npm run typecheck && npm run lint && npm test` – und bei größeren Änderungen `npm run build`.
