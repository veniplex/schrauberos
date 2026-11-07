import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, EmptyState, Plate, TextLink } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { customerDisplayName } from "@/modules/workshop/customers/public";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains, searchWhere } from "@/server/search";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.vehicles") };
}

const SORTS = ["plate", "vehicle"] as const;
const DEFAULT = { sort: "plate", dir: "asc" } as const;

export default async function VehiclesPage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("vehicles.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const plate = normalizePlate(q);
  const noOwnerOnly = sp.owner === "none";
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  // Der Anzeigename des Halters ist in der Fahrzeugliste sichtbar (Richtlinie D7), Kontaktdaten gehören nicht zum Suchumfang
  const text = searchWhere<Prisma.VehicleWhereInput>(q, session.can, [
    { where: () => (plate ? { plateNorm: { contains: plate } } : { id: "" }) },
    { where: (term) => ({ vin: contains(term) }) },
    { where: (term) => ({ make: contains(term) }) },
    { where: (term) => ({ model: contains(term) }) },
    { where: (term) => ({ customer: { is: { OR: [{ lastName: contains(term) }, { firstName: contains(term) }, { company: contains(term) }] } } }) },
  ]);
  const where = { ...(noOwnerOnly ? { customerId: null } : {}), ...(text ?? {}) };

  const total = await db.vehicle.count({ where });
  const page = clampPage(list.page, total, list.pageSize);
  const orderBy = list.sort === "vehicle" ? [{ make: list.dir }, { model: list.dir }, { plateNorm: "asc" as const }] : [{ plateNorm: list.dir }];
  const vehicles = await db.vehicle.findMany({ where, include: { customer: true, _count: { select: { tireSets: true, appointments: true } } }, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("vehicles.edit");
  const canSeeCustomers = session.can("customers.view");
  const links = listLinks("/vehicles", { q: q || undefined, owner: noOwnerOnly ? "none" : undefined }, list, DEFAULT);

  return (
    <>
      <PageHeader
        title={t("vehicles.title")}
        description={t("vehicles.description")}
        help="workshop.vehicles"
        actions={
          canEdit ? (
            <LinkButton href="/vehicles/new" variant="primary">
              <Plus className="size-4" aria-hidden /> {t("vehicles.new")}
            </LinkButton>
          ) : null
        }
      />

      <FilterBar
        keep={sortFields(list, DEFAULT)}
        columns="sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
        active={Boolean(q || noOwnerOnly)}
        extrasOpen={noOwnerOnly}
        resetHref="/vehicles"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("vehicles.searchList")} aria-label={t("common.search")} />}
      >
        <Select name="owner" defaultValue={noOwnerOnly ? "none" : ""} aria-label={t("vehicles.fields.owner")}>
          <option value="">{t("vehicles.filters.anyOwner")}</option>
          <option value="none">{t("vehicles.filters.noOwner")}</option>
        </Select>
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
        empty={<EmptyState title={t("vehicles.listEmpty")} hint={q || noOwnerOnly ? t("common.noResults") : t("vehicles.listEmptyHint")} />}
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
          { id: "tires", header: t("nav.tires"), align: "end", priority: "low", cell: (v) => v._count.tireSets },
          { id: "appointments", header: t("nav.appointments"), align: "end", priority: "low", cell: (v) => v._count.appointments },
        ]}
      />
    </>
  );
}
