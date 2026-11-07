import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, EmptyState, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { DUE_TONE } from "@/lib/due";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, parseListParams } from "@/lib/list-params";
import { DEVICE_STATUSES, DEVICE_TYPES } from "@/modules/it/network/constants";
import { warrantyState } from "@/modules/it/network/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { checkDevices, listDevices } from "@/modules/it/network/queries";
import { DemoNotice, DeviceStatusBadge, LinkStateBadge } from "@/modules/it/network/ui";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.devices") };
}

type SearchParams = { q?: string; type?: string; status?: string; location?: string; sort?: string; dir?: string; page?: string };
const SORTS = ["name", "model", "location"] as const;
type SortKey = (typeof SORTS)[number];
const DEFAULT = { sort: "name", dir: "asc" } as const;

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("network.view");
  const sp = await searchParams;
  const i18n = await getI18n();
  const { t, tp, td, date } = i18n;

  const type = (DEVICE_TYPES as readonly string[]).includes(sp.type ?? "") ? sp.type! : "";
  const status = (DEVICE_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const q = (sp.q ?? "").trim().toLowerCase();
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  const [all, locations] = await Promise.all([
    listDevices({ ...(type ? { type } : {}), ...(status ? { status } : {}), ...(sp.location ? { locationId: sp.location } : {}) }),
    db.netLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  // Durchsuchbar: Gerät, Hersteller/Modell, Seriennummer, Zuordnung, Standort sowie Adresse, Hostname und MAC der IPs – alles innerhalb von `network.view`
  const found = q
    ? all.filter((d) =>
        [d.name, d.manufacturer, d.model, d.serialNumber, d.assignedTo, d.location?.name, ...d.ips.flatMap((i) => [i.address, i.hostname, i.mac])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : all;
  const sign = list.dir === "asc" ? 1 : -1;
  const sorters: Record<SortKey, (a: (typeof found)[number], b: (typeof found)[number]) => number> = {
    name: (a, b) => sign * a.name.localeCompare(b.name),
    model: (a, b) => sign * `${a.manufacturer ?? ""} ${a.model ?? ""}`.localeCompare(`${b.manufacturer ?? ""} ${b.model ?? ""}`) || a.name.localeCompare(b.name),
    location: (a, b) => sign * (a.location?.name ?? "").localeCompare(b.location?.name ?? "") || a.name.localeCompare(b.name),
  };
  const sorted = [...found].sort(sorters[list.sort as SortKey]);
  const total = sorted.length;
  const page = clampPage(list.page, total, list.pageSize);
  const devices = sorted.slice((page - 1) * list.pageSize, page * list.pageSize);
  const checks = await checkDevices(devices);
  const canEdit = session.can("network.edit");
  const filters = { q: sp.q?.trim() || undefined, type: type || undefined, status: status || undefined, location: sp.location || undefined };
  const links = listLinks("/network/devices", filters, list, DEFAULT);

  return (
    <>
      <PageHeader
        back={{ href: "/network", label: t("nav.network") }}
        title={t("network.devicesTitle")}
        description={t("network.devicesDescription")}
        help="it.network"
        actions={
          canEdit ? (
            <LinkButton href="/network/devices/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("network.devicesNew")}
            </LinkButton>
          ) : null
        }
      />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]"
        active={Boolean(filters.q || type || status || sp.location)}
        extrasOpen={Boolean(type || status || sp.location)}
        resetHref="/network/devices"
        search={<SearchInput name="q" defaultValue={sp.q ?? ""} placeholder={t("network.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="type" defaultValue={type} aria-label={t("network.fields.type")}>
          <option value="">{t("network.filters.anyType")}</option>
          {DEVICE_TYPES.map((x) => (
            <option key={x} value={x}>
              {td(`enums.deviceType.${x}`, x)}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label={t("common.status")}>
          <option value="">{t("network.filters.anyStatus")}</option>
          {DEVICE_STATUSES.map((x) => (
            <option key={x} value={x}>
              {td(`enums.deviceStatus.${x}`, x)}
            </option>
          ))}
        </Select>
        <Select name="location" defaultValue={sp.location ?? ""} aria-label={t("network.fields.location")}>
          <option value="">{t("network.filters.anyLocation")}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      {devices.some((d) => d.monitorEnabled) ? (
        <div className="mb-4">
          <DemoNotice t={t} />
        </div>
      ) : null}

      <DataTable
        caption={t("network.devicesTitle")}
        rows={devices}
        rowKey={(d) => d.id}
        rowHref={(d) => `/network/devices/${d.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="56rem"
        summary={tp("network.devicesCount", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={
          <EmptyState
            title={t("network.devicesEmpty")}
            hint={t("network.devicesEmptyHint")}
            action={
              canEdit ? (
                <LinkButton href="/network/devices/new" variant="primary">
                  {t("network.devicesNew")}
                </LinkButton>
              ) : undefined
            }
          />
        }
        columns={[
          {
            id: "device",
            header: t("network.cols.device"),
            priority: "primary",
            sort: "name",
            cell: (d) => d.name,
            sub: (d) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge>{td(`enums.deviceType.${d.type}`, d.type)}</Badge>
                {d.status !== "active" ? <DeviceStatusBadge status={d.status} td={td} /> : null}
              </span>
            ),
          },
          {
            id: "model",
            header: t("network.cols.model"),
            sort: "model",
            cell: (d) => (
              <div className="text-sm">
                {[d.manufacturer, d.model].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span>}
                {d.assignedTo ? <div className="text-xs text-ink-muted">{d.assignedTo}</div> : null}
              </div>
            ),
          },
          {
            id: "location",
            header: t("network.cols.location"),
            sort: "location",
            cell: (d) => (
              <div className="text-sm">
                {d.location?.name ?? <span className="text-ink-muted">–</span>}
                {d.rackInfo ? <div className="text-xs text-ink-muted">{d.rackInfo}</div> : null}
              </div>
            ),
          },
          {
            id: "ips",
            header: t("network.cols.ips"),
            cell: (d) => (
              <div className="font-mono text-[13px] tabular">
                {d.ips.length ? d.ips.map((i) => <div key={i.id}>{i.address}</div>) : <span className="font-sans text-ink-muted">–</span>}
              </div>
            ),
          },
          {
            id: "warranty",
            header: t("network.cols.warranty"),
            cell: (d) => {
              const w = warrantyState(d.warrantyUntil);
              return d.warrantyUntil ? (
                <StatusBadge tone={w ? DUE_TONE[w] : "neutral"}>{date(d.warrantyUntil)}</StatusBadge>
              ) : (
                <span className="text-ink-muted">–</span>
              );
            },
          },
          { id: "reach", header: t("network.cols.reachability"), cell: (d) => <LinkStateBadge check={checks.get(d.id)} i18n={i18n} /> },
        ]}
      />
    </>
  );
}
