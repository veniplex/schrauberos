"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FieldHint, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton, LinkButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { parseRecoveryCode, type RecoveryActionState } from "@/lib/recovery-code";
import { RecoveryCodeView } from "@/platform/account/recovery-code-view";
import { recoverAccess } from "./actions";

/** Hinweis zur Eingabe, rein im Browser: Der Code verlässt das Gerät erst beim Absenden. */
function useCodeHint(code: string): { text: string; tone: "ok" | "bad" } | null {
  const { t } = useI18n();
  if (!code.trim()) return null;
  const parsed = parseRecoveryCode(code);
  if (parsed.ok) return { text: t("recovery.recover.checksumOk"), tone: "ok" };
  if (parsed.reason === "checksum") return { text: t("recovery.recover.badGroup", { group: parsed.badGroup ?? 0 }), tone: "bad" };
  if (parsed.reason === "chars") return { text: t("recovery.recover.badChars"), tone: "bad" };
  return null; // noch unvollständig
}

export function RecoverForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [state, action] = useActionState<RecoveryActionState, FormData>(recoverAccess, {});
  const [code, setCode] = useState("");
  const hint = useCodeHint(code);
  const err = state.fieldErrors ?? {};

  if (state.recoveryCode) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{t("recovery.recover.doneTitle")}</h2>
        <p className="text-sm text-ink-muted print:hidden">{t("recovery.recover.doneIntro")}</p>
        <RecoveryCodeView code={state.recoveryCode} issuedOn={state.issuedOn} continueLabel={t("recovery.recover.toLogin")} onContinue={() => router.push("/login")} />
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("recovery.recover.code")} htmlFor="code" error={err.code}>
        <Input
          id="code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("recovery.recover.codePlaceholder")}
          maxLength={100}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
          autoFocus
          required
        />
        {hint ? <FieldHint>{hint.text}</FieldHint> : <FieldHint>{t("recovery.recover.codeHint")}</FieldHint>}
      </Field>
      <Field label={t("recovery.recover.newPassword")} htmlFor="password" error={err.password} hint={t("account.passwordRules")} required>
        <Input id="password" name="password" type="password" maxLength={128} autoComplete="new-password" invalid={!!err.password} required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" error={err.confirm} required>
        <Input id="confirm" name="confirm" type="password" maxLength={128} autoComplete="new-password" invalid={!!err.confirm} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">{t("recovery.recover.submit")}</SubmitButton>
      <LinkButton href="/login" variant="ghost" className="w-full">
        {t("recovery.recover.back")}
      </LinkButton>
    </form>
  );
}
