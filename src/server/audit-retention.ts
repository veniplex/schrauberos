import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { getSetting } from "@/server/settings";

/**
 * Aufbewahrung des Audit-Logs: Einträge, die älter sind als die eingestellte Frist, werden vom Scheduler gelöscht (Datensparsamkeit).
 * Standard 2 Jahre; 0 = unbegrenzt aufbewahren. Eingestellt wird die Frist unter Einstellungen → Sicherheit. **Mindestens 30 Tage** (ZP2-S-F05): Das Audit-Log ist der Nachweis,
 * wer was getan hat – wer sich Rechte erschlichen hat, könnte sonst die Spuren mit einer Frist von einem Tag am nächsten Morgen tilgen lassen.
 */
export const AUDIT_RETENTION_KEY = "audit.retentionDays";
export const AUDIT_RETENTION_DEFAULT_DAYS = 730;
export const AUDIT_RETENTION_MAX_DAYS = 3650;
/** Kürzeste erlaubte Frist (außer 0 = unbegrenzt). */
export const AUDIT_RETENTION_MIN_DAYS = 30;
const DAY_MS = 86_400_000;

/** Gespeicherter Wert → Tage (ungültig oder fehlend = Standard; ein zu kurzer Altwert gilt als Mindestfrist). */
export function parseRetentionDays(value: string | null): number {
  const n = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0 || n > AUDIT_RETENTION_MAX_DAYS) return AUDIT_RETENTION_DEFAULT_DAYS;
  return n === 0 ? 0 : Math.max(n, AUDIT_RETENTION_MIN_DAYS);
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
