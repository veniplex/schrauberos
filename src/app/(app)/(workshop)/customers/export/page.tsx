import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { archiveParam, parseArchiveFilter } from "@/lib/archive-filter";
import { defaultFormatId } from "@/server/csv/format";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("customers.exchange.exportTitle") };
}

export default async function CustomersExportPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const session = await requirePermission("customers.export");
  // Exportieren heißt: die Daten ansehen dürfen
  if (!session.can("customers.view")) redirect("/forbidden");
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  // Archiv: Standard nur aktive Kunden; die Auswahl der Liste („Archivierte“, „Alle“) kommt als Adresse mit
  const archived = parseArchiveFilter(sp.archived);
  return (
    <>
      <PageHeader back={{ href: "/customers", label: t("nav.customers") }} help="workshop.customers" title={t("customers.exchange.exportTitle")} description={t("customers.exchange.exportDescription")} />
      <div className="flex max-w-3xl flex-col gap-4">
        <Alert tone="warning">{t("exchange.privacy")}</Alert>
        <Card title={t("exchange.exportCard")}>
          {archived !== "active" ? <p className="mb-4 text-sm">{t("customers.exchange.selection", { filters: t(archived === "all" ? "archive.filter.all" : "archive.filter.archived") })}</p> : null}
          <ExportPanel kind="customers" defaultFormat={defaultFormatId(locale)} fixed={archiveParam(archived)} />
        </Card>
      </div>
    </>
  );
}
