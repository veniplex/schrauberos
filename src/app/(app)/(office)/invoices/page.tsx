import type { Metadata } from "next";
import { Lock, Paperclip, Plus } from "lucide-react";
import { EmptyState, StatCard } from "@/components/ui/layout";
import { ExchangeMenu } from "@/components/exchange/exchange-menu";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { TabNav } from "@/components/ui/tab-nav";
import type { Prisma } from "@/generated/prisma/client";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { currentYear, startOfDayIn, todayInput } from "@/lib/dates";
import { clampPage, listHref, listLinks, pageWindow, parseListParams, sortFields } from "@/lib/list-params";
import { INVOICE_DIRECTIONS, paymentState, type InvoiceDirection } from "@/modules/office/invoices/domain";
import { invoiceSums, invoiceTextWhere, invoiceYears } from "@/modules/office/invoices/queries";
import { formatCents } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { searchWhere } from "@/server/search";
import { PaymentBadge } from "@/modules/office/invoices/ui";
import { SearchInput, Select } from "@/components/ui/form";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.invoices") };
}

type SearchParams = { dir?: string; q?: string; status?: string; year?: string; sort?: string; order?: string; page?: string };
const STATES = ["open", "overdue", "paid", "cancelled"] as const;
const SORTS = ["date", "number", "party", "due", "gross"] as const;
const DEFAULT = { sort: "date", dir: "desc" } as const;
/** `dir` ist hier die Richtung der Rechnung (Eingang/Ausgang), die Sortierrichtung heißt `order`. */
const ORDER_PARAM = "order";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("invoices.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, date, locale } = i18n;
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  const direction: InvoiceDirection = (INVOICE_DIRECTIONS as readonly string[]).includes(sp.dir ?? "") ? (sp.dir as InvoiceDirection) : "incoming";
  const q = (sp.q ?? "").trim();
  const state = (STATES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const thisYear = currentYear();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : sp.year === "all" ? 0 : thisYear;
  const today = startOfDayIn(todayInput());
  const list = parseListParams(sp, { sorts: SORTS, ...DEFAULT, dirParam: ORDER_PARAM });

  const yearRange = year ? { issueDate: { gte: startOfDayIn(`${year}-01-01`), lt: startOfDayIn(`${year + 1}-01-01`) } } : {};
  const text = searchWhere<Prisma.InvoiceWhereInput>(q, session.can, [{ where: (term) => ({ OR: invoiceTextWhere(term) }) }]);
  const where: Prisma.InvoiceWhereInput = {
    direction,
    ...yearRange,
    ...(text ?? {}),
    ...(state === "paid" ? { status: "paid" } : state === "cancelled" ? { status: "cancelled" } : {}),
    ...(state === "overdue" ? { status: "open", dueDate: { lt: today } } : {}),
    ...(state === "open" ? { status: "open", AND: [{ OR: [{ dueDate: null }, { dueDate: { gte: today } }] }] } : {}),
  };

  const orderBy =
    list.sort === "number"
      ? [{ number: list.dir }]
      : list.sort === "party"
        ? [{ partyName: list.dir }, { issueDate: "desc" as const }]
        : list.sort === "due"
          ? [{ dueDate: list.dir }, { issueDate: "desc" as const }]
          : list.sort === "gross"
            ? [{ grossCents: list.dir }, { issueDate: "desc" as const }]
            : [{ issueDate: list.dir }, { number: list.dir }];

  // Summen immer über alle Rechnungen der Richtung im gewählten Jahr (ohne Status-/Suchfilter), von der Datenbank gerechnet
  const [total, totals, years] = await Promise.all([db.invoice.count({ where }), invoiceSums({ direction, ...yearRange }), invoiceYears(thisYear)]);
  const page = clampPage(list.page, total, list.pageSize);
  const invoices = await db.invoice.findMany({ where, include: { file: { select: { id: true } } }, orderBy, ...pageWindow(page, list.pageSize) });
  const canEdit = session.can("invoices.edit");

  const links = listLinks("/invoices", { dir: direction, q: q || undefined, status: state || undefined, year: sp.year }, list, DEFAULT, ORDER_PARAM);
  const tabHref = (value: InvoiceDirection) => listHref("/invoices", { dir: value, year: sp.year });

  return (
    <>
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.description")}
        help="office.invoices"
        actions={
          <>
            <ExchangeMenu exportHref={session.can("invoices.export") ? "/invoices/export" : undefined} importHref={session.can("invoices.import") ? "/invoices/import" : undefined} />
            {canEdit ? (
              <LinkButton href={`/invoices/new?dir=${direction}`} variant="primary">
                <Plus className="size-4" aria-hidden /> {direction === "incoming" ? t("invoices.newIncoming") : t("invoices.newOutgoing")}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <TabNav label={t("invoices.title")} items={INVOICE_DIRECTIONS.map((value) => ({ href: tabHref(value), label: t(`invoices.tabs.${value}`), active: direction === value }))} />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={direction === "incoming" ? t("invoices.stats.toPay") : t("invoices.stats.toReceive")} value={eur(totals.openCents)} sub={tp("invoices.stats.count", totals.openCount)} />
        <StatCard label={t("invoices.stats.overdue")} value={eur(totals.overdueCents)} sub={tp("invoices.stats.count", totals.overdueCount)} tone={totals.overdueCents > 0 ? "danger" : undefined} />
        <StatCard label={direction === "incoming" ? t("invoices.stats.paid") : t("invoices.stats.received")} value={eur(totals.paidCents)} sub={year ? String(year) : t("invoices.allYears")} />
      </div>

      <FilterBar
        keep={sortFields(list, DEFAULT, ORDER_PARAM)}
        columns="sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto]"
        active={Boolean(q || state || sp.year)}
        extrasOpen={Boolean(state || sp.year)}
        resetHref={listHref("/invoices", { dir: direction })}
        search={<SearchInput name="q" defaultValue={q} placeholder={t("invoices.searchPlaceholder")} aria-label={t("common.search")} />}
      >
        <input type="hidden" name="dir" value={direction} />
        <Select name="status" defaultValue={state} aria-label={t("common.status")}>
          <option value="">{t("invoices.filters.anyStatus")}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {t(`invoices.payment.${s}`)}
            </option>
          ))}
        </Select>
        <Select name="year" defaultValue={year ? String(year) : "all"} aria-label={t("invoices.fields.year")}>
          <option value="all">{t("invoices.allYears")}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        caption={t("invoices.title")}
        rows={invoices}
        rowKey={(inv) => inv.id}
        rowHref={(inv) => `/invoices/${inv.id}`}
        sort={{ key: list.sort, dir: list.dir }}
        sortHref={links.sortHref}
        minWidth="52rem"
        summary={tp("invoices.count", total)}
        footer={<Pagination page={page} pageSize={list.pageSize} total={total} hrefFor={links.pageHref} />}
        empty={<EmptyState title={t("invoices.empty")} hint={t("invoices.emptyHint")} />}
        columns={[
          {
            id: "number",
            header: t("invoices.fields.number"),
            priority: "primary",
            sort: "number",
            cell: (inv) => (
              <span className="font-mono text-[13px]">
                {inv.number}
                {inv.file ? <Paperclip className="ml-1.5 inline size-3.5 text-ink-muted" aria-label={t("invoices.hasFile")} /> : null}
                {inv.finalizedAt ? <Lock className="ml-1.5 inline size-3.5 text-ink-muted" aria-label={t("invoices.finalize.badge")} /> : null}
              </span>
            ),
          },
          { id: "date", header: t("invoices.fields.issueDate"), sort: "date", cell: (inv) => <span className="whitespace-nowrap tabular text-sm">{date(inv.issueDate)}</span> },
          {
            id: "party",
            header: direction === "incoming" ? t("invoices.fields.supplier") : t("invoices.fields.recipient"),
            sort: "party",
            cell: (inv) => (
              <div className="text-sm">
                {inv.partyName}
                {inv.category ? <div className="text-xs text-ink-muted">{inv.category}</div> : null}
              </div>
            ),
          },
          {
            id: "due",
            header: t("invoices.fields.dueDate"),
            sort: "due",
            cell: (inv) => (inv.dueDate ? <span className="whitespace-nowrap tabular text-sm">{date(inv.dueDate)}</span> : <span className="text-ink-muted">–</span>),
          },
          { id: "gross", header: t("invoices.fields.gross"), align: "end", sort: "gross", cell: (inv) => <span className="whitespace-nowrap font-medium">{eur(inv.grossCents)}</span> },
          { id: "status", header: t("common.status"), cell: (inv) => <PaymentBadge state={paymentState(inv)} t={t} /> },
        ]}
      />
    </>
  );
}
