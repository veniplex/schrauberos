import Link from "next/link";
import { Card, EmptyState, StatusBadge, TextLink } from "@/components/ui/layout";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { formatCents } from "@/lib/money";
import { startOfDay } from "@/lib/zone";
import type { WidgetDef } from "@/modules/types";
import { db } from "@/server/db";
import { unrestrictedDocument } from "@/modules/workshop/customers/public";
import { billingStats } from "./queries";

/** Dashboard: Entwürfe, offene Angebote und offene Rechnungen (noch zu zahlen) mit den zuletzt bearbeiteten Entwürfen und offenen Angeboten. */
export async function BillingWidget() {
  const { t, td, tp, locale } = await getI18n();
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const today = startOfDay(new Date());
  const [stats, rows] = await Promise.all([
    billingStats(),
    db.invoice.findMany({
      where: {
        source: "billing",
        OR: [{ finalizedAt: null }, { docType: "offer", offerStatus: "open", OR: [{ validUntil: null }, { validUntil: { gte: today } }] }],
        AND: [unrestrictedDocument],
      },
      select: { id: true, docType: true, number: true, partyName: true, finalizedAt: true, grossCents: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);
  const cell = (label: string, value: string, sub: string, href: string) => (
    <Link href={href} className="block px-4 py-4 hover:bg-surface-hover">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular">{value}</p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </Link>
  );
  return (
    <Card headingLevel={3} title={t("billing.widgets.title")} actions={<TextLink href="/billing" className="text-sm">{t("common.showAll")}</TextLink>} padded={false}>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {cell(t("billing.widgets.drafts"), String(stats.drafts), tp("billing.stats.count", stats.drafts), "/billing?status=draft")}
        {cell(t("billing.widgets.openOffers"), String(stats.openOffers), tp("billing.stats.count", stats.openOffers), "/billing?type=offer&status=open")}
        {cell(t("billing.widgets.dueInvoices"), eur(stats.outstandingCents), stats.overdueCount ? `${stats.overdueCount} ${t("billing.widgets.overdue")}` : tp("billing.stats.count", stats.outstandingCount), "/billing?status=unpaid")}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t("billing.widgets.none")} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/billing/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-hover">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.partyName}</span>
                  <span className="text-xs text-ink-muted">
                    {td(`billing.types.${r.docType}`, r.docType)} <span className="font-mono">{r.number}</span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="tabular font-medium">{eur(r.grossCents)}</span>
                  {r.finalizedAt ? <StatusBadge tone="info">{t("billing.status.open")}</StatusBadge> : <StatusBadge tone="neutral">{t("billing.status.draft")}</StatusBadge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export const widgets: WidgetDef[] = [{ id: "billing-open", titleKey: "billing.widgets.title", priority: 26, feature: "office.billing", permission: "billing.view", span: 1, order: 38, Component: BillingWidget }];
