import type { Metadata } from "next";
import { ImportPageBody } from "@/components/exchange/import-page-body";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { VEHICLE_COLUMNS } from "@/modules/workshop/vehicles/exchange-columns";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("vehicles.exchange.importTitle") };
}

export default async function VehiclesImportPage() {
  const session = await requirePermission("vehicles.import");
  const { t } = await getI18n();
  // Die Halter-Spalte (Kundennummer) gibt es nur mit dem Recht, Kunden zu sehen
  const columns = session.features.has("workshop.customers") && session.can("customers.view") ? VEHICLE_COLUMNS : VEHICLE_COLUMNS.filter((c) => c.key !== "customerNumber");
  return (
    <>
      <PageHeader back={{ href: "/vehicles", label: t("nav.vehicles") }} help="workshop.vehicles" title={t("vehicles.exchange.importTitle")} description={t("vehicles.exchange.importDescription")} />
      <ImportPageBody kind="vehicles" duplicateOverride columns={columns} rules="vehicles.exchange.importRules" />
    </>
  );
}
