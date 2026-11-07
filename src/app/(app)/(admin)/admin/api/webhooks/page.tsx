import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Alert, Badge, Card, EmptyState, StatusBadge } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitSwitch } from "@/components/ui/switch";
import { getI18n } from "@/i18n/server";
import { MAX_WEBHOOKS } from "@/lib/webhooks/schedule";
import { setWebhookEnabled } from "@/modules/admin/api/actions";
import { ApiTabs } from "@/modules/admin/api/api-tabs";
import { DeliveryTable } from "@/modules/admin/api/deliveries";
import { deadLetterCount, deliveryRows, webhookRows } from "@/modules/admin/api/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("api.webhooks.title") };
}

/** Webhooks (Recht `api.manage`): Ziele mit Schalter, aufgegebene Zustellungen (Dead-Letter) und das Zustellprotokoll. */
export default async function WebhooksPage() {
  await requirePermission("api.manage");
  const { t, td, date } = await getI18n();
  const [webhooks, deliveries, dead] = await Promise.all([webhookRows(), deliveryRows({ take: 50 }), deadLetterCount()]);
  const stamp = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title={t("api.title")}
        description={t("api.description")}
        help="admin.api"
        actions={
          webhooks.length < MAX_WEBHOOKS ? (
            <LinkButton variant="primary" href="/admin/api/webhooks/new">
              <Plus className="size-4" aria-hidden /> {t("api.webhooks.new")}
            </LinkButton>
          ) : null
        }
      />
      <ApiTabs active="webhooks" />
      <div className="flex max-w-5xl flex-col gap-5">
        <Alert tone="info">{t("api.webhooks.intro")}</Alert>
        {dead > 0 ? <Alert tone="danger">{t("api.webhooks.deadLetter", { count: dead })}</Alert> : null}

        <DataTable
          caption={t("api.webhooks.title")}
          rows={webhooks}
          rowKey={(w) => w.id}
          rowHref={(w) => `/admin/api/webhooks/${w.id}`}
          minWidth="48rem"
          empty={<EmptyState title={t("api.webhooks.empty")} hint={t("api.webhooks.emptyHint")} />}
          columns={[
            { id: "name", header: t("api.webhooks.form.name"), priority: "primary", cell: (w) => w.name, sub: (w) => <span>{w.host}</span> },
            { id: "events", header: t("api.webhooks.list.events"), cell: (w) => <span className="tabular">{t("api.webhooks.list.eventsCount", { count: w.events.length })}</span> },
            {
              id: "state",
              header: t("api.webhooks.list.state"),
              cell: (w) => (
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? t("api.webhooks.list.on") : t("api.webhooks.list.off")}</StatusBadge>
                  {w.disabledReason ? <span className="text-xs text-warning-ink">{td(`api.webhooks.disabledReason.${w.disabledReason}`, w.disabledReason)}</span> : null}
                  {!w.hasSecret ? <Badge tone="warning">{t("api.webhooks.list.noSecret")}</Badge> : null}
                </span>
              ),
            },
            {
              id: "delivery",
              header: t("api.webhooks.list.delivery"),
              cell: (w) => (
                <span className="flex flex-col gap-0.5 text-sm text-ink-muted">
                  <span>{w.lastSentAt ? t("api.webhooks.list.lastSent", { time: stamp(w.lastSentAt) }) : t("api.webhooks.list.neverSent")}</span>
                  {w.pending > 0 || w.held > 0 || w.failed > 0 ? (
                    <span>
                      {w.pending > 0 ? t("api.webhooks.list.pending", { count: w.pending }) : null}
                      {w.held > 0 ? ` ${t("api.webhooks.list.held", { count: w.held })}` : null}
                      {w.failed > 0 ? <span className="text-danger-ink"> {t("api.webhooks.list.failed", { count: w.failed })}</span> : null}
                    </span>
                  ) : null}
                  {w.dropped > 0 ? <span className="text-warning-ink">{t("api.webhooks.list.dropped", { count: w.dropped })}</span> : null}
                </span>
              ),
            },
            {
              id: "switch",
              header: t("api.webhooks.list.switch"),
              hideHeader: true,
              align: "end",
              cell: (w) => (
                <form action={setWebhookEnabled}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="enabled" value={String(!w.enabled)} />
                  <SubmitSwitch
                    checked={w.enabled}
                    disabled={!w.hasSecret && !w.enabled}
                    label={`${t("api.webhooks.list.switchLabel")}: ${w.name}`}
                    confirm={{ title: `${t("api.webhooks.list.turnOff")}: ${w.name}?`, message: t("api.webhooks.list.turnOffHint"), confirmLabel: t("api.webhooks.list.turnOff") }}
                  />
                </form>
              ),
            },
          ]}
        />

        <Card title={t("api.webhooks.log.title")}>
          <p className="mb-3 text-sm text-ink-muted">{t("api.webhooks.log.intro")}</p>
          <DeliveryTable rows={deliveries} showWebhook />
        </Card>
      </div>
    </>
  );
}
