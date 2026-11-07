import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { generateWebhookSecret } from "@/lib/webhooks/signature";
import { db } from "@/server/db";
import { decryptSecret } from "@/server/secrets";
import { getSecret, setSecret } from "@/server/settings";

/**
 * Geheimnis der Signatur je Webhook: verschlüsselt in den Einstellungen (`setSecret/getSecret`, Schlüssel `secret.key`, **nicht im Backup lesbar**). Der Klartext wird nur bei Erzeugung und
 * Rotation einmalig angezeigt; danach gibt es keinen Weg, ihn wieder zu sehen (nur erneuern). Beim Zurücksetzen nach einem Restore ohne Schlüssel schaltet der Verbraucher
 * (`modules/admin/api/secrets.ts`) das Ziel aus.
 */
export const WEBHOOK_SECRET_PREFIX = "webhook.secret.";
export const WEBHOOK_PREVIOUS_PREFIX = "webhook.secretPrevious.";
/** Alle Einstellungsschlüssel dieser Geheimnisse beginnen so (für das Zurücksetzen und Aufräumen). */
export const WEBHOOK_SECRET_KEY_START = "webhook.secret";

export const secretKeyOf = (webhookId: string): string => `${WEBHOOK_SECRET_PREFIX}${webhookId}`;
export const previousKeyOf = (webhookId: string): string => `${WEBHOOK_PREVIOUS_PREFIX}${webhookId}`;

type Writer = Pick<PrismaClient | Prisma.TransactionClient, "appSetting">;

/** Liest ein Geheimnis über den übergebenen Client (in einer Transaktion über deren Client – ein zweiter Zugriff über `db` wartete auf die eigene Transaktion); `null`, wenn es fehlt oder nicht lesbar ist. */
async function readSecret(key: string, reader: Writer): Promise<string | null> {
  const row = await reader.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  try {
    return decryptSecret(row.value);
  } catch {
    return null;
  }
}

/** Erzeugt ein neues Geheimnis, speichert es verschlüsselt und gibt den Klartext **einmalig** zurück. */
export async function issueWebhookSecret(webhookId: string, writer: Writer = db): Promise<string> {
  const secret = generateWebhookSecret();
  await setSecret(secretKeyOf(webhookId), secret, writer);
  return secret;
}

/** Rotation: das bisherige Geheimnis wird zum vorherigen (signiert während der Überlappung mit), ein neues entsteht. */
export async function rotateWebhookSecret(webhookId: string, writer: Writer = db): Promise<string> {
  const current = await readSecret(secretKeyOf(webhookId), writer);
  await setSecret(previousKeyOf(webhookId), current, writer);
  return issueWebhookSecret(webhookId, writer);
}

export async function removeWebhookSecrets(webhookId: string, writer: Writer = db): Promise<void> {
  await setSecret(secretKeyOf(webhookId), null, writer);
  await setSecret(previousKeyOf(webhookId), null, writer);
}

/** Die Geheimnisse, mit denen eine Zustellung signiert wird (aktuelles; innerhalb der Überlappung auch das vorherige). Leer, wenn keines lesbar ist. */
export async function signingSecrets(webhookId: string, previousUntil: Date | null, now: Date): Promise<string[]> {
  const current = await getSecret(secretKeyOf(webhookId));
  if (!current) return [];
  const previous = previousUntil && previousUntil.getTime() > now.getTime() ? await getSecret(previousKeyOf(webhookId)) : null;
  return previous ? [current, previous] : [current];
}

export async function hasWebhookSecret(webhookId: string, reader: Writer = db): Promise<boolean> {
  return (await readSecret(secretKeyOf(webhookId), reader)) !== null;
}
