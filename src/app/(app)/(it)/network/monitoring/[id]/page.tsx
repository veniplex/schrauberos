import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Chart } from "@/components/ui/chart";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { LinkButton } from "@/components/ui/buttons";
import { Card, DangerZone, DefinitionList, EmptyState } from "@/components/ui/layout";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { viewOf } from "@/lib/monitor/model";
import { targetLabel } from "@/lib/monitor/target";
import { deleteMonitorTarget } from "@/modules/it/network/monitor-actions";
import { durationText, intervalText } from "@/modules/it/network/monitor-format";
import { getMonitorTarget, monitorHistory } from "@/modules/it/network/queries";
import { TargetStateBadge } from "@/modules/it/network/ui";
import { requirePermission, sessionIfAllowed } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await sessionIfAllowed("network.view"))) return {};
  const target = await db.netMonitorTarget.findUnique({ where: { id }, select: { name: true } });
  return { title: target?.name };
}

const CHART_HOURS = 48;

export default async function MonitorTargetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("network.view");
  const canManage = session.can("network.monitor");
  const { id } = await params;
  const i18n = await getI18n();
  const { t, date, number } = i18n;
  const target = await getMonitorTarget(id, { canManage });
  if (!target) notFound();
  const now = new Date();
  const history = await monitorHistory(target.id, now);
  const view = viewOf(target, now);
  const stamp = (d: Date) => date(d, { dateStyle: "medium", timeStyle: "short" });

  const lastHours = history.hours.slice(-CHART_HOURS);
  const failed = history.recent.filter((s) => !s.ok).length;

  return (
    <>
      <PageHeader
        back={{ href: "/network/monitoring", label: t("network.monitor.title") }}
        help="it.network"
        title={target.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TargetStateBadge state={target.enabled ? view.state : "unknown"} stale={target.enabled && view.stale} t={t} />
            {target.address ? <span className="font-mono text-xs">{targetLabel({ kind: target.kind, ...target.address })}</span> : null}
          </span>
        }
        actions={
          canManage ? (
            <LinkButton href={`/network/monitoring/${target.id}/edit`}>
              <Pencil className="size-4" aria-hidden /> {t("common.edit")}
            </LinkButton>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 md:col-span-2">
          <Card title={t("network.monitor.sections.history")}>
            {lastHours.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("network.monitor.detail.noHistory")}</p>
            ) : (
              <Chart
                type="line"
                title={t("network.monitor.detail.chartTitle")}
                categories={lastHours.map((h) => date(h.hour, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}
                series={[{ id: "latency", label: t("network.monitor.detail.chartSeries"), values: lastHours.map((h) => h.latencyAvgMs) }]}
                categoryLabel={t("network.monitor.cols.checked")}
                integer
              />
            )}
          </Card>

          <Card title={t("network.monitor.sections.recent")}>
            {history.recent.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("network.monitor.detail.noHistory")}</p>
            ) : (
              <>
                <div role="img" aria-label={`${history.recent.length} / ${failed}`} className="flex h-8 items-end gap-0.5">
                  {history.recent.map((s) => (
                    <span
                      key={s.at.toISOString()}
                      title={`${stamp(s.at)} · ${t(`network.monitor.classes.${s.statusClass as "2xx"}`)}${s.latencyMs !== null ? ` · ${t("network.monitor.ms", { n: s.latencyMs })}` : ""}`}
                      className={`w-1.5 min-w-1 flex-1 rounded-sm ${s.ok ? "h-8 bg-success-ink" : "h-3 bg-danger-ink"}`}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-muted">{t("network.monitor.detail.recentHint")}</p>
              </>
            )}
          </Card>

          <Card title={t("network.monitor.sections.events")} padded={false}>
            <DataTable
              bare
              caption={t("network.monitor.sections.events")}
              rows={history.events}
              rowKey={(e) => e.id}
              minWidth="28rem"
              empty={<EmptyState title={t("network.monitor.detail.noEvents")} />}
              columns={[
                { id: "at", header: t("network.monitor.cols.checked"), priority: "primary", cell: (e) => stamp(e.at) },
                {
                  id: "kind",
                  header: t("network.monitor.cols.status"),
                  cell: (e) => (e.kind === "down" ? t("network.monitor.detail.eventDown") : t("network.monitor.detail.eventUp")),
                  sub: (e) => (e.kind === "up" && e.downSeconds !== null ? <span>{t("network.monitor.detail.downFor", { duration: durationText(e.downSeconds) })}</span> : null),
                },
              ]}
            />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card title={t("network.monitor.sections.state")}>
            <DefinitionList
              items={[
                { label: t("network.monitor.cols.status"), value: <TargetStateBadge state={target.enabled ? view.state : "unknown"} stale={target.enabled && view.stale} t={t} /> },
                { label: t("network.monitor.cols.device"), value: target.device ? <Link href={`/network/devices/${target.device.id}`} className="font-medium hover:underline">{target.device.name}</Link> : null },
                { label: t("network.monitor.cols.result"), value: target.lastClass ? t(`network.monitor.classes.${target.lastClass as "2xx"}`) : null },
                { label: t("network.monitor.cols.latency"), value: target.lastLatencyMs !== null ? t("network.monitor.ms", { n: target.lastLatencyMs }) : null },
                { label: t("network.monitor.detail.lastCheck"), value: target.lastCheckAt ? stamp(target.lastCheckAt) : t("network.monitor.never") },
                { label: t("network.monitor.detail.since"), value: target.stateSince ? stamp(target.stateSince) : null },
                { label: t("network.monitor.cols.interval"), value: intervalText(i18n, target.intervalSec) },
                { label: t("network.monitor.detail.availability"), value: history.availability30d !== null ? `${number(history.availability30d, { maximumFractionDigits: 1 })} %` : null },
              ]}
            />
            <p className="mt-4 text-xs text-ink-muted">{t("network.monitor.detail.privacy")}</p>
          </Card>

          {canManage ? (
            <DangerZone title={t("common.dangerZone")}>
              <form action={deleteMonitorTarget}>
                <input type="hidden" name="id" value={target.id} />
                <ConfirmSubmitButton message={t("network.monitor.deleteConfirm", { name: target.name })}>{t("network.monitor.delete")}</ConfirmSubmitButton>
              </form>
            </DangerZone>
          ) : null}
        </div>
      </div>
    </>
  );
}
