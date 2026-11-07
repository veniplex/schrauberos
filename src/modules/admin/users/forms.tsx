"use client";

import { Checkbox, Field, FormActions, FormCard, Input } from "@/components/ui/form";
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
  const external = initial.authSource !== "local";

  return (
    <FormCard action={saveUser} className="max-w-3xl">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
          <input type="hidden" name="username" value={initial.username} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("users.fields.username")} htmlFor="username" name="username" hint={t("users.fields.usernameHint")} required>
          <Input id="username" name={initial.id ? undefined : "username"} defaultValue={initial.username} disabled={!!initial.id} autoComplete="off" autoCapitalize="none" required />
        </Field>
        <Field label={t("users.fields.name")} htmlFor="name" name="name" required>
          <Input id="name" name="name" defaultValue={initial.name} autoComplete="off" required />
        </Field>
        <Field label={t("users.fields.email")} htmlFor="email" name="email">
          <Input id="email" name="email" type="email" defaultValue={initial.email} autoComplete="off" />
        </Field>
        {external ? (
          <Field label={t("users.fields.authSource")}>
            <Input value={initial.authSource} readOnly disabled />
          </Field>
        ) : (
          <Field
            label={initial.id ? t("users.fields.passwordReset") : t("users.fields.password")}
            htmlFor="password"
            name="password"
            hint={initial.id ? t("users.fields.passwordResetHint") : t("account.passwordRules")}
            required={!initial.id}
          >
            <Input id="password" name="password" type="password" maxLength={128} autoComplete="new-password" required={!initial.id} />
          </Field>
        )}
      </div>

      <Field label={t("users.fields.roles")} group name="roleId">
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
      </Field>

      <div className="flex flex-col gap-2">
        <Checkbox name="active" defaultChecked={initial.active} disabled={isSelf} label={t("users.fields.active")} />
        {isSelf ? <input type="hidden" name="active" value="on" /> : null}
        {!external ? (
          <Checkbox name="mustChangePassword" defaultChecked={initial.mustChangePassword} label={t("users.fields.mustChangePassword")} />
        ) : null}
      </div>

      <FormActions cancelHref="/admin/users" />
    </FormCard>
  );
}
