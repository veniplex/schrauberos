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

/** Reiter auf der Einstellungsseite: jede Funktion bringt ihre eigenen Einstellungen selbst mit. */
export type SettingsTabDef = {
  id: string;
  feature: FeatureId;
  labelKey: MessageKey;
  permission: Permission;
  order: number;
  Component: ServerComponent;
};
