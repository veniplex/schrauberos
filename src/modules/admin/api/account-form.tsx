"use client";

import { Checkbox, Field, Form, FormActions, FormFieldError, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/layout";
import { useI18n } from "@/i18n/client";
import { createServiceAccount } from "./actions";

type State = { ok?: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string };

/**
 * Neues Dienstkonto: Name, Rollen (die Rechte des Kontos; angeboten werden nur Rollen, die ein Dienstkonto bekommen darf), **erneute Passwortabfrage**. Das Konto hat kein Passwort und keine Anmeldung;
 * danach legt man unter „Tokens“ ein Token an, dessen Besitzer das Dienstkonto ist.
 */
export function AccountForm({ roles }: { roles: Array<{ id: string; name: string }> }) {
  const { t } = useI18n();
  return (
    <Form<State> action={createServiceAccount as never} className="flex max-w-3xl flex-col gap-5">
      <Card title={t("api.accounts.form.details")}>
        <Field label={t("api.accounts.form.name")} htmlFor="account-name" name="name" required hint={t("api.accounts.form.nameHint")}>
          <Input id="account-name" name="name" maxLength={60} required autoComplete="off" />
        </Field>
      </Card>
      <Card title={t("api.accounts.form.roles")}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{t("api.accounts.form.rolesIntro")}</p>
          {roles.length === 0 ? <Alert tone="warning">{t("api.accounts.form.noRoles")}</Alert> : null}
          <div className="grid gap-1 sm:grid-cols-2">
            {roles.map((role) => (
              <Checkbox key={role.id} name="roleId" value={role.id} label={role.name} />
            ))}
          </div>
          <FormFieldError name="roleIds" />
        </div>
      </Card>
      <Card title={t("api.accounts.form.confirm")}>
        <Field label={t("api.accounts.form.password")} htmlFor="account-password" name="password" required hint={t("api.accounts.form.passwordHint")}>
          <Input id="account-password" name="password" type="password" maxLength={128} autoComplete="current-password" required />
        </Field>
      </Card>
      <FormActions cancelHref="/admin/api/accounts" submitLabel={t("api.accounts.form.submit")} />
    </Form>
  );
}
