import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Alert, Card, EmptyState, StatCard } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitSwitch } from "@/components/ui/switch";
import { getI18n } from "@/i18n/server";
import { viewOf } from "@/lib/monitor/model";
import { targetLabel } from "@/lib/monitor/target";
import { setMonitoring } from "@/modules/it/network/monitor-actions";
import { intervalText } from "@/modules/it/network/monitor-format";
import { listMonitorTargets, monitoringEnabled, monitorSummary } from "@/modules/it/network/queries";
import { TargetStateBadge } from "@/modules/it/network/ui";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.monitor.title") };
}

/**
 * Überwachung (F12): Schalter, Zusammenfassung und alle Ziele mit **gemessenem** Zustand. Wer nur `network.view` hat, sieht Name, Gerät, Zustand und Ergebnis – die Zieladresse (Host, Port, Pfad)
 * liest die Seite für diese Person gar nicht erst aus der Datenbank. Der Schalter und „Ziel hinzufügen“ brauchen `network.monitor`.
 */
export default async function MonitoringPage() {
  const session = await requirePermission("network.view");
  const canManage = session.can("network.monitor");
  const i18n = await getI18n();
  const { t, tp, date } = i18n;
  const now = new Date();
  const [targets, enabled, summary] = await Promise.all([listMonitorTargets({ canManage }), monitoringEnabled(), monitorSummary(now)]);
  const stamp = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        back={{ href: "/network", label: t("nav.network") }}
        help="it.network"
        title={t("network.monitor.title")}
        description={t("network.monitor.description")}
        actions={
          canManage ? (
            <LinkButton href="/network/monitoring/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("network.monitor.new")}
            </LinkButton>
          ) : null
        }
      />

      <div className="flex max-w-6xl flex-col gap-5">
        <Card title={t("network.monitor.switchTitle")}>
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 text-sm">{enabled ? t("network.monitor.switchOn") : t("network.monitor.switchOff")}</p>
            {canManage ? (
              <form action={setMonitoring} className="shrink-0">
                <input type="hidden" name="enabled" value={String(!enabled)} />
                <SubmitSwitch
                  checked={enabled}
                  label={t("network.monitor.switchTitle")}
                  confirm={{ title: `${t("network.monitor.turnOff")}?`, message: t("network.monitor.switchOff"), confirmLabel: t("network.monitor.turnOff") }}
                />
              </form>
            ) : null}
          </div>
        </Card>

        {!enabled ? <Alert tone="info">{t("network.monitor.offNotice")}</Alert> : null}

        {enabled && targets.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t("network.monitor.stats.up")} value={summary.up} tone={summary.up > 0 ? "success" : undefined} />
            <StatCard label={t("network.monitor.stats.warn")} value={summary.warn} tone={summary.warn > 0 ? "warning" : undefined} />
            <StatCard label={t("network.monitor.stats.down")} value={summary.down} tone={summary.down > 0 ? "danger" : undefined} />
            <StatCard label={t("network.monitor.stats.unknown")} value={summary.unknown} />
          </div>
        ) : null}

        <DataTable
          caption={t("network.monitor.title")}
          rows={targets}
          rowKey={(row) => row.id}
          rowHref={(row) => `/network/monitoring/${row.id}`}
          minWidth="56rem"
          summary={tp("network.monitor.count", targets.length)}
          empty={<EmptyState title={t("network.monitor.noTargets")} hint={t("network.monitor.noTargetsHint")} />}
          columns={[
            {
              id: "name",
              header: t("network.monitor.cols.name"),
              priority: "primary",
              cell: (row) => row.name,
              sub: (row) => (row.address ? <span className="font-mono text-xs">{targetLabel({ kind: row.kind, ...row.address })}</span> : <span>{t(`network.monitor.kind.${row.kind as "tcp" | "http" | "https"}`)}</span>),
            },
            { id: "device", header: t("network.monitor.cols.device"), cell: (row) => row.device?.name ?? <span className="text-ink-muted">–</span> },
            {
              id: "status",
              header: t("network.monitor.cols.status"),
              cell: (row) => {
                // Ohne Überwachung oder bei ausgeschaltetem Ziel gibt es keinen Zustand, der gezeigt werden dürfte
                if (!enabled || !row.enabled) return <TargetStateBadge state="unknown" t={t} />;
                const view = viewOf(row, now);
                return <TargetStateBadge state={view.state} stale={view.stale} t={t} />;
              },
            },
            { id: "latency", header: t("network.monitor.cols.latency"), cell: (row) => (enabled && row.enabled && row.lastLatencyMs !== null ? t("network.monitor.ms", { n: row.lastLatencyMs }) : <span className="text-ink-muted">–</span>) },
            {
              id: "result",
              header: t("network.monitor.cols.result"),
              cell: (row) => (enabled && row.enabled && row.lastClass ? t(`network.monitor.classes.${row.lastClass as "2xx"}`) : <span className="text-ink-muted">–</span>),
            },
            {
              id: "checked",
              header: t("network.monitor.cols.checked"),
              cell: (row) => (row.lastCheckAt ? stamp(row.lastCheckAt) : <span className="text-ink-muted">{t("network.monitor.never")}</span>),
              sub: (row) => (row.enabled ? <span>{t("network.monitor.everyInterval", { interval: intervalText(i18n, row.intervalSec) })}</span> : <span>{t("network.monitor.disabled")}</span>),
            },
          ]}
        />

        <Card title={t("network.monitor.notes.title")}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>{t("network.monitor.notes.noPing")}</li>
            <li>{t("network.monitor.notes.debounce")}</li>
            <li>{t("network.monitor.notes.stale")}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
