import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { DEFAULT_INTERVAL_SECONDS } from "@/lib/monitor/model";
import { MonitorForm } from "@/modules/it/network/monitor-form";
import { monitorFormChoices } from "@/modules/it/network/queries";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("network.monitor.new") };
}

export default async function NewMonitorTargetPage() {
  await requirePermission("network.monitor");
  const [{ t }, choices] = await Promise.all([getI18n(), monitorFormChoices()]);
  return (
    <>
      <PageHeader back={{ href: "/network/monitoring", label: t("network.monitor.title") }} help="it.network" title={t("network.monitor.new")} />
      <MonitorForm
        cancelHref="/network/monitoring"
        devices={choices.devices}
        ips={choices.ips}
        initial={{ name: "", kind: "tcp", host: "", port: "", path: "", method: "HEAD", ignoreTlsErrors: false, intervalSec: DEFAULT_INTERVAL_SECONDS, enabled: true, deviceId: "" }}
      />
    </>
  );
}
