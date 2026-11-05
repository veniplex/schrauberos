"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, FormMessage, Input, Select, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { PERMISSION_AREAS, PERMISSION_GROUPS, type Area } from "@/modules/permissions";
import { ACCENT_PRESETS } from "@/lib/color";
import { WEEKDAYS } from "@/lib/domain/constants";
import type { OpeningHours } from "@/lib/domain/opening-hours";
import { useI18n } from "@/i18n/client";
import { saveUser } from "./user-actions";
import { saveRole } from "./role-actions";
import { saveWorkshop } from "./settings-actions";
import { changePassword, saveProfile } from "./account-actions";

/* ───────────── Benutzer ───────────── */

export type UserFormInitial = {
  id?: string;
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

/* ───────────── Rollen ───────────── */

export function RoleForm({
  initial,
}: {
  initial: { id?: string; name: string; description: string; isAdmin: boolean; permissions: string[] };
}) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveRole, {});
  const [selected, setSelected] = useState(() => new Set(initial.permissions));
  const err = state.fieldErrors ?? {};

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleGroup = (keys: readonly string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("roles.fields.name")} htmlFor="name" error={err.name} required>
            <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} maxLength={60} required />
          </Field>
          <Field label={t("roles.fields.description")} htmlFor="description">
            <Input id="description" name="description" defaultValue={initial.description} maxLength={300} />
          </Field>
        </div>
      </Card>

      {initial.isAdmin ? (
        <p className="rounded-md bg-info-bg px-3.5 py-2.5 text-sm text-info-ink">{t("roles.adminNotice")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {(Object.keys(PERMISSION_AREAS) as Area[]).map((area) => (
            <section key={area} aria-labelledby={`perm-area-${area}`}>
              <h2 id={`perm-area-${area}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t(`areas.${area}`)}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {PERMISSION_AREAS[area].map((group) => {
                  const keys = PERMISSION_GROUPS[group];
                  const allOn = keys.every((k) => selected.has(k));
                  return (
                    <Card
                      key={group}
                      title={t(`permissionGroups.${group}`)}
                      actions={
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleGroup(keys, !allOn)}>
                          {allOn ? t("roles.selectNone") : t("roles.selectAll")}
                        </button>
                      }
                    >
                      <ul className="flex flex-col gap-2">
                        {keys.map((key) => (
                          <li key={key}>
                            <label className="flex cursor-pointer items-center gap-3 text-sm">
                              <input
                                type="checkbox"
                                name="permission"
                                value={key}
                                checked={selected.has(key)}
                                onChange={(e) => toggle(key, e.target.checked)}
                                className="size-4 accent-[var(--accent)]"
                              />
                              {t(`permissions.${key}` as never)}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href="/admin/roles" className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────── Werkstatt-Profil ───────────── */

export type WorkshopFormInitial = {
  name: string;
  tagline: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  email: string;
  website: string;
  accentColor: string;
  logoDataUrl: string | null;
  hours: OpeningHours;
  dayStartHour: number;
  dayEndHour: number;
  slotMinutes: number;
  treadWarnMm: number;
  treadReplaceMm: number;
  tireAgeWarnYears: number;
  tireAgeReplaceYears: number;
};

export function WorkshopForm({ initial }: { initial: WorkshopFormInitial }) {
  const { t } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveWorkshop, {});
  const [accent, setAccent] = useState(initial.accentColor);
  const [closed, setClosed] = useState(() => Object.fromEntries(WEEKDAYS.map((d) => [d, initial.hours[d] === null])));
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} encType="multipart/form-data" className="flex max-w-4xl flex-col gap-5">
      <Card title={t("settings.workshop.identity")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.workshop.name")} htmlFor="name" error={err.name} required>
            <Input id="name" name="name" defaultValue={initial.name} invalid={!!err.name} maxLength={80} required />
          </Field>
          <Field label={t("settings.workshop.tagline")} htmlFor="tagline">
            <Input id="tagline" name="tagline" defaultValue={initial.tagline} maxLength={120} />
          </Field>
          <Field label={t("customers.fields.street")} htmlFor="street">
            <Input id="street" name="street" defaultValue={initial.street} />
          </Field>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <Field label={t("customers.fields.zip")} htmlFor="zip">
              <Input id="zip" name="zip" defaultValue={initial.zip} />
            </Field>
            <Field label={t("customers.fields.city")} htmlFor="city">
              <Input id="city" name="city" defaultValue={initial.city} />
            </Field>
          </div>
          <Field label={t("customers.fields.phone")} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} />
          </Field>
          <Field label={t("customers.fields.email")} htmlFor="email" error={err.email}>
            <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} />
          </Field>
          <Field label={t("settings.workshop.website")} htmlFor="website" className="sm:col-span-2">
            <Input id="website" name="website" defaultValue={initial.website} placeholder="https://" />
          </Field>
        </div>
      </Card>

      <Card title={t("settings.workshop.branding")}>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="field-label">{t("settings.workshop.logo")}</p>
            <div className="flex items-center gap-4">
              {initial.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Data-URL
                <img src={initial.logoDataUrl} alt="" className="size-14 rounded-md border border-line object-contain p-1" />
              ) : (
                <span className="grid size-14 place-items-center rounded-md border border-dashed border-line-strong text-xs text-ink-muted">–</span>
              )}
              <div className="min-w-0 flex-1">
                <input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm" aria-label={t("settings.workshop.logo")} />
                {err.logo ? <p className="field-error">{err.logo}</p> : <p className="field-hint">{t("settings.workshop.logoHint")}</p>}
              </div>
            </div>
            {initial.logoDataUrl ? (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" name="removeLogo" className="size-4 accent-[var(--accent)]" /> {t("settings.workshop.removeLogo")}
              </label>
            ) : null}
          </div>
          <div>
            <p className="field-label">{t("settings.workshop.accent")}</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  aria-label={c}
                  aria-pressed={accent.toLowerCase() === c}
                  className="size-8 rounded-full border-2 border-surface outline outline-1 outline-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ink"
                  style={{ background: c }}
                />
              ))}
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label={t("settings.workshop.accentCustom")} className="size-8 cursor-pointer rounded-md border border-line-strong bg-surface p-0.5" />
              <input type="hidden" name="accentColor" value={accent} />
            </div>
            {err.accentColor ? <p className="field-error">{err.accentColor}</p> : <p className="field-hint">{t("settings.workshop.accentHint")}</p>}
          </div>
        </div>
      </Card>

      <Card title={t("settings.workshop.hours")}>
        <ul className="flex flex-col gap-2">
          {WEEKDAYS.map((day) => (
            <li key={day} className="grid grid-cols-[6rem_1fr] items-center gap-3 sm:grid-cols-[8rem_auto_auto_1fr]">
              <span className="text-sm font-medium">{t(`enums.weekday.${day}`)}</span>
              <label className="flex items-center gap-2 text-sm sm:order-4">
                <input
                  type="checkbox"
                  name={`hours.${day}.closed`}
                  checked={closed[day]}
                  onChange={(e) => setClosed((c) => ({ ...c, [day]: e.target.checked }))}
                  className="size-4 accent-[var(--accent)]"
                />
                {t("settings.workshop.closed")}
              </label>
              <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:contents">
                <Input type="time" name={`hours.${day}.from`} defaultValue={initial.hours[day]?.[0] ?? "07:30"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.from")}`} className="w-28" />
                <span className="text-ink-muted sm:hidden">–</span>
                <Input type="time" name={`hours.${day}.to`} defaultValue={initial.hours[day]?.[1] ?? "17:00"} disabled={closed[day]} aria-label={`${t(`enums.weekday.${day}`)} – ${t("settings.workshop.to")}`} className="w-28" />
              </div>
              {err[`hours.${day}`] ? <p className="field-error col-span-full">{err[`hours.${day}`]}</p> : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("settings.workshop.calendar")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("settings.workshop.dayStart")} htmlFor="dayStartHour" error={err.dayStartHour}>
            <Input id="dayStartHour" name="dayStartHour" type="number" min={0} max={23} defaultValue={initial.dayStartHour} />
          </Field>
          <Field label={t("settings.workshop.dayEnd")} htmlFor="dayEndHour" error={err.dayEndHour}>
            <Input id="dayEndHour" name="dayEndHour" type="number" min={1} max={24} defaultValue={initial.dayEndHour} invalid={!!err.dayEndHour} />
          </Field>
          <Field label={t("settings.workshop.slot")} htmlFor="slotMinutes">
            <Select id="slotMinutes" name="slotMinutes" defaultValue={String(initial.slotMinutes)}>
              {[10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={t("settings.workshop.tireRules")}>
        <p className="mb-4 text-sm text-ink-muted">{t("settings.workshop.tireRulesHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("settings.workshop.treadWarn")} htmlFor="treadWarnMm" error={err.treadWarnMm}>
            <Input id="treadWarnMm" name="treadWarnMm" type="number" step="0.1" min={1} max={10} defaultValue={initial.treadWarnMm} />
          </Field>
          <Field label={t("settings.workshop.treadReplace")} htmlFor="treadReplaceMm" error={err.treadReplaceMm}>
            <Input id="treadReplaceMm" name="treadReplaceMm" type="number" step="0.1" min={1} max={10} defaultValue={initial.treadReplaceMm} invalid={!!err.treadReplaceMm} />
          </Field>
          <Field label={t("settings.workshop.ageWarn")} htmlFor="tireAgeWarnYears" error={err.tireAgeWarnYears}>
            <Input id="tireAgeWarnYears" name="tireAgeWarnYears" type="number" min={1} max={20} defaultValue={initial.tireAgeWarnYears} invalid={!!err.tireAgeWarnYears} />
          </Field>
          <Field label={t("settings.workshop.ageReplace")} htmlFor="tireAgeReplaceYears" error={err.tireAgeReplaceYears}>
            <Input id="tireAgeReplaceYears" name="tireAgeReplaceYears" type="number" min={1} max={25} defaultValue={initial.tireAgeReplaceYears} />
          </Field>
        </div>
      </Card>

      <FormMessage state={state} />
      <div className="flex justify-end">
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────── Konto ───────────── */

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
