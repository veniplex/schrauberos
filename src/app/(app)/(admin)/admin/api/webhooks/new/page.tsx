import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { MAX_WEBHOOKS } from "@/lib/webhooks/schedule";
import { eventGroups } from "@/modules/admin/api/event-groups";
import { offeredEvents } from "@/modules/admin/api/operations";
import { WebhookForm } from "@/modules/admin/api/webhook-form";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.webhooks.new") };
}

/** Neuer Webhook: Ziel, Ereignisse; das Geheimnis der Signatur entsteht beim Anlegen und wird einmal angezeigt. */
export default async function NewWebhookPage() {
  await requirePermission("api.manage");
  const { t, td } = await getI18n();
  const [events, count] = await Promise.all([offeredEvents(), db.webhook.count()]);
  return (
    <>
      <PageHeader back={{ href: "/admin/api/webhooks", label: t("api.webhooks.title") }} title={t("api.webhooks.new")} help="admin.api" />
      {count >= MAX_WEBHOOKS ? (
        <Alert tone="warning">{t("api.webhooks.errors.tooMany", { max: MAX_WEBHOOKS })}</Alert>
      ) : (
        <WebhookForm initial={{ name: "", url: "", events: [], enabled: false, allowPrivate: false }} groups={eventGroups(events, { t, td })} hasSecret />
      )}
    </>
  );
}
