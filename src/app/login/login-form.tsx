"use client";

import { loginAction } from "./actions";
import { Field, Form, FormMessage, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";

export function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  return (
    <Form action={loginAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label={t("auth.username")} htmlFor="username" name="username">
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoFocus required />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" name="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required />
      </Field>
      <FormMessage />
      <SubmitButton className="w-full">{t("auth.signIn")}</SubmitButton>
    </Form>
  );
}
