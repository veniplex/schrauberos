import type { Metadata } from "next";
import { ImportPageBody } from "@/components/exchange/import-page-body";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { TIRE_COLUMNS } from "@/modules/workshop/tires/exchange-columns";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tires.exchange.importTitle") };
}

export default async function TiresImportPage() {
  await requirePermission("tires.import");
  const { t } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/tires", label: t("nav.tires") }} help="workshop.tires" title={t("tires.exchange.importTitle")} description={t("tires.exchange.importDescription")} />
      <ImportPageBody kind="tires" duplicateOverride columns={TIRE_COLUMNS} rules="tires.exchange.importRules" />
    </>
  );
}
