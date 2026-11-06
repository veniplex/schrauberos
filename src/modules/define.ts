import type { MessageKey } from "@/i18n/translate";

/**
 * Begriffe (siehe README.md, Abschnitt Architektur):
 *  - Plattform:  immer an, kennt keine Fachlogik (Login, Rechte-Engine, Layout, DB, i18n, UI-Kit).
 *  - Modul:      fachlicher Bereich (Werkstatt, Büro, IT, Verwaltung); als Ganzes ein-/ausschaltbar.
 *  - Funktion:   abgegrenzter Teil eines Moduls (Termine, Reifenlager, Rechnungen …); einzeln schaltbar.
 *  - Querschnittsfunktion: von mehreren Funktionen genutzter Baustein (z. B. Dokumentation) – in src/capabilities.
 */

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
  | "docs"
  | "handbook"
  | "modules"
  | "audit"
  | "updates"
  | "backup"
  | "help";

export type ModuleDef = {
  /** Kurze ID, z. B. "workshop" */
  id: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Reihenfolge in Navigation, Dashboard und Admin-Seite */
  order: number;
  /** Pflichtmodul: kann nicht ausgeschaltet werden (z. B. Verwaltung – sonst sperrt man sich aus) */
  required?: boolean;
};

export type NavDef = {
  id: string;
  href: string;
  labelKey: MessageKey;
  icon: IconName;
  /** Berechtigung, mit der der Eintrag sichtbar ist (muss zur Rechte-Gruppe der Funktion gehören) */
  permission: string;
  order: number;
};

export type FeatureDef = {
  /** ID innerhalb des Moduls, z. B. "tires". Vollständige ID: "<modul>.<id>" */
  id: string;
  module: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  order: number;
  /** Pflichtfunktion: kann nicht ausgeschaltet werden */
  required?: boolean;
  /** Harte Abhängigkeiten (vollständige IDs): ohne sie ist die Funktion nicht nutzbar und wird automatisch inaktiv. */
  requires?: readonly string[];
  /** Weiche Abhängigkeiten (vollständige IDs): optionale Verknüpfung, läuft auch ohne. */
  uses?: readonly string[];
  /**
   * Eigene Rechte-Gruppe. Schlüssel: "<gruppe>.<aktion>".
   * `adminOnly`: Rechte der Verwaltung (Benutzer, Rollen, Einstellungen, Backups …), die nur Administratoren vergeben dürfen –
   * ein Nicht-Admin kann sie weder Rollen hinzufügen noch Konten zuweisen (siehe `src/lib/rbac.ts`).
   */
  permissions: { group: string; keys: readonly string[]; adminOnly?: readonly string[] };
  nav: readonly NavDef[];
  /** URL-Präfixe (ohne führenden Slash), die zu dieser Funktion gehören, z. B. "appointments", "admin/users" */
  routes: readonly string[];
  /** Querschnittsfunktion Dokumentation: Bereichs-ID, unter der die Doku dieser Funktion läuft */
  docsArea?: string;
};

// `const`-Typparameter: Literale (IDs, Rechte-Schlüssel) bleiben als Typen erhalten → typsichere Permission-Union.
export function defineModule<const M extends ModuleDef>(module: M): M {
  return module;
}

export function defineFeature<const F extends FeatureDef>(feature: F): F {
  return feature;
}
