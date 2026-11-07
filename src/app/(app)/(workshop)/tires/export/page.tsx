import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { Field, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { TIRE_SET_STATUSES } from "@/modules/workshop/tires/constants";
import { defaultFormatId } from "@/server/csv/format";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("tires.exchange.exportTitle") };
}

export default async function TiresExportPage() {
  const session = await requirePermission("tires.export");
  if (!session.can("tires.view")) redirect("/forbidden");
  const { t, locale } = await getI18n();
  return (
    <>
      <PageHeader back={{ href: "/tires", label: t("nav.tires") }} help="workshop.tires" title={t("tires.exchange.exportTitle")} description={t("tires.exchange.exportDescription")} />
      <div className="max-w-3xl">
        <Card title={t("exchange.exportCard")}>
          <ExportPanel kind="tires" defaultFormat={defaultFormatId(locale)}>
            <Field label={t("tires.exchange.statusFilter")} htmlFor="export-tires-status">
              <Select id="export-tires-status" name="status" defaultValue="">
                <option value="">{t("tires.exchange.statusAll")}</option>
                {TIRE_SET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`enums.tireSetStatus.${status}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </ExportPanel>
        </Card>
      </div>
    </>
  );
}
