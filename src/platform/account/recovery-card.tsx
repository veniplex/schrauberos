"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FieldHint, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import type { RecoveryActionState } from "@/lib/recovery-code";
import { confirmRecoveryCode, createRecoveryCode } from "./recovery-actions";
import { RecoveryCodeView } from "./recovery-code-view";

/** Notzugang im Konto: Status des Codes und (Neu-)Erzeugen mit erneuter Passwortabfrage. Nur für Administrator-Konten. */
export function RecoveryCard({ status, account }: { status: { createdOn: string | null; confirmed: boolean }; account: { name: string; username: string } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action] = useActionState<RecoveryActionState, FormData>(createRecoveryCode, {});
  const err = state.fieldErrors ?? {};
  // useActionState behält die letzte Antwort (samt Code): „Weiter“ merkt sich deshalb, **welcher** Code schon abgehakt ist.
  // Ein neu erzeugter Code ist ein anderer und wird wieder angezeigt.
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (state.recoveryCode && state.recoveryCode !== dismissed) {
    return (
      <RecoveryCodeView
        code={state.recoveryCode}
        issuedOn={state.issuedOn}
        account={account}
        onConfirm={() => confirmRecoveryCode(new FormData())}
        onContinue={() => {
          setDismissed(state.recoveryCode ?? null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{t("recovery.account.intro")}</p>
      <p className="text-sm">
        {status.createdOn ? (
          <>
            {t("recovery.account.created", { date: status.createdOn })} {status.confirmed ? t("recovery.account.confirmed") : t("recovery.account.notConfirmed")}
          </>
        ) : (
          t("recovery.account.none")
        )}
      </p>
      <Field label={t("recovery.account.password")} htmlFor="recovery-password" error={err.password} hint={status.createdOn ? t("recovery.account.regenerateHint") : undefined} required>
        <Input id="recovery-password" name="password" type="password" maxLength={128} autoComplete="current-password" invalid={!!err.password} required />
      </Field>
      <FieldHint>{t("recovery.account.restoreHint")}</FieldHint>
      <FormMessage state={state} />
      <div>
        <SubmitButton>{status.createdOn ? t("recovery.account.regenerate") : t("recovery.account.generate")}</SubmitButton>
      </div>
    </form>
  );
}
