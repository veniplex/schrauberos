import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n/translate";
import type { Area, Permission } from "./permissions";

export type IconName =
  | "dashboard"
  | "calendar"
  | "tires"
  | "customers"
  | "vehicles"
  | "users"
  | "roles"
  | "settings"
  | "network"
  | "server"
  | "ip"
  | "cabling"
  | "invoices"
  | "employees"
  | "absences"
  | "fleet"
  | "docs";

export type NavItem = {
  id: string;
  href: string;
  labelKey: MessageKey;
  icon: IconName;
  /** Ohne Angabe: für alle eingeloggten Benutzer sichtbar */
  permission?: Permission;
  /** Bereich der Navigation: Werkstatt, Büro, IT, Verwaltung */
  section: Area;
  order: number;
};

export type WidgetDef = {
  id: string;
  /** Widget wird nur Benutzern mit dieser Berechtigung angezeigt */
  permission: Permission;
  /** Bereich, unter dem das Widget auf der Übersicht erscheint */
  area: Exclude<Area, "admin">;
  /** Breite im Dashboard-Raster (1 = halb, 2 = voll) */
  span?: 1 | 2;
  order: number;
  /** Server Component (darf async sein und selbst Daten laden) */
  Component: () => ReactNode | Promise<ReactNode>;
};

/**
 * Ein Modul bündelt ein Feature: Navigation, Dashboard-Widgets und (in permissions.ts) Rechte.
 * Neues Feature = neuer Ordner in src/modules/<name>/ + Eintrag in registry.ts.
 */
export type ModuleManifest = {
  id: string;
  nav: NavItem[];
  widgets: WidgetDef[];
};
