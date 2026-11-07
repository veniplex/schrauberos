import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, ChipLink, EmptyState, StatusBadge, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { DUE_TONE } from "@/lib/due";
import { getI18n } from "@/i18n/server";
import { warrantyState } from "@/modules/it/network/domain";
import { DEVICE_TYPES } from "@/modules/it/network/constants";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { checkDevices } from "@/modules/it/network/queries";
import { DemoNotice, LinkStateBadge } from "@/modules/it/network/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.network") };
}

export default async function NetworkOverviewPage() {
  await requirePermission("network.view");
  const i18n = await getI18n();
  const { t, td, date } = i18n;

  const [devices, subnetCount, vlanCount, ipCount, connectionCount] = await Promise.all([
    db.netDevice.findMany({ orderBy: { name: "asc" } }),
    db.netSubnet.count(),
    db.netVlan.count(),
    db.netIp.count(),
    db.netConnection.count(),
  ]);

  const monitored = devices.filter((d) => d.monitorEnabled && d.status === "active");
  const checks = await checkDevices(monitored);
  const counts = { online: 0, degraded: 0, offline: 0 };
  for (const d of monitored) {
    const s = checks.get(d.id)?.state;
    if (s === "online" || s === "degraded" || s === "offline") counts[s]++;
  }
  const problems = monitored.filter((d) => ["offline", "degraded"].includes(checks.get(d.id)?.state ?? ""));

  const warranty = devices
    .filter((d) => d.status !== "retired" && ["expired", "soon"].includes(warrantyState(d.warrantyUntil) ?? ""))
    .sort((a, b) => a.warrantyUntil!.getTime() - b.warrantyUntil!.getTime());

  const byType = DEVICE_TYPES.map((type) => ({ type, n: devices.filter((d) => d.type === type && d.status !== "retired").length })).filter((x) => x.n > 0);

  const stat = (href: string, value: number, label: string) => <StatCard href={href} value={value} label={label} />;

  return (
    <>
      <PageHeader help="it.network" title={t("network.title")} description={t("network.description")} />

      <div className="mb-5">
        <DemoNotice t={t} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stat("/network/devices", devices.filter((d) => d.status !== "retired").length, t("network.stats.devices"))}
        {stat("/network/ip", subnetCount, t("network.stats.subnets"))}
        {stat("/network/ip", vlanCount, "VLANs")}
        {stat("/network/ip", ipCount, t("network.stats.ips"))}
        {stat("/network/cabling", connectionCount, t("network.stats.connections"))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              {t("network.widgets.statusTitle")} <Badge tone="info">{t("network.demoBadge")}</Badge>
            </span>
          }
          padded={false}
        >
          {monitored.length === 0 ? (
            <EmptyState title={t("network.widgets.statusEmpty")} hint={t("network.monitorHowTo")} />
          ) : (
            <>
              <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
                {(["online", "degraded", "offline"] as const).map((s) => (
                  <div key={s} className="px-3 py-3">
                    <p className="text-2xl font-semibold tabular">{counts[s]}</p>
                    <p className="text-xs text-ink-muted">{t(`enums.linkState.${s}`)}</p>
                  </div>
                ))}
              </div>
              {problems.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-muted">{t("network.widgets.allFine")}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {problems.map((d) => (
                    <li key={d.id}>
                      <Link href={`/network/devices/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-hover">
                        <span className="truncate text-sm font-medium">{d.name}</span>
                        <LinkStateBadge check={checks.get(d.id)} i18n={i18n} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        <Card title={t("network.sections.warranty")} padded={false}>
          {warranty.length === 0 ? (
            <EmptyState title={t("network.warranty.none")} />
          ) : (
            <ul className="divide-y divide-line">
              {warranty.map((d) => {
                const state = warrantyState(d.warrantyUntil);
                return (
                  <li key={d.id}>
                    <Link href={`/network/devices/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-hover">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="text-xs text-ink-muted">{td(`enums.deviceType.${d.type}`, d.type)}</span>
                      </span>
                      <StatusBadge tone={state ? DUE_TONE[state] : "neutral"}>
                        {state === "expired" ? t("network.warranty.expired") : t("network.warranty.soon")} · {date(d.warrantyUntil!)}
                      </StatusBadge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={t("network.sections.byType")} className="lg:col-span-2">
          {byType.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("network.devicesEmpty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {byType.map(({ type, n }) => (
                <li key={type}>
                  <ChipLink href={`/network/devices?type=${type}`}>
                    {td(`enums.deviceType.${type}`, type)} <span className="tabular font-semibold text-ink">{n}</span>
                  </ChipLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
