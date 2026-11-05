# SchrauberOS – Hinweise für Claude

Werkstatt-Dashboard (Next.js 16, App Router, Prisma 7, SQLite lokal / PostgreSQL in Docker). Sprache der UI und Doku: Deutsch (Standard) + Englisch.
Architektur, Befehle und das Rezept für neue Features stehen in `README.md` – bitte dort nachlesen statt hier zu duplizieren.

@AGENTS.md

## Regeln, die man nicht aus dem Code ablesen kann

* **Next.js ist hier nicht das, was du kennst** (siehe AGENTS.md): `middleware` heißt `proxy.ts`, `params`/`searchParams`/`cookies()` sind Promises. Doku liegt in `node_modules/next/dist/docs/`. `cacheComponents` ist bewusst **aus** (komplett eingeloggte, dynamische App).
* **Jede Seite und jede Server Action prüft selbst** (`requirePermission`/`requireSession`). `proxy.ts` und das Ausblenden in der Navigation sind nur Komfort, kein Schutz.
* **Ein Schema, zwei Datenbanken:** nur `prisma/schema.prisma` (SQLite) von Hand ändern; `prisma/postgres/schema.prisma` ist generiert (`npm run db:sync-pg`). Keine Enums/Json-Felder; Zustandswerte sind Strings aus `src/lib/domain/constants.ts`. Für Textsuche immer `contains()` aus `src/server/search.ts`.
* **Prisma-Migrationen kommen doppelt:** `prisma/migrations` (SQLite) und `prisma/postgres/migrations`. Nach `prisma migrate dev` gegen Postgres den Client wieder mit `npm run db:generate` für SQLite erzeugen.
* **Übersetzungen:** `src/i18n/messages/de.ts` definiert die Struktur, `en.ts` muss identisch sein (Typfehler sonst). Dynamische Schlüssel (Enum-Werte) über `td(key, fallback)`.
* **Design:** nur Tokens aus `src/app/tokens.css` / Tailwind-Utilities (`bg-surface`, `text-ink-muted`, …), keine Rohfarben in Komponenten. Hell/Dunkel über `light-dark()`.
* **Server-only Code** (`server-only`-Import) darf nicht vom Seed-Skript (`prisma/seed.ts`) importiert werden – dafür gibt es `src/server/db-client.ts`.
* Kein `useEffect` mit synchronem `setState` (ESLint `react-hooks/set-state-in-effect`), keine `Date.now()`/`new Date()` direkt im Komponenten-Body (`react-hooks/purity`) – in Helfer auslagern.

## Prüfen vor dem Abschluss

`npm run typecheck && npm run lint && npm test` – und bei größeren Änderungen `npm run build`.
