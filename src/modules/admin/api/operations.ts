import { z } from "zod";
import { claimRow } from "@/lib/concurrency";
import { checkWebhookUrl, type WebhookUrlProblem } from "@/lib/webhooks/url";
import { HOLD_DAYS, MAX_WEBHOOKS } from "@/lib/webhooks/schedule";
import type { MessageKey } from "@/i18n/translate";
import { WEBHOOK_EVENTS } from "@/modules/catalog";
import { getActiveFeatureIds } from "@/modules/features";
import { db } from "@/server/db";
import { defineOperation, fail, failField } from "@/server/operations";
import { attemptDelivery, parseEvents } from "@/server/webhooks/deliver";
import { issueWebhookSecret, removeWebhookSecrets, hasWebhookSecret, rotateWebhookSecret } from "@/server/webhooks/secrets";
import type { Tx } from "@/server/operations";

/**
 * Webhooks verwalten (Recht `api.manage`, nur Administratoren; die Zustellung steht in `server/webhooks`). Festgelegt:
 *  - **Ereignisse** nur aus dem Katalog der Funktionen (`webhookEvents`); das Ziel ist eine `https`-Adresse (Klartext nur mit der Freigabe für das eigene Netz), nie der eigene Rechner, nie Metadaten-Dienste
 *    (`lib/webhooks/url.ts`; beim Senden wird zusätzlich aufgelöst und die Adresse festgelegt).
 *  - **Geheimnis** der Signatur: zufällig, verschlüsselt, **einmal** im Ergebnis von Anlegen/Erneuern; eingeschaltet wird erst, wenn es eines gibt. Audit nennt Name und Host, nie das Geheimnis, nie die ganze Adresse
 *    (sie kann Zugangsdaten als Parameter tragen).
 *  - **Höchstens 20 Ziele.** Ausschalten stellt offene Zustellungen zurück (bis zu 14 Tage), Einschalten holt sie nach; Löschen entfernt Ziel, Geheimnis und Protokoll.
 */
const urlProblemKey = (problem: WebhookUrlProblem): MessageKey => `api.webhooks.errors.url.${problem}` as MessageKey;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "–";
  }
};

const saveInput = z.object({
  id: z.string().min(1).max(40).optional(),
  version: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().min(1).max(500),
  events: z.array(z.string().min(1).max(80)).min(1).max(60),
  enabled: z.boolean().default(false),
  allowPrivate: z.boolean().default(false),
});

/** Zurückgestellte Zustellungen nachholen (jünger als 14 Tage) bzw. verwerfen (älter). */
async function releaseHeld(tx: Tx, webhookId: string): Promise<void> {
  const cutoff = new Date(Date.now() - HOLD_DAYS * 86_400_000);
  await tx.webhookDelivery.deleteMany({ where: { webhookId, status: "held", createdAt: { lt: cutoff } } });
  await tx.webhookDelivery.updateMany({ where: { webhookId, status: "held" }, data: { status: "pending", nextAttemptAt: new Date() } });
}

export const saveWebhookOperation = defineOperation({
  name: "admin.api.saveWebhook",
  permission: "api.manage",
  input: saveInput,
  audit: (input) => (input.id ? "webhook.update" : "webhook.create"),
  run: async ({ input, principal, tx, audit }) => {
    const events = [...new Set(input.events)];
    const known = new Set(WEBHOOK_EVENTS.map((event) => event.type));
    if (events.some((type) => !known.has(type))) failField("events", "api.webhooks.errors.events");
    const checked = checkWebhookUrl(input.url, { allowPrivate: input.allowPrivate });
    if (!checked.ok) failField("url", urlProblemKey(checked.problem));
    const url = checked.url.toString();
    const data = { name: input.name, url, events: events.join(","), allowPrivate: input.allowPrivate };

    if (!input.id) {
      if ((await tx.webhook.count()) >= MAX_WEBHOOKS) fail("invalid", "api.webhooks.errors.tooMany", { max: MAX_WEBHOOKS });
      // Eingeschaltet wird beim Anlegen nie: erst nach dem Eintragen des Geheimnisses beim Empfänger (Ziel ist ausgeschaltet, bis die Person es einschaltet)
      const row = await tx.webhook.create({ data: { ...data, enabled: false, createdByName: principal.user.name }, select: { id: true } });
      const secret = await issueWebhookSecret(row.id, tx);
      audit({ target: `${input.name} → ${hostOf(url)}`, entityId: row.id });
      return { id: row.id, secret };
    }

    const before = await tx.webhook.findUnique({ where: { id: input.id }, select: { enabled: true } });
    if (!before) fail("notFound");
    if (!(await claimRow(tx.webhook, input.id, input.version))) fail("conflict", "common.conflict");
    if (input.enabled && !before.enabled) {
      if (!(await hasWebhookSecret(input.id, tx))) fail("conflict", "api.webhooks.errors.noSecret");
      await releaseHeld(tx, input.id);
    }
    if (!input.enabled && before.enabled) await tx.webhookDelivery.updateMany({ where: { webhookId: input.id, status: "pending" }, data: { status: "held" } });
    await tx.webhook.update({ where: { id: input.id }, data: { ...data, enabled: input.enabled, ...(input.enabled ? { disabledReason: null } : {}) } });
    audit({ target: `${input.name} → ${hostOf(url)}${before.enabled !== input.enabled ? (input.enabled ? " (an)" : " (aus)") : ""}`, entityId: input.id });
    return { id: input.id, secret: null as string | null };
  },
});

/** Schalter in der Liste: ein-/ausschalten (ohne die übrigen Felder anzufassen). */
export const setWebhookEnabledOperation = defineOperation({
  name: "admin.api.setWebhookEnabled",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40), enabled: z.boolean() }),
  audit: "webhook.update",
  run: async ({ input, tx, audit }) => {
    const row = await tx.webhook.findUnique({ where: { id: input.id }, select: { name: true, url: true, enabled: true } });
    if (!row) fail("notFound");
    if (row.enabled !== input.enabled) {
      if (input.enabled) {
        if (!(await hasWebhookSecret(input.id, tx))) fail("conflict", "api.webhooks.errors.noSecret");
        await releaseHeld(tx, input.id);
        await tx.webhook.update({ where: { id: input.id }, data: { enabled: true, disabledReason: null } });
      } else {
        await tx.webhookDelivery.updateMany({ where: { webhookId: input.id, status: "pending" }, data: { status: "held" } });
        await tx.webhook.update({ where: { id: input.id }, data: { enabled: false } });
      }
    }
    audit({ target: `${row.name} → ${hostOf(row.url)} (${input.enabled ? "an" : "aus"})`, entityId: input.id });
    return { id: input.id };
  },
});

export const deleteWebhookOperation = defineOperation({
  name: "admin.api.deleteWebhook",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "webhook.delete",
  run: async ({ input, tx, audit }) => {
    const row = await tx.webhook.findUnique({ where: { id: input.id }, select: { name: true, url: true } });
    if (!row) fail("notFound");
    await tx.webhook.delete({ where: { id: input.id } });
    await removeWebhookSecrets(input.id, tx);
    audit({ target: `${row.name} → ${hostOf(row.url)}`, entityId: input.id });
    return { id: input.id };
  },
});

/** Neues Geheimnis (Rotation): das bisherige signiert noch `OVERLAP_HOURS` Stunden mit, damit der Empfänger umstellen kann; der Klartext des neuen steht einmal im Ergebnis. */
export const OVERLAP_HOURS = 24;
export const rotateWebhookSecretOperation = defineOperation({
  name: "admin.api.rotateWebhookSecret",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "webhook.secret",
  run: async ({ input, tx, audit }) => {
    const row = await tx.webhook.findUnique({ where: { id: input.id }, select: { name: true, url: true } });
    if (!row) fail("notFound");
    const hadSecret = await hasWebhookSecret(input.id, tx);
    const secret = await rotateWebhookSecret(input.id, tx);
    // Das bisherige Geheimnis gilt nur mit Überlappung; fehlte eines (nach einem Restore), gibt es nichts zu überlappen
    await tx.webhook.update({ where: { id: input.id }, data: { previousSecretUntil: hadSecret ? new Date(Date.now() + OVERLAP_HOURS * 3_600_000) : null } });
    audit({ target: `${row.name} → ${hostOf(row.url)}`, entityId: input.id });
    return { id: input.id, secret, overlapHours: hadSecret ? OVERLAP_HOURS : 0 };
  },
});

/**
 * „Test-Ereignis senden“: ein einziger Versuch mit dem Typ `webhook.test` (kein Ereignis einer Funktion, keine Wiederholung), auch für ein ausgeschaltetes Ziel – so lässt sich die Einrichtung vor dem
 * Einschalten prüfen. Das Ergebnis (Statuscode oder Fehlercode, nie Text des Empfängers) steht im Zustellprotokoll. Höchstens 5 Tests je Minute und Ziel.
 */
export const testWebhookOperation = defineOperation({
  name: "admin.api.testWebhook",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "webhook.test",
  transaction: false, // der Versuch geht ins Netz; die Zeile und der Audit-Eintrag stehen danach
  run: async ({ input, audit }) => {
    const row = await db.webhook.findUnique({ where: { id: input.id }, select: { id: true, name: true, url: true } });
    if (!row) fail("notFound");
    if ((await db.webhookDelivery.count({ where: { webhookId: row.id, type: "webhook.test", createdAt: { gte: new Date(Date.now() - 60_000) } } })) >= 5) fail("busy", "api.webhooks.errors.testRate");
    const delivery = await db.webhookDelivery.create({ data: { webhookId: row.id, eventId: `test_${crypto.randomUUID().replaceAll("-", "")}`, type: "webhook.test", eventAt: new Date(), status: "pending" }, select: { id: true } });
    const outcome = await attemptDelivery(delivery.id, { manual: true });
    const result = await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id }, select: { lastStatus: true, lastError: true, lastDurationMs: true } });
    audit({ target: `${row.name} → ${hostOf(row.url)}`, entityId: row.id });
    return { outcome, status: result.lastStatus, error: result.lastError, durationMs: result.lastDurationMs };
  },
});

/** „Erneut zustellen“: eine aufgegebene (oder beliebige) Zustellung wieder auf Anfang – gleiche Ereignis-ID, damit der Empfänger Doppeltes erkennt. Nur für ein eingeschaltetes Ziel. */
export const redeliverOperation = defineOperation({
  name: "admin.api.redeliver",
  permission: "api.manage",
  input: z.object({ id: z.string().min(1).max(40) }),
  audit: "webhook.redeliver",
  run: async ({ input, tx, audit }) => {
    const delivery = await tx.webhookDelivery.findUnique({ where: { id: input.id }, include: { webhook: { select: { id: true, name: true, url: true, enabled: true } } } });
    if (!delivery) fail("notFound");
    if (delivery.type === "webhook.test") fail("conflict", "api.webhooks.errors.redeliverTest");
    if (!delivery.webhook.enabled) fail("conflict", "api.webhooks.errors.targetOff");
    if (delivery.status === "pending" || delivery.status === "held") fail("conflict", "api.webhooks.errors.alreadyPending");
    await tx.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), completedAt: null } });
    audit({ target: `${delivery.webhook.name} → ${hostOf(delivery.webhook.url)}: ${delivery.type}`, entityId: delivery.webhook.id });
    return { id: delivery.id };
  },
});

/** Welche Ereignisse bietet die Oberfläche an? Nur die aktiver Funktionen (ausgeschaltete melden nichts). */
export async function offeredEvents(): Promise<Array<{ type: string; resource: string; feature: string }>> {
  const active = await getActiveFeatureIds();
  return WEBHOOK_EVENTS.filter((event) => active.has(event.feature));
}

export { parseEvents };
