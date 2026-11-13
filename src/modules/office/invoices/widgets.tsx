import Link from "next/link";
import { Card, EmptyState, TextLink, StatusBadge } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { startOfDay } from "@/lib/zone";
import type { InvoiceTotals } from "@/modules/office/invoices/domain";
import { outstandingCents } from "@/modules/office/invoices/domain";
import { archiveReadableWhere, invoiceSums, ledgerWhere } from "@/modules/office/invoices/queries";
import { formatCents } from "@/lib/money";
import { isRestricted, restrictionSelect } from "@/modules/workshop/customers/public";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";
import type { WidgetDef } from "@/modules/types";

/** Offene und überfällige Rechnungen (Eingang und Ausgang) mit Summen. */
export async function InvoicesWidget() {
  const [{ t, tp, date, locale }, session] = await Promise.all([getI18n(), getSession()]);
  // Namen von Kunden mit eingeschränkter Verarbeitung (Art. 18) nur mit `customers.view`; nicht lesbare Rechnungen (nicht festgeschriebene eingeschränkter Kunden) stehen nicht in der Liste
  const namesVisible = Boolean(session?.can("customers.view"));
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  // Summen von der Datenbank gerechnet (aggregate), nicht über geladene Zeilen; geladen werden nur die fünf ältesten überfälligen
  const [incoming, outgoing, overdue] = await Promise.all([
    invoiceSums({ direction: "incoming" }),
    invoiceSums({ direction: "outgoing" }),
    db.invoice.findMany({
      where: { AND: [ledgerWhere, archiveReadableWhere, { status: "open", dueDate: { lt: startOfDay(new Date()) } }] },
      select: { id: true, number: true, partyName: true, dueDate: true, grossCents: true, deductedCents: true, paidCents: true, customer: { select: restrictionSelect } },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
  ]);

  const col = (label: string, tot: InvoiceTotals, href: string) => (
    <Link href={href} className="block px-5 py-4 hover:bg-surface-hover">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular">{eur(tot.openCents)}</p>
      <p className="text-xs text-ink-muted">
        {tp("invoices.stats.count", tot.openCount)}
        {tot.overdueCount ? <span className="text-danger-ink"> · {t("invoices.widgets.overdueCount", { count: tot.overdueCount })}</span> : null}
      </p>
    </Link>
  );

  return (
    <Card headingLevel={3} title={t("invoices.widgets.title")} actions={<TextLink href="/invoices" className="text-sm">{t("common.showAll")}</TextLink>} padded={false}>
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        {col(t("invoices.widgets.toPay"), incoming, "/invoices?dir=incoming&status=open")}
        {col(t("invoices.widgets.toReceive"), outgoing, "/invoices?dir=outgoing&status=open")}
      </div>
      {overdue.length === 0 ? (
        <EmptyState title={t("invoices.widgets.noneOverdue")} />
      ) : (
        <ul className="divide-y divide-line">
          {overdue.map((i) => (
            <li key={i.id}>
              <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-hover">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{isRestricted(i.customer) && !namesVisible ? <span className="text-ink-muted">{t("invoices.restricted.hiddenName")}</span> : i.partyName}</span>
                  <span className="font-mono text-xs text-ink-muted">{i.number}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular font-medium">{eur(outstandingCents(i))}</span>
                  <StatusBadge tone="danger">{t("invoices.widgets.dueSince", { date: date(i.dueDate!) })}</StatusBadge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Dashboard-Bausteine dieser Funktion (von der Registry eingesammelt). */
export const widgets: WidgetDef[] = [
  { id: "invoices-open", titleKey: "invoices.widgets.title", priority: 25, feature: "office.invoices", permission: "invoices.view", span: 1, order: 39, Component: InvoicesWidget },
];
