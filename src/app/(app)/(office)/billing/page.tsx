import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchInput, Select } from "@/components/ui/form";
import { EmptyState, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { clampPage, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { formatCents } from "@/lib/money";
import { isRestricted, restrictionSelect } from "@/modules/workshop/customers/public";
import { BILLING_STATUS_FILTERS, BILLING_TYPE_FILTERS, billingListWhere, billingReadableWhere, billingStats, parseStatusFilter, parseTypeFilter } from "@/modules/office/billing/queries";
import { DocBadges } from "@/modules/office/billing/ui";
import { payableCents } from "@/modules/office/billing/domain";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.billing") };
}

const SORTS = ["date", "number", "recipient", "amount"] as const;
const DEFAULT = { sort: "date", dir: "desc" } as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; status?: string; sort?: string; dir?: string; page?: string }> }) {
  const session = await requirePermission("billing.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, td, date, locale } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const q = (sp.q ?? "").trim();
  const type = parseTypeFilter(sp.type);
  const status = parseStatusFilter(sp.status);
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT });
  // Belege eingeschränkter Kunden (Art. 18): nur festgeschriebene Rechnungen und nur mit `invoices.view` (wie die Detailseite, `billingReadAccess`); ihr Name nur mit `customers.view`
  const namesVisible = session.can("customers.view");
  const where = { AND: [billingListWhere({ q, type, status, restrictedNames: namesVisible }), billingReadableWhere(session)] };
  const orderBy =
    list.sort === "number"
      ? [{ number: list.dir }]
      : list.sort === "recipient"
        ? [{ partyName: list.dir }, { createdAt: "desc" as const }]
        : list.sort === "amount"
          ? [{ grossCents: list.dir }, { createdAt: "desc" as const }]
          : [{ finalizedAt: list.dir }, { createdAt: list.dir }];

  const [total, stats] = await Promise.all([db.invoice.count({ where }), billingStats()]);
  const page = clampPage(list.page, total, list.pageSize);
  const rows = await db.invoice.findMany({
    where,
    orderBy,
    ...pageWindow(page, list.pageSize),
    select: { id: true, source: true, docType: true, number: true, partyName: true, issueDate: true, finalizedAt: true, offerStatus: true, validUntil: true, status: true, dueDate: true, grossCents: true, deductedCents: true, paidCents: true, sentAt: true, createdAt: true, customer: { select: restrictionSelect } },
  });
  const links = listLinks("/billing", { q: q || undefined, type: type === "all" ? undefined : type, status: status === "all" ? undefined : status }, list, DEFAULT);
  const canEdit = session.can("billing.edit");

  return (
    <>
      <PageHeader
        title={t("billing.title")}
        description={t("billing.description")}
        help="office.billing"
        actions={
          canEdit ? (
            <>
              <LinkButton href="/billing/new?type=offer" variant="secondary">
                <Plus className="size-4" aria-hidden /> {t("billing.new.offer")}
              </LinkButton>
              <LinkButton href="/billing/new?type=invoice" variant="primary">
                <Plus className="size-4" aria-hidden /> {t("billing.new.invoice")}
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("billing.stats.drafts")} value={String(stats.drafts)} sub={tp("billing.stats.count", stats.drafts)} />
        <StatCard label={t("billing.stats.openOffers")} value={String(stats.openOffers)} sub={tp("billing.stats.count", stats.openOffers)} />
        <StatCard label={t("billing.stats.outstanding")} value={eur(stats.outstandingCents)} sub={`${t("billing.stats.overdue")}: ${eur(stats.overdueCents)}`} tone={stats.overdueCents > 0 ? "danger" : undefined} />
      </div>

      <FilterBar
        keep={sortFields(list, DEFAULT)}
        columns="sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto]"
        active={Boolean(q || type !== "all" || status !== "all")}
        extrasOpen={Boolean(type !== "all" || status !== "all")}
        resetHref="/billing"
        search={<SearchInput name="q" defaultValue={q} placeholder={t("billing.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <Select name="type" defaultValue={type} aria-label={t("billing.columns.type")}>
          <option value="all">{t("billing.filters.anyType")}</option>
          {BILLING_TYPE_FILTERS.filter((v) => v !== "all").map((v) => (
            <option key={v} value={v}>
              {td(`billing.types.${v}`, v)}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label={t("common.status")}>
          <option value="all">{t("billing.filters.anyStatus")}</option>
          {BILLING_STATUS_FILTERS.filter((v) => v !== "all").map((v) => (
            <option key={v} value={v}>
              {td(`billing.status.${v}`, v)}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption={t("billing.title")}
        rows={rows}
        rowKey={(row) => row.id}
        rowHref={(row) => `/billing/${row.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="52rem"
        summary={tp("billing.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("billing.empty")} hint={t("billing.emptyHint")} />}
        columns={[
          {
            id: "number",
            header: t("billing.columns.number"),
            priority: "primary",
            sort: "number",
            cell: (row) => (
              <div>
                <span className="font-mono text-[13px]">{row.number || t("billing.draftNumber")}</span>
                <div className="text-xs text-ink-muted">{td(`billing.types.${row.docType}`, row.docType)}</div>
              </div>
            ),
          },
          {
            id: "recipient",
            header: t("billing.columns.recipient"),
            sort: "recipient",
            cell: (row) => (
              <div className="text-sm">
                {isRestricted(row.customer) && !namesVisible ? <span className="text-ink-muted">{t("invoices.restricted.hiddenName")}</span> : row.partyName}
                {isRestricted(row.customer) ? <div className="text-xs text-warning-ink">{t("invoices.restricted.notice")}</div> : null}
              </div>
            ),
          },
          { id: "date", header: t("billing.columns.date"), sort: "date", cell: (row) => <span className="whitespace-nowrap tabular text-sm">{row.finalizedAt ? date(row.issueDate) : "–"}</span> },
          {
            id: "amount",
            header: t("billing.columns.amount"),
            align: "end",
            sort: "amount",
            cell: (row) => <span className="whitespace-nowrap font-medium">{eur(row.docType === "offer" || row.docType === "confirmation" || row.docType === "credit" ? row.grossCents : payableCents(row))}</span>,
          },
          { id: "status", header: t("common.status"), cell: (row) => <DocBadges doc={row} t={t} /> },
        ]}
      />
    </>
  );
}
