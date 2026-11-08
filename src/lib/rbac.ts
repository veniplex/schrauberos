import { ADMIN_IMPLIED_PERMISSIONS, isAdminOnly } from "@/modules/catalog";

/**
 * Rechte-Hierarchie (reine Logik, getestet): Wer Benutzer oder Rollen verwaltet, darf damit nie mehr Rechte erzeugen, als er selbst
 * hat. Verglichen werden **Rohrechte** – die Rechte laut Rollen, ungefiltert nach der Aktivierung von Funktionen. So versteckt eine
 * ausgeschaltete Funktion nichts: Schaltet man sie später ein, bleibt die Rechnung dieselbe.
 *
 *  - Ein Nicht-Admin ändert nur Konten, deren Rohrechte eine Teilmenge der eigenen sind, nie ein Administrator-Konto.
 *  - Er vergibt (und entzieht) nur Rollen, die er vollständig besitzt und die keine adminOnly-Rechte (Verwaltung) enthalten.
 *  - Er ändert Rollen nur um Rechte, die er selbst hat und die nicht adminOnly sind (Differenz alt/neu), nie die eigene Rolle,
 *    nie eine Administrator-Rolle und nie eine Rolle, die bereits adminOnly-Rechte enthält.
 *  - Administratoren dürfen alles (außer den Schutzregeln für den letzten Administrator, die die Aktionen selbst prüfen).
 */

export type RoleRights = { id?: string; isAdmin: boolean; permissions: readonly string[] };

export type Actor = { userId: string; isAdmin: boolean; rights: ReadonlySet<string>; roleIds: ReadonlySet<string> };

/** Warum eine Änderung abgelehnt wurde (Schlüssel unter `rbac.denied.*`). */
export const DENIALS = ["adminRole", "adminOnly", "notSubset", "ownRole"] as const;
export type Denial = (typeof DENIALS)[number];
export const isDenial = (value: unknown): value is Denial => (DENIALS as readonly unknown[]).includes(value);

/**
 * Rohrechte einer Rollenmenge: eine Administrator-Rolle bedeutet alle Rechte des Katalogs **außer den ausdrücklich zu vergebenden** (`explicitOnly`, z. B. IT-Tresor); die Rechte, die eine Rolle ausdrücklich
 * enthält, kommen immer dazu.
 */
export function rawRights(roles: readonly RoleRights[]): Set<string> {
  return new Set([...(roles.some((r) => r.isAdmin) ? ADMIN_IMPLIED_PERMISSIONS : []), ...roles.flatMap((r) => r.permissions)]);
}

export function actorOf(userId: string, roles: readonly (RoleRights & { id: string })[]): Actor {
  return { userId, isAdmin: roles.some((r) => r.isAdmin), rights: rawRights(roles), roleIds: new Set(roles.map((r) => r.id)) };
}

const isSubset = (part: Iterable<string>, whole: ReadonlySet<string>) => [...part].every((p) => whole.has(p));

/** Darf der Aufrufer das Konto mit diesen Rollen ändern oder löschen (Passwort, E-Mail, aktiv, Rollen)? */
export function checkManageUser(actor: Actor, targetRoles: readonly RoleRights[]): Denial | null {
  if (actor.isAdmin) return null;
  if (targetRoles.some((r) => r.isAdmin)) return "adminRole";
  return isSubset(rawRights(targetRoles), actor.rights) ? null : "notSubset";
}

/** Darf der Aufrufer diese Rolle einem Konto geben oder entziehen? */
export function checkGrantRole(actor: Actor, role: RoleRights): Denial | null {
  if (actor.isAdmin) return null;
  if (role.isAdmin) return "adminRole";
  if (role.permissions.some(isAdminOnly)) return "adminOnly";
  return isSubset(role.permissions, actor.rights) ? null : "notSubset";
}

/**
 * Darf der Aufrufer die Rechte der Rolle von `role.permissions` auf `next` ändern (`role` = null: neue Rolle)?
 * Geprüft wird die Differenz; bestehende Rechte, die der Aufrufer nicht hat, dürfen unverändert bleiben.
 */
export function checkRoleChange(actor: Actor, role: (RoleRights & { id: string }) | null, next: readonly string[]): Denial | null {
  if (actor.isAdmin) return null;
  if (role) {
    if (role.isAdmin) return "adminRole";
    if (actor.roleIds.has(role.id)) return "ownRole";
    if (role.permissions.some(isAdminOnly)) return "adminOnly";
  }
  const current = new Set(role?.permissions ?? []);
  const wanted = new Set(next);
  const changed = [...wanted].filter((p) => !current.has(p)).concat([...current].filter((p) => !wanted.has(p)));
  if (changed.some(isAdminOnly)) return "adminOnly";
  return isSubset(changed, actor.rights) ? null : "notSubset";
}

/** Darf der Aufrufer die Rolle löschen? (Benutzer verlieren damit deren Rechte.) */
export function checkRoleDelete(actor: Actor, role: RoleRights & { id: string }): Denial | null {
  if (actor.isAdmin) return null;
  if (actor.roleIds.has(role.id)) return "ownRole";
  return checkGrantRole(actor, role);
}

/** Rechte, die der Aufrufer in der Rollenmaske nicht anfassen darf (adminOnly oder nicht selbst vorhanden). */
export function lockedPermissions(actor: Actor, allPermissions: readonly string[]): string[] {
  return actor.isAdmin ? [] : allPermissions.filter((p) => isAdminOnly(p) || !actor.rights.has(p));
}

/** Hat ein Nicht-Admin-Konto (mit diesen Rollen) Rechte der Verwaltung? Für die Warnung in Benutzer- und Rollenliste. */
export function hasAdminOnlyRights(roles: readonly RoleRights[]): boolean {
  return !roles.some((r) => r.isAdmin) && roles.some((r) => r.permissions.some(isAdminOnly));
}
