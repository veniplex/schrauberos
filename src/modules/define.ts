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
  | "system"
  | "help";

export type ModuleDef = {
  /** Kurze ID, z. B. "workshop" */
  id: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Reihenfolge in Navigation, Dashboard und Admin-Seite */
  order: number;
  /** Standard ohne gespeicherten Schalter: true (Vorgabe, Bestand) oder false (neues Modul, wird erst eingeschaltet) */
  defaultEnabled?: boolean;
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

/**
 * Eintrag im globalen „Neu“-Menü: eine Funktion meldet hier ihre Anlegen-Aktionen an („Neuer Kunde“, „Neuer Termin“ …). Die Plattform kennt keine Funktion – sie sammelt nur die
 * Einträge der **aktiven** Funktionen ein, für die die Person das Recht hat (`quickActionsFor` in `registry.ts`).
 */
export type QuickActionDef = {
  id: string;
  labelKey: MessageKey;
  href: string;
  icon: IconName;
  /** Recht, mit dem der Eintrag erscheint (muss zur Rechte-Gruppe der Funktion gehören) */
  permission: string;
  order: number;
};

/**
 * Kennzeichnung von Rechten, die nie automatisch in einer Standardrolle landen (Regel 9): sensible Daten, Export/Import, Versand, Anzeigen von Geheimnissen, Zugriff über die API.
 * Die Markierung steht im Katalog (`permissions.marked` der `feature.ts`), nicht im Namen; `catalog.test.ts` prüft sie gegen `DEFAULT_ROLES`. Wer sie vergeben will, tut das bewusst in der Rollenmaske.
 */
export const PERMISSION_MARKS = ["sensitive", "export", "import", "send", "reveal", "api"] as const;
export type PermissionMark = (typeof PERMISSION_MARKS)[number];

export type FeatureDef = {
  /** ID innerhalb des Moduls, z. B. "tires". Vollständige ID: "<modul>.<id>" */
  id: string;
  module: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  order: number;
  /** Pflichtfunktion: kann nicht ausgeschaltet werden */
  required?: boolean;
  /**
   * Standard ohne gespeicherten Schalter: true (Vorgabe – gilt für den Bestand: Termine, Kunden, Fahrzeuge, Reifen, Rechnungsarchiv,
   * Mitarbeiter, Handbuch) oder false (neue Funktionen: aus, bis ein Administrator sie auf der Seite „Module & Funktionen“ oder per
   * Einrichtungs-Preset einschaltet). Pflichtfunktionen sind immer an. Daten bleiben beim Ausschalten erhalten.
   */
  defaultEnabled?: boolean;
  /** Harte Abhängigkeiten (vollständige IDs): ohne sie ist die Funktion nicht nutzbar und wird automatisch inaktiv. */
  requires?: readonly string[];
  /** Weiche Abhängigkeiten (vollständige IDs): optionale Verknüpfung, läuft auch ohne. */
  uses?: readonly string[];
  /**
   * Eigene Rechte-Gruppe. Schlüssel: "<gruppe>.<aktion>".
   * `adminOnly`: Rechte der Verwaltung (Benutzer, Rollen, Einstellungen, Backups …), die nur Administratoren vergeben dürfen –
   * ein Nicht-Admin kann sie weder Rollen hinzufügen noch Konten zuweisen (siehe `src/lib/rbac.ts`).
   */
  permissions: { group: string; keys: readonly string[]; adminOnly?: readonly string[]; marked?: Readonly<Partial<Record<PermissionMark, readonly string[]>>> };
  nav: readonly NavDef[];
  /** Anlegen-Aktionen für das globale „Neu“-Menü (optional). Die Schnellsuche kommt von `search.ts` der Funktion (`searchProviders`, siehe `registry.ts`). */
  quickActions?: readonly QuickActionDef[];
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
