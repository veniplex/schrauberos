import "server-only";
import { db } from "@/server/db";
import { parseEvents } from "@/server/webhooks/deliver";
import { webhookHealth } from "@/server/webhooks/health";
import { hasWebhookSecret } from "@/server/webhooks/secrets";

/**
 * Lesen für die Webhook-Seiten (Recht `api.manage`): ausdrücklich ausgewählte Spalten, nie ein Geheimnis – nur ob eines vorhanden ist. Das Zustellprotokoll enthält weder Nutzlast noch Antworttext.
 */
export type WebhookRow = {
  id: string;
  name: string;
  url: string;
  host: string;
  events: string[];
  enabled: boolean;
  allowPrivate: boolean;
  disabledReason: string | null;
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
  pending: number;
  held: number;
  failed: number;
  /** Ereignisse, die verworfen wurden, weil die Warteschlange voll war (seit dem letzten Einschalten) */
  dropped: number;
  lastSentAt: Date | null;
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "–";
  }
};

export async function webhookRows(): Promise<WebhookRow[]> {
  const rows = await db.webhook.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const counts = await db.webhookDelivery.groupBy({ by: ["webhookId", "status"], _count: { _all: true } });
  const lastSent = await db.webhookDelivery.groupBy({ by: ["webhookId"], where: { status: "sent" }, _max: { completedAt: true } });
  return Promise.all(
    rows.map(async (row) => {
      const count = (status: string) => counts.find((c) => c.webhookId === row.id && c.status === status)?._count._all ?? 0;
      return {
        id: row.id,
        name: row.name,
        url: row.url,
        host: hostOf(row.url),
        events: parseEvents(row.events),
        enabled: row.enabled,
        allowPrivate: row.allowPrivate,
        disabledReason: row.disabledReason,
        hasSecret: await hasWebhookSecret(row.id),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        pending: count("pending"),
        held: count("held"),
        failed: count("failed"),
        dropped: row.droppedEvents,
        lastSentAt: lastSent.find((l) => l.webhookId === row.id)?._max.completedAt ?? null,
      };
    }),
  );
}

export type DeliveryRow = {
  id: string;
  webhookId: string;
  webhookName: string;
  eventId: string;
  type: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date;
  createdAt: Date;
};

export async function deliveryRows(options: { webhookId?: string; take?: number } = {}): Promise<DeliveryRow[]> {
  const rows = await db.webhookDelivery.findMany({
    where: options.webhookId ? { webhookId: options.webhookId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    select: {
      id: true,
      webhookId: true,
      eventId: true,
      type: true,
      status: true,
      attempts: true,
      lastStatus: true,
      lastError: true,
      lastDurationMs: true,
      lastAttemptAt: true,
      nextAttemptAt: true,
      createdAt: true,
      webhook: { select: { name: true } },
    },
  });
  return rows.map(({ webhook, ...row }) => ({ ...row, webhookName: webhook.name }));
}

/** Aufgegebene Zustellungen (Dead-Letter) insgesamt – ohne Test-Ereignisse und ohne die Unterdrückung nach Art. 18 (`suppressed`, keine Störung). */
export const deadLetterCount = async (): Promise<number> => (await webhookHealth()).deadLetters;
