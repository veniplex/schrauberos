import { deliverDue, fanOutEvent, hasDueDeliveries, pruneWebhookDeliveries } from "@/server/webhooks/deliver";
import { WEBHOOK_EVENTS } from "@/modules/catalog";
import type { JobDef, OutboxHandlerDef } from "@/server/jobs/types";

/**
 * Webhooks über die Outbox und den Job-Runner:
 *  - **Abnehmer `webhooks.fanout`:** legt je Ereignis des Katalogs (`webhookEvents` der Funktionen) und abonniertem Ziel eine Zustellung an (schnell, nur Datenbank; idempotent über die Ereignis-ID).
 *    Ereignisse, die kein Funktionsbeitrag im Katalog nennt (z. B. `mail.send`), erreichen Webhooks nie.
 *  - **Job `webhooks.deliver`** (alle 15 s, billige Vorabprüfung): stellt fällige Zustellungen zu, mit Wiederholung und Wartezeiten (`lib/webhooks/schedule.ts`).
 *  - **Job `webhooks.prune`** (nachts): Zustellprotokoll 30 Tage, zurückgestellte Zustellungen 14 Tage.
 */
export const outboxHandlers: OutboxHandlerDef[] = [
  {
    id: "webhooks.fanout",
    feature: "admin.api",
    types: [...new Set(WEBHOOK_EVENTS.map((event) => event.type))],
    handle: async (message) => {
      await fanOutEvent(message);
    },
  },
];

export const jobs: JobDef[] = [
  {
    id: "webhooks.deliver",
    feature: "admin.api",
    schedule: { every: 15_000 },
    retry: { baseDelayMs: 15_000, maxDelayMs: 5 * 60_000 },
    timeoutMs: 5 * 60_000,
    shouldRun: ({ now }) => hasDueDeliveries(now),
    run: async ({ now, signal }) => {
      const s = await deliverDue({ now, signal });
      const parts = [s.sent && `${s.sent} zugestellt`, s.retried && `${s.retried} wiederholt`, s.failed && `${s.failed} aufgegeben`, s.gone && `${s.gone} Ziel meldet 410`].filter(Boolean);
      return parts.length ? parts.join(", ") : undefined;
    },
  },
  {
    id: "webhooks.prune",
    feature: "admin.api",
    schedule: { cron: "45 3 * * *" },
    run: async ({ now }) => {
      const removed = await pruneWebhookDeliveries(now);
      return removed > 0 ? `${removed} gelöscht` : undefined;
    },
  },
];
