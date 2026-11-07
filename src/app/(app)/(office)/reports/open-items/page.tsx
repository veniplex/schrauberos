import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Card, StatCard, StatusBadge } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { noon, todayInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { AGE_BUCKETS, type AgeBucket } from "@/modules/office/invoices/public";
import { canOpenReport } from "@/modules/office/reports/access";
import { openItemsReport, type OpenItemsReport } from "@/modules/office/reports/queries";
import { ReportChart } from "@/modules/office/reports/report-chart";
import { requirePermission } from "@/server/auth/session";
import { defaultFormatId } from "@/server/csv/format";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.openItems.title") };
}

type Item = OpenItemsReport["items"][number];
const BUCKET_TONE: Record<AgeBucket, "neutral" | "warning" | "danger"> = { notDue: "neutral", d1_30: "warning", d31_60: "warning", d61_90: "danger", d91plus: "danger" };

/**
 * Offene Posten (F9): was noch zu zahlen ist, nach dem Alter der Fälligkeit am heutigen Tag – Forderungen (Ausgangsrechnungen, Standard) oder Verbindlichkeiten (Eingangsrechnungen). Summen von der Datenbank
 * gerechnet; die Liste zeigt die ältesten Posten ohne Kunden mit eingeschränkter Verarbeitung (Art. 18). Verlangt `reports.view` und `invoices.view`.
 */
export default async function OpenItemsReportPage({ searchParams }: { searchParams: Promise<{ direction?: string }> }) {
  const session = await requirePermission("reports.view");
  if (!canOpenReport(session, "openItems")) redirect("/forbidden");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, locale, date } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const today = todayInput();
  const direction = sp.direction === "incoming" ? "incoming" : "outgoing";
  const report = await openItemsReport(session, { direction, today });
  if (!report) redirect("/forbidden");
  const overdue = report.buckets.filter((b) => b.bucket !== "notDue").reduce((sum, b) => ({ count: sum.count + b.count, cents: sum.cents + b.cents }), { count: 0, cents: 0 });
  const rules = ["scope", "amount", "age"] as const;
  const dayText = (day: string) => date(noon(day), { dateStyle: "medium" });

  return (
    <>
      <PageHeader back={{ href: "/reports", label: t("reports.back") }} help="office.reports" title={t("reports.openItems.title")} description={t("reports.openItems.description")} />
      <nav aria-label={t("reports.openItems.directionLabel")} className="mb-5 flex flex-wrap gap-2">
        {(["outgoing", "incoming"] as const).map((d) => (
          <LinkButton key={d} href={`/reports/open-items?direction=${d}`} variant={d === direction ? "primary" : "secondary"} aria-current={d === direction ? "true" : undefined}>
            {t(`reports.openItems.direction.${d}`)}
          </LinkButton>
        ))}
      </nav>
      <p className="mb-5 text-sm text-ink-muted">{t("reports.openItems.today", { date: dayText(today) })}</p>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={t("reports.openItems.series")} value={eur(report.total.cents)} sub={tp("reports.openItems.itemCount", report.total.count)} />
        <StatCard label={t("reports.openItems.overdueTotal")} value={eur(overdue.cents)} sub={tp("reports.openItems.itemCount", overdue.count)} tone={overdue.count > 0 ? "danger" : undefined} />
        <StatCard label={t("reports.openItems.buckets.notDue")} value={eur(report.buckets.find((b) => b.bucket === "notDue")?.cents ?? 0)} sub={tp("reports.openItems.itemCount", report.buckets.find((b) => b.bucket === "notDue")?.count ?? 0)} />
      </div>

      {report.total.count === 0 ? (
        <Alert tone="success" className="mb-5">
          {t("reports.openItems.empty")}
        </Alert>
      ) : (
        <>
          <Card className="mb-5">
            <ReportChart kind="money" title={t("reports.openItems.chart")} categories={AGE_BUCKETS.map((b) => t(`reports.openItems.buckets.${b}`))} values={report.buckets.map((b) => b.cents)} seriesLabel={t("reports.openItems.series")} categoryLabel={t("reports.openItems.stage")} />
          </Card>
          <div className="mb-5">
            <DataTable<OpenItemsReport["buckets"][number]>
              caption={t("reports.openItems.chart")}
              rowKey={(row) => row.bucket}
              minWidth="28rem"
              columns={[
                { id: "bucket", header: t("reports.openItems.stage"), priority: "primary", cell: (row) => <StatusBadge tone={BUCKET_TONE[row.bucket]}>{t(`reports.openItems.buckets.${row.bucket}`)}</StatusBadge> },
                { id: "count", header: t("reports.common.count"), align: "end", cell: (row) => row.count },
                { id: "cents", header: t("reports.openItems.cols.outstanding"), align: "end", cell: (row) => <strong>{eur(row.cents)}</strong> },
              ]}
              rows={report.buckets}
            />
          </div>

          <Card title={t("reports.openItems.listTitle")} padded={false} className="mb-5">
            <DataTable<Item>
              bare
              caption={t("reports.openItems.listTitle")}
              rowKey={(row) => row.id}
              minWidth="40rem"
              summary={t("reports.common.limitHint", { max: 50 })}
              columns={[
                { id: "number", header: t("reports.openItems.cols.number"), priority: "primary", cell: (row) => <span className="font-mono">{row.number}</span> },
                { id: "party", header: t("reports.openItems.cols.party"), cell: (row) => row.partyName },
                { id: "due", header: t("reports.openItems.cols.due"), cell: (row) => (row.dueDay ? dayText(row.dueDay) : t("reports.openItems.noDue")) },
                { id: "overdue", header: t("reports.openItems.cols.overdue"), cell: (row) => (row.daysOverdue > 0 ? tp("reports.openItems.days", row.daysOverdue) : "–") },
                { id: "stage", header: t("reports.openItems.cols.stage"), priority: "low", cell: (row) => <StatusBadge tone={BUCKET_TONE[row.bucket]}>{t(`reports.openItems.buckets.${row.bucket}`)}</StatusBadge> },
                { id: "amount", header: t("reports.openItems.cols.outstanding"), align: "end", cell: (row) => <strong>{eur(row.outstandingCents)}</strong> },
              ]}
              rows={report.items}
              rowHref={(row) => `/invoices/${row.id}`}
            />
          </Card>
          {report.hiddenCount > 0 ? (
            <Alert tone="info" className="mb-5">
              {tp("reports.openItems.hidden", report.hiddenCount)}
            </Alert>
          ) : null}
        </>
      )}
      {report.credits.count > 0 ? (
        <Alert tone="info" className="mb-5">
          {tp("reports.openItems.credits", report.credits.count, { amount: eur(report.credits.cents) })}
        </Alert>
      ) : null}

      <div className="mb-5">
        <Disclosure title={t("reports.common.rulesTitle")} variant="card">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {rules.map((rule) => (
              <li key={rule}>{t(`reports.openItems.rules.${rule}`)}</li>
            ))}
          </ul>
        </Disclosure>
      </div>

      {session.can("reports.export") ? (
        <Card title={t("reports.common.exportTitle")}>
          <p className="mb-4 text-sm text-ink-muted">{t("reports.common.exportHint")}</p>
          <ExportPanel kind="report-open-items" defaultFormat={defaultFormatId(locale)} fixed={{ direction }} />
        </Card>
      ) : null}
    </>
  );
}
