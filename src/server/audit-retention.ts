import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { getSetting } from "@/server/settings";

/**
 * Aufbewahrung des Audit-Logs: Einträge, die älter sind als die eingestellte Frist, werden vom Scheduler gelöscht (Datensparsamkeit).
 * Standard 2 Jahre; 0 = unbegrenzt aufbewahren. Eingestellt wird die Frist unter Einstellungen → Sicherheit.
 */
export const AUDIT_RETENTION_KEY = "audit.retentionDays";
export const AUDIT_RETENTION_DEFAULT_DAYS = 730;
export const AUDIT_RETENTION_MAX_DAYS = 3650;
const DAY_MS = 86_400_000;

/** Gespeicherter Wert → Tage (ungültig oder fehlend = Standard). */
export function parseRetentionDays(value: string | null): number {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 && n <= AUDIT_RETENTION_MAX_DAYS ? n : AUDIT_RETENTION_DEFAULT_DAYS;
}

export async function getAuditRetentionDays(): Promise<number> {
  return parseRetentionDays(await getSetting(AUDIT_RETENTION_KEY));
}

/** Löscht Einträge außerhalb der Aufbewahrungsfrist und hält das selbst im Audit-Log fest. Liefert die Anzahl gelöschter Einträge. */
export async function pruneAuditLog(now = new Date()): Promise<number> {
  const days = await getAuditRetentionDays();
  if (days === 0) return 0;
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  return db.$transaction(async (tx) => {
    const { count } = await tx.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) await writeAudit(tx, "system.auditPruned", { target: `${count} (> ${days} d)`, actor: { id: null, name: "System" } });
    return count;
  });
}
