"use client";

import { Checkbox, Field, Form, FormActions, Input, Select, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/buttons";
import { Card } from "@/components/ui/layout";
import { ABSENCE_TYPES, DEPARTMENTS } from "@/modules/office/employees/domain";
import { useI18n } from "@/i18n/client";
import { saveAbsence, saveEmployee, saveQualification } from "./actions";

export type EmployeeFormInitial = {
  id?: string;
  /** Version der Zeile beim Öffnen (optimistische Sperre) */
  version?: string;
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
  return (
    <Form action={saveEmployee} draftKey={`employee:${initial.id ?? "new"}`} className="flex max-w-4xl flex-col gap-5">
      {initial.id ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? ""} />
        </>
      ) : null}

      <Card title={t("employees.sections.person")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("employees.fields.firstName")} htmlFor="firstName" name="firstName" required>
            <Input id="firstName" name="firstName" defaultValue={initial.firstName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.lastName")} htmlFor="lastName" name="lastName" required>
            <Input id="lastName" name="lastName" defaultValue={initial.lastName} maxLength={60} required autoComplete="off" />
          </Field>
          <Field label={t("employees.fields.personnelNumber")} htmlFor="personnelNumber" name="personnelNumber">
            <Input id="personnelNumber" name="personnelNumber" defaultValue={initial.personnelNumber} maxLength={30} autoComplete="off" />
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
          <Field label={t("employees.fields.vacationDays")} htmlFor="vacationDaysPerYear" name="vacationDaysPerYear" hint={t("employees.fields.vacationDaysHint")}>
            <Input id="vacationDaysPerYear" name="vacationDaysPerYear" type="number" min={0} max={60} defaultValue={initial.vacationDaysPerYear} />
          </Field>
        </div>
      </Card>

      <Card title={t("employees.sections.contact")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("customers.fields.email")} htmlFor="email" name="email">
            <Input id="email" name="email" type="email" defaultValue={initial.email} autoComplete="off" />
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
          <Field label={t("employees.fields.leaveDate")} htmlFor="leaveDate" name="leaveDate">
            <Input id="leaveDate" name="leaveDate" type="date" defaultValue={initial.leaveDate} />
          </Field>
        </div>
        <Checkbox name="active" defaultChecked={initial.active} label={t("employees.fields.active")} className="mt-4" />
        <Field label={t("employees.fields.userAccount")} htmlFor="userId" name="userId" hint={t("employees.fields.userAccountHint")} className="mt-4">
          <Select id="userId" name="userId" defaultValue={initial.userId}>
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
              <Input id="emergencyName" name="emergencyName" data-no-draft defaultValue={initial.emergencyName} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyPhone")} htmlFor="emergencyPhone">
              <Input id="emergencyPhone" name="emergencyPhone" data-no-draft type="tel" defaultValue={initial.emergencyPhone} autoComplete="off" />
            </Field>
            <Field label={t("employees.fields.emergencyRelation")} htmlFor="emergencyRelation">
              <Input id="emergencyRelation" name="emergencyRelation" data-no-draft defaultValue={initial.emergencyRelation} maxLength={40} autoComplete="off" />
            </Field>
          </div>
        </Card>
      ) : null}

      <FormActions cancelHref={cancelHref} />
    </Form>
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
  return (
    <Form action={saveAbsence} className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("employees.title")} htmlFor="employeeId" name="employeeId" required>
          <Select id="employeeId" name="employeeId" defaultValue={initialEmployeeId} required>
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
        <Field label={t("employees.fields.absenceType")} htmlFor="type" name="type" required>
          <Select id="type" name="type" defaultValue="vacation">
            {ABSENCE_TYPES.filter((x) => x !== "sick" || canSensitive).map((x) => (
              <option key={x} value={x}>
                {td(`employees.absenceTypes.${x}`, x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("employees.fields.from")} htmlFor="startDate" name="startDate" required>
          <Input id="startDate" name="startDate" type="date" defaultValue={initialDate} required />
        </Field>
        <Field label={t("employees.fields.to")} htmlFor="endDate" name="endDate" hint={t("employees.fields.toHint")} required>
          <Input id="endDate" name="endDate" type="date" defaultValue={initialDate} required />
        </Field>
      </div>
      <Field label={t("common.notes")} htmlFor="note">
        <Input id="note" name="note" maxLength={200} />
      </Field>
      <FormActions cancelHref={closeHref} />
    </Form>
  );
}

/* ───────────── Qualifikation (Inline) ───────────── */

export function QualificationForm({ employeeId }: { employeeId: string }) {
  const { t } = useI18n();
  return (
    <Form action={saveQualification} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <Input name="name" placeholder={t("employees.fields.qualification")} aria-label={t("employees.fields.qualification")} className="min-w-48 flex-[2]" maxLength={100} required />
      <Field label={t("employees.fields.issuedAt")} htmlFor="issuedAt" className="min-w-36 flex-1">
        <Input id="issuedAt" name="issuedAt" type="date" />
      </Field>
      <Field label={t("employees.fields.expiresAt")} htmlFor="expiresAt" name="expiresAt" className="min-w-36 flex-1">
        <Input id="expiresAt" name="expiresAt" type="date" />
      </Field>
      <SubmitButton size="sm" className="mt-5">
        {t("common.add")}
      </SubmitButton>
    </Form>
  );
}
