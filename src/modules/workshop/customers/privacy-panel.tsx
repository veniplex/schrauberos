import { Download, FileJson } from "lucide-react";
import { Alert, Card } from "@/components/ui/layout";
import { LinkButton } from "@/components/ui/buttons";
import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { getI18n } from "@/i18n/server";
import { anonymizeBlock } from "@/lib/privacy";
import { collectRetention, privacySubject } from "@/modules/privacy";
import type { AppSession } from "@/server/auth/session";
import { anonymizeCustomer, restrictCustomer, unrestrictCustomer } from "./actions";
import { getPrivacyConfig } from "./settings";

/** Hinweis oben auf der Kundenseite für alle, die den Kunden sehen: Verarbeitung eingeschränkt bzw. anonymisiert. */
export async function PrivacyNotice({ restrictedAt, anonymizedAt }: { restrictedAt: Date | null; anonymizedAt: Date | null }) {
  const { t, date } = await getI18n();
  if (!restrictedAt && !anonymizedAt) return null;
  return (
    <div className="mb-5 flex flex-col gap-3">
      {restrictedAt ? <Alert tone="warning">{t("privacy.panel.restrictedNotice", { date: date(restrictedAt, { dateStyle: "medium" }) })}</Alert> : null}
      {anonymizedAt ? <Alert tone="info">{t("privacy.panel.anonymizedNotice", { date: date(anonymizedAt, { dateStyle: "medium" }) })}</Alert> : null}
    </div>
  );
}

/**
 * Karte „Datenschutz“ auf der Kundenseite (P4b-5): Auskunft exportieren (\`customers.disclose\`), Verarbeitung einschränken/aufheben und Stammsatz anonymisieren (\`customers.privacy\`).
 * Die Anonymisierung zeigt, warum sie gesperrt ist (Fristen nicht bestätigt, Frist läuft bis …); die Sperre prüft die Operation selbst noch einmal.
 */
export async function PrivacyPanel({ session, customer }: { session: AppSession; customer: { id: string; processingRestrictedAt: Date | null; anonymizedAt: Date | null } }) {
  const canDisclose = session.can("customers.disclose");
  const canPrivacy = session.can("customers.privacy");
  if (!canDisclose && !canPrivacy) return null;
  const { t } = await getI18n();

  let blocked: string | null = null;
  let canAnonymize = false;
  if (canPrivacy) {
    const [subject, config] = await Promise.all([privacySubject(customer.id), getPrivacyConfig()]);
    const items = subject ? await collectRetention(subject) : [];
    const block = anonymizeBlock({ anonymizedAt: customer.anonymizedAt, confirmed: Boolean(config.confirmedAt), items, rules: config.rules });
    canAnonymize = block === null;
    blocked = !block ? null : block.reason === "running" ? t("privacy.panel.blocked.running", { date: block.until }) : t(`privacy.panel.blocked.${block.reason}`);
  }

  return (
    <Card title={t("privacy.panel.title")}>
      <div className="flex flex-col gap-5 text-sm">
        {canDisclose ? (
          <section aria-labelledby="privacy-disclose" className="flex flex-col gap-2">
            <h3 id="privacy-disclose" className="font-medium">
              {t("privacy.panel.disclose")}
            </h3>
            <p className="text-ink-muted">{t("privacy.panel.discloseHint")}</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton external size="sm" href={`/api/exchange/customer-disclosure?customer=${customer.id}`}>
                <Download className="size-3.5" aria-hidden /> {t("privacy.panel.discloseCsv")}
              </LinkButton>
              <LinkButton external size="sm" href={`/api/customers/${customer.id}/disclosure`}>
                <FileJson className="size-3.5" aria-hidden /> {t("privacy.panel.discloseJson")}
              </LinkButton>
            </div>
          </section>
        ) : null}

        {canPrivacy ? (
          <>
            <section aria-labelledby="privacy-restrict" className="flex flex-col gap-2">
              <h3 id="privacy-restrict" className="font-medium">
                {customer.processingRestrictedAt ? t("privacy.panel.unrestrict") : t("privacy.panel.restrict")}
              </h3>
              {customer.processingRestrictedAt ? (
                <form action={unrestrictCustomer}>
                  <input type="hidden" name="id" value={customer.id} />
                  <ConfirmSubmitButton variant="secondary" message={t("privacy.panel.unrestrictConfirm")}>
                    {t("privacy.panel.unrestrict")}
                  </ConfirmSubmitButton>
                </form>
              ) : (
                <form action={restrictCustomer} className="flex flex-col gap-2">
                  <p className="text-ink-muted">{t("privacy.panel.restrictHint")}</p>
                  <input type="hidden" name="id" value={customer.id} />
                  <Field label={t("privacy.panel.restrictNote")} htmlFor="restrictNote" hint={t("privacy.panel.restrictNoteHint")}>
                    <Input id="restrictNote" name="note" maxLength={300} autoComplete="off" />
                  </Field>
                  <div>
                    <ConfirmSubmitButton variant="secondary" message={t("privacy.panel.restrictConfirm")}>
                      {t("privacy.panel.restrict")}
                    </ConfirmSubmitButton>
                  </div>
                </form>
              )}
            </section>

            <section aria-labelledby="privacy-anonymize" className="flex flex-col gap-2">
              <h3 id="privacy-anonymize" className="font-medium">
                {t("privacy.panel.anonymize")}
              </h3>
              <p className="text-ink-muted">{t("privacy.panel.anonymizeHint")}</p>
              {blocked ? (
                <p className="text-ink-muted" role="note">
                  {blocked}
                </p>
              ) : null}
              {canAnonymize ? (
                <form action={anonymizeCustomer}>
                  <input type="hidden" name="id" value={customer.id} />
                  <ConfirmSubmitButton message={t("privacy.panel.anonymizeConfirm")} typeToConfirm={t("privacy.panel.anonymizeTypeToConfirm")}>
                    {t("privacy.panel.anonymize")}
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </Card>
  );
}
