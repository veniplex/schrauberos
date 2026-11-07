import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { Disclosure } from "@/components/ui/disclosure";
import { DataTable } from "@/components/ui/data-table";
import { Alert, Card, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { todayInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { monthStart } from "@/lib/month";
import { canOpenReport } from "@/modules/office/reports/access";
import { MAX_REVENUE_MONTHS, parseRevenuePeriod, thisYearUntil } from "@/modules/office/reports/domain";
import { PeriodForm } from "@/modules/office/reports/period-form";
import { revenueReport, type RevenueReport } from "@/modules/office/reports/queries";
import { ReportChart } from "@/modules/office/reports/report-chart";
import { requirePermission } from "@/server/auth/session";
import { defaultFormatId } from "@/server/csv/format";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.revenue.title") };
}

type Row = RevenueReport["months"][number];

/**
 * Umsatz je Monat (F9): Ausgangsrechnungen nach Rechnungsdatum (Netto, Steuer, Brutto; Gegenbelege negativ), nur über die Ausgangsliste. Verlangt `reports.view` und `invoices.view`. Der Zeitraum wird auf
 * ganze Monate gerundet (höchstens 36); ein ungültiger Zeitraum fällt mit Hinweis auf „dieses Jahr bis heute“ zurück.
 */
export default async function RevenueReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requirePermission("reports.view");
  if (!canOpenReport(session, "revenue")) redirect("/forbidden");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, locale } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const today = todayInput();

  const asked = sp.from !== undefined || sp.to !== undefined;
  const parsed = parseRevenuePeriod(sp.from ?? thisYearUntil(today).from, sp.to ?? thisYearUntil(today).to);
  const period = parsed.ok ? parsed : thisYearUntil(today);
  const problem = asked && !parsed.ok ? parsed.problem : null;
  const report = await revenueReport(session, period);
  if (!report) redirect("/forbidden");
  const monthLabel = (month: string) => i18n.date(monthStart(month), { month: "long", year: "numeric" });
  const shortMonth = (month: string) => i18n.date(monthStart(month), { month: "short", year: "2-digit" });
  const rules = ["scope", "credit", "partial", "month"] as const;

  return (
    <>
      <PageHeader back={{ href: "/reports", label: t("reports.back") }} help="office.reports" title={t("reports.revenue.title")} description={t("reports.revenue.description")} />
      {problem ? (
        <Alert tone="warning" className="mb-5">
          {t(`reports.errors.${problem}`, { max: problem === "tooLong" ? MAX_REVENUE_MONTHS : 0, unit: t("reports.errors.units.months") })}
        </Alert>
      ) : null}
      <PeriodForm today={today} from={period.from} to={period.to} maxDays={366 * 3} presets={["thisMonth", "lastMonth", "thisYear"]} />
      <p className="mb-5 text-sm text-ink-muted">{t("reports.period.months", { from: monthLabel(report.from.slice(0, 7)), to: monthLabel(report.to.slice(0, 7)) })}</p>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("reports.revenue.gross")} value={eur(report.total.grossCents)} />
        <StatCard label={t("reports.revenue.net")} value={eur(report.total.netCents)} />
        <StatCard label={t("reports.revenue.vat")} value={eur(report.total.vatCents)} />
        <StatCard label={t("reports.revenue.docs")} value={report.total.count} />
      </div>

      <Card className="mb-5">
        <ReportChart kind="money" title={t("reports.revenue.chart")} categories={report.months.map((m) => shortMonth(m.month))} values={report.months.map((m) => m.grossCents)} seriesLabel={t("reports.revenue.series")} categoryLabel={t("reports.revenue.month")} />
      </Card>

      <div className="mb-5">
        <DataTable<Row>
          caption={t("reports.revenue.title")}
          rowKey={(row) => row.month}
          minWidth="34rem"
          columns={[
            { id: "month", header: t("reports.revenue.month"), priority: "primary", cell: (row) => monthLabel(row.month) },
            { id: "docs", header: t("reports.revenue.docs"), align: "end", cell: (row) => row.count },
            { id: "net", header: t("reports.revenue.net"), align: "end", cell: (row) => eur(row.netCents) },
            { id: "vat", header: t("reports.revenue.vat"), align: "end", cell: (row) => eur(row.vatCents) },
            { id: "gross", header: t("reports.revenue.gross"), align: "end", cell: (row) => <strong>{eur(row.grossCents)}</strong> },
          ]}
          rows={report.months}
          footer={
            <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm font-semibold">
              <span>{t("reports.common.total")}</span>
              <span className="tabular">
                {report.total.count} {t("reports.revenue.docs")} · {t("reports.revenue.net")} {eur(report.total.netCents)} · {t("reports.revenue.vat")} {eur(report.total.vatCents)} · {t("reports.revenue.gross")} {eur(report.total.grossCents)}
              </span>
            </p>
          }
        />
      </div>
      {report.total.withoutNet > 0 ? (
        <Alert tone="info" className="mb-5">
          {tp("reports.revenue.withoutNet", report.total.withoutNet)}
        </Alert>
      ) : null}

      <div className="mb-5">
        <Disclosure title={t("reports.common.rulesTitle")} variant="card">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {rules.map((rule) => (
              <li key={rule}>{t(`reports.revenue.rules.${rule}`)}</li>
            ))}
          </ul>
        </Disclosure>
      </div>

      {session.can("reports.export") ? (
        <Card title={t("reports.common.exportTitle")}>
          <p className="mb-4 text-sm text-ink-muted">{t("reports.common.exportHint")}</p>
          <ExportPanel kind="report-revenue" defaultFormat={defaultFormatId(locale)} fixed={{ from: period.from, to: period.to }} />
        </Card>
      ) : null}
    </>
  );
}
