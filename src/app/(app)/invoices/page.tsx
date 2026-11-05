import type { Metadata } from "next";
import clsx from "clsx";
import Link from "next/link";
import { Paperclip, Plus, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { currentYear, nowDate } from "@/lib/dates";
import { INVOICE_DIRECTIONS, invoiceTotals, paymentState, type InvoiceDirection } from "@/lib/domain/invoices";
import { formatCents } from "@/lib/money";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { contains } from "@/server/search";
import { PaymentBadge } from "@/modules/invoices/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("nav.invoices") };
}

type SearchParams = { dir?: string; q?: string; status?: string; year?: string };
const STATES = ["open", "overdue", "paid", "cancelled"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requirePermission("invoices.view");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, date, locale } = i18n;
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  const dir: InvoiceDirection = (INVOICE_DIRECTIONS as readonly string[]).includes(sp.dir ?? "") ? (sp.dir as InvoiceDirection) : "incoming";
  const q = (sp.q ?? "").trim();
  const state = (STATES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "";
  const thisYear = currentYear();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : sp.year === "all" ? 0 : thisYear;
  const today = nowDate();
  today.setHours(0, 0, 0, 0);

  const where = {
    direction: dir,
    ...(year ? { issueDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } : {}),
    ...(q ? { OR: [{ number: contains(q) }, { partyName: contains(q) }, { reference: contains(q) }, { category: contains(q) }] } : {}),
    ...(state === "paid" ? { status: "paid" } : state === "cancelled" ? { status: "cancelled" } : {}),
    ...(state === "overdue" ? { status: "open", dueDate: { lt: today } } : {}),
    ...(state === "open" ? { status: "open", OR: [{ dueDate: null }, { dueDate: { gte: today } }] } : {}),
  };

  // Summen immer über alle Rechnungen der Richtung im gewählten Jahr (ohne Status-/Suchfilter)
  const [invoices, forTotals, years] = await Promise.all([
    db.invoice.findMany({ where, include: { file: { select: { id: true } } }, orderBy: [{ issueDate: "desc" }, { number: "desc" }], take: 300 }),
    db.invoice.findMany({ where: { direction: dir, ...(year ? { issueDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } : {}) }, select: { status: true, dueDate: true, grossCents: true } }),
    db.invoice.findMany({ select: { issueDate: true }, distinct: ["issueDate"] }),
  ]);
  const totals = invoiceTotals(forTotals);
  const yearOptions = [...new Set([thisYear, ...years.map((y) => y.issueDate.getFullYear())])].sort((a, b) => b - a);
  const canEdit = session.can("invoices.edit");
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ dir, ...(sp.year ? { year: sp.year } : {}), ...extra });
    return `/invoices?${p.toString()}`;
  };

  const tab = (value: InvoiceDirection) => (
    <Link
      href={keep({ dir: value })}
      aria-current={dir === value ? "page" : undefined}
      className={clsx("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", dir === value ? "border-accent text-accent-text" : "border-transparent text-ink-muted hover:text-ink")}
    >
      {t(`invoices.tabs.${value}`)}
    </Link>
  );
  const stat = (label: string, value: string, sub?: string, tone?: string) => (
    <div className="card card-pad">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={clsx("mt-1 text-2xl font-semibold tabular", tone)}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-muted">{sub}</p> : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t("invoices.title")}
        description={t("invoices.description")}
        actions={
          canEdit ? (
            <LinkButton href={`/invoices/new?dir=${dir}`} variant="primary">
              <Plus className="size-4" aria-hidden /> {dir === "incoming" ? t("invoices.newIncoming") : t("invoices.newOutgoing")}
            </LinkButton>
          ) : null
        }
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line" aria-label={t("invoices.title")}>
        {tab("incoming")}
        {tab("outgoing")}
      </nav>

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {stat(dir === "incoming" ? t("invoices.stats.toPay") : t("invoices.stats.toReceive"), eur(totals.openCents), tp("invoices.stats.count", totals.openCount))}
        {stat(t("invoices.stats.overdue"), eur(totals.overdueCents), tp("invoices.stats.count", totals.overdueCount), totals.overdueCents > 0 ? "text-danger-ink" : undefined)}
        {stat(dir === "incoming" ? t("invoices.stats.paid") : t("invoices.stats.received"), eur(totals.paidCents), year ? String(year) : t("invoices.allYears"))}
      </div>

      <form method="get" className="card card-pad mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem_auto]">
        <input type="hidden" name="dir" value={dir} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={q} className="input pl-9" placeholder={t("invoices.searchPlaceholder")} aria-label={t("common.search")} />
        </div>
        <select name="status" defaultValue={state} className="input" aria-label={t("common.status")}>
          <option value="">{t("invoices.filters.anyStatus")}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {t(`invoices.payment.${s}`)}
            </option>
          ))}
        </select>
        <select name="year" defaultValue={year ? String(year) : "all"} className="input" aria-label={t("invoices.fields.year")}>
          <option value="all">{t("invoices.allYears")}</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-secondary">
          {t("common.filter")}
        </button>
      </form>

      <section className="card overflow-hidden">
        {invoices.length === 0 ? (
          <EmptyState title={t("invoices.empty")} hint={t("invoices.emptyHint")} />
        ) : (
          <>
            <p className="border-b border-line px-4 py-2 text-sm text-ink-muted">{tp("invoices.count", invoices.length)}</p>
            <div className="overflow-x-auto">
              <table className="table min-w-[52rem]">
                <thead>
                  <tr>
                    <th>{t("invoices.fields.issueDate")}</th>
                    <th>{t("invoices.fields.number")}</th>
                    <th>{dir === "incoming" ? t("invoices.fields.supplier") : t("invoices.fields.recipient")}</th>
                    <th>{t("invoices.fields.dueDate")}</th>
                    <th className="text-right">{t("invoices.fields.gross")}</th>
                    <th>{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="row-link">
                      <td className="whitespace-nowrap tabular text-sm">{date(inv.issueDate)}</td>
                      <td>
                        <Link href={`/invoices/${inv.id}`} className="font-mono text-[13px] font-medium hover:underline">
                          {inv.number}
                        </Link>
                        {inv.file ? <Paperclip className="ml-1.5 inline size-3.5 text-ink-muted" aria-label={t("invoices.hasFile")} /> : null}
                      </td>
                      <td className="text-sm">
                        {inv.partyName}
                        {inv.category ? <div className="text-xs text-ink-muted">{inv.category}</div> : null}
                      </td>
                      <td className="whitespace-nowrap tabular text-sm">{inv.dueDate ? date(inv.dueDate) : <span className="text-ink-muted">–</span>}</td>
                      <td className="whitespace-nowrap text-right tabular font-medium">{eur(inv.grossCents)}</td>
                      <td>
                        <PaymentBadge state={paymentState(inv)} t={t} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
