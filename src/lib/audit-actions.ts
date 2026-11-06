/**
 * Alle Aktionen, die im Audit-Log festgehalten werden. Für jede muss es eine Beschriftung unter
 * `audit.actions.<aktion>` geben (prüft catalog.test.ts). Gruppe = Teil vor dem Punkt.
 */
export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.loginFailed",
  "auth.loginThrottled",
  "auth.logout",
  "account.password",
  "account.profile",
  "user.create",
  "user.update",
  "user.delete",
  "user.unlock",
  "role.create",
  "role.update",
  "role.delete",
  "module.enable",
  "module.disable",
  "settings.workshop",
  "settings.appointments",
  "settings.tires",
  "settings.security",
  "appointment.delete",
  "customer.delete",
  "vehicle.delete",
  "vehicle.transfer",
  "tires.delete",
  "invoice.delete",
  "employee.delete",
  "fleet.delete",
  "network.delete",
  "docs.delete",
  "docs.categoryDelete",
  "backup.create",
  "backup.delete",
  "backup.download",
  "backup.restore",
  "backup.upload",
  "setup.complete",
  "system.update",
  "system.updateFailed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_GROUPS = [...new Set(AUDIT_ACTIONS.map((a) => a.split(".")[0]))];
