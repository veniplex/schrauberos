import "server-only";
import { logError } from "@/lib/log-safe";
import { WEBHOOK_EVENTS } from "@/modules/catalog";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { CLAIM_LEASE_MS, classifyStatus, GLOBAL_CONCURRENCY, HOLD_DAYS, KEEP_LOG_DAYS, MAX_ATTEMPTS, MAX_HELD_PER_WEBHOOK, MAX_PENDING_PER_WEBHOOK, PER_TARGET_PER_RUN, retryDelayMs, RUN_BUDGET_MS, type DeliveryError } from "@/lib/webhooks/schedule";
import { signatureHeader } from "@/lib/webhooks/signature";
import { setSecret } from "@/server/settings";
import { previousKeyOf, signingSecrets } from "./secrets";
import { classifySendError, postWebhook, type SendDeps } from "./send";

/**
 * Zustellung der Webhooks. **Die Nutzlast trägt nur Ereignis-ID, Typ, Zeitpunkt und die ID der Sache** (samt Name der API-Ressource, unter der der Empfänger sie mit seinem eigenen Token abholt) – nie Fachdaten,
 * nie Namen, Beträge oder Texte. Sensible Ressourcen (Mitarbeiter, Krankheit, Tresor, Konto/Verwaltung) erzeugen keine Ereignisse: Welche Ereignisse es gibt, legen die Funktionen in `webhookEvents` ihrer `feature.ts` fest.
 *
 * Ablauf: Der Outbox-Abnehmer `webhooks.fanout` legt je Ereignis und abonniertem Ziel **eine** Zustellung an (`WebhookDelivery`, eindeutig je Ziel und Ereignis – parallele Läufe legen nichts doppelt an). Der Job `webhooks.deliver`
 * stellt fällige Zustellungen zu: Eine Zustellung wird **atomar übernommen** (bedingtes Update, danach gehört sie dem Läufer für `CLAIM_LEASE_MS`) – zwei gleichzeitige Läufer senden nie dasselbe doppelt;
 * je Ziel läuft höchstens eine Zustellung gleichzeitig, insgesamt höchstens `GLOBAL_CONCURRENCY`. Fehlversuche werden mit wachsender Pause wiederholt (`lib/webhooks/schedule.ts`), nach dem 12. Versuch gilt die Zustellung als aufgegeben.
 *
 * **Fairness:** Ein Lauf bedient jedes Ziel mit höchstens `PER_TARGET_PER_RUN` Zustellungen, ein Ziel ruht nach seinem ersten Fehlversuch im Lauf (der Rest bleibt fällig, sein Backoff gilt je Zustellung), und der Lauf beginnt
 * nach `RUN_BUDGET_MS` keine weitere Zustellung – ein langsames oder totes Ziel belegt nie den ganzen Lauf. **Jeder Versuch nimmt die aktuelle Zeit** (Zeitstempel der Signatur, Lease, Wiederholungszeitpunkt); nur Tests geben eine Uhr vor.
 */
export type DeliveryPayload = { id: string; type: string; createdAt: string; entity: { resource: string; id: string } | null };

/** Typ des Test-Ereignisses der Verwaltung (kein Ereignis einer Funktion). */
export const TEST_TYPE = "webhook.test";

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

export type AttemptOutcome = "sent" | "retry" | "failed" | "gone" | "skipped" | "suppressed";
export type AttemptOptions = { now?: Date; isRestricted?: RestrictionCheck; /** Test-Ereignis: ein Versuch, keine Wiederholung; auch für ein ausgeschaltetes Ziel */ manual?: boolean; signal?: AbortSignal; deps?: SendDeps };

/** Ein Versuch für eine Zustellung (übernimmt sie zuerst atomar; wer sie nicht bekommt, sendet nichts). */
export async function attemptDelivery(id: string, options: AttemptOptions = {}): Promise<AttemptOutcome> {
  const now = options.now ?? new Date();
  const claimed = await db.webhookDelivery.updateMany({
    // Ein Test-Ereignis (`manual`) sendet die Verwaltung selbst: ohne Fälligkeit und auch für ein ausgeschaltetes Ziel; der Läufer fasst es nie an
    where: { id, status: "pending", ...(options.manual ? {} : { nextAttemptAt: { lte: now }, type: { not: TEST_TYPE }, webhook: { enabled: true } }) },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS), attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (claimed.count !== 1) return "skipped";
  const delivery = await db.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
  if (!delivery) return "skipped";
  const { webhook } = delivery;
  const resource = resourceOf(delivery.type);
  if (options.isRestricted && resource && delivery.entityId && (await options.isRestricted(resource, delivery.entityId))) {
    // Verarbeitung eingeschränkt (Art. 18): nicht senden – sichtbar im Protokoll als „unterdrückt“ (keine Störung, kein „aufgegeben“)
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { status: "suppressed", lastError: "restricted", completedAt: now } });
    return "suppressed";
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
  if (error === "secret" && !options.manual) {
    // Ohne lesbares Geheimnis geht nichts hinaus (fail-closed) – und das Ziel wird ausgeschaltet statt 12-mal zu versuchen: Die Zustellung wird zurückgestellt, die Verwaltung sieht den Grund
    await db.webhookDelivery.updateMany({ where: { id, status: "pending" }, data: { ...common, status: "held" } });
    await disableWebhook(webhook.id, "secret", webhook.name);
    return "retry";
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
  try {
    await db.$transaction([
      db.webhook.update({ where: { id }, data: { enabled: false, disabledReason: reason } }),
      db.webhookDelivery.updateMany({ where: { webhookId: id, status: "pending" }, data: { status: "held" } }),
    ]);
  } catch (error) {
    // Das Ziel wurde während des Versuchs gelöscht: nichts mehr auszuschalten (kein Fehler im Protokoll)
    if ((error as { code?: string }).code === "P2025") return;
    throw error;
  }
  await audit("webhook.disabled", { actor: { id: null, name: "System" }, target: `${name}: ${reason}`, entityId: id });
}

export type DeliverySummary = { sent: number; retried: number; failed: number; gone: number; skipped: number; suppressed: number; /** Versuche, die an einem Fehler außerhalb des Empfängers scheiterten (Datenbank …) */ errors: number };

/** Gibt es fällige Zustellungen? (Billige Vorabprüfung des Jobs.) */
export async function hasDueDeliveries(now = new Date()): Promise<boolean> {
  return (await db.webhookDelivery.count({ where: { status: "pending", type: { not: TEST_TYPE }, nextAttemptAt: { lte: now }, webhook: { enabled: true } }, take: 1 })) > 0;
}

/**
 * Stellt fällige Zustellungen zu – **fair je Ziel**: Die Ziele mit fälligen Zustellungen kommen nach dem Alter ihrer ältesten an die Reihe (höchstens `GLOBAL_CONCURRENCY` gleichzeitig); jedes Ziel bekommt
 * je Lauf höchstens `perTarget` Zustellungen nacheinander und ruht nach seinem ersten Fehlversuch. Nach `budgetMs` beginnt keine weitere. `now` gibt nur ein Test vor; sonst nimmt jeder Versuch die aktuelle Zeit.
 */
export async function deliverDue(
  options: { now?: Date; limit?: number; perTarget?: number; budgetMs?: number; signal?: AbortSignal; deps?: SendDeps; isRestricted?: RestrictionCheck } = {},
): Promise<DeliverySummary> {
  const fixedNow = options.now;
  const perTarget = options.perTarget ?? PER_TARGET_PER_RUN;
  const budgetMs = options.budgetMs ?? RUN_BUDGET_MS;
  const limit = options.limit ?? 200;
  const started = Date.now();
  const summary: DeliverySummary = { sent: 0, retried: 0, failed: 0, gone: 0, skipped: 0, suppressed: 0, errors: 0 };
  const due = () => ({ status: "pending", type: { not: TEST_TYPE }, nextAttemptAt: { lte: fixedNow ?? new Date() }, webhook: { enabled: true } }) as const;
  const targets = await db.webhookDelivery.groupBy({ by: ["webhookId"], where: due(), _min: { nextAttemptAt: true } });
  const queue = targets.sort((a, b) => (a._min.nextAttemptAt?.getTime() ?? 0) - (b._min.nextAttemptAt?.getTime() ?? 0) || a.webhookId.localeCompare(b.webhookId)).map((t) => t.webhookId);
  let attempted = 0;
  const stop = () => Boolean(options.signal?.aborted) || attempted >= limit || Date.now() - started > budgetMs;

  async function serve(webhookId: string): Promise<void> {
    const rows = await db.webhookDelivery.findMany({ where: { ...due(), webhookId }, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: perTarget, select: { id: true } });
    for (const { id } of rows) {
      if (stop()) return;
      attempted++;
      try {
        const outcome = await attemptDelivery(id, { now: fixedNow, signal: options.signal, deps: options.deps, isRestricted: options.isRestricted });
        if (outcome === "retry") summary.retried++;
        else summary[outcome]++;
        // Das Ziel hat versagt (oder sich abgemeldet): der Rest bleibt fällig und kommt im nächsten Lauf dran, damit es die anderen Ziele nicht aufhält
        if (outcome === "retry" || outcome === "failed" || outcome === "gone") return;
      } catch (error) {
        summary.errors++;
        logError("webhooks:deliver", error);
        return;
      }
    }
  }
  async function worker(): Promise<void> {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (stop()) return;
      await serve(id);
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
    // Deckel je Ziel (zurückgestellt 500, wartend 5000): Überzähliges wird nicht still verschluckt, sondern im Zähler des Ziels gezählt (sichtbar auf der Webhook-Seite, im Audit beim Einschalten)
    const full = webhook.enabled
      ? (await db.webhookDelivery.count({ where: { webhookId: webhook.id, status: "pending" } })) >= MAX_PENDING_PER_WEBHOOK
      : (await db.webhookDelivery.count({ where: { webhookId: webhook.id, status: "held" } })) >= MAX_HELD_PER_WEBHOOK;
    if (full) {
      await db.webhook.update({ where: { id: webhook.id }, data: { droppedEvents: { increment: 1 } } }).catch((error) => {
        if ((error as { code?: string }).code !== "P2025") throw error;
      });
      continue;
    }
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

/**
 * Aufräumen: Zustellprotokoll nach 30 Tagen (zugestellt, aufgegeben, 410, unterdrückt); zurückgestellte Zustellungen nach 14 Tagen seit der Anlage, **wartende** nach 14 Tagen ohne jede Bewegung
 * (gemessen an der nächsten Wiederholung, nicht an der Anlage – eine erneut zugestellte alte Zustellung bleibt); außerdem wird ein **abgelaufenes vorheriges Geheimnis** (Rotation) gelöscht.
 */
export async function pruneWebhookDeliveries(now = new Date()): Promise<number> {
  const DAY = 86_400_000;
  const { count } = await db.webhookDelivery.deleteMany({
    where: {
      OR: [
        { status: { in: ["sent", "failed", "gone", "suppressed"] }, completedAt: { lt: new Date(now.getTime() - KEEP_LOG_DAYS * DAY) } },
        { status: "held", createdAt: { lt: new Date(now.getTime() - HOLD_DAYS * DAY) } },
        { status: "pending", nextAttemptAt: { lt: new Date(now.getTime() - HOLD_DAYS * DAY) } },
      ],
    },
  });
  const expired = await db.webhook.findMany({ where: { previousSecretUntil: { lt: now } }, select: { id: true } });
  for (const { id } of expired) {
    await setSecret(previousKeyOf(id), null);
    await db.webhook.updateMany({ where: { id }, data: { previousSecretUntil: null } });
  }
  return count;
}
