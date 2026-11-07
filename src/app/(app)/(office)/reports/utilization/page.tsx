import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { DataTable } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Card, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { noon, todayInput } from "@/lib/dates";
import { canOpenReport } from "@/modules/office/reports/access";
import { MAX_UTILIZATION_DAYS, parsePeriod, thisMonthUntil } from "@/modules/office/reports/domain";
import { PeriodForm } from "@/modules/office/reports/period-form";
import { utilizationReport, utilizationTotals, type UtilizationReport } from "@/modules/office/reports/queries";
import { ReportChart } from "@/modules/office/reports/report-chart";
import { UTILIZATION_MAX_BOOKINGS } from "@/modules/workshop/appointments/public";
import { requirePermission } from "@/server/auth/session";
import { defaultFormatId } from "@/server/csv/format";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.utilization.title") };
}

type Row = UtilizationReport["rows"][number];

/**
 * Auslastung der Arbeitsplätze (F9): Anteil der Öffnungszeit (Werkstattprofil, ohne ganze Feiertage), in dem ein Arbeitsplatz mit Terminen belegt ist – im Zeitraum (höchstens ein Jahr, Standard: dieser
 * Monat bis heute). Keine Namen, Kunden oder Fahrzeuge. Verlangt `reports.view` und `appointments.view`.
 */
export default async function UtilizationReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await requirePermission("reports.view");
  if (!canOpenReport(session, "utilization")) redirect("/forbidden");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, number, date } = i18n;
  const today = todayInput();
  const asked = sp.from !== undefined || sp.to !== undefined;
  const parsed = parsePeriod(sp.from ?? thisMonthUntil(today).from, sp.to ?? thisMonthUntil(today).to, { maxDays: MAX_UTILIZATION_DAYS });
  const period = parsed.ok ? parsed : thisMonthUntil(today);
  const problem = asked && !parsed.ok ? parsed.problem : null;
  const report = await utilizationReport(session, period);
  if (!report) redirect("/forbidden");
  const hours = (minutes: number) => t("reports.common.hours", { hours: number(minutes / 60, { maximumFractionDigits: 1 }) });
  const percent = (value: number | null) => (value === null ? "–" : `${number(value, { maximumFractionDigits: 1 })} %`);
  const withBay = report.rows.filter((r) => r.id !== null);
  const totals = utilizationTotals(report);
  const rules = ["capacity", "booked", "totals", "people"] as const;

  return (
    <>
      <PageHeader back={{ href: "/reports", label: t("reports.back") }} help="office.reports" title={t("reports.utilization.title")} description={t("reports.utilization.description")} />
      {problem ? (
        <Alert tone="warning" className="mb-5">
          {t(`reports.errors.${problem}`, { max: MAX_UTILIZATION_DAYS, unit: t("reports.errors.units.days") })}
        </Alert>
      ) : null}
      <PeriodForm today={today} from={period.from} to={period.to} maxDays={MAX_UTILIZATION_DAYS} presets={["today", "last7", "last30", "thisMonth", "lastMonth", "thisYear"]} />
      <p className="mb-5 text-sm text-ink-muted">{t("reports.period.days", { from: date(noon(report.from), { dateStyle: "medium" }), to: date(noon(report.to), { dateStyle: "medium" }) })}</p>

      {report.truncated ? (
        <Alert tone="warning" className="mb-5">
          {t("reports.utilization.truncated", { max: number(UTILIZATION_MAX_BOOKINGS) })}
        </Alert>
      ) : null}
      {report.capacityMinutes <= 0 ? (
        <Alert tone="info" className="mb-5">
          {t("reports.utilization.noCapacity")}
        </Alert>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("reports.utilization.stats.capacityPerBay")} value={hours(totals.capacityPerBay)} sub={t("reports.utilization.stats.capacityPerBaySub")} />
        <StatCard label={t("reports.utilization.stats.capacityTotal")} value={hours(totals.capacityTotal)} sub={tp("reports.utilization.stats.bays", totals.bays)} />
        <StatCard label={t("reports.utilization.stats.bookedTotal")} value={hours(totals.bookedTotal)} sub={t("reports.utilization.stats.bookedTotalSub")} />
        <StatCard label={t("reports.utilization.stats.unassigned")} value={hours(totals.bookedUnassigned)} sub={t("reports.utilization.stats.unassignedSub")} />
      </div>

      {withBay.length > 0 && report.capacityMinutes > 0 ? (
        <Card className="mb-5">
          <ReportChart kind="percent" title={t("reports.utilization.chart")} categories={withBay.map((r) => r.name ?? "")} values={withBay.map((r) => r.utilization)} seriesLabel={t("reports.utilization.series")} categoryLabel={t("reports.utilization.cols.bay")} />
        </Card>
      ) : null}

      <div className="mb-5">
        <DataTable<Row>
          caption={t("reports.utilization.title")}
          rowKey={(row) => row.id ?? "none"}
          minWidth="36rem"
          columns={[
            { id: "bay", header: t("reports.utilization.cols.bay"), priority: "primary", cell: (row) => (row.id === null ? t("reports.utilization.noBay") : `${row.name}${row.active ? "" : ` ${t("reports.utilization.inactive")}`}`) },
            { id: "appointments", header: t("reports.utilization.cols.appointments"), align: "end", cell: (row) => row.appointments },
            { id: "booked", header: t("reports.utilization.cols.booked"), align: "end", cell: (row) => hours(row.bookedMinutes) },
            { id: "capacity", header: t("reports.utilization.cols.capacityPerBay"), align: "end", cell: (row) => (row.id === null ? "–" : hours(report.capacityMinutes)) },
            { id: "utilization", header: t("reports.utilization.cols.utilization"), align: "end", cell: (row) => <strong>{percent(row.utilization)}</strong> },
          ]}
          rows={report.rows}
          empty={<p className="p-6 text-center text-sm text-ink-muted">{t("reports.common.noData")}</p>}
        />
      </div>

      <div className="mb-5">
        <Disclosure title={t("reports.common.rulesTitle")} variant="card">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {rules.map((rule) => (
              <li key={rule}>{t(`reports.utilization.rules.${rule}`)}</li>
            ))}
          </ul>
        </Disclosure>
      </div>

      {session.can("reports.export") ? (
        <Card title={t("reports.common.exportTitle")}>
          <p className="mb-4 text-sm text-ink-muted">{t("reports.common.exportHint")}</p>
          <ExportPanel kind="report-utilization" defaultFormat={defaultFormatId(i18n.locale)} fixed={{ from: period.from, to: period.to }} />
        </Card>
      ) : null}
    </>
  );
}
