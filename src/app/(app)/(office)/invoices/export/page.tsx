import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExportPanel } from "@/components/exchange/export-panel";
import { PeriodFields } from "@/components/exchange/period-fields";
import { Field, Select } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { PageHeader } from "@/components/ui/page-header";
import { getI18n } from "@/i18n/server";
import { todayInput } from "@/lib/dates";
import { defaultFormatId } from "@/server/csv/format";
import { requirePermission } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("invoices.exchange.exportTitle") };
}

export default async function InvoicesExportPage() {
  const session = await requirePermission("invoices.export");
  if (!session.can("invoices.view")) redirect("/forbidden");
  const { t, locale } = await getI18n();
  const today = todayInput();
  const defaultFormat = defaultFormatId(locale);
  const direction = (id: string) => (
    <Field label={t("invoices.exchange.direction.label")} htmlFor={`${id}-direction`}>
      <Select id={`${id}-direction`} name="direction" defaultValue="">
        <option value="">{t("invoices.exchange.direction.both")}</option>
        <option value="incoming">{t("invoices.exchange.direction.incoming")}</option>
        <option value="outgoing">{t("invoices.exchange.direction.outgoing")}</option>
      </Select>
    </Field>
  );
  return (
    <>
      <PageHeader back={{ href: "/invoices", label: t("nav.invoices") }} help="office.invoices" title={t("invoices.exchange.exportTitle")} description={t("invoices.exchange.exportDescription")} />
      <div className="flex max-w-3xl flex-col gap-6">
        <Alert tone="warning">{t("exchange.privacy")}</Alert>
        <Card title={t("invoices.exchange.accountant.title")}>
          <p className="mb-4 text-sm text-ink-muted">{t("invoices.exchange.accountant.description")}</p>
          <ExportPanel kind="accountant" defaultFormat={defaultFormat}>
            <PeriodFields today={today} idPrefix="accountant" required />
            {direction("accountant")}
            <p className="text-xs text-ink-muted">{t("invoices.exchange.accountant.hint")}</p>
          </ExportPanel>
        </Card>
        <Card title={t("invoices.exchange.archiveCard")}>
          <p className="mb-4 text-sm text-ink-muted">{t("invoices.exchange.archiveHint")}</p>
          <ExportPanel kind="invoices" defaultFormat={defaultFormat}>
            <PeriodFields today={today} idPrefix="archive" />
            {direction("archive")}
          </ExportPanel>
        </Card>
      </div>
    </>
  );
}
