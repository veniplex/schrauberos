import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/**
 * Outbox: Ereignisse für asynchrone Wirkungen (Webhooks, E-Mail, Benachrichtigungen). Die Schreib-API entsteht hier, der Runner, der sie
 * zustellt, folgt mit dem Job-Runner (P1b-0).
 *
 * Ereignisse schreibt nur der Aktions-Rahmen (`ctx.emit` in `src/server/operations`) – **in derselben Transaktion wie die Änderung**:
 * Ist die Transaktion zurückgerollt, gibt es kein Ereignis; ist sie festgeschrieben, gibt es genau eines. Der Runner sieht es daher
 * erst nach dem Commit. Synchrone Wirkungen in derselben Transaktion sind keine Ereignisse, sondern Hooks (`operation-hooks`).
 */

type Client = Pick<PrismaClient | Prisma.TransactionClient, "outboxEvent">;

export type OutboxEventInput = {
  /** z. B. "invoice.paid" */
  type: string;
  entityId?: string | null;
  /** Nutzdaten, JSON-tauglich; keine Geheimnisse und keine sensiblen Mitarbeiterdaten */
  payload?: Record<string, unknown>;
  actorId?: string | null;
};

/** Schreibt ein Ereignis (mit dem Client der laufenden Transaktion aufrufen). */
export async function writeOutboxEvent(client: Client, event: OutboxEventInput): Promise<string> {
  const row = await client.outboxEvent.create({
    data: {
      type: event.type.slice(0, 80),
      entityId: event.entityId ?? null,
      payload: JSON.stringify(event.payload ?? {}),
      actorId: event.actorId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** Noch nicht zugestellte Ereignisse, älteste zuerst (für den Runner). */
export async function pendingOutboxEvents(client: Client, now = new Date(), limit = 50) {
  return client.outboxEvent.findMany({ where: { processedAt: null, availableAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit });
}
