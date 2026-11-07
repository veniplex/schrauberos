"use client";

import { Field, Form, FormActions, Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/client";
import { changePassword, saveProfile } from "./actions";

export function ProfileForm({ initial }: { initial: { name: string; email: string } }) {
  const { t } = useI18n();
  return (
    <Form action={saveProfile} className="flex flex-col gap-4">
      <Field label={t("users.fields.name")} htmlFor="name" name="name" required>
        <Input id="name" name="name" defaultValue={initial.name} required />
      </Field>
      <Field label={t("users.fields.email")} htmlFor="email" name="email">
        <Input id="email" name="email" type="email" defaultValue={initial.email} />
      </Field>
      <FormActions />
    </Form>
  );
}

export function PasswordForm() {
  const { t } = useI18n();
  return (
    <Form action={changePassword} className="flex flex-col gap-4">
      <Field label={t("account.currentPassword")} htmlFor="current" name="current" required>
        <Input id="current" name="current" type="password" maxLength={128} autoComplete="current-password" required />
      </Field>
      <Field label={t("account.newPassword")} htmlFor="next" name="next" hint={t("account.passwordRules")} required>
        <Input id="next" name="next" type="password" maxLength={128} autoComplete="new-password" required />
      </Field>
      <Field label={t("account.confirmPassword")} htmlFor="confirm" name="confirm" required>
        <Input id="confirm" name="confirm" type="password" maxLength={128} autoComplete="new-password" required />
      </Field>
      <FormActions submitLabel={t("account.changePassword")} />
    </Form>
  );
}
