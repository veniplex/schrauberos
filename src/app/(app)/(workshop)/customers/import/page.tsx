import type { Metadata } from "next";
import { ImportPageBody } from "@/components/exchange/import-page-body";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { CUSTOMER_COLUMNS } from "@/modules/workshop/customers/exchange-columns";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("customers.exchange.importTitle") };
}

export default async function CustomersImportPage() {
  await requirePermission("customers.import");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/customers", label: t("nav.customers") }} help="workshop.customers" title={t("customers.exchange.importTitle")} description={t("customers.exchange.importDescription")} />
      <ImportPageBody kind="customers" duplicateOverride={false} columns={CUSTOMER_COLUMNS} rules="customers.exchange.importRules" />
    </>
  );
}
