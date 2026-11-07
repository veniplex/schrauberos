import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { SegmentedLinks } from "@/components/ui/segmented";
import { TabNav } from "@/components/ui/tab-nav";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { clampPage, listHref, listLinks, parseListParams, sortFields } from "@/lib/list-params";
import { employeeName } from "@/modules/office/employees/public";
import { FLEET_STATUSES, type FleetStatus } from "@/modules/office/fleet/domain";
import { FLEET_STATUS_TONE } from "@/modules/office/fleet/status-tone";
import { requirePermission } from "@/server/auth/session";
import { contains, searchWhere } from "@/server/search";
import { listFleet, type FleetRow } from "@/modules/office/fleet/queries";
import { DueBadge } from "@/modules/office/fleet/ui";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.fleet") };
}

const SORTS = ["plate", "vehicle", "km"] as const;
type SortKey = (typeof SORTS)[number];
const DEFAULT = { sort: "plate", dir: "asc" } as const;

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; due?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("fleet.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, td, number } = i18n;
  const q = (sp.q ?? "").trim();
  const status = sp.status === "all" || (FLEET_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "current";
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  // Durchsuchbar: Kennzeichen, Marke/Modell, FIN und Name des Fahrers (nicht Tankkarte oder Police)
  const text = searchWhere<Prisma.FleetVehicleWhereInput>(q, session.can, [
    { where: (term) => ({ plate: contains(term) }) },
    { where: (term) => ({ make: contains(term) }) },
    { where: (term) => ({ model: contains(term) }) },
    { where: (term) => ({ vin: contains(term) }) },
    { where: (term) => ({ driver: { is: { OR: [{ lastName: contains(term) }, { firstName: contains(term) }] } } }) },
  ]);
  let vehicles = await listFleet({ ...(status === "current" ? { status: { not: "sold" } } : status !== "all" ? { status } : {}), ...(text ?? {}) });
  const dueCount = vehicles.filter((v) => v.dues.length > 0).length;
  if (sp.due) vehicles = vehicles.filter((v) => v.dues.length > 0);

  const sign = list.dir === "asc" ? 1 : -1;
  const sorters: Record<SortKey, (a: FleetRow, b: FleetRow) => number> = {
    plate: (a, b) => sign * a.plate.localeCompare(b.plate),
    vehicle: (a, b) => sign * `${a.make ?? ""} ${a.model ?? ""}`.localeCompare(`${b.make ?? ""} ${b.model ?? ""}`) || a.plate.localeCompare(b.plate),
    km: (a, b) => sign * ((a.currentKm ?? -1) - (b.currentKm ?? -1)) || a.plate.localeCompare(b.plate),
  };
  vehicles = vehicles.sort(sorters[list.sort as SortKey]);
  const total = vehicles.length;
  const page = clampPage(list.page, total, list.pageSize);
  const pageRows = vehicles.slice((page - 1) * list.pageSize, page * list.pageSize);
  const canEdit = session.can("fleet.edit");

  const filters = { q: q || undefined, status: status !== "current" ? status : undefined, due: sp.due ? "1" : undefined };
  const links = listLinks("/fleet", filters, list, DEFAULT);

  return (
    <>
      <PageHeader
        title={t("fleet.title")}
        description={t("fleet.description")}
        help="office.fleet"
        actions={
          canEdit ? (
            <LinkButton href="/fleet/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("fleet.new")}
            </LinkButton>
          ) : null
        }
      />
      <TabNav
        label={t("fleet.title")}
        items={[
          { href: "/fleet", label: t("fleet.tabs.vehicles"), active: true },
          { href: "/fleet/licenses", label: t("fleet.tabs.licenses"), active: false },
        ]}
      />

      <SegmentedLinks
        label={t("fleet.cols.dues")}
        className="mb-4"
        options={[
          { href: listHref("/fleet", { q: filters.q, status: filters.status }), label: t("fleet.filters.all"), active: !sp.due },
          { href: listHref("/fleet", { q: filters.q, status: filters.status, due: 1 }), label: `${t("fleet.filters.due")} (${dueCount})`, active: !!sp.due },
        ]}
      />

      <FilterBar
        keep={sortFields(list, DEFAULT)}
        columns="sm:grid-cols-[minmax(0,1fr)_11rem_auto]"
        active={Boolean(q || status !== "current")}
        extrasOpen={status !== "current"}
        resetHref={listHref("/fleet", { due: filters.due })}
        search={<SearchInput name="q" defaultValue={q} placeholder={t("fleet.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        {sp.due ? <input type="hidden" name="due" value="1" /> : null}
        <Select name="status" defaultValue={status} aria-label={t("common.status")}>
          <option value="current">{t("fleet.filters.current")}</option>
          <option value="all">{t("fleet.filters.anyStatus")}</option>
          {FLEET_STATUSES.map((x) => (
            <option key={x} value={x}>
              {td(`fleet.statuses.${x}`, x)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption={t("fleet.title")}
        rows={pageRows}
        rowKey={(v) => v.id}
        rowHref={(v) => `/fleet/${v.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="52rem"
        summary={tp("fleet.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("fleet.empty")} hint={t("fleet.emptyHint")} />}
        columns={[
          {
            id: "plate",
            header: t("vehicles.fields.plate"),
            priority: "primary",
            sort: "plate",
            cell: (v) => <Plate>{v.plate}</Plate>,
            sub: (v) => (v.status !== "active" ? <StatusBadge tone={FLEET_STATUS_TONE[v.status as FleetStatus] ?? "neutral"}>{td(`fleet.statuses.${v.status}`, v.status)}</StatusBadge> : null),
          },
          { id: "vehicle", header: t("vehicles.cols.vehicle"), sort: "vehicle", cell: (v) => [v.make, v.model].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span> },
          {
            id: "driver",
            header: t("fleet.fields.driver"),
            cell: (v) =>
              v.driver ? (
                <TextLink href={`/employees/${v.driver.id}`} className="text-inherit no-underline hover:underline">
                  {employeeName(v.driver)}
                </TextLink>
              ) : (
                <span className="text-ink-muted">{t("fleet.noDriver")}</span>
              ),
          },
          { id: "km", header: t("fleet.fields.km"), align: "end", sort: "km", cell: (v) => (v.currentKm != null ? `${number(v.currentKm)} km` : "–") },
          {
            id: "dues",
            header: t("fleet.cols.dues"),
            cell: (v) => (
              <div className="flex flex-wrap gap-1.5">{v.dues.length ? v.dues.map((d) => <DueBadge key={d.kind} due={d} i18n={i18n} />) : <span className="text-ink-muted">–</span>}</div>
            ),
          },
        ]}
      />
    </>
  );
}
