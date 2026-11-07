import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { Badge, EmptyState, Plate } from "@/components/ui/layout";
import { ExchangeMenu } from "@/components/exchange/exchange-menu";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { archivedWhere, archiveParam, parseArchiveFilter } from "@/lib/archive-filter";
import { unrestrictedCustomerWhere } from "@/modules/workshop/customers/queries";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { customerDisplayName } from "@/modules/workshop/customers/domain";
import { countCustomers, customerSearchFields, listCustomers } from "@/modules/workshop/customers/queries";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { searchWhere } from "@/server/search";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.customers") };
}

const SORTS = ["name", "city"] as const;
const DEFAULT = { sort: "name", dir: "asc" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("customers.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const plate = normalizePlate(q);
  // „Eingeschränkt“ (Art. 18 DSGVO) ist ein eigener Listenfilter: Standardliste, Archiv und Auswahl zeigen eingeschränkte Kunden nie, „Alle“ schon
  const restrictedOnly = sp.archived === "restricted";
  const archived = parseArchiveFilter(restrictedOnly ? undefined : sp.archived);
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  // Wörterbuch pro Berechtigung: Kennzeichen nur durchsuchbar, wer Fahrzeuge sehen darf
  const text =
    searchWhere<Prisma.CustomerWhereInput>(q, session.can, [
      ...customerSearchFields,
      { permission: "vehicles.view", where: () => (plate ? { vehicles: { some: { plateNorm: { contains: plate } } } } : { id: "" }) },
    ]) ?? {};
  const where: Prisma.CustomerWhereInput = restrictedOnly
    ? { ...text, processingRestrictedAt: { not: null } }
    : { ...text, ...archivedWhere(archived), ...(archived === "all" ? {} : unrestrictedCustomerWhere) };

  const total = await countCustomers(session, where);
  const page = clampPage(list.page, total, list.pageSize);
  const orderBy = list.sort === "city" ? [{ city: list.dir }, { lastName: "asc" as const }] : [{ lastName: list.dir }, { firstName: list.dir }, { company: list.dir }];
  const customers = await listCustomers(session, { where, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("customers.edit");
  const filterParam = restrictedOnly ? { archived: "restricted" } : archiveParam(archived);
  const links = listLinks("/customers", { q: q || undefined, ...filterParam }, list, DEFAULT);
  const exportQuery = new URLSearchParams(restrictedOnly ? {} : archiveParam(archived)).toString();

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.description")}
        help="workshop.customers"
        actions={
          <>
            <ExchangeMenu exportHref={session.can("customers.export") ? `/customers/export${exportQuery ? `?${exportQuery}` : ""}` : undefined} importHref={session.can("customers.import") ? "/customers/import" : undefined} />
            {canEdit ? (
              <LinkButton href="/customers/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("customers.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
        keep={sortFields(list, DEFAULT)}
        active={Boolean(q) || archived !== "active" || restrictedOnly}
        extrasOpen={archived !== "active" || restrictedOnly}
        resetHref="/customers"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("customers.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="archived" defaultValue={restrictedOnly ? "restricted" : archived === "active" ? "" : archived === "all" ? "all" : "1"} aria-label={t("archive.filter.label")}>
          <option value="">{t("archive.filter.active")}</option>
          <option value="1">{t("archive.filter.archived")}</option>
          <option value="restricted">{t("customers.filterRestricted")}</option>
          <option value="all">{t("archive.filter.all")}</option>
        </Select>
      </FilterBar>

      <DataTable
        caption={t("customers.title")}
        rows={customers}
        rowKey={(c) => c.id}
        rowHref={(c) => `/customers/${c.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        summary={tp("customers.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("customers.empty")} hint={q ? t("common.noResults") : t("customers.emptyHint")} />}
        columns={[
          {
            id: "name",
            header: t("customers.cols.name"),
            priority: "primary",
            sort: "name",
            cell: (c) => customerDisplayName(c),
            sub: (c) =>
              c.customerNumber || c.archivedAt || c.processingRestrictedAt ? (
                <span className="flex flex-wrap items-center gap-2">
                  {c.customerNumber ? <span className="tabular">#{c.customerNumber}</span> : null}
                  {c.archivedAt ? <Badge>{t("archive.badge")}</Badge> : null}
                  {c.processingRestrictedAt ? <Badge>{t("privacy.panel.restrictedBadge")}</Badge> : null}
                </span>
              ) : null,
          },
          {
            id: "contact",
            header: t("customers.cols.contact"),
            sort: "city",
            cell: (c) => (
              <div className="text-sm">
                <div>{c.phone}</div>
                <div className="text-ink-muted">{[c.zip, c.city].filter(Boolean).join(" ")}</div>
              </div>
            ),
          },
          {
            id: "vehicles",
            header: t("customers.cols.vehicles"),
            cell: (c) => (
              <div className="flex flex-wrap gap-1.5">{c.vehicles.length ? c.vehicles.map((v) => <Plate key={v.id}>{v.plate}</Plate>) : <span className="text-ink-muted">–</span>}</div>
            ),
          },
        ]}
      />
    </>
  );
}
