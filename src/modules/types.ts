import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import type { FeatureId, Permission } from "./catalog";

type ServerComponent = () => ReactNode | Promise<ReactNode>;

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
  /** Recht, ohne das die Seite 404 liefert (muss dem `requirePermission` der Seite entsprechen) */
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
