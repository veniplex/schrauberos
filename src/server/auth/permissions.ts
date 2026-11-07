import { ALL_PERMISSIONS, featureOfPermission } from "@/modules/catalog";

/**
 * **Wirksame Rechte eines Kontos** aus seinen Rollen und den aktiven Funktionen – die eine Stelle für Sitzung (`session.ts`), API-Token (`server/api/auth.ts`) und Kalender-Abo (`appointments/feed.ts`):
 * ein Administrator hat alle Rechte, alle anderen die Rechte ihrer Rollen; Rechte ausgeschalteter Funktionen fallen für alle weg (auch für Administratoren – das sperrt die Funktion überall). Wer eine
 * neue Sperre einführt (gesperrtes Konto, weitere Bedingung), ändert sie hier und der Test `permissions.test.ts` hält die drei Wege gleich.
 */
export type RoleGrant = { isAdmin: boolean; permissions: ReadonlyArray<{ permission: string }> };

export function grantedPermissions(roles: readonly RoleGrant[], features: ReadonlySet<string>): Set<string> {
  const granted: readonly string[] = roles.some((r) => r.isAdmin) ? ALL_PERMISSIONS : roles.flatMap((r) => r.permissions.map((p) => p.permission));
  return new Set(granted.filter((p) => features.has(featureOfPermission(p) ?? "")));
}

/** Haben die Rollen das Recht überhaupt – unabhängig davon, ob seine Funktion gerade aktiv ist? (Administratoren haben alle.) */
export function rolesGrant(roles: readonly RoleGrant[], permission: string): boolean {
  return roles.some((r) => r.isAdmin) || roles.some((r) => r.permissions.some((p) => p.permission === permission));
}
