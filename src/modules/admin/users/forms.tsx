"use client";

import { useActionState } from "react";
import { type ActionState, Checkbox, Field, FieldLabel, FormCard, FormMessage, Input } from "@/components/ui/form";
import { LinkButton, SubmitButton } from "@/components/ui/buttons";
import { useI18n } from "@/i18n/client";
import { saveUser } from "./actions";

export type UserFormInitial = {
  id?: string;
  version?: string;
  username: string;
  name: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  roleIds: string[];
  authSource: string;
};

export function UserForm({
  initial,
  roles,
  lockedRoleIds,
  isSelf,
}: {
  initial: UserFormInitial;
  roles: Array<{ id: string; name: string; description: string | null; isAdmin: boolean }>;
  /** Rollen, die der angemeldete Benutzer nicht vergeben oder entziehen darf (Administrator-Rollen, Verwaltungsrechte, fremde Rechte) */
  lockedRoleIds: string[];
  isSelf: boolean;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveUser, {});
  const err = state.fieldErrors ?? {};
  const external = initial.authSource !== "local";

  return (
    <FormCard action={action} className="max-w-3xl">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
          <input type="hidden" name="username" value={initial.username} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("users.fields.username")} htmlFor="username" error={err.username} hint={t("users.fields.usernameHint")} required>
          <Input id="username" name={initial.id ? undefined : "username"} defaultValue={initial.username} disabled={!!initial.id} invalid={!!err.username} autoComplete="off" autoCapitalize="none" required />
        </Field>
        <Field label={t("users.fields.name")} htmlFor="name" error={err.name} required>
          <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} autoComplete="off" required />
        </Field>
        <Field label={t("users.fields.email")} htmlFor="email" error={err.email}>
          <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} autoComplete="off" />
        </Field>
        {external ? (
          <Field label={t("users.fields.authSource")}>
            <Input value={initial.authSource} readOnly disabled />
          </Field>
        ) : (
          <Field
            label={initial.id ? t("users.fields.passwordReset") : t("users.fields.password")}
            htmlFor="password"
            error={err.password}
            hint={initial.id ? t("users.fields.passwordResetHint") : t("account.passwordRules")}
            required={!initial.id}
          >
            <Input id="password" name="password" type="password" maxLength={128} autoComplete="new-password" invalid={!!err.password} required={!initial.id} />
          </Field>
        )}
      </div>

      <fieldset>
        <FieldLabel as="legend">{t("users.fields.roles")}</FieldLabel>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {roles.map((r) => {
            const locked = lockedRoleIds.includes(r.id);
            return (
              <li key={r.id}>
                <Checkbox
                  name="roleId"
                  value={r.id}
                  defaultChecked={initial.roleIds.includes(r.id)}
                  disabled={locked}
                  label={<span className="font-medium">{r.name}</span>}
                  hint={locked ? t("users.roleLocked") : r.description}
                  className={locked ? "rounded-md border border-line p-3 opacity-60" : "cursor-pointer rounded-md border border-line p-3 hover:bg-surface-hover"}
                />
                {locked && initial.roleIds.includes(r.id) ? <input type="hidden" name="roleId" value={r.id} /> : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Checkbox name="active" defaultChecked={initial.active} disabled={isSelf} label={t("users.fields.active")} />
        {isSelf ? <input type="hidden" name="active" value="on" /> : null}
        {!external ? (
          <Checkbox name="mustChangePassword" defaultChecked={initial.mustChangePassword} label={t("users.fields.mustChangePassword")} />
        ) : null}
      </div>

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <LinkButton href="/admin/users">
          {t("common.cancel")}
        </LinkButton>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </FormCard>
  );
}
