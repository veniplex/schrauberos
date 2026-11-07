"use client";

import { ConfirmSubmitButton } from "@/components/ui/confirm-dialog";
import { Field, Form, FormMessage, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { KeyRecoveryForm } from "@/platform/account/key-recovery-form";
import { resetSecrets } from "./key-actions";

/**
 * Störung des Geheimnisschlüssels (`secret.key` fehlt, ist nicht lesbar oder gehört nicht zur Datenbank), Verwaltung → Backups → Schlüssel: der Weg zurück mit dem
 * Wiederherstellungsschlüssel (falls die Datenbank eine Hülle enthält) und – als letzter Ausweg – das Zurücksetzen der nicht lesbaren Geheimnisse (Passwort, Rückfrage,
 * Sicherung der Zeilen vorher). Ein nicht lesbarer, vorhandener Schlüssel wird nie überschrieben: Dort hilft nur die Person am Server.
 */
export function KeyIssuePanel({ kind, recoverable }: { kind: "missing" | "unreadable" | "mismatch"; recoverable: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="danger">
        <p className="font-medium">{t("backup.keyIssue.title")}</p>
        <p>{t(`backup.keyIssue.${kind}`)}</p>
        <p>{recoverable ? t("backup.keyIssue.recoverable") : t("backup.keyIssue.notRecoverable")}</p>
      </Alert>
      {recoverable ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">{t("backup.keyIssue.formTitle")}</h2>
          <KeyRecoveryForm />
        </div>
      ) : null}
      {kind !== "unreadable" ? (
        <Form action={resetSecrets} className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">{t("backup.keyIssue.reset.title")}</h2>
          <p className="text-sm text-ink-muted">{t("backup.keyIssue.reset.warning")}</p>
          <Field label={t("backup.key.password")} htmlFor="reset-secrets-password" name="password" hint={t("backup.key.passwordHint")} required>
            <Input id="reset-secrets-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
          </Field>
          <FormMessage />
          <div>
            <ConfirmSubmitButton variant="danger" message={t("backup.keyIssue.reset.confirm")} typeToConfirm={t("backup.list.restoreWord")}>
              {t("backup.keyIssue.reset.submit")}
            </ConfirmSubmitButton>
          </div>
        </Form>
      ) : null}
    </div>
  );
}
