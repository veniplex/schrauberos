import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { invoiceTotals, paymentState } from "@/modules/office/invoices/domain";
import { formatCents } from "@/lib/money";
import { db } from "@/server/db";
import type { WidgetDef } from "@/modules/types";

/** Offene und überfällige Rechnungen (Eingang und Ausgang) mit Summen. */
export async function InvoicesWidget() {
  const { t, tp, date, locale } = await getI18n();
  const eur = (c: number) => formatCents(c, INTL_LOCALE[locale]);

  const open = await db.invoice.findMany({
    where: { status: "open" },
    select: { id: true, direction: true, number: true, partyName: true, dueDate: true, grossCents: true, status: true },
    orderBy: { dueDate: "asc" },
  });
  const incoming = invoiceTotals(open.filter((i) => i.direction === "incoming"));
  const outgoing = invoiceTotals(open.filter((i) => i.direction === "outgoing"));
  const overdue = open.filter((i) => paymentState(i) === "overdue").slice(0, 5);

  const col = (label: string, tot: ReturnType<typeof invoiceTotals>, href: string) => (
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
    <Card title={t("invoices.widgets.title")} actions={<Link href="/invoices" className="text-sm text-accent-text inline-flex min-h-(--tap-row) min-w-(--tap-row) items-center hover:underline">{t("common.showAll")}</Link>} padded={false}>
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
                  <span className="block truncate font-medium">{i.partyName}</span>
                  <span className="font-mono text-xs text-ink-muted">{i.number}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular font-medium">{eur(i.grossCents)}</span>
                  <Badge tone="danger">{t("invoices.widgets.dueSince", { date: date(i.dueDate!) })}</Badge>
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
  { id: "invoices-open", feature: "office.invoices", permission: "invoices.view", span: 1, order: 39, Component: InvoicesWidget },
];
