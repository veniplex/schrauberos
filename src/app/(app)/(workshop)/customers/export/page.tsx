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
  return { title: t("customers.exchange.exportTitle") };
}

export default async function CustomersExportPage() {
  const session = await requirePermission("customers.export");
  // Exportieren heißt: die Daten ansehen dürfen
  if (!session.can("customers.view")) redirect("/forbidden");
  const { t, locale } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/customers", label: t("nav.customers") }} help="workshop.customers" title={t("customers.exchange.exportTitle")} description={t("customers.exchange.exportDescription")} />
      <div className="flex max-w-3xl flex-col gap-4">
        <Alert tone="warning">{t("exchange.privacy")}</Alert>
        <Card title={t("exchange.exportCard")}>
          <ExportPanel kind="customers" defaultFormat={defaultFormatId(locale)} />
        </Card>
      </div>
    </>
  );
}
