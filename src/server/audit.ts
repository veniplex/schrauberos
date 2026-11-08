import "server-only";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuditAction } from "@/lib/audit-actions";
import { logError, stripControl } from "@/lib/log-safe";

type Options = {
  /** Betroffenes Objekt in lesbarer Form (Benutzername, Kennzeichen, Rechnungsnummer …) */
  target?: string | null;
  entityId?: string | null;
  /** Nur nötig, wenn (noch) keine Sitzung besteht, z. B. bei der Anmeldung */
  actor?: { id: string | null; name: string };
  /** Höchstlänge des Ziels (Standard 200 Zeichen); nur für Einträge mit einer Differenz (Rechte einer Rolle), die mehr braucht */
  targetMax?: number;
};

type Client = Pick<PrismaClient | Prisma.TransactionClient, "auditLog">;

const clean = (value: string | null | undefined, max: number) => (value ? stripControl(value, max) : null);

/**
 * Schreibt einen Audit-Eintrag mit dem übergebenen Client – in einer Transaktion gemeinsam mit der Änderung (der Aktions-Rahmen
 * macht das so: keine Änderung ohne Eintrag). Bezeichnungen werden von Steuerzeichen befreit (Log-Injection) und gekürzt.
 */
export async function writeAudit(client: Client, action: AuditAction, options: Omit<Options, "actor"> & { actor: { id: string | null; name: string } }): Promise<void> {
  await client.auditLog.create({
    data: {
      action,
      actorId: options.actor.id,
      actorName: clean(options.actor.name, 120) ?? "–",
      target: clean(options.target, options.targetMax ?? 200),
      entityId: clean(options.entityId, 60),
    },
  });
}

/**
 * Schreibt einen Eintrag ins Audit-Log. Der Handelnde ist standardmäßig der angemeldete Benutzer.
 * Ein Fehler hier darf die eigentliche Aktion nie scheitern lassen (für Aktionen im Rahmen siehe `writeAudit`).
 */
export async function audit(action: AuditAction, options: Options = {}): Promise<void> {
  try {
    const actor = options.actor ?? (await getSession().then((s) => (s ? { id: s.user.id, name: s.user.name } : null))) ?? { id: null, name: "–" };
    await writeAudit(db, action, { target: options.target, entityId: options.entityId, actor });
  } catch (error) {
    logError("audit", error);
  }
}
