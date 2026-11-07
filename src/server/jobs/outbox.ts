import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { backoffDelay } from "@/lib/jobs/schedule";
import { describeError, logError } from "@/lib/log-safe";
import { db as appDb } from "@/server/db";
import { pendingOutboxEvents } from "@/server/outbox";
import type { OutboxHandlerDef, OutboxMessage } from "./types";

/**
 * Zustellung der Outbox (Job `platform.outbox`): Ereignisse, die der Aktions-Rahmen in der Transaktion der Änderung geschrieben hat, gehen an die Abnehmer,
 * die Funktionen anmelden (`OutboxHandlerDef`).
 *
 *  - **Mindestens einmal, je Abnehmer erfolgreich genau einmal:** Jeder gelungene Abnehmer wird in `OutboxDelivery` festgehalten; bei einer Wiederholung
 *    (ein anderer Abnehmer des Ereignisses war gescheitert) wird er übersprungen. Fällt der Prozess zwischen Zustellung und Vermerk aus, kommt das Ereignis
 *    ein zweites Mal an – Abnehmer sind deshalb über `message.id` idempotent.
 *  - **Fehler:** `attempts` steigt, die nächste Zustellung kommt nach Wartezeit (30 s · 2^n, höchstens 1 h); nach `maxAttempts` gilt das Ereignis als
 *    fehlgeschlagen (`failedAt`) und wird nicht mehr versucht, bleibt aber bis zum Aufräumen sichtbar.
 *  - **Kein Abnehmer** angemeldet: erledigt, es gibt nichts zuzustellen. **Abnehmer einer ausgeschalteten Funktion:** Das Ereignis bleibt für ihn **offen (geparkt)**, bis die
 *    Funktion wieder eingeschaltet ist (dann wird nachgeholt) oder es mit der Aufbewahrung verfällt (14 Tage ab Anlage). Das Parken kostet einen Wartetermin (`PARK_MS`), damit
 *    geparkte Ereignisse die Zustellung neuer nicht verdrängen. Grund: Ein Webhook-Abnehmer, der kurz ausgeschaltet wird (Wartung, Fehlkonfiguration), soll keine Ereignisse verlieren.
 *  - **Zeitlimit je Abnehmer** (`OutboxHandlerDef.timeoutMs`, Standard 30 s): Ein hängender Abnehmer wird nach dem Limit als gescheitert gewertet (`signal` ausgelöst) und
 *    blockiert weder die übrigen Abnehmer noch den Job.
 *  - Ein fehlschlagender Abnehmer oder ein fehlerhaftes Ereignis blockiert weder die anderen Abnehmer noch andere Ereignisse. Eine strenge Reihenfolge gibt es nicht.
 */

type Client = Pick<PrismaClient, "outboxEvent" | "outboxDelivery" | "$transaction">;

export const OUTBOX_DEFAULT_MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 60 * 60_000;
/** Wartezeit für Ereignisse, deren Abnehmer-Funktion ausgeschaltet ist, bis wieder geschaut wird. */
export const OUTBOX_PARK_MS = 15 * 60_000;
/** Standard-Zeitlimit einer einzelnen Zustellung. */
export const OUTBOX_HANDLER_TIMEOUT_MS = 30_000;

/** Aufbewahrung zugestellter bzw. endgültig fehlgeschlagener Ereignisse (Tage). */
export const OUTBOX_KEEP_PROCESSED_DAYS = 14;
export const OUTBOX_KEEP_FAILED_DAYS = 60;

export const matchesType = (patterns: readonly string[], type: string): boolean =>
  patterns.some((p) => p === "*" || p === type || (p.endsWith("*") && type.startsWith(p.slice(0, -1))));

function parsePayload(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type OutboxDeliveryOptions = {
  handlers: readonly OutboxHandlerDef[];
  activeFeatures: ReadonlySet<string>;
  now?: Date;
  limit?: number;
  db?: Client;
  /** Wird der Job abgebrochen (Zeitlimit des Jobs), hört die Zustellung nach dem laufenden Ereignis auf */
  signal?: AbortSignal;
};

export type OutboxSummary = { delivered: number; retried: number; failed: number; skipped: number; parked: number };

/** Gibt es zuzustellende Ereignisse? (Billige Vorabprüfung des Jobs – ein einzelner Zählzugriff.) */
export async function hasPendingOutbox(now = new Date(), db: Pick<PrismaClient, "outboxEvent"> = appDb): Promise<boolean> {
  return (await db.outboxEvent.count({ where: { processedAt: null, failedAt: null, availableAt: { lte: now } }, take: 1 })) > 0;
}

/** Ruft einen Abnehmer mit Zeitlimit auf. Ein Abnehmer, der `signal` ignoriert und hängt, wird liegengelassen (sein spätes Ende wird verschluckt). */
async function callHandler(handler: OutboxHandlerDef, message: OutboxMessage, parent: AbortSignal | undefined): Promise<void> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = Promise.resolve().then(() => handler.handle(message, { signal: controller.signal }));
    work.catch(() => undefined); // ein spätes Scheitern nach dem Zeitlimit ist kein unbehandelter Fehler
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Zeitüberschreitung"));
      }, handler.timeoutMs ?? OUTBOX_HANDLER_TIMEOUT_MS);
      timer.unref();
    });
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

/** Stellt anstehende Ereignisse zu. */
export async function deliverOutbox(options: OutboxDeliveryOptions): Promise<OutboxSummary> {
  const db = options.db ?? appDb;
  const now = options.now ?? new Date();
  const summary: OutboxSummary = { delivered: 0, retried: 0, failed: 0, skipped: 0, parked: 0 };
  const events = await pendingOutboxEvents(db, now, options.limit ?? 50);

  for (const event of events) {
    if (options.signal?.aborted) break;
    const registered = options.handlers.filter((h) => matchesType(h.types, event.type));
    const matching = registered.filter((h) => !h.feature || options.activeFeatures.has(h.feature));
    const done = new Set((await db.outboxDelivery.findMany({ where: { eventId: event.id }, select: { handler: true } })).map((d) => d.handler));
    const todo = matching.filter((h) => !done.has(h.id));
    // Abnehmer ausgeschalteter Funktionen, die noch nicht bedient wurden: das Ereignis bleibt (für sie) offen
    const parkedFor = registered.filter((h) => !matching.includes(h) && !done.has(h.id));
    if (todo.length === 0) {
      if (parkedFor.length > 0) {
        await db.outboxEvent.update({ where: { id: event.id }, data: { availableAt: new Date(now.getTime() + OUTBOX_PARK_MS) } });
        summary.parked++;
        continue;
      }
      await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: now, lastError: null } });
      if (registered.length === 0) summary.skipped++;
      else summary.delivered++;
      continue;
    }

    const message: OutboxMessage = {
      id: event.id,
      type: event.type,
      entityId: event.entityId,
      payload: parsePayload(event.payload),
      actorId: event.actorId,
      createdAt: event.createdAt,
      attempt: event.attempts + 1,
    };
    const failed: OutboxHandlerDef[] = [];
    let lastError = "";
    for (const handler of todo) {
      try {
        await callHandler(handler, message, options.signal);
        // Vermerk; ein doppelter Eintrag (parallele Zustellung) ist harmlos
        await db.outboxDelivery.create({ data: { eventId: event.id, handler: handler.id, deliveredAt: now } }).catch(() => undefined);
      } catch (error) {
        failed.push(handler);
        lastError = `${handler.id}: ${describeError(error)}`;
        logError(`outbox:${handler.id}`, error);
      }
    }

    if (failed.length === 0) {
      if (parkedFor.length > 0) {
        // Die aktiven Abnehmer sind bedient; für die ausgeschalteten bleibt das Ereignis offen
        await db.outboxEvent.update({ where: { id: event.id }, data: { lastError: null, availableAt: new Date(now.getTime() + OUTBOX_PARK_MS) } });
        summary.parked++;
        continue;
      }
      await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: now, attempts: { increment: 1 }, lastError: null } });
      summary.delivered++;
      continue;
    }
    const attempts = event.attempts + 1;
    const limit = Math.min(...failed.map((h) => h.maxAttempts ?? OUTBOX_DEFAULT_MAX_ATTEMPTS));
    if (attempts >= limit) {
      await db.outboxEvent.update({ where: { id: event.id }, data: { attempts, lastError, failedAt: now } });
      summary.failed++;
    } else {
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { attempts, lastError, availableAt: new Date(now.getTime() + backoffDelay(attempts, RETRY_BASE_MS, RETRY_MAX_MS)) },
      });
      summary.retried++;
    }
  }
  return summary;
}

/**
 * Räumt zugestellte (nach 14 Tagen) und endgültig fehlgeschlagene Ereignisse (nach 60 Tagen) samt Zustellvermerken ab, dazu noch offene (geparkte) Ereignisse, die
 * seit 14 Tagen nicht zugestellt werden konnten (Abnehmer-Funktion blieb ausgeschaltet). Liefert die Anzahl.
 */
export async function pruneOutbox(now = new Date(), db: Client = appDb): Promise<number> {
  const DAY = 86_400_000;
  const where = {
    OR: [
      { processedAt: { lt: new Date(now.getTime() - OUTBOX_KEEP_PROCESSED_DAYS * DAY) } },
      { failedAt: { lt: new Date(now.getTime() - OUTBOX_KEEP_FAILED_DAYS * DAY) } },
      { processedAt: null, failedAt: null, createdAt: { lt: new Date(now.getTime() - OUTBOX_KEEP_PROCESSED_DAYS * DAY) } },
    ],
  };
  return db.$transaction(async (tx) => {
    await tx.outboxDelivery.deleteMany({ where: { event: where } });
    return (await tx.outboxEvent.deleteMany({ where })).count;
  });
}
