import "server-only";
import { logError } from "@/lib/log-safe";
import { WEBHOOK_EVENTS } from "@/modules/catalog";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { CLAIM_LEASE_MS, classifyStatus, GLOBAL_CONCURRENCY, HOLD_DAYS, KEEP_LOG_DAYS, MAX_ATTEMPTS, MAX_HELD_PER_WEBHOOK, retryDelayMs, type DeliveryError } from "@/lib/webhooks/schedule";
import { signatureHeader } from "@/lib/webhooks/signature";
import { signingSecrets } from "./secrets";
import { classifySendError, postWebhook, type SendDeps } from "./send";

/**
 * Zustellung der Webhooks. **Die Nutzlast trägt nur Ereignis-ID, Typ, Zeitpunkt und die ID der Sache** (samt Name der API-Ressource, unter der der Empfänger sie mit seinem eigenen Token abholt) – nie Fachdaten,
 * nie Namen, Beträge oder Texte. Sensible Ressourcen (Mitarbeiter, Krankheit, Tresor, Konto/Verwaltung) erzeugen keine Ereignisse: Welche Ereignisse es gibt, legen die Funktionen in `webhookEvents` ihrer `feature.ts` fest.
 *
 * Ablauf: Der Outbox-Abnehmer `webhooks.fanout` legt je Ereignis und abonniertem Ziel **eine** Zustellung an (`WebhookDelivery`, eindeutig je Ziel und Ereignis – parallele Läufe legen nichts doppelt an). Der Job `webhooks.deliver`
 * stellt fällige Zustellungen zu: Eine Zustellung wird **atomar übernommen** (bedingtes Update, danach gehört sie dem Läufer für `CLAIM_LEASE_MS`) – zwei gleichzeitige Läufer senden nie dasselbe doppelt;
 * je Ziel läuft höchstens eine Zustellung gleichzeitig, insgesamt höchstens `GLOBAL_CONCURRENCY`. Fehlversuche werden mit wachsender Pause wiederholt (`lib/webhooks/schedule.ts`), nach dem 12. Versuch gilt die Zustellung als aufgegeben.
 */
export type DeliveryPayload = { id: string; type: string; createdAt: string; entity: { resource: string; id: string } | null };

const resourceOf = (type: string): string | null => WEBHOOK_EVENTS.find((event) => event.type === type)?.resource ?? null;

/** Der Text des Bodys (genau diese Zeichen werden signiert und gesendet). */
export function webhookBody(d: { eventId: string; type: string; entityId: string | null; eventAt: Date }): string {
  const resource = resourceOf(d.type);
  const payload: DeliveryPayload = { id: d.eventId, type: d.type, createdAt: d.eventAt.toISOString(), entity: d.entityId && resource ? { resource, id: d.entityId } : null };
  return JSON.stringify(payload);
}

export const parseEvents = (text: string): string[] => text.split(",").map((e) => e.trim()).filter(Boolean);

/**
 * Gehört die Sache zu einem Kunden mit eingeschränkter Verarbeitung (Art. 18 DSGVO)? Dann geht **nichts** hinaus (weder Ereignis noch Wiederholung). Die Prüfung liefert die Verwaltung der API
 * (`modules/admin/api/restriction.ts`) – die Plattform kennt die Tabellen der Funktionen nicht.
 */
export type RestrictionCheck = (resource: string, entityId: string) => Promise<boolean>;

export type AttemptOutcome = "sent" | "retry" | "failed" | "gone" | "skipped";
export type AttemptOptions = { now?: Date; isRestricted?: RestrictionCheck; /** Test-Ereignis: ein Versuch, keine Wiederholung; auch für ein ausgeschaltetes Ziel */ manual?: boolean; signal?: AbortSignal; deps?: SendDeps };

/** Ein Versuch für eine Zustellung (übernimmt sie zuerst atomar; wer sie nicht bekommt, sendet nichts). */
export async function attemptDelivery(id: string, options: AttemptOptions = {}): Promise<AttemptOutcome> {
  const now = options.now ?? new Date();
  const claimed = await db.webhookDelivery.updateMany({
    where: { id, status: "pending", nextAttemptAt: { lte: now }, ...(options.manual ? {} : { webhook: { enabled: true } }) },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS), attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (claimed.count !== 1) return "skipped";
  const delivery = await db.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
  if (!delivery) return "skipped";
  const { webhook } = delivery;
  const resource = resourceOf(delivery.type);
  if (options.isRestricted && resource && delivery.entityId && (await options.isRestricted(resource, delivery.entityId))) {
    // Verarbeitung eingeschränkt (Art. 18): nicht senden, aufgeben – sichtbar im Protokoll
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { status: "failed", lastError: "restricted", completedAt: now } });
    return "failed";
  }

  let status: number | null = null;
  let error: DeliveryError | null = null;
  let durationMs = 0;
  try {
    const secrets = await signingSecrets(webhook.id, webhook.previousSecretUntil, now);
    if (secrets.length === 0) throw Object.assign(new Error("secret"), { code: "SECRET" });
    const body = webhookBody(delivery);
    const timestamp = Math.floor(now.getTime() / 1000);
    const result = await postWebhook(
      webhook.url,
      {
        allowPrivate: webhook.allowPrivate,
        body,
        headers: {
          "content-type": "application/json",
          "user-agent": "SchrauberOS-Webhook/1",
          "x-webhook-id": delivery.eventId,
          "x-webhook-timestamp": String(timestamp),
          "x-webhook-event": delivery.type,
          "x-webhook-signature": signatureHeader(secrets, timestamp, delivery.eventId, body),
        },
      },
      { ...options.deps, signal: options.signal },
    );
    status = result.status;
    durationMs = result.durationMs;
  } catch (cause) {
    error = cause instanceof Error && (cause as { code?: string }).code === "SECRET" ? "secret" : classifySendError(cause);
  }

  const verdict = status === null ? ("retry" as const) : classifyStatus(status);
  if (status !== null && verdict !== "sent" && verdict !== "gone") error = verdict === "redirect" ? "redirect" : "http";
  const attempts = delivery.attempts; // nach dem Übernehmen schon hochgezählt gelesen
  const common = { lastStatus: status, lastError: verdict === "sent" ? null : error, lastDurationMs: durationMs || null };

  if (verdict === "sent") {
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { ...common, status: "sent", completedAt: now } });
    return "sent";
  }
  if (verdict === "gone") {
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { ...common, status: "gone", completedAt: now } });
    await disableWebhook(webhook.id, "gone", webhook.name);
    return "gone";
  }
  if (options.manual || attempts >= MAX_ATTEMPTS) {
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { ...common, status: "failed", completedAt: now } });
    return "failed";
  }
  await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { ...common, nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)) } });
  return "retry";
}

/** Schaltet ein Ziel aus (der Empfänger hat 410 gemeldet, das Geheimnis ist unlesbar): offene Zustellungen werden zurückgestellt, das Audit-Log nennt den Grund. */
export async function disableWebhook(id: string, reason: "gone" | "secret", name: string): Promise<void> {
  await db.$transaction([
    db.webhook.update({ where: { id }, data: { enabled: false, disabledReason: reason } }),
    db.webhookDelivery.updateMany({ where: { webhookId: id, status: "pending" }, data: { status: "held" } }),
  ]);
  await audit("webhook.disabled", { actor: { id: null, name: "System" }, target: `${name}: ${reason}`, entityId: id });
}

export type DeliverySummary = { sent: number; retried: number; failed: number; gone: number; skipped: number };

/** Gibt es fällige Zustellungen? (Billige Vorabprüfung des Jobs.) */
export async function hasDueDeliveries(now = new Date()): Promise<boolean> {
  return (await db.webhookDelivery.count({ where: { status: "pending", nextAttemptAt: { lte: now }, webhook: { enabled: true } }, take: 1 })) > 0;
}

/** Stellt fällige Zustellungen zu: je Ziel nacheinander, verschiedene Ziele gleichzeitig (höchstens `GLOBAL_CONCURRENCY`). */
export async function deliverDue(options: { now?: Date; limit?: number; signal?: AbortSignal; deps?: SendDeps; isRestricted?: RestrictionCheck } = {}): Promise<DeliverySummary> {
  const now = options.now ?? new Date();
  const summary: DeliverySummary = { sent: 0, retried: 0, failed: 0, gone: 0, skipped: 0 };
  const due = await db.webhookDelivery.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now }, webhook: { enabled: true } },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: options.limit ?? 50,
    select: { id: true, webhookId: true },
  });
  const groups = new Map<string, string[]>();
  for (const row of due) groups.set(row.webhookId, [...(groups.get(row.webhookId) ?? []), row.id]);
  const queue = [...groups.values()];

  async function worker(): Promise<void> {
    for (let ids = queue.shift(); ids; ids = queue.shift()) {
      for (const id of ids) {
        if (options.signal?.aborted) return;
        try {
          const outcome = await attemptDelivery(id, { now, signal: options.signal, deps: options.deps, isRestricted: options.isRestricted });
          if (outcome === "retry") summary.retried++;
          else summary[outcome]++;
        } catch (error) {
          logError("webhooks:deliver", error);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(GLOBAL_CONCURRENCY, queue.length) }, worker));
  return summary;
}

/**
 * Outbox-Abnehmer: legt für ein Ereignis die Zustellungen an – `pending` für eingeschaltete, `held` (bis zu 14 Tage zurückgestellt) für ausgeschaltete Ziele. Idempotent über die Ereignis-ID
 * (eindeutig je Ziel und Ereignis). Ereignisse außerhalb des Katalogs gibt es für Webhooks nicht.
 */
export async function fanOutEvent(message: { id: string; type: string; entityId: string | null; createdAt: Date }, options: { isRestricted?: RestrictionCheck } = {}): Promise<number> {
  if (!WEBHOOK_EVENTS.some((event) => event.type === message.type)) return 0;
  const resource = resourceOf(message.type);
  if (options.isRestricted && resource && message.entityId && (await options.isRestricted(resource, message.entityId))) return 0;
  const webhooks = await db.webhook.findMany({ select: { id: true, events: true, enabled: true } });
  let created = 0;
  for (const webhook of webhooks) {
    if (!parseEvents(webhook.events).includes(message.type)) continue;
    if (!webhook.enabled && (await db.webhookDelivery.count({ where: { webhookId: webhook.id, status: "held" } })) >= MAX_HELD_PER_WEBHOOK) continue;
    try {
      await db.webhookDelivery.create({
        data: { webhookId: webhook.id, eventId: message.id, type: message.type, entityId: message.entityId, eventAt: message.createdAt, status: webhook.enabled ? "pending" : "held" },
      });
      created++;
    } catch (error) {
      // dieselbe Zustellung gibt es schon (Wiederholung des Ereignisses): harmlos
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  return created;
}

/** Aufräumen: Zustellprotokoll nach 30 Tagen, zurückgestellte (und liegengebliebene) Zustellungen nach 14 Tagen. */
export async function pruneWebhookDeliveries(now = new Date()): Promise<number> {
  const DAY = 86_400_000;
  const { count } = await db.webhookDelivery.deleteMany({
    where: {
      OR: [
        { status: { in: ["sent", "failed", "gone"] }, completedAt: { lt: new Date(now.getTime() - KEEP_LOG_DAYS * DAY) } },
        { status: { in: ["held", "pending"] }, createdAt: { lt: new Date(now.getTime() - HOLD_DAYS * DAY) } },
      ],
    },
  });
  return count;
}
