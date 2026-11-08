import type { Metadata } from "next";
import { redirect } from "next/navigation";
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

export default async function NewMonitorTargetPage({ searchParams }: { searchParams: Promise<{ device?: string }> }) {
  const session = await requirePermission("network.monitor");
  // Überwachen setzt das Ansehen des Netzwerks voraus (die Auswahl liest Geräte und IP-Adressen; wie in der Operation)
  if (!session.can("network.view")) redirect("/forbidden");
  const [{ t }, choices, { device }] = await Promise.all([getI18n(), monitorFormChoices(), searchParams]);
  return (
    <>
      <PageHeader back={{ href: "/network/monitoring", label: t("network.monitor.title") }} help="it.network" title={t("network.monitor.new")} />
      <MonitorForm
        cancelHref="/network/monitoring"
        devices={choices.devices}
        ips={choices.ips}
        initial={{ name: "", kind: "tcp", host: "", port: "", path: "", method: "HEAD", ignoreTlsErrors: false, intervalSec: DEFAULT_INTERVAL_SECONDS, enabled: true, deviceId: choices.devices.some((d) => d.id === device) ? (device ?? "") : "" }}
      />
    </>
  );
}
