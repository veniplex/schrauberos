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
