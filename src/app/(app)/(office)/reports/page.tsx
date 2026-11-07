import type { Metadata } from "next";
import { CardLink, EmptyState } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { REPORT_HREF, openableReports } from "@/modules/office/reports/access";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reports.title") };
}

/** Übersicht der Berichte (F9): nur die, die die Person mit ihren Rechten öffnen darf (`reports.view` und das Leserecht der Quelle). */
export default async function ReportsPage() {
  const session = await requirePermission("reports.view");
  const { t } = await getI18n();
  const reports = openableReports(session);
  return (
    <>
      <PageHeader help="office.reports" title={t("reports.title")} description={t("reports.description")} />
      {reports.length === 0 ? (
        <EmptyState title={t("reports.empty")} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((id) => (
            <li key={id} className="min-w-0">
              <CardLink href={REPORT_HREF[id]} className="h-full">
                <h2 className="text-base font-semibold">{t(`reports.cards.${id}.title`)}</h2>
                <p className="mt-1 text-sm text-ink-muted">{t(`reports.cards.${id}.text`)}</p>
                <p className="mt-3 text-sm font-medium text-accent-text">{t("reports.open")}</p>
              </CardLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
