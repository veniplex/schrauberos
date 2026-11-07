import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { EmptyState, Plate } from "@/components/ui/layout";
import { ExchangeMenu } from "@/components/exchange/exchange-menu";
import { PageHeader } from "@/components/ui/page-header";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { customerDisplayName } from "@/modules/workshop/customers/domain";
import { normalizePlate } from "@/lib/plate";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains, searchWhere } from "@/server/search";
import { SearchInput } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.customers") };
}

const SORTS = ["name", "city"] as const;
const DEFAULT = { sort: "name", dir: "asc" } as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("customers.view");
  const [{ t, tp }, sp] = await Promise.all([getI18n(), searchParams]);
  const q = (sp.q ?? "").trim();
  const plate = normalizePlate(q);
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });

  // Wörterbuch pro Berechtigung: Kennzeichen nur durchsuchbar, wer Fahrzeuge sehen darf
  const where =
    searchWhere<Prisma.CustomerWhereInput>(q, session.can, [
      { where: (term) => ({ lastName: contains(term) }) },
      { where: (term) => ({ firstName: contains(term) }) },
      { where: (term) => ({ company: contains(term) }) },
      { where: (term) => ({ customerNumber: contains(term) }) },
      { where: (term) => ({ city: contains(term) }) },
      { where: (term) => ({ phone: contains(term) }) },
      { where: (term) => ({ email: contains(term) }) },
      { permission: "vehicles.view", where: () => (plate ? { vehicles: { some: { plateNorm: { contains: plate } } } } : { id: "" }) },
    ]) ?? {};

  const total = await db.customer.count({ where });
  const page = clampPage(list.page, total, list.pageSize);
  const orderBy = list.sort === "city" ? [{ city: list.dir }, { lastName: "asc" as const }] : [{ lastName: list.dir }, { firstName: list.dir }, { company: list.dir }];
  const customers = await db.customer.findMany({ where, include: { vehicles: { orderBy: { plateNorm: "asc" } } }, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("customers.edit");
  const links = listLinks("/customers", { q: q || undefined }, list, DEFAULT);

  return (
    <>
      <PageHeader
        title={t("customers.title")}
        description={t("customers.description")}
        help="workshop.customers"
        actions={
          <>
            <ExchangeMenu exportHref={session.can("customers.export") ? "/customers/export" : undefined} importHref={session.can("customers.import") ? "/customers/import" : undefined} />
            {canEdit ? (
              <LinkButton href="/customers/new" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("customers.new")}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <FilterBar
        columns="sm:grid-cols-[minmax(0,1fr)_auto]"
        keep={sortFields(list, DEFAULT)}
        active={Boolean(q)}
        resetHref="/customers"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("customers.searchPlaceholder")} aria-label={t("common.search")} />}
      />

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
            sub: (c) => (c.customerNumber ? <span className="tabular">#{c.customerNumber}</span> : null),
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
