import type { Metadata } from "next";
import { Plus, Printer } from "lucide-react";
import { Badge, EmptyState, Plate, StatusBadge, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { nowDate } from "@/lib/dates";
import { isMonth, monthStart } from "@/lib/month";
import { inspectionState, monthOf } from "@/modules/workshop/vehicles/domain";
import { vehicleListWhere } from "@/modules/workshop/vehicles/queries";
import { INSPECTION_TONE } from "@/modules/workshop/vehicles/status-tone";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { Input, SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.vehicles") };
}

const SORTS = ["plate", "vehicle", "inspection"] as const;
const DEFAULT = { sort: "plate", dir: "asc" } as const;

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string; inspection?: string; month?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("vehicles.view");
  const [{ t, tp, date }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const noOwnerOnly = sp.owner === "none";
  // Prüffrist: „bald fällig oder überfällig“, „ohne Frist“ oder ein bestimmter Monat (Liste für Anrufe, siehe Druckliste)
  const thisMonth = monthOf(nowDate());
  const inspection = sp.inspection === "soon" || sp.inspection === "none" ? sp.inspection : undefined;
  const month = sp.month && isMonth(sp.month) ? sp.month : undefined;
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  const where = vehicleListWhere({ q, noOwnerOnly, inspection, month }, session.can, thisMonth);

  const total = await db.vehicle.count({ where });
  const page = clampPage(list.page, total, list.pageSize);
  const orderBy =
    list.sort === "vehicle"
      ? [{ make: list.dir }, { model: list.dir }, { plateNorm: "asc" as const }]
      : list.sort === "inspection"
        ? [{ inspectionDue: list.dir }, { plateNorm: "asc" as const }]
        : [{ plateNorm: list.dir }];
  const vehicles = await db.vehicle.findMany({ where, include: { customer: true, _count: { select: { tireSets: true, appointments: true } } }, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("vehicles.edit");
  const canSeeCustomers = session.can("customers.view");
  const filters = { q: q || undefined, owner: noOwnerOnly ? "none" : undefined, inspection, month };
  const links = listLinks("/vehicles", filters, list, DEFAULT);
  // Druckliste: dieselben Filter (ohne Sortierung/Seite – die Liste ist nach Frist sortiert)
  const printHref = `/vehicles/print?${new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => !!entry[1])).toString()}`;
  const monthLabel = (value: string) => date(monthStart(value), { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.description")}
        help="workshop.vehicles"
        actions={
          <>
            <LinkButton href={printHref}>
              <Printer className="size-4" aria-hidden /> {t("vehicles.print.button")}
            </LinkButton>
            {canEdit ? (
              <LinkButton href="/vehicles/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("vehicles.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <FilterBar
        keep={sortFields(list, DEFAULT)}
        columns="sm:grid-cols-[minmax(0,1fr)_11rem_13rem_10rem_auto]"
        active={Boolean(q || noOwnerOnly || inspection || month)}
        extrasOpen={noOwnerOnly || Boolean(inspection || month)}
        resetHref="/vehicles"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("vehicles.searchList")} aria-label={t("common.search")} />}
      >
        <Select name="owner" defaultValue={noOwnerOnly ? "none" : ""} aria-label={t("vehicles.fields.owner")}>
          <option value="">{t("vehicles.filters.anyOwner")}</option>
          <option value="none">{t("vehicles.filters.noOwner")}</option>
        </Select>
        <Select name="inspection" defaultValue={inspection ?? ""} aria-label={t("vehicles.fields.inspectionDue")}>
          <option value="">{t("vehicles.filters.anyInspection")}</option>
          <option value="soon">{t("vehicles.filters.inspectionSoon")}</option>
          <option value="none">{t("vehicles.filters.inspectionNone")}</option>
        </Select>
        <Input name="month" type="month" defaultValue={month ?? ""} aria-label={t("vehicles.filters.month")} placeholder="11/2026" />
      </FilterBar>

      <DataTable
        caption={t("vehicles.title")}
        rows={vehicles}
        rowKey={(v) => v.id}
        rowHref={(v) => `/vehicles/${v.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="44rem"
        summary={tp("vehicles.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("vehicles.listEmpty")} hint={q || noOwnerOnly || inspection || month ? t("common.noResults") : t("vehicles.listEmptyHint")} />}
        columns={[
          { id: "plate", header: t("vehicles.fields.plate"), priority: "primary", sort: "plate", cell: (v) => <Plate>{v.plate}</Plate> },
          {
            id: "vehicle",
            header: t("vehicles.cols.vehicle"),
            sort: "vehicle",
            cell: (v) => (
              <div className="text-sm">
                {[v.make, v.model, v.year].filter(Boolean).join(" ") || <span className="text-ink-muted">–</span>}
                {v.vin ? <div className="font-mono text-xs text-ink-muted">{v.vin}</div> : null}
              </div>
            ),
          },
          {
            id: "owner",
            header: t("vehicles.fields.owner"),
            cell: (v) =>
              v.customer ? (
                canSeeCustomers ? (
                  <TextLink href={`/customers/${v.customer.id}`} className="text-inherit no-underline hover:underline">
                    {customerDisplayName(v.customer)}
                  </TextLink>
                ) : (
                  customerDisplayName(v.customer)
                )
              ) : (
                <Badge>{t("vehicles.noOwner")}</Badge>
              ),
          },
          {
            id: "inspection",
            header: t("vehicles.cols.inspection"),
            sort: "inspection",
            cell: (v) => {
              const state = inspectionState(v.inspectionDue, thisMonth);
              return v.inspectionDue && state ? <StatusBadge tone={INSPECTION_TONE[state]}>{t(`vehicles.inspection.${state}`, { month: monthLabel(v.inspectionDue) })}</StatusBadge> : <span className="text-ink-muted">–</span>;
            },
          },
          { id: "tires", header: t("nav.tires"), align: "end", priority: "low", cell: (v) => v._count.tireSets },
          { id: "appointments", header: t("nav.appointments"), align: "end", priority: "low", cell: (v) => v._count.appointments },
        ]}
      />
    </>
  );
}
