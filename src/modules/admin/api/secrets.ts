import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { resetUnreadableSettingSecrets, type SecretConsumerDef } from "@/server/secret-consumers";
import { WEBHOOK_SECRET_KEY_START, WEBHOOK_SECRET_PREFIX } from "@/server/webhooks/secrets";

/**
 * Das Signaturgeheimnis jedes Webhooks liegt verschlüsselt in den Einstellungen (`webhook.secret.<id>`, dazu das vorherige während einer Rotation). Ist es nach einem Restore ohne passenden Schlüssel
 * unlesbar, wird es entfernt und das Ziel **ausgeschaltet** (Grund „secret“): Es darf nichts ohne gültige Signatur hinausgehen. Danach auf der Webhook-Seite ein neues Geheimnis erzeugen
 * (es wird einmal angezeigt), beim Empfänger eintragen und das Ziel wieder einschalten.
 */
async function resetWebhookSecrets(): Promise<number> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: WEBHOOK_SECRET_KEY_START } }, select: { key: true } });
  const affected = new Set<string>();
  const removed = await resetUnreadableSettingSecrets(
    rows.map((r) => r.key),
    async () => {
      // Welche Ziele haben jetzt kein lesbares Geheimnis mehr? (Zeilen, die verschwunden sind)
      const left = new Set((await db.appSetting.findMany({ where: { key: { startsWith: WEBHOOK_SECRET_PREFIX } }, select: { key: true } })).map((r) => r.key.slice(WEBHOOK_SECRET_PREFIX.length)));
      for (const webhook of await db.webhook.findMany({ select: { id: true, name: true } })) if (!left.has(webhook.id)) affected.add(webhook.id);
    },
  );
  for (const id of affected) {
    const webhook = await db.webhook.findUnique({ where: { id }, select: { name: true } });
    await db.$transaction([
      db.webhook.update({ where: { id }, data: { enabled: false, disabledReason: "secret" } }),
      db.webhookDelivery.updateMany({ where: { webhookId: id, status: "pending" }, data: { status: "held" } }),
    ]);
    await audit("webhook.disabled", { actor: { id: null, name: "System" }, target: `${webhook?.name ?? id}: secret`, entityId: id });
  }
  return removed;
}

export const secretConsumers: SecretConsumerDef[] = [{ id: "webhooks.secret", feature: "admin.api", resetUnreadable: resetWebhookSecrets }];
