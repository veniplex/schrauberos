import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { LinkButton } from "@/components/ui/buttons";
import { DataTable } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Card, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";
import { noon, todayInput } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { monthStart } from "@/lib/month";
import { canOpenReport } from "@/modules/office/reports/access";
import { DUE_MONTH_CHOICES, dueReport } from "@/modules/office/reports/queries";
import { ReportChart } from "@/modules/office/reports/report-chart";
import { requirePermission } from "@/server/auth/session";
import { defaultFormatId } from "@/server/csv/format";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.due.title") };
}

/**
 * Fälligkeiten (F9): Prüffristen der Kundenfahrzeuge (`vehicles.view`), Fristen im Fuhrpark (`fleet.view`) und Zahlungsziele (`invoices.view`) für die nächsten Monate – **jeder Teil nur mit dem Recht seiner
 * Quelle**. Verlangt `reports.view` und mindestens eines dieser Rechte.
 */
export default async function DueReportPage({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  const session = await requirePermission("reports.view");
  if (!canOpenReport(session, "due")) redirect("/forbidden");
  const [i18n, sp] = await Promise.all([getI18n(), searchParams]);
  const { t, tp, locale, date } = i18n;
  const eur = (cents: number) => formatCents(cents, INTL_LOCALE[locale]);
  const today = todayInput();
  const asked = Number(sp.months);
  const months = (DUE_MONTH_CHOICES as readonly number[]).includes(asked) ? asked : 3;
  const report = await dueReport(session, { today, months });
  const dayText = (day: string) => date(noon(day), { dateStyle: "medium" });
  const monthText = (month: string) => date(monthStart(month), { month: "long", year: "numeric" });
  const shortMonth = (month: string) => date(monthStart(month), { month: "short", year: "2-digit" });
  const nothing = !report.inspection && !report.fleet && !report.payments;
  const rules = ["inspection", "payments"] as const;
  const inspection = report.inspection;
  const monthRows = inspection ? [...(inspection.overdue > 0 ? [{ key: "overdue", label: t("reports.due.inspection.overdue"), count: inspection.overdue }] : []), ...inspection.months.map((m) => ({ key: m.month, label: monthText(m.month), count: m.count }))] : [];

  return (
    <>
      <PageHeader back={{ href: "/reports", label: t("reports.back") }} help="office.reports" title={t("reports.due.title")} description={t("reports.due.description")} />
      <nav aria-label={t("reports.due.horizon")} className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-muted">{t("reports.due.horizon")}</span>
        {DUE_MONTH_CHOICES.map((n) => (
          <LinkButton key={n} href={`/reports/due?months=${n}`} variant={n === months ? "primary" : "secondary"} size="sm" aria-current={n === months ? "true" : undefined}>
            {t(`reports.due.horizonChoices.${n}`)}
          </LinkButton>
        ))}
      </nav>

      {nothing ? (
        <Alert tone="info" className="mb-5">
          {t("reports.due.nothing")}
        </Alert>
      ) : null}

      {inspection ? (
        <section className="mb-6" aria-labelledby="due-inspection">
          <h2 id="due-inspection" className="mb-3 text-lg font-semibold">
            {t("reports.due.inspection.title")}
          </h2>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t("reports.due.inspection.overdue")} value={inspection.overdue} tone={inspection.overdue > 0 ? "danger" : undefined} />
            <StatCard label={t("reports.due.title")} value={inspection.months.reduce((sum, m) => sum + m.count, 0)} sub={`${t("reports.due.horizon")}: ${t(`reports.due.horizonChoices.${months as 1 | 3 | 6 | 12}`)}`} />
          </div>
          {monthRows.length === 0 ? (
            <Alert tone="success">{t("reports.due.inspection.empty")}</Alert>
          ) : (
            <>
              <Card className="mb-4">
                <ReportChart kind="count" title={t("reports.due.chart")} categories={monthRows.map((r) => (r.key === "overdue" ? r.label : shortMonth(r.key)))} values={monthRows.map((r) => r.count)} seriesLabel={t("reports.due.series")} categoryLabel={t("reports.due.inspection.cols.due")} />
              </Card>
              <Card padded={false} title={t("reports.due.inspection.title")}>
                <DataTable<(typeof inspection.items)[number]>
                  bare
                  caption={t("reports.due.inspection.title")}
                  rowKey={(row) => row.id}
                  minWidth="32rem"
                  summary={t("reports.common.limitHint", { max: 50 })}
                  columns={[
                    { id: "plate", header: t("reports.due.inspection.cols.plate"), priority: "primary", cell: (row) => row.plate },
                    { id: "vehicle", header: t("reports.due.inspection.cols.vehicle"), cell: (row) => row.vehicleName || "–" },
                    { id: "due", header: t("reports.due.inspection.cols.due"), cell: (row) => monthText(row.month) },
                  ]}
                  rows={inspection.items}
                  rowHref={(row) => (session.can("vehicles.view") ? `/vehicles/${row.id}` : null)}
                />
              </Card>
            </>
          )}
        </section>
      ) : null}

      {report.fleet ? (
        <section className="mb-6" aria-labelledby="due-fleet">
          <h2 id="due-fleet" className="mb-3 text-lg font-semibold">
            {t("reports.due.fleet.title")}
          </h2>
          <Card padded={false}>
            <DataTable<NonNullable<typeof report.fleet>[number]>
              bare
              caption={t("reports.due.fleet.title")}
              rowKey={(row) => `${row.id}-${row.kind}`}
              minWidth="30rem"
              columns={[
                { id: "plate", header: t("reports.due.fleet.cols.plate"), priority: "primary", cell: (row) => row.plate },
                { id: "kind", header: t("reports.due.fleet.cols.kind"), cell: (row) => t(`reports.due.fleet.kinds.${row.kind}`) },
                { id: "due", header: t("reports.due.fleet.cols.due"), cell: (row) => dayText(row.day) },
              ]}
              rows={report.fleet}
              empty={<p className="p-6 text-center text-sm text-ink-muted">{t("reports.due.fleet.empty")}</p>}
            />
          </Card>
        </section>
      ) : null}

      {report.payments ? (
        <section className="mb-6" aria-labelledby="due-payments">
          <h2 id="due-payments" className="mb-3 text-lg font-semibold">
            {t("reports.due.payments.title", { days: report.days })}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {(["outgoing", "incoming"] as const).map((direction) => {
              const part = report.payments![direction];
              return (
                <Card key={direction} title={t(`reports.due.payments.${direction}`)} padded={false} className="min-w-0">
                  <p className="border-b border-line px-4 py-2 text-sm font-medium">{t("reports.due.payments.sum", { count: part.count, amount: eur(part.cents) })}</p>
                  <DataTable<(typeof part.items)[number]>
                    bare
                    caption={t(`reports.due.payments.${direction}`)}
                    rowKey={(row) => row.id}
                    minWidth="26rem"
                    columns={[
                      { id: "number", header: t("reports.due.payments.cols.number"), priority: "primary", cell: (row) => <span className="font-mono">{row.number}</span> },
                      { id: "party", header: t("reports.due.payments.cols.party"), cell: (row) => row.partyName },
                      { id: "due", header: t("reports.due.payments.cols.due"), cell: (row) => dayText(row.dueDay) },
                      { id: "amount", header: t("reports.due.payments.cols.outstanding"), align: "end", cell: (row) => <strong>{eur(row.outstandingCents)}</strong> },
                    ]}
                    rows={part.items}
                    rowHref={(row) => `/invoices/${row.id}`}
                    empty={<p className="p-6 text-center text-sm text-ink-muted">{t("reports.due.payments.empty")}</p>}
                  />
                  {part.hiddenCount > 0 ? <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">{tp("reports.openItems.hidden", part.hiddenCount)}</p> : null}
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="mb-5">
        <Disclosure title={t("reports.common.rulesTitle")} variant="card">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {rules.map((rule) => (
              <li key={rule}>{t(`reports.due.rules.${rule}`)}</li>
            ))}
          </ul>
        </Disclosure>
      </div>

      {session.can("reports.export") ? (
        <Card title={t("reports.common.exportTitle")}>
          <p className="mb-4 text-sm text-ink-muted">{t("reports.common.exportHint")}</p>
          <ExportPanel kind="report-due" defaultFormat={defaultFormatId(locale)} fixed={{ months: String(months) }} />
        </Card>
      ) : null}
    </>
  );
}
