import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { DEVICE_STATUSES, DEVICE_TYPES } from "@/lib/domain/constants";
import { warrantyState } from "@/lib/domain/network";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { checkDevices, listDevices } from "@/modules/network/queries";
import { DemoNotice, DeviceStatusBadge, LinkStateBadge } from "@/modules/network/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.devices") };
}

type SearchParams = { q?: string; type?: string; status?: string; location?: string };

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("network.view");
  const sp = await searchParams;
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;

  const type = (DEVICE_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type! : "";
  const status = (DEVICE_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const q = (sp.q ?? "").trim().toLowerCase();

  const [all, locations] = await Promise.all([
    listDevices({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(sp.location ? { locationId: sp.location } : {}) }),
    db.netLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const devices = q
    ? all.filter((d) =>
        [d.name, d.manufacturer, d.model, d.serialNumber, d.assignedTo, d.location?.name, ...d.ips.flatMap((i) => [i.address, i.hostname, i.mac])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : all;
  const checks = await checkDevices(devices);
  const canEdit = session.can("network.edit");

  return (
    <>
      <PageHeader
        title={t("network.devicesTitle")}
        description={t("network.devicesDescription")}
        actions={
          canEdit ? (
            <LinkButton href="/network/devices/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("network.devicesNew")}
            </LinkButton>
          ) : null
        }
      />

      <form method="get" className="card card-pad mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={sp.q ?? ""} className="input pl-9" placeholder={t("network.searchPlaceholder")} aria-label={t("common.search")} />
        </div>
        <select name="type" defaultValue={type} className="input" aria-label={t("network.fields.type")}>
          <option value="">{t("network.filters.anyType")}</option>
          {DEVICE_TYPES.map((x) => (
            <option key={x} value={x}>
              {td(`enums.deviceType.${x}`, x)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className="input" aria-label={t("common.status")}>
          <option value="">{t("network.filters.anyStatus")}</option>
          {DEVICE_STATUSES.map((x) => (
            <option key={x} value={x}>
              {td(`enums.deviceStatus.${x}`, x)}
            </option>
          ))}
        </select>
        <select name="location" defaultValue={sp.location ?? ""} className="input" aria-label={t("network.fields.location")}>
          <option value="">{t("network.filters.anyLocation")}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          {t("common.filter")}
        </button>
      </form>

      {devices.some((d) => d.monitorEnabled) ? (
        <div className="mb-4">
          <DemoNotice t={t} />
        </div>
      ) : null}

      <section className="card overflow-hidden">
        {devices.length === 0 ? (
          <EmptyState
            title={t("network.devicesEmpty")}
            hint={t("network.devicesEmptyHint")}
            action={canEdit ? <LinkButton href="/network/devices/new" variant="primary">{t("network.devicesNew")}</LinkButton> : undefined}
          />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("network.devicesCount", devices.length)}</p>
            <div className="overflow-x-auto">
              <table className="table min-w-[56rem]">
                <thead>
                  <tr>
                    <th>{t("network.cols.device")}</th>
                    <th>{t("network.cols.model")}</th>
                    <th>{t("network.cols.location")}</th>
                    <th>{t("network.cols.ips")}</th>
                    <th>{t("network.cols.warranty")}</th>
                    <th>{t("network.cols.reachability")}</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const w = warrantyState(d.warrantyUntil);
                    return (
                      <tr key={d.id} className="row-link">
                        <td>
                          <Link href={`/network/devices/${d.id}`} className="font-medium hover:underline">
                            {d.name}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge>{td(`enums.deviceType.${d.type}`, d.type)}</Badge>
                            {d.status !== "active" ? <DeviceStatusBadge status={d.status} td={td} /> : null}
                          </div>
                        </td>
                        <td className="text-sm">
                          {[d.manufacturer, d.model].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span>}
                          {d.assignedTo ? <div className="text-xs text-ink-muted">{d.assignedTo}</div> : null}
                        </td>
                        <td className="text-sm">
                          {d.location?.name ?? <span className="text-ink-muted">–</span>}
                          {d.rackInfo ? <div className="text-xs text-ink-muted">{d.rackInfo}</div> : null}
                        </td>
                        <td className="font-mono text-[13px] tabular">
                          {d.ips.length ? d.ips.map((i) => <div key={i.id}>{i.address}</div>) : <span className="font-sans text-ink-muted">–</span>}
                        </td>
                        <td className="text-sm whitespace-nowrap">
                          {d.warrantyUntil ? (
                            <Badge tone={w === "expired" ? "danger" : w === "soon" ? "warning" : "neutral"}>{date(d.warrantyUntil)}</Badge>
                          ) : (
                            <span className="text-ink-muted">–</span>
                          )}
                        </td>
                        <td>
                          <LinkStateBadge check={checks.get(d.id)} i18n={i18n} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
