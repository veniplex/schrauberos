"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { Field, FormMessage, Input, Select, Textarea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { ABSENCE_TYPES, DEPARTMENTS } from "@/modules/office/employees/domain";
import { useI18n } from "@/i18n/client";
import { saveAbsence, saveEmployee, saveQualification } from "./actions";

export type EmployeeFormInitial = {
  id?: string;
  firstName: string;
  lastName: string;
  personnelNumber: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  mobile: string;
  hireDate: string;
  leaveDate: string;
  active: boolean;
  vacationDaysPerYear: string;
  notes: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  userId: string;
};

export function EmployeeForm({
  initial,
  users,
  canSensitive,
  cancelHref,
}: {
  initial: EmployeeFormInitial;
  users: Array<{ id: string; name: string; username: string }>;
  canSensitive: boolean;
  cancelHref: string;
}) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveEmployee, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <Card title={t("employees.sections.person")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.firstName")} htmlFor="firstName" error={err.firstName} required>
            <Input id="firstName" name="firstName" defaultValue={initial.firstName} invalid={!!err.firstName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.lastName")} htmlFor="lastName" error={err.lastName} required>
            <Input id="lastName" name="lastName" defaultValue={initial.lastName} invalid={!!err.lastName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.personnelNumber")} htmlFor="personnelNumber" error={err.personnelNumber}>
            <Input id="personnelNumber" name="personnelNumber" defaultValue={initial.personnelNumber} invalid={!!err.personnelNumber} maxLength={30} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.jobTitle")} htmlFor="jobTitle">
            <Input id="jobTitle" name="jobTitle" defaultValue={initial.jobTitle} maxLength={80} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.department")} htmlFor="department">
            <Select id="department" name="department" defaultValue={initial.department}>
              {DEPARTMENTS.map((x) => (
                <option key={x} value={x}>
                  {td(`employees.departments.${x}`, x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("employees.fields.vacationDays")} htmlFor="vacationDaysPerYear" error={err.vacationDaysPerYear} hint={t("employees.fields.vacationDaysHint")}>
            <Input id="vacationDaysPerYear" name="vacationDaysPerYear" type="number" min={0} max={60} defaultValue={initial.vacationDaysPerYear} />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.contact")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("customers.fields.email")} htmlFor="email" error={err.email}>
            <Input id="email" name="email" type="email" defaultValue={initial.email} invalid={!!err.email} autoComplete="off" />
          </Field>
          <Field label={t("customers.fields.phone")} htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.mobile")} htmlFor="mobile">
            <Input id="mobile" name="mobile" type="tel" defaultValue={initial.mobile} autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.employment")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.hireDate")} htmlFor="hireDate">
            <Input id="hireDate" name="hireDate" type="date" defaultValue={initial.hireDate} />
          </Field>
          <Field label={t("employees.fields.leaveDate")} htmlFor="leaveDate" error={err.leaveDate}>
            <Input id="leaveDate" name="leaveDate" type="date" defaultValue={initial.leaveDate} invalid={!!err.leaveDate} />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={initial.active} className="size-4 accent-[var(--accent)]" />
          {t("employees.fields.active")}
        </label>
        <Field label={t("employees.fields.userAccount")} htmlFor="userId" error={err.userId} hint={t("employees.fields.userAccountHint")} className="mt-4">
          <Select id="userId" name="userId" defaultValue={initial.userId} invalid={!!err.userId}>
            <option value="">{t("employees.fields.noUser")}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.notes")} htmlFor="notes" className="mt-4">
          <Textarea id="notes" name="notes" defaultValue={initial.notes} maxLength={2000} />
        </Field>
      </Card>

      {canSensitive ? (
        <Card title={t("employees.sections.emergency")}>
          <p className="mb-3 text-sm text-ink-muted">{t("employees.sensitiveHint")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("employees.fields.emergencyName")} htmlFor="emergencyName">
              <Input id="emergencyName" name="emergencyName" defaultValue={initial.emergencyName} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyPhone")} htmlFor="emergencyPhone">
              <Input id="emergencyPhone" name="emergencyPhone" type="tel" defaultValue={initial.emergencyPhone} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyRelation")} htmlFor="emergencyRelation">
              <Input id="emergencyRelation" name="emergencyRelation" defaultValue={initial.emergencyRelation} maxLength={40} autoComplete="off" />
            </Field>
          </div>
        </Card>
      ) : null}

      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href={cancelHref} className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────── Abwesenheit (im Modal) ───────────── */

export function AbsenceForm({
  employees,
  initialEmployeeId,
  initialDate,
  canSensitive,
  returnTo,
  closeHref,
}: {
  employees: Array<{ id: string; name: string }>;
  initialEmployeeId: string;
  initialDate: string;
  canSensitive: boolean;
  returnTo: string;
  closeHref: string;
}) {
  const { t, td } = useI18n();
  const [state, action] = useActionState<ActionState, FormData>(saveAbsence, {});
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("employees.title")} htmlFor="employeeId" error={err.employeeId} required>
          <Select id="employeeId" name="employeeId" defaultValue={initialEmployeeId} invalid={!!err.employeeId} required>
            <option value="" disabled>
              {t("employees.fields.choose")}
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.fields.absenceType")} htmlFor="type" error={err.type} required>
          <Select id="type" name="type" defaultValue="vacation" invalid={!!err.type}>
            {ABSENCE_TYPES.filter((x) => x !== "sick" || canSensitive).map((x) => (
              <option key={x} value={x}>
                {td(`employees.absenceTypes.${x}`, x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.fields.from")} htmlFor="startDate" error={err.startDate} required>
          <Input id="startDate" name="startDate" type="date" defaultValue={initialDate} invalid={!!err.startDate} required />
        </Field>
        <Field label={t("employees.fields.to")} htmlFor="endDate" error={err.endDate} hint={t("employees.fields.toHint")} required>
          <Input id="endDate" name="endDate" type="date" defaultValue={initialDate} invalid={!!err.endDate} required />
        </Field>
      </div>
      <Field label={t("common.notes")} htmlFor="note">
        <Input id="note" name="note" maxLength={200} />
      </Field>
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Link href={closeHref} className="btn btn-secondary">
          {t("common.cancel")}
        </Link>
        <SubmitButton>{t("common.save")}</SubmitButton>
      </div>
    </form>
  );
}

/* ───────────── Qualifikation (Inline) ───────────── */

export function QualificationForm({ employeeId }: { employeeId: string }) {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const result = await saveQualification(prev, fd);
    if (result.ok) formRef.current?.reset();
    return result;
  }, {});
  const err = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Input name="name" placeholder={t("employees.fields.qualification")} aria-label={t("employees.fields.qualification")} className="min-w-48 flex-[2]" maxLength={100} required invalid={!!err.name} />
      <label className="flex min-w-36 flex-1 flex-col text-xs text-ink-muted">
        {t("employees.fields.issuedAt")}
        <Input name="issuedAt" type="date" className="mt-1" />
      </label>
      <label className="flex min-w-36 flex-1 flex-col text-xs text-ink-muted">
        {t("employees.fields.expiresAt")}
        <Input name="expiresAt" type="date" className="mt-1" invalid={!!err.expiresAt} />
        {err.expiresAt ? <span className="field-error">{err.expiresAt}</span> : null}
      </label>
      <SubmitButton size="sm" className="mt-5">
        {t("common.add")}
      </SubmitButton>
    </form>
  );
}
