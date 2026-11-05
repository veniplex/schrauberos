"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";

export function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label={t("auth.username")} htmlFor="username">
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoFocus required />
      </Field>
      <Field label={t("auth.password")} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full">{t("auth.signIn")}</SubmitButton>
    </form>
  );
}
