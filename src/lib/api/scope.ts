import { FEATURES, MARKED_PERMISSIONS, MODULES, featureOfPermission, fullFeatureId, isAdminOnly, isPermission } from "@/modules/catalog";
import type { Actor } from "@/lib/rbac";

/**
 * Wirksame Rechte eines API-Tokens (reine Logik, getestet).
 *
 *  - **Nie** in einem Token: Rechte der Verwaltung (`adminOnly`), alle Rechte der Plattform-/Verwaltungsfunktionen (Pflichtfunktionen: Benutzer,
 *    Rollen, Einstellungen, Module, Backups, Updates, Audit, später API selbst) die ausdrücklich gesperrten Rechte (`API_NEVER`) und die gekennzeichneten Rechte des Datenaustauschs (Export/Import).
 *    Das gilt auch, wenn ein Administrator das Token erzeugt.
 *  - Beim Erzeugen: Der Scope darf höchstens die Rechte enthalten, die der Erzeuger selbst hat (Rechte-Hierarchie).
 *  - Bei **jeder Anfrage**: wirksam = Scope ∩ aktuelle Rechte des Besitzers (ohne gesperrte Rechte). Verliert der Besitzer ein Recht, verliert es
 *    das Token sofort.
 */

/**
 * Rechte, die kein Token tragen darf, obwohl sie nicht `adminOnly` sind: sensible Mitarbeiterdaten (Notfallkontakt, Krankheit) und die Arbeitszeiten **aller** Mitarbeiter ansehen bzw. nachtragen/korrigieren
 * (`time.viewAll`, `time.correctAll`: personenbezogen, Anwesenheit). Ein Token liest und schreibt über die Zeiterfassung nur die Zeiten seines Besitzers. Dazu die Rechte, die nur eine Person in der Oberfläche ausübt (siehe unten).
 */
export const API_NEVER: ReadonlySet<string> = new Set([
  "employees.sensitive",
  "time.viewAll",
  "time.correctAll",
  // Datenschutzvorgänge (Einschränken, Anonymisieren) und das Wiederöffnen abgeschlossener Aufträge/Checklisten sind bewusste Handlungen einer Person in der Oberfläche – ein Token trägt sie nie
  // (es gibt dafür keine Endpunkte, `api-exceptions.ts`; das Recht in einem Token wäre nur eine offene Tür, falls je ein Endpunkt hinzukäme)
  "customers.privacy",
  "orders.reopen",
  "checklists.reopen",
  // Überwachungsziele lassen den Server Verbindungen ins eigene Netz aufbauen: mit einem Token wäre das ein Werkzeug zum Abtasten des Netzes. Die API liest nur den gemessenen Status (network.view).
  "network.monitor",
  // IT-Tresor: Zugangsdaten verlassen den Server nur in der Antwort einer Aktion mit Sitzung und erneuter Passwortabfrage – nie über ein Token (es gibt keinen Endpunkt, und das Recht darf in keinem stehen)
  "docsIt.vault",
  "docsIt.vaultManage",
]);

/** Rechte der Plattform-/Verwaltungsfunktionen (Pflichtfunktionen oder Funktionen eines Pflichtmoduls). */
const PLATFORM_PERMISSIONS: ReadonlySet<string> = new Set(
  FEATURES.filter((f) => ("required" in f && f.required) || MODULES.some((m) => m.id === f.module && "required" in m && m.required)).flatMap((f) => [...f.permissions.keys]),
);

/** Gekennzeichnete Rechte des Datenaustauschs (CSV-Export/-Import): sie gelten nur für Sitzungen, nie für ein Token (Regel 9; die API hat dafür keine Endpunkte). */
const isExchangePermission = (permission: string): boolean => {
  const mark = MARKED_PERMISSIONS.get(permission);
  return mark === "export" || mark === "import";
};

/** Darf dieses Recht nie in einem Token stehen? */
export const isApiForbidden = (permission: string): boolean => isAdminOnly(permission) || PLATFORM_PERMISSIONS.has(permission) || API_NEVER.has(permission) || isExchangePermission(permission);

/** Ist die Funktion Plattform/Verwaltung (nie API-Ressource)? */
export const isPlatformFeature = (featureId: string): boolean =>
  FEATURES.some((f) => fullFeatureId(f) === featureId && (("required" in f && f.required) || MODULES.some((m) => m.id === f.module && "required" in m && m.required)));

/** Alle Rechte, die ein Token tragen kann (Auswahl bei der Erzeugung). */
export const grantablePermissions = (): string[] => FEATURES.flatMap((f) => [...f.permissions.keys]).filter((p) => !isApiForbidden(p));

export type ScopeDenial = "empty" | "unknown" | "forbidden" | "notSubset";

/** Darf der Erzeuger (mit seinen Rohrechten) diesen Scope vergeben? */
export function checkTokenScope(actor: Pick<Actor, "rights">, scope: readonly string[]): ScopeDenial | null {
  if (scope.length === 0) return "empty";
  if (scope.some((p) => !isPermission(p))) return "unknown";
  if (scope.some(isApiForbidden)) return "forbidden";
  return scope.every((p) => actor.rights.has(p)) ? null : "notSubset";
}

/**
 * Wirksame Rechte einer Anfrage: Scope ∩ aktuelle Rechte des Besitzers (die bereits auf aktive Funktionen eingeschränkt sind), ohne gesperrte Rechte.
 */
export function effectivePermissions(scope: Iterable<string>, ownerPermissions: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const p of scope) if (ownerPermissions.has(p) && !isApiForbidden(p) && featureOfPermission(p)) out.add(p);
  return out;
}
