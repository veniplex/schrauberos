import type { ReactNode } from "react";
import type { PrismaClient } from "@/generated/prisma/client";
import type { MessageKey } from "@/i18n/translate";
import type { AppSession } from "@/server/auth/session";
import type { FeatureId, Permission } from "./catalog";

type ServerComponent = () => ReactNode | Promise<ReactNode>;

/**
 * Betrachter einer Abfrage (`queries.ts` der Funktionen): die Sitzung oder das Prinzipal einer Operation. Eine Abfrage liest sensible Spalten nur, wenn `can(...)` es erlaubt –
 * sie werden gar nicht erst aus der Datenbank geholt (README, „Datenzugriff“).
 */
export type Viewer = Pick<AppSession, "can">;

/** Dashboard-Baustein einer Funktion. Erscheint nur, wenn die Funktion aktiv ist und das Recht vorliegt. */
export type WidgetDef = {
  id: string;
  feature: FeatureId;
  permission: Permission;
  /** Breite im Dashboard-Raster (1 = halb, 2 = voll) */
  span?: 1 | 2;
  order: number;
  /** Server Component (darf async sein und selbst Daten laden) */
  Component: ServerComponent;
};

/**
 * Hilfe-Thema einer Funktion: eine Markdown-Datei unter `docs/` (ohne `.md`, z. B. "workshop/tires").
 * Erscheint in der Hilfe unter dem Modul der Funktion – nur, wenn die Funktion aktiv ist und das Recht vorliegt.
 */
export type HelpTopicDef = {
  /** Adresse in der Hilfe (`/help/<id>`), eindeutig; üblich: die Funktions-ID, bei mehreren Themen mit Zusatz */
  id: string;
  feature: FeatureId;
  /** Wer die Funktion nutzen darf, bekommt auch ihre Hilfe (Recht muss zur Funktion gehören) */
  permission: Permission;
  doc: string;
};

/** Ein Treffer der Schnellsuche. `href` ist die Seite, auf der der Treffer geöffnet wird. */
export type SearchHit = { id: string; title: string; subtitle?: string; href: string };

/**
 * Suchanbieter einer Funktion für die Schnellsuche (`search.ts` der Funktion, eingesammelt in `registry.ts`). Erscheint nur, wenn die Funktion aktiv ist und das Recht vorliegt –
 * wie ein Widget. Die Plattform (Suchfeld, `/api/search`) aggregiert nur und kennt keine Funktion. Textsuche immer über `contains()` aus `src/server/search.ts`; was der Anbieter
 * liefert, muss auch die Seite hinter dem Link zeigen dürfen (Rechte und Sichtbarkeit selbst beachten, z. B. Kapitel der Dokumentation).
 */
export type SearchProviderDef = {
  id: string;
  feature: FeatureId;
  permission: Permission;
  /** Überschrift der Treffergruppe */
  groupKey: MessageKey;
  order: number;
  search: (query: string, context: { session: AppSession; limit: number }) => Promise<SearchHit[]>;
};

/** Reiter auf der Einstellungsseite: jede Funktion bringt ihre eigenen Einstellungen selbst mit. */
export type SettingsTabDef = {
  id: string;
  feature: FeatureId;
  labelKey: MessageKey;
  permission: Permission;
  order: number;
  Component: ServerComponent;
};

/** Wert eines Routen-Parameters in der Browser-CI: fester Wert oder die erste Zeile einer Tabelle des Demo-Seeds. */
export type PageParam = { value: string } | { table: string; column?: string; where?: string };

/** Art der Seite (steuert, was die Browser-CI erwartet und welche Rolle sie sehen darf). */
export type PageKind = "list" | "detail" | "new" | "edit" | "modal" | "print" | "other";

/**
 * Eine Seite einer Funktion für die Browser-CI (Routen-Inventur). Jede Funktion bringt eine `pages.ts` mit Liste, Detail, Neu,
 * Bearbeiten, Dialogen und Druckansichten; eingesammelt in `src/modules/pages.ts`. Der Test `pages.test.ts` schlägt fehl, wenn eine Funktion
 * keine Seiten meldet, eine Route nicht existiert oder eine Seite keiner Funktion gehört.
 */
export type PageDef = {
  feature: FeatureId;
  /** Route wie im App-Verzeichnis, ohne Routengruppen, z. B. "/customers/[id]/edit" */
  path: string;
  kind: PageKind;
  /** Recht, ohne das die Seite nicht zugänglich ist (Weiterleitung auf „Kein Zugriff“, `/forbidden`; bei ausgeschalteter Funktion 404) – muss dem `requirePermission` der Seite entsprechen */
  permission: Permission;
  /** Werte der Platzhalter in `path` (Seed-Verweise) */
  params?: Record<string, PageParam>;
  /** Suchparameter inkl. "?", z. B. "?new=1" (Dialoge, Ansichten) */
  query?: string;
  /** Schlüsselseite: bekommt Baseline-Screenshots */
  key?: boolean;
};

export function definePages(feature: FeatureId, pages: ReadonlyArray<Omit<PageDef, "feature">>): PageDef[] {
  return pages.map((page) => ({ ...page, feature }));
}

/**
 * Start- und Beispieldaten einer Funktion (`seed.ts` der Funktion, eingesammelt in `src/modules/seed.ts`). Die Plattform (`src/server/seed`) kennt keine Funktion – sie führt die
 * Beiträge nur der Reihe nach (`order`) aus.
 *  - `base`: Grunddaten einer **frischen** Installation (Einstellungszeile, Standardwerte wie Arbeitsplätze); läuft bei jedem Start, aber nur bei leerer Datenbank.
 *  - `demo`: Beispieldaten zum Ausprobieren (Einrichtung auf Wunsch, Entwicklung, Browser-CI). Jeder Beitrag prüft selbst, ob seine Tabelle schon Daten hat, und findet Daten
 *    anderer Funktionen über natürliche Schlüssel (Kennzeichen, Nachname) statt über Ids – fehlen sie, entsteht der Datensatz ohne Verknüpfung oder gar nicht.
 * Der Demo-Seed muss jede Seite der Routen-Inventur (`pages.ts`) abdecken (Test in `seed.test.ts`). Seeds importieren nichts mit `server-only` (das Seed-Skript lädt sie).
 */
export type SeedDef = {
  id: string;
  feature: FeatureId;
  /** Reihenfolge der Ausführung (Kunden vor Fahrzeugen vor Reifen und Terminen …) */
  order: number;
  base?: (db: PrismaClient) => Promise<void>;
  demo?: (db: PrismaClient) => Promise<void>;
};
