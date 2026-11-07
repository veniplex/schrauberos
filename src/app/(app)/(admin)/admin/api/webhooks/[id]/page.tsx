import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Alert, Card, DangerZone } from "@/components/ui/layout";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { versionOf } from "@/lib/concurrency";
import { deleteWebhook } from "@/modules/admin/api/actions";
import { DeliveryTable } from "@/modules/admin/api/deliveries";
import { eventGroups } from "@/modules/admin/api/event-groups";
import { offeredEvents } from "@/modules/admin/api/operations";
import { deliveryRows } from "@/modules/admin/api/queries";
import { RotateSecret, TestWebhook, WebhookForm } from "@/modules/admin/api/webhook-form";
import { db } from "@/server/db";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { parseEvents } from "@/server/webhooks/deliver";
import { hasWebhookSecret } from "@/server/webhooks/secrets";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  // Der Titel kommt aus der Datenbank – nur mit dem Recht
  if (!(await sessionIfAllowed("api.manage"))) return { title: t("api.webhooks.title") };
  const { id } = await params;
  const row = await db.webhook.findUnique({ where: { id }, select: { name: true } });
  return { title: row ? row.name : t("api.webhooks.title") };
}

/** Webhook bearbeiten: Ziel und Ereignisse, Geheimnis erneuern, Test-Ereignis, Zustellprotokoll, Löschen. */
export default async function WebhookPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("api.manage");
  const { id } = await params;
  const row = await db.webhook.findUnique({ where: { id } });
  if (!row) notFound();
  const { t, td } = await getI18n();
  const [events, hasSecret, deliveries] = await Promise.all([offeredEvents(), hasWebhookSecret(row.id), deliveryRows({ webhookId: row.id, take: 30 })]);
  // Abonnierte Ereignisse, die nicht (mehr) angeboten werden (Funktion aus), bleiben sichtbar – sonst gingen sie beim Speichern still verloren
  const subscribed = parseEvents(row.events);
  const known = new Set(events.map((e) => e.type));
  const extra = subscribed.filter((type) => !known.has(type)).map((type) => ({ type, feature: "admin.api" }));

  return (
    <>
      <PageHeader back={{ href: "/admin/api/webhooks", label: t("api.webhooks.title") }} title={row.name} help="admin.api" />
      <div className="flex max-w-3xl flex-col gap-5">
        {row.disabledReason ? <Alert tone="warning">{t("api.webhooks.disabledNote", { reason: td(`api.webhooks.disabledReason.${row.disabledReason}`, row.disabledReason) })}</Alert> : null}
        <WebhookForm
          initial={{ id: row.id, version: versionOf(row), name: row.name, url: row.url, events: subscribed, enabled: row.enabled, allowPrivate: row.allowPrivate }}
          groups={eventGroups([...events, ...extra], { t, td })}
          hasSecret={hasSecret}
        />
        <Card title={t("api.webhooks.secret.title")}>
          <RotateSecret id={row.id} hasSecret={hasSecret} />
        </Card>
        <Card title={t("api.webhooks.test.title")}>
          <TestWebhook id={row.id} />
        </Card>
        <Card title={t("api.webhooks.log.title")}>
          <DeliveryTable rows={deliveries} showWebhook={false} />
        </Card>
        <DangerZone title={t("api.webhooks.delete.title")}>
          <p className="mb-3 text-sm text-ink-muted">{t("api.webhooks.delete.hint")}</p>
          <form action={deleteWebhook}>
            <input type="hidden" name="id" value={row.id} />
            <ConfirmSubmitButton size="md" message={t("api.webhooks.delete.confirm")} target={row.name}>
              <Trash2 className="size-4" aria-hidden /> {t("api.webhooks.delete.action")}
            </ConfirmSubmitButton>
          </form>
        </DangerZone>
      </div>
    </>
  );
}
