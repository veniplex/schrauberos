import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { db } from "@/server/db";
import { checkDevices } from "./queries";
import { LinkStateBadge } from "./ui";

/** Überblick über die (Demo-)Erreichbarkeit der überwachten Geräte. */
export async function NetworkStatusWidget() {
  const i18n = await getI18n();
  const { t, tp } = i18n;
  const devices = await db.netDevice.findMany({
    where: { monitorEnabled: true, status: "active" },
    select: { id: true, name: true, type: true, monitorEnabled: true },
    orderBy: { name: "asc" },
  });
  const checks = await checkDevices(devices);
  const counts = { online: 0, degraded: 0, offline: 0 };
  for (const d of devices) {
    const s = checks.get(d.id)?.state;
    if (s === "online" || s === "degraded" || s === "offline") counts[s]++;
  }
  const problems = devices.filter((d) => ["offline", "degraded"].includes(checks.get(d.id)?.state ?? ""));

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {t("network.widgets.statusTitle")} <Badge tone="info">{t("network.demoBadge")}</Badge>
        </span>
      }
      actions={
        <Link href="/network" className="text-sm text-accent-text hover:underline">
          {t("common.showAll")}
        </Link>
      }
      padded={false}
    >
      {devices.length === 0 ? (
        <EmptyState title={t("network.widgets.statusEmpty")} />
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
            <>
              <p className="px-5 pt-3 text-sm text-ink-muted">{tp("network.widgets.problemCount", problems.length)}</p>
              <ul className="divide-y divide-line">
                {problems.slice(0, 5).map((d) => (
                  <li key={d.id}>
                    <Link href={`/network/devices/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-hover">
                      <span className="truncate text-sm font-medium">{d.name}</span>
                      <LinkStateBadge check={checks.get(d.id)} i18n={i18n} />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
