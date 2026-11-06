# Entwicklung

## Schnellstart

Voraussetzung: Node.js 22 oder neuer (getestet mit 24).

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run setup            # Prisma-Client, Datenbank, Seed (inkl. Demo-Daten)
npm run dev
```

Danach <http://localhost:3000>, Login `admin` / `admin` (beim ersten Login muss ein eigenes Passwort vergeben werden).
Demo-Daten entfallen mit `SEED_DEMO="false"` in der `.env`.

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run typecheck` | TypeScript prüfen |
| `npm run lint` | ESLint |
| `npm test` | Unit-Tests und Architektur-Test |
| `npm run build` | Produktions-Build |
| `npm run db:baseline` | Schema ableiten und die Baseline-Migrationen neu erzeugen |
| `npm run db:fresh` | lokale SQLite-Datenbank löschen, neu anlegen und seeden |
| `npm run db:studio` | Datenbank im Browser ansehen |

Vor jedem Abschluss: `npm run typecheck && npm run lint && npm test` – bei größeren Änderungen zusätzlich `npm run build`.

## Datenbank in der Entwicklungsphase

Solange nur Demodaten existieren, gibt es **keine Migrationshistorie**: je Datenbank (SQLite und PostgreSQL) genau
eine Baseline-Migration, die aus dem aktuellen Schema erzeugt wird. Nach einer Schema-Änderung:

```bash
npm run db:baseline    # leitet das Postgres-Schema ab und erzeugt beide Baselines neu
npm run db:fresh       # lokale Datenbank neu aufbauen und seeden
```

Bestehende Datenbanken (z. B. ein laufender Docker-Stack) müssen nach einer Schema-Änderung neu angelegt werden
(`docker compose down -v`). Sobald echte Daten existieren, wird auf normale Migrationen (`prisma migrate dev`)
umgestellt und diese Baseline als Ausgangspunkt eingefroren.

## Eine neue Funktion anlegen (Rezept)

Beispiel: Funktion `warranty` im Modul `workshop`.

1. **Ordner** `src/modules/workshop/warranty/` anlegen.
2. **`feature.ts`** mit `defineFeature({...})`: ID, Modul, Name/Beschreibung (Übersetzungsschlüssel), Reihenfolge,
   Abhängigkeiten (`requires` / `uses`), Rechte-Gruppe mit Schlüsseln (`warranty.view`, …), Navigationseinträge,
   Routen-Präfixe.
3. **In `src/modules/catalog.ts` eintragen** (Import und Eintrag in `FEATURES`). Ab jetzt kennt das System die Rechte,
   die Aktivierung, die Admin-Seite und den Katalog dieses Handbuchs.
4. **Texte** in `src/i18n/messages/modules/warranty.de.ts` und `.en.ts` (die englische Datei ist als
   `typeof warrantyDe` typisiert), dann in `de.ts` / `en.ts` einbinden. Enthalten sein muss `feature.name` und
   `feature.description`. Beschriftungen der Rechte kommen nach `permissionGroups.*` und `permissions.*`.
5. **Seiten** unter `src/app/(app)/(workshop)/warranty/`. **Jede Seite beginnt mit `await requirePermission("…")`,
   jede Server Action ebenfalls.**
6. **Optional:** Dashboard-Baustein (`widgets.tsx` mit `export const widgets: WidgetDef[]`) und Einstellungs-Reiter
   (`settings-tab.tsx` mit `export const settingsTabs: SettingsTabDef[]`) – beides in `src/modules/registry.ts`
   eintragen.
7. **Öffentliche Schnittstelle:** Soll eine andere Funktion etwas nutzen, exportiert `public.ts` genau das – und die
   andere Funktion deklariert die Abhängigkeit (`requires` / `uses`).
8. **Standardrollen:** Neue Rechte in `src/modules/default-roles.ts` den passenden Rollen zuordnen. Administratoren
   haben neue Rechte sofort. In der Entwicklungsphase wird die Datenbank ohnehin neu aufgebaut (`db:fresh`).
9. **Prüfen:** `npm run typecheck && npm run lint && npm test`. Der Architektur-Test meldet verbotene Importe und
   nicht deklarierte Abhängigkeiten.

## Konventionen

* **Next.js 16**: `middleware` heißt `proxy.ts`; `params`, `searchParams` und `cookies()` sind Promises. Die Doku liegt
  in `node_modules/next/dist/docs/`. `cacheComponents` ist bewusst aus (komplett eingeloggte, dynamische App).
* **Übersetzungen:** `de.ts` definiert die Struktur, `en.ts` muss identisch sein (sonst Typfehler). Dynamische
  Schlüssel (Enum-Werte) über `td(key, fallback)`, Plural über `<key>_one` / `<key>_other` und `tp()`.
* **Design:** nur Tokens aus `src/app/tokens.css` bzw. Tailwind-Utilities (`bg-surface`, `text-ink-muted`, …), keine
  Rohfarben in Komponenten. Hell/Dunkel über `light-dark()`.
* **React:** kein `useEffect` mit synchronem `setState`; kein `Date.now()` / `new Date()` direkt im
  Komponenten-Rumpf (Helfer aus `src/lib/dates.ts`).
* **Server-only Code** darf vom Seed-Skript nicht importiert werden; dafür gibt es `src/server/db-client.ts`.
* **Fahrzeuge** haben einen optionalen Halter – nie `vehicle.customer.x` ohne Prüfung; Anzeigenamen über
  `customerDisplayName()`.
* **Geld** immer als ganze Cent, Eingabe über `parseMoneyToCents`.

## Tests

Getestet wird die Fachlogik (`*.test.ts` neben dem Code, `node:test` via `tsx`), die Aktivierungslogik
(`catalog-logic.test.ts`), der Katalog selbst (`catalog.test.ts`: gültige Abhängigkeiten, eindeutige Rechte,
Übersetzungen vorhanden) und die Architekturregeln (`architecture.test.ts`).
