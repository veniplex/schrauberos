"use client";

import { Field, Form, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Alert, TextLink } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { reconstructKey } from "./key-recovery-actions";

/** Eingabe des Wiederherstellungsschlüssels, um `secret.key` aus der Datenbank wiederherzustellen (Anmeldeseite und Verwaltung → Backups → Schlüssel). */
export function KeyRecoveryForm({ onDoneHref }: { onDoneHref?: string }) {
  const { t } = useI18n();
  return (
    <Form action={reconstructKey} className="flex flex-col gap-4">
      {(state) =>
        state.ok ? (
          <div className="flex flex-col gap-3">
            <Alert tone="success">{state.message ?? t("backup.keyIssue.done")}</Alert>
            {onDoneHref ? (
              <TextLink href={onDoneHref}>{t("backup.keyIssue.backToLogin")}</TextLink>
            ) : null}
          </div>
        ) : (
          <>
            <Field label={t("backup.keyIssue.key")} htmlFor="issue-recovery-key" name="key" hint={t("backup.keyIssue.keyHint")} required>
              <Input id="issue-recovery-key" name="key" type="password" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={200} className="font-mono" required />
            </Field>
            <FormMessage />
            <SubmitButton className="w-full sm:w-auto">{t("backup.keyIssue.submit")}</SubmitButton>
          </>
        )
      }
    </Form>
  );
}
