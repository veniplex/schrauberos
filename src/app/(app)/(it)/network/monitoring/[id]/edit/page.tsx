import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import type { MonitorKind } from "@/lib/monitor/model";
import { MonitorForm } from "@/modules/it/network/monitor-form";
import { getMonitorTarget, monitorFormChoices } from "@/modules/it/network/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.monitor.edit") };
}

export default async function EditMonitorTargetPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("network.monitor");
  if (!session.can("network.view")) redirect("/forbidden");
  const [{ t }, { id }, choices] = await Promise.all([getI18n(), params, monitorFormChoices()]);
  const target = await getMonitorTarget(id, { canManage: true });
  if (!target?.address) notFound();
  const { address } = target;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ href: "/network/monitoring", label: t("network.monitor.title") }, { href: `/network/monitoring/${target.id}`, label: target.name }]}
        help="it.network"
        title={t("network.monitor.edit")}
        description={target.name}
      />
      <MonitorForm
        cancelHref={`/network/monitoring/${target.id}`}
        devices={choices.devices}
        ips={choices.ips}
        initial={{
          id: target.id,
          version: target.version,
          name: target.name,
          kind: target.kind as MonitorKind,
          host: address.host,
          port: String(address.port),
          path: address.path ?? "",
          method: address.method,
          ignoreTlsErrors: address.ignoreTlsErrors,
          intervalSec: target.intervalSec,
          enabled: target.enabled,
          deviceId: target.device?.id ?? "",
        }}
      />
    </>
  );
}
