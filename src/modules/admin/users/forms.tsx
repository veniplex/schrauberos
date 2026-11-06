"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
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
  canAssignAdmin,
  isSelf,
}: {
  initial: UserFormInitial;
  roles: Array<{ id: string; name: string; description: string | null; isAdmin: boolean }>;
  canAssignAdmin: boolean;
  isSelf: boolean;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveUser, {});
  const err = state.fieldErrors ?? {};
  const external = initial.authSource !== "local";

  return (
    <form action={action} className="card card-pad flex max-w-3xl flex-col gap-5">
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
            <p className="input flex items-center bg-surface-2">{initial.authSource}</p>
          </Field>
        ) : (
          <Field
            label={initial.id ? t("users.fields.passwordReset") : t("users.fields.password")}
            htmlFor="password"
            error={err.password}
            hint={initial.id ? t("users.fields.passwordResetHint") : t("account.passwordRules")}
            required={!initial.id}
          >
            <Input id="password" name="password" type="password" autoComplete="new-password" invalid={!!err.password} required={!initial.id} />
          </Field>
        )}
      </div>

      <fieldset>
        <legend className="field-label">{t("users.fields.roles")}</legend>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {roles.map((r) => {
            const locked = r.isAdmin && !canAssignAdmin;
            return (
              <li key={r.id}>
                <label className={`flex items-start gap-3 rounded-md border border-line p-3 ${locked ? "opacity-60" : "cursor-pointer hover:bg-surface-hover"}`}>
                  <input
                    type="checkbox"
                    name="roleId"
                    value={r.id}
                    defaultChecked={initial.roleIds.includes(r.id)}
                    disabled={locked}
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{r.name}</span>
                    {r.description ? <span className="block text-xs text-ink-muted">{r.description}</span> : null}
                  </span>
                </label>
                {locked && initial.roleIds.includes(r.id) ? <input type="hidden" name="roleId" value={r.id} /> : null}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={initial.active} disabled={isSelf} className="size-4 accent-[var(--accent)]" />
          {t("users.fields.active")}
          {isSelf ? <input type="hidden" name="active" value="on" /> : null}
        </label>
        {!external ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="mustChangePassword" defaultChecked={initial.mustChangePassword} className="size-4 accent-[var(--accent)]" />
            {t("users.fields.mustChangePassword")}
          </label>
        ) : null}
      </div>

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href="/admin/users" className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}
