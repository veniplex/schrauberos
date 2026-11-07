import type { Metadata } from "next";
import { ImportPageBody } from "@/components/exchange/import-page-body";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { INVOICE_COLUMNS } from "@/modules/office/invoices/exchange-columns";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("invoices.exchange.importTitle") };
}

export default async function InvoicesImportPage() {
  const session = await requirePermission("invoices.import");
  const { t } = await getI18n();
  // Der Kunde (Kundennummer) gehört zu `customers.view`
  const columns = session.features.has("workshop.customers") && session.can("customers.view") ? INVOICE_COLUMNS : INVOICE_COLUMNS.filter((c) => c.key !== "customerNumber");
  return (
    <>
      <PageHeader back={{ href: "/invoices", label: t("nav.invoices") }} help="office.invoices" title={t("invoices.exchange.importTitle")} description={t("invoices.exchange.importDescription")} />
      <ImportPageBody kind="invoices" duplicateOverride={false} columns={columns} rules="invoices.exchange.importRules" />
    </>
  );
}
