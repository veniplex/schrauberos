"use client";

import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { confirmRetention, savePrivacySettings } from "./actions";

/**
 * Einstellungen → Datenschutz (nur Administratoren): Aufbewahrungsfristen in Jahren und ihre Bestätigung. Solange nicht bestätigt, ist die Anonymisierung von Kunden gesperrt; eine
 * Änderung der Fristen nimmt die Bestätigung zurück.
 */
export function PrivacySettingsForm({ years, confirmedAt, confirmedBy }: { years: { invoice: number; books: number }; confirmedAt: string | null; confirmedBy: string | null }) {
  const { t, date } = useI18n();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Form action={savePrivacySettings} className="flex flex-col gap-5">
        <Card title={t("privacy.settings.title")}>
          <p className="mb-4 text-sm text-ink-muted">{t("privacy.settings.hint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("privacy.settings.invoiceYears")} htmlFor="retentionInvoiceYears" name="retentionInvoiceYears">
              <Input id="retentionInvoiceYears" name="retentionInvoiceYears" type="number" min={1} max={30} inputMode="numeric" defaultValue={years.invoice} />
            </Field>
            <Field label={t("privacy.settings.booksYears")} htmlFor="retentionBooksYears" name="retentionBooksYears" hint={t("privacy.settings.saveHint")}>
              <Input id="retentionBooksYears" name="retentionBooksYears" type="number" min={1} max={30} inputMode="numeric" defaultValue={years.books} />
            </Field>
          </div>
        </Card>
        <FormActions submitLabel={t("privacy.settings.save")} />
      </Form>

      <Card title={t("privacy.settings.confirm")}>
        <Alert tone={confirmedAt ? "success" : "warning"} live={false}>
          {confirmedAt ? t("privacy.settings.status.confirmed", { date: date(confirmedAt, { dateStyle: "medium" }), name: confirmedBy ?? "–" }) : t("privacy.settings.status.unconfirmed")}
        </Alert>
        <p className="my-3 text-sm text-ink-muted">{t("privacy.settings.confirmHint")}</p>
        <form action={confirmRetention}>
          <input type="hidden" name="confirmed" value={confirmedAt ? "0" : "1"} />
          <ConfirmSubmitButton variant={confirmedAt ? "secondary" : "primary"} message={confirmedAt ? t("privacy.settings.revokeQuestion") : t("privacy.settings.confirmQuestion")} confirmLabel={confirmedAt ? t("privacy.settings.confirmRevoke") : t("privacy.settings.confirm")}>
            {confirmedAt ? t("privacy.settings.confirmRevoke") : t("privacy.settings.confirm")}
          </ConfirmSubmitButton>
        </form>
      </Card>
    </div>
  );
}
