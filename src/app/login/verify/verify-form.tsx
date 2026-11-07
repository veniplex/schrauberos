"use client";

import { Field, Form, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton, LinkButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { verifyAction } from "./actions";

/** Zweiter Schritt: Code der App (6 Ziffern) oder Sicherungscode. Das Feld nimmt beides; die Tastatur zeigt Ziffern (`inputMode="numeric"`) – ein Sicherungscode lässt sich dennoch tippen. */
export function VerifyForm({ next }: { next: string }) {
  const { t } = useI18n();
  return (
    <Form action={verifyAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label={t("auth.secondFactor.code")} htmlFor="code" name="code" hint={t("auth.secondFactor.codeHint")} required>
        <Input id="code" name="code" autoComplete="one-time-code" inputMode="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={40} className="font-mono tracking-wider" autoFocus required />
      </Field>
      <FormMessage />
      <SubmitButton className="w-full">{t("auth.secondFactor.submit")}</SubmitButton>
      <LinkButton href="/login" variant="ghost" className="w-full">
        {t("auth.secondFactor.cancel")}
      </LinkButton>
    </Form>
  );
}
