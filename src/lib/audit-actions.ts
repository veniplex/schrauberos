import { FEATURES, type FeatureAuditAction } from "@/modules/catalog";

/**
 * Audit-Aktionen der **Plattform** (Anmeldung, Konto, Einrichtung, Geheimnisse, API-Tokens, Dokumentation als Querschnittsfunktion, Systemereignisse).
 * Alle übrigen Aktionen gehören einer Funktion und stehen in deren `feature.ts` (`auditActions`); der Katalog führt sie zusammen. Jede Aktion gehört genau einer
 * Stelle, braucht eine Beschriftung unter `audit.actions.<aktion>` und muss verwendet werden (`audit-actions.test.ts`, `catalog.test.ts`). Gruppe = Teil vor dem Punkt.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  "auth.login",
  "auth.loginFailed",
  "auth.loginThrottled",
  "auth.logout",
  "auth.recoveryCreated",
  "auth.recoveryUsed",
  "auth.recoveryFailed",
  "auth.secondFactorFailed",
  "auth.backupCodeUsed",
  "auth.twoFactorEnabled",
  "auth.twoFactorDisabled",
  "auth.twoFactorBackupCodes",
  "auth.twoFactorReset",
  "auth.sessionRevoked",
  "auth.logoutEverywhere",
  "auth.deviceRevoked",
  "account.password",
  "account.profile",
  "docs.create",
  "docs.update",
  "docs.restore",
  "docs.delete",
  "docs.categorySave",
  "docs.categoryDelete",
  "docs.imageUpload",
  "secrets.keyCreated",
  "secrets.keyConfirmed",
  "secrets.reset",
  "secrets.keyReconstructed",
  "secrets.resetForced",
  "apiToken.create",
  "apiToken.revoke",
  "apiToken.restoreRevoked",
  "setup.complete",
  "setup.restore",
  "system.integrityFailed",
  "system.auditPruned",
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];
export type AuditAction = PlatformAuditAction | FeatureAuditAction;

/** Audit-Aktionen der Funktionen, wie sie ihre `feature.ts` meldet (Aktion → Funktions-ID). */
export const FEATURE_AUDIT_ACTIONS: ReadonlyMap<string, string> = new Map(
  FEATURES.flatMap((f) => (("auditActions" in f ? f.auditActions : []) as readonly string[]).map((action) => [action, `${f.module}.${f.id}`] as const)),
);

/** Alle Aktionen: Plattform zuerst, dann die der Funktionen in Katalog-Reihenfolge. */
export const AUDIT_ACTIONS: readonly AuditAction[] = [...PLATFORM_AUDIT_ACTIONS, ...([...FEATURE_AUDIT_ACTIONS.keys()] as FeatureAuditAction[])];

export const AUDIT_GROUPS = [...new Set(AUDIT_ACTIONS.map((a) => a.split(".")[0]))];
