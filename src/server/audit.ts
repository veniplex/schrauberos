import "server-only";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import type { AuditAction } from "@/lib/audit-actions";

type Options = {
  /** Betroffenes Objekt in lesbarer Form (Benutzername, Kennzeichen, Rechnungsnummer …) */
  target?: string | null;
  entityId?: string | null;
  /** Nur nötig, wenn (noch) keine Sitzung besteht, z. B. bei der Anmeldung */
  actor?: { id: string | null; name: string };
};

/**
 * Schreibt einen Eintrag ins Audit-Log. Der Handelnde ist standardmäßig der angemeldete Benutzer.
 * Ein Fehler hier darf die eigentliche Aktion nie scheitern lassen.
 */
export async function audit(action: AuditAction, options: Options = {}): Promise<void> {
  try {
    const actor = options.actor ?? (await getSession().then((s) => (s ? { id: s.user.id, name: s.user.name } : null)));
    await db.auditLog.create({
      data: {
        action,
        actorId: actor?.id ?? null,
        actorName: actor?.name ?? "–",
        target: options.target ?? null,
        entityId: options.entityId ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] Eintrag konnte nicht geschrieben werden", error);
  }
}
