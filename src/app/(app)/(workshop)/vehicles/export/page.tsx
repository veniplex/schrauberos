import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { defaultFormatId } from "@/server/csv/format";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.exchange.exportTitle") };
}

/** Die Auswahl der Fahrzeugliste (Suche, Prüffrist, Halter) kommt als Adresse mit und geht unverändert an den Export. */
export default async function VehiclesExportPage({ searchParams }: { searchParams: Promise<{ q?: string; owner?: string; inspection?: string; month?: string }> }) {
  const session = await requirePermission("vehicles.export");
  if (!session.can("vehicles.view")) redirect("/forbidden");
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const fixed: Record<string, string> = {};
  const parts: string[] = [];
  if (sp.q?.trim()) {
    fixed.q = sp.q.trim().slice(0, 60);
    parts.push(`„${fixed.q}“`);
  }
  if (sp.owner === "none") {
    fixed.owner = "none";
    parts.push(t("vehicles.filters.noOwner"));
  }
  if (sp.inspection === "soon" || sp.inspection === "none") {
    fixed.inspection = sp.inspection;
    parts.push(sp.inspection === "soon" ? t("vehicles.filters.inspectionSoon") : t("vehicles.filters.inspectionNone"));
  }
  if (sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month)) {
    fixed.month = sp.month;
    parts.push(`${t("vehicles.filters.month")} ${sp.month}`);
  }
  return (
    <>
      <PageHeader back={{ href: "/vehicles", label: t("nav.vehicles") }} help="workshop.vehicles" title={t("vehicles.exchange.exportTitle")} description={t("vehicles.exchange.exportDescription")} />
      <div className="flex max-w-3xl flex-col gap-4">
        {session.can("customers.view") ? <Alert tone="warning">{t("exchange.privacy")}</Alert> : null}
        <Card title={t("exchange.exportCard")}>
          <p className="mb-4 text-sm">
            {parts.length > 0 ? t("vehicles.exchange.selection", { filters: parts.join(", ") }) : t("vehicles.exchange.selectionAll")}
            {parts.length > 0 ? <span className="block text-xs text-ink-muted">{t("vehicles.exchange.selectionHint")}</span> : null}
          </p>
          <ExportPanel kind="vehicles" defaultFormat={defaultFormatId(locale)} fixed={fixed} />
        </Card>
      </div>
    </>
  );
}
