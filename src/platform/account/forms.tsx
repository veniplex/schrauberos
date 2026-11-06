"use client";

import { useActionState } from "react";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { changePassword, saveProfile } from "./actions";

export function ProfileForm({ initial }: { initial: { name: string; email: string } }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveProfile, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("users.fields.name")} htmlFor="name" error={err.name} required>
        <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} required />
      </Field>
      <Field label={t("users.fields.email")} htmlFor="email" error={err.email}>
        <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(changePassword, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={t("account.currentPassword")} htmlFor="current" error={err.current} required>
        <Input id="current" name="current" type="password" autoComplete="current-password" invalid={!!err.current} required />
      </Field>
      <Field label={t("account.newPassword")} htmlFor="next" error={err.next} hint={t("account.passwordRules")} required>
        <Input id="next" name="next" type="password" autoComplete="new-password" invalid={!!err.next} required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" error={err.confirm} required>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" invalid={!!err.confirm} required />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton>{t("account.changePassword")}</SubmitButton>
      </div>
    </form>
  );
}
