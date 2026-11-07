import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { DataTable } from "@/components/ui/data-table";
import { Disclosure } from "@/components/ui/disclosure";
import { Alert, Card, StatCard } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { noon } from "@/lib/dates";
import { canOpenReport } from "@/modules/office/reports/access";
import { storageReport } from "@/modules/office/reports/queries";
import { ReportChart } from "@/modules/office/reports/report-chart";
import { requirePermission } from "@/server/auth/session";
import { defaultFormatId } from "@/server/csv/format";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.storage.title") };
}

/**
 * Einlagerungsbestand (F9): die eingelagerten Reifensätze nach Lagerplatz und Saison – nur Anzahlen, keine Namen und Kennzeichen. Verlangt `reports.view` und `tires.view`.
 */
export default async function StorageReportPage() {
  const session = await requirePermission("reports.view");
  if (!canOpenReport(session, "storage")) redirect("/forbidden");
  const { t, tp, date, locale } = await getI18n();
  const report = await storageReport(session);
  if (!report) redirect("/forbidden");
  const seasons = ["summer", "winter", "allseason"] as const;
  const dayText = (day: string) => date(noon(day), { dateStyle: "medium" });

  return (
    <>
      <PageHeader back={{ href: "/reports", label: t("reports.back") }} help="office.reports" title={t("reports.storage.title")} description={t("reports.storage.description")} />
      {report.total === 0 ? (
        <Alert tone="info" className="mb-5">
          {t("reports.storage.empty")}
        </Alert>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t("reports.storage.cols.total")} value={report.total} />
            {seasons.map((season) => (
              <StatCard key={season} label={t(`reports.storage.seasons.${season}`)} value={report.bySeason[season]} />
            ))}
          </div>
          <Card className="mb-5">
            <ReportChart kind="count" title={t("reports.storage.chart")} categories={seasons.map((s) => t(`reports.storage.seasons.${s}`))} values={seasons.map((s) => report.bySeason[s])} seriesLabel={t("reports.storage.series")} categoryLabel={t("reports.storage.cols.season")} />
          </Card>
          <div className="mb-5">
            <DataTable<(typeof report.rows)[number]>
              caption={t("reports.storage.title")}
              rowKey={(row) => row.location ?? "none"}
              minWidth="38rem"
              columns={[
                { id: "location", header: t("reports.storage.cols.location"), priority: "primary", cell: (row) => row.location ?? <span className="text-ink-muted">{t("reports.storage.noLocation")}</span> },
                { id: "summer", header: t("reports.storage.seasons.summer"), align: "end", cell: (row) => row.summer },
                { id: "winter", header: t("reports.storage.seasons.winter"), align: "end", cell: (row) => row.winter },
                { id: "allseason", header: t("reports.storage.seasons.allseason"), align: "end", cell: (row) => row.allseason },
                { id: "total", header: t("reports.storage.cols.total"), align: "end", cell: (row) => <strong>{row.total}</strong> },
                { id: "oldest", header: t("reports.storage.cols.oldest"), priority: "low", cell: (row) => dayText(row.oldestDay) },
              ]}
              rows={report.rows}
            />
          </div>
          {report.restricted.total > 0 ? (
            <Alert tone="info" className="mb-5">
              {tp("reports.storage.restricted", report.restricted.total)}
            </Alert>
          ) : null}
          {report.moreLocations > 0 ? (
            <Alert tone="info" className="mb-5">
              {tp("reports.storage.more", report.moreLocations)}
            </Alert>
          ) : null}
        </>
      )}

      <div className="mb-5">
        <Disclosure title={t("reports.common.rulesTitle")} variant="card">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            <li>{t("reports.storage.rules.scope")}</li>
          </ul>
        </Disclosure>
      </div>

      {session.can("reports.export") ? (
        <Card title={t("reports.common.exportTitle")}>
          <p className="mb-4 text-sm text-ink-muted">{t("reports.common.exportHint")}</p>
          <ExportPanel kind="report-storage" defaultFormat={defaultFormatId(locale)} />
        </Card>
      ) : null}
    </>
  );
}
